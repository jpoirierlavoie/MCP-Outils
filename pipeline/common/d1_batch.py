"""Export par lots SQLite -> Cloudflare D1 et bascule bleu-vert hors ligne.

Principes :
1. Toute source est d'abord assemblée et validée dans une base SQLite locale (`.db`).
2. Aucune transaction explicite (`BEGIN` / `COMMIT`) n'est émise dans les lots `.sql`,
   car `wrangler d1 execute --remote --file` les encapsule lui-même.
3. Chaque instruction `INSERT` reste <= 75 Ko et chaque fichier `.sql` <= 6 Mo.
4. Les index secondaires et tables virtuelles `FTS5` à contenu externe sont construits
   en fin de chargement (par tranches d'identifiants `BETWEEN lo AND hi`) afin d'éviter
   tout dépassement du délai CPU par requête de D1 et tout gonflement réseau.
5. En mode bascule bleu-vert (`provision_or_get_d1`), une base datée p. ex.
   `outils-adresses-20261115` peut être créée, chargée et contrôlée intégralement avant
   toute mise à jour atomique de `database_id` dans `wrangler.jsonc`.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import subprocess
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path
from typing import Iterable, Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "6276df02799535c0e96225fdf6184023")
NODE_BIN = shutil.which("node.exe" if os.name == "nt" else "node") or "node"
WRANGLER_JS = REPO_ROOT / "node_modules" / "wrangler" / "bin" / "wrangler.js"
NPX_BIN = shutil.which("npx.cmd" if os.name == "nt" else "npx") or (
    "npx.cmd" if os.name == "nt" else "npx"
)

MAX_STMT_BYTES = 75_000
MAX_FILE_BYTES = 6_000_000


def strip_accents(text: str) -> str:
    expanded = (
        text.replace("Œ", "OE")
        .replace("œ", "oe")
        .replace("Æ", "AE")
        .replace("æ", "ae")
        .replace("ß", "ss")
    )
    nfd = unicodedata.normalize("NFD", expanded)
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")


def normalize_search_text(text: str) -> str:
    lowered = strip_accents(text).lower()
    cleaned = re.sub(r"[^a-z0-9]+", " ", lowered)
    return " ".join(cleaned.split())


def sql_literal(val: object) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "1" if val else "0"
    if isinstance(val, int):
        return str(val)
    if isinstance(val, float):
        if val != val:  # NaN
            return "NULL"
        return repr(val)
    s = str(val).replace("\x00", "")
    return "'" + s.replace("'", "''") + "'"


def export_table_batches(
    conn: sqlite3.Connection,
    table: str,
    columns: Sequence[str],
    out_dir: Path,
    prefix: str,
    order_by: str | None = None,
    max_file_bytes: int = MAX_FILE_BYTES,
    max_stmt_bytes: int = MAX_STMT_BYTES,
) -> tuple[list[Path], int]:
    """Exporte une table SQLite locale en fichiers `.sql` compacts multi-lignes."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cols_sql = ", ".join(columns)
    order_clause = f" ORDER BY {order_by}" if order_by else ""
    cur = conn.execute(f"SELECT {cols_sql} FROM {table}{order_clause}")

    files: list[Path] = []
    file_idx = 1
    current_stmts: list[str] = []
    current_file_bytes = 0

    stmt_header = f"INSERT INTO {table} ({cols_sql}) VALUES\n"
    stmt_rows: list[str] = []
    stmt_bytes = len(stmt_header.encode("utf-8"))
    total_rows = 0

    def flush_stmt() -> None:
        nonlocal stmt_rows, stmt_bytes, current_file_bytes
        if not stmt_rows:
            return
        stmt = stmt_header + ",\n".join(stmt_rows) + ";\n"
        stmt_b = len(stmt.encode("utf-8"))
        if current_stmts and current_file_bytes + stmt_b > max_file_bytes:
            flush_file()
        current_stmts.append(stmt)
        current_file_bytes += stmt_b
        stmt_rows = []
        stmt_bytes = len(stmt_header.encode("utf-8"))

    def flush_file() -> None:
        nonlocal file_idx, current_stmts, current_file_bytes
        if not current_stmts:
            return
        fpath = out_dir / f"{prefix}_{file_idx:04d}.sql"
        fpath.write_text("".join(current_stmts), encoding="utf-8", newline="\n")
        files.append(fpath)
        file_idx += 1
        current_stmts = []
        current_file_bytes = 0

    for row in cur:
        total_rows += 1
        tup = "(" + ",".join(sql_literal(v) for v in row) + ")"
        tup_b = len(tup.encode("utf-8")) + 2
        if stmt_rows and stmt_bytes + tup_b > max_stmt_bytes:
            flush_stmt()
        stmt_rows.append(tup)
        stmt_bytes += tup_b

    flush_stmt()
    flush_file()
    return files, total_rows


def build_fts_slice_statements(
    conn: sqlite3.Connection,
    fts_table: str,
    base_table: str,
    id_col: str,
    fts_cols: Sequence[str],
    slice_size: int = 40_000,
) -> list[str]:
    row = conn.execute(f"SELECT MIN({id_col}), MAX({id_col}) FROM {base_table}").fetchone()
    if not row or row[0] is None or row[1] is None:
        return []
    min_id, max_id = int(row[0]), int(row[1])
    cols_csv = ", ".join(fts_cols)
    stmts: list[str] = []
    lo = min_id
    while lo <= max_id:
        hi = lo + slice_size - 1
        stmts.append(
            f"INSERT INTO {fts_table}(rowid, {cols_csv}) "
            f"SELECT {id_col}, {cols_csv} FROM {base_table} "
            f"WHERE {id_col} BETWEEN {lo} AND {hi};"
        )
        lo = hi + 1
    return stmts


_D1_UUID_TO_NAME: dict[str, str] = {}


def _has_cf_api_token() -> bool:
    return bool(os.environ.get("CLOUDFLARE_API_TOKEN", "").strip())


def _wrangler_prefix() -> list[str]:
    if WRANGLER_JS.exists():
        return [NODE_BIN, str(WRANGLER_JS)]
    return [NPX_BIN, "wrangler"]


def _run_wrangler_json(args: list[str], timeout: int = 120) -> object:
    cmd = [*_wrangler_prefix(), *args]
    proc = subprocess.run(
        cmd,
        cwd=REPO_ROOT,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    if proc.returncode != 0:
        err = ((proc.stderr or "") + "\n" + (proc.stdout or "")).strip()
        raise RuntimeError(f"Échec wrangler {' '.join(args[:4])} : {err[-1500:]}")
    raw = (proc.stdout or "").strip()
    if not raw:
        raise RuntimeError(f"Sortie JSON vide de wrangler {' '.join(args[:4])}")
    return json.loads(raw)


def _cf_headers() -> dict[str, str]:
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if not token:
        raise RuntimeError("CLOUDFLARE_API_TOKEN absent de l'environnement.")
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
    }


def list_d1_databases() -> list[dict]:
    if not _has_cf_api_token():
        data = _run_wrangler_json(["d1", "list", "--json"])
        if not isinstance(data, list):
            raise RuntimeError(f"Format inattendu de wrangler d1 list --json : {type(data)}")
        for db in data:
            if isinstance(db, dict) and db.get("uuid") and db.get("name"):
                _D1_UUID_TO_NAME[str(db["uuid"])] = str(db["name"])
        return data

    results: list[dict] = []
    page = 1
    while True:
        url = (
            f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database"
            f"?per_page=100&page={page}"
        )
        req = urllib.request.Request(url, headers=_cf_headers())
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        if not payload.get("success"):
            raise RuntimeError(f"Erreur API D1 list: {payload.get('errors')}")
        batch = payload.get("result") or []
        for db in batch:
            if isinstance(db, dict) and db.get("uuid") and db.get("name"):
                _D1_UUID_TO_NAME[str(db["uuid"])] = str(db["name"])
        results.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return results


def _resolve_d1_name(database_id_or_name: str) -> str:
    if database_id_or_name in _D1_UUID_TO_NAME:
        return _D1_UUID_TO_NAME[database_id_or_name]
    for db in list_d1_databases():
        if str(db.get("uuid")) == database_id_or_name or str(db.get("name")) == database_id_or_name:
            return str(db["name"])
    return database_id_or_name


def provision_or_get_d1(db_name: str, location: str = "enam") -> dict:
    for db in list_d1_databases():
        if db.get("name") == db_name:
            return db
    if not _has_cf_api_token():
        cmd = [*_wrangler_prefix(), "d1", "create", db_name, "--location", location]
        proc = subprocess.run(
            cmd,
            cwd=REPO_ROOT,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        if proc.returncode != 0:
            err = ((proc.stderr or "") + "\n" + (proc.stdout or "")).strip()
            raise RuntimeError(f"Échec création D1 {db_name} via Wrangler : {err[-1500:]}")
        for db in list_d1_databases():
            if db.get("name") == db_name:
                return db
        raise RuntimeError(f"Base D1 {db_name} créée mais introuvable dans wrangler d1 list.")

    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database"
    body = json.dumps({"name": db_name, "primary_location_hint": location}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers=_cf_headers())
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if not payload.get("success"):
        raise RuntimeError(f"Échec création D1 {db_name}: {payload.get('errors')}")
    return payload["result"]


def d1_query_remote(database_id: str, sql: str, params: Sequence[object] | None = None) -> list[dict]:
    if not _has_cf_api_token():
        if params:
            raise RuntimeError(
                "d1_query_remote via session OAuth Wrangler ne supporte pas params positionnels."
            )
        db_name = _resolve_d1_name(database_id)
        last_err: Exception | None = None
        for attempt in range(4):
            try:
                payload = _run_wrangler_json(
                    ["d1", "execute", db_name, "--remote", "--json", "--command", sql],
                    timeout=180,
                )
                if isinstance(payload, list) and payload:
                    last_res = payload[-1]
                    if isinstance(last_res, dict):
                        return list(last_res.get("results") or [])
                return []
            except (RuntimeError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
                last_err = exc
                if attempt < 3:
                    time.sleep(2.0 * (attempt + 1))
                    continue
                raise last_err
        return []

    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}"
        f"/d1/database/{database_id}/query"
    )
    body_obj: dict[str, object] = {"sql": sql}
    if params:
        body_obj["params"] = list(params)
    body = json.dumps(body_obj).encode("utf-8")

    last_err: Exception | None = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, data=body, method="POST", headers=_cf_headers())
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            if not payload.get("success"):
                raise RuntimeError(f"Erreur SQL D1: {payload.get('errors')}")
            res_list = payload.get("result") or []
            return res_list[-1].get("results", []) if res_list else []
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, RuntimeError) as exc:
            last_err = exc
            if attempt < 3:
                time.sleep(2.0 * (attempt + 1))
                continue
            raise last_err
    return []


def get_d1_database_info(database_id: str) -> dict:
    if not _has_cf_api_token():
        db_name = _resolve_d1_name(database_id)
        info = _run_wrangler_json(["d1", "info", db_name, "--json"])
        if not isinstance(info, dict):
            raise RuntimeError(f"Format inattendu de wrangler d1 info {db_name}")
        if "file_size" not in info and "database_size" in info:
            info["file_size"] = info["database_size"]
        return info

    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{database_id}"
    req = urllib.request.Request(url, headers=_cf_headers())
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if not payload.get("success"):
        raise RuntimeError(f"Erreur API D1 get {database_id}: {payload.get('errors')}")
    return payload["result"]


def execute_sql_file_remote(db_name: str, sql_file: Path, max_retries: int = 4) -> None:
    if WRANGLER_JS.exists():
        prefix_cmd = [NODE_BIN, str(WRANGLER_JS)]
    else:
        prefix_cmd = [NPX_BIN, "wrangler"]
    cmd = [
        *prefix_cmd,
        "d1",
        "execute",
        db_name,
        "--remote",
        f"--file={sql_file}",
        "--yes",
    ]
    last_err = ""
    for attempt in range(max_retries):
        proc = subprocess.run(
            cmd,
            cwd=REPO_ROOT,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=600,
        )
        if proc.returncode == 0:
            return
        last_err = (proc.stderr or "") + "\n" + (proc.stdout or "")
        if attempt < max_retries - 1:
            time.sleep(3.0 * (attempt + 1))
    raise RuntimeError(
        f"Échec wrangler d1 execute sur {db_name} ({sql_file.name}):\n{last_err[-1500:]}"
    )


def execute_sql_files_remote(db_name: str, files: Iterable[Path]) -> None:
    file_list = list(files)
    total = len(file_list)
    for idx, fpath in enumerate(file_list, 1):
        t0 = time.perf_counter()
        execute_sql_file_remote(db_name, fpath)
        dt = time.perf_counter() - t0
        if idx == 1 or idx == total or idx % 5 == 0:
            print(
                f"  [{db_name}] lot {idx}/{total} ({fpath.name}, "
                f"{fpath.stat().st_size / 1024:.0f} Ko) exécuté en {dt:.1f}s"
            )
