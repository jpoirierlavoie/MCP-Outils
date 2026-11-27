from __future__ import annotations

import argparse
import csv
import datetime as dt
import concurrent.futures
import io
import json
import re
import shutil
import sqlite3
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

from pipeline.common.blue_green import dated_db_name, swap_wrangler_binding, verify_remote_candidate
from pipeline.common.d1_batch import (
    ACCOUNT_ID,
    REPO_ROOT,
    build_fts_slice_statements,
    d1_query_remote,
    execute_sql_files_remote,
    export_table_batches,
    provision_or_get_d1,
    strip_accents,
)

HERE = Path(__file__).resolve().parent
SOURCES_DIR = REPO_ROOT / "pipeline" / "sources"
WORK_DIR = REPO_ROOT / "pipeline" / "work" / "adresses"
BATCH_DIR = REPO_ROOT / "pipeline" / "batches" / "adresses"
LOCAL_DB_PATH = WORK_DIR / "outils_adresses.db"
SCRATCH_DB_PATH = WORK_DIR / "_scratch_civiques.db"

RQA_CKAN_URL = (
    "https://www.donneesquebec.ca/recherche/api/3/action/"
    "package_show?id=referentiel-quebecois-des-adresses"
)

BATCH_MAX_FILE_BYTES = 18_000_000

STATIC_CITY_ALIASES: dict[str, list[str]] = {
    "montreal": [
        "mtl",
        "mtrl",
        "ville marie",
        "verdun",
        "lasalle",
        "lachine",
        "anjou",
        "outremont",
        "saint laurent",
        "st laurent",
        "saint leonard",
        "st leonard",
        "pierrefonds",
        "roxboro",
        "pointe aux trembles",
        "riviere des prairies",
        "rosemont",
        "villeray",
        "ahuntsic",
        "cote des neiges",
        "notre dame de grace",
        "ndg",
        "montreal nord",
    ],
    "quebec": [
        "qc",
        "ville de quebec",
        "sainte foy",
        "ste foy",
        "beauport",
        "charlesbourg",
        "sillery",
        "cap rouge",
        "loretteville",
        "val belair",
        "vanier",
        "limoilou",
    ],
    "laval": [
        "chomedey",
        "vimont",
        "duvernay",
        "fabreville",
        "auteuil",
        "pont viau",
        "sainte dorothee",
        "ste dorothee",
        "sainte rose",
        "ste rose",
        "laval des rapides",
    ],
    "longueuil": ["saint hubert", "st hubert", "greenfield park", "vieux longueuil"],
    "gatineau": ["hull", "aylmer", "buckingham", "masson angers"],
    "saguenay": ["chicoutimi", "jonquiere", "la baie"],
    "trois rivieres": ["tr", "3 rivieres", "cap de la madeleine", "trois rivieres ouest"],
    "sherbrooke": ["fleurimont", "lennoxville", "rock forest"],
    "levis": ["saint nicolas", "st nicolas", "charny", "lauzon", "saint romuald", "st romuald"],
}


def fold_address_token(raw: str) -> str:
    s = strip_accents(raw)
    s = re.sub(r"[\u2018\u2019\u02bc']", " ", s).lower()
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return " ".join(s.split())


def compute_consonant_key(raw: str) -> str:
    folded = fold_address_token(raw).replace(" ", "")
    raw_cons = re.sub(r"[aeiouy]", "", folded)
    out_chars: list[str] = []
    for ch in raw_cons:
        if not out_chars or out_chars[-1] != ch:
            out_chars.append(ch)
    res = "".join(out_chars)
    return res if res else folded


def format_yyyymmdd(val: str, fallback: str) -> str:
    v = (val or "").strip()
    if len(v) == 8 and v.isdigit():
        return f"{v[0:4]}-{v[4:6]}-{v[6:8]}"
    if len(v) >= 10 and v[4] == "-" and v[7] == "-":
        return v[:10]
    return fallback


def encode_etat(raw: str) -> str:
    v = strip_accents((raw or "").strip()).lower()
    if v.startswith("cert"):
        return "C"
    if v.startswith("val"):
        return "V"
    if v.startswith("prov"):
        return "P"
    if v.startswith("hist"):
        return "H"
    return (raw.strip()[:1].upper() if raw and raw.strip() else "V")


def _extract_lot_numbers(raw: str | None) -> tuple[list[int], int]:
    if not raw:
        return [], 0
    lots: list[int] = []
    seen: set[int] = set()
    skipped = 0
    for part in re.split(r"[,;]+", raw):
        token = re.sub(r"\s+", "", part)
        if not token:
            continue
        if token.isascii() and token.isdigit():
            val = int(token)
            if 1 <= val <= 999_999_999:
                if val not in seen:
                    seen.add(val)
                    lots.append(val)
            else:
                skipped += 1
        else:
            skipped += 1
    return lots, skipped


def _http_get_json(url: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "mcp-outils-pipeline/0.3",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _download_stream(url: str, dest: Path, label: str) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 10_000:
        if dest.suffix.lower() == ".zip":
            if zipfile.is_zipfile(dest):
                print(
                    f"[{label}] Archive déjà présente en cache ({dest.stat().st_size / (1024 * 1024):.1f} Mo) : {dest.name}",
                    flush=True,
                )
                return dest
            print(f"[{label}] Archive partielle/corrompue détectée, retéléchargement...", flush=True)
            dest.unlink()
        else:
            print(
                f"[{label}] Fichier déjà présent en cache ({dest.stat().st_size / (1024 * 1024):.1f} Mo) : {dest.name}",
                flush=True,
            )
            return dest

    tmp_dest = dest.with_suffix(dest.suffix + ".part")
    if tmp_dest.exists():
        tmp_dest.unlink()

    head_req = urllib.request.Request(
        url, method="HEAD", headers={"User-Agent": "mcp-outils-pipeline/0.3"}
    )
    total_len = 0
    accepts_ranges = False
    try:
        with urllib.request.urlopen(head_req, timeout=30) as hresp:
            total_len = int(hresp.headers.get("Content-Length") or "0")
            accepts_ranges = "bytes" in (hresp.headers.get("Accept-Ranges") or "").lower()
    except Exception:
        total_len = 0

    if accepts_ranges and total_len > 50 * 1024 * 1024:
        num_parts = 8
        print(
            f"[{label}] Téléchargement parallèle ({num_parts} flux Range, {total_len / (1024 * 1024):.1f} Mo) depuis {url} ...",
            flush=True,
        )
        part_size = (total_len + num_parts - 1) // num_parts
        ranges = [
            (i, i * part_size, min(total_len - 1, (i + 1) * part_size - 1))
            for i in range(num_parts)
        ]

        def fetch_part(spec: tuple[int, int, int]) -> Path:
            idx, start, end = spec
            pfile = dest.with_suffix(f"{dest.suffix}.part{idx}")
            for attempt in range(4):
                try:
                    rreq = urllib.request.Request(
                        url,
                        headers={
                            "User-Agent": "mcp-outils-pipeline/0.3",
                            "Range": f"bytes={start}-{end}",
                        },
                    )
                    with urllib.request.urlopen(rreq, timeout=600) as rresp, open(pfile, "wb") as pf:
                        while True:
                            buf = rresp.read(2 * 1024 * 1024)
                            if not buf:
                                break
                            pf.write(buf)
                    if pfile.stat().st_size == (end - start + 1):
                        print(
                            f"  [{label}] segment {idx + 1}/{num_parts} terminé ({pfile.stat().st_size / (1024 * 1024):.1f} Mo)",
                            flush=True,
                        )
                        return pfile
                except Exception:
                    if attempt == 3:
                        raise
            raise RuntimeError(f"Segment {idx} incomplet")

        with concurrent.futures.ThreadPoolExecutor(max_workers=num_parts) as pool:
            part_files = list(pool.map(fetch_part, ranges))

        with open(tmp_dest, "wb") as out_f:
            for pf in part_files:
                with open(pf, "rb") as in_f:
                    shutil.copyfileobj(in_f, out_f, length=8 * 1024 * 1024)
                pf.unlink()
    else:
        print(f"[{label}] Téléchargement depuis {url} ...", flush=True)
        req = urllib.request.Request(url, headers={"User-Agent": "mcp-outils-pipeline/0.3"})
        downloaded = 0
        next_report = 50 * 1024 * 1024
        with urllib.request.urlopen(req, timeout=600) as resp, open(tmp_dest, "wb") as out_f:
            while True:
                chunk = resp.read(4 * 1024 * 1024)
                if not chunk:
                    break
                out_f.write(chunk)
                downloaded += len(chunk)
                if downloaded >= next_report:
                    print(f"  [{label}] {downloaded / (1024 * 1024):.0f} Mo téléchargés...", flush=True)
                    next_report += 100 * 1024 * 1024

    shutil.move(str(tmp_dest), str(dest))
    print(
        f"[{label}] Téléchargement terminé ({dest.stat().st_size / (1024 * 1024):.1f} Mo) -> {dest.name}",
        flush=True,
    )
    return dest


def resolve_rqa_urls() -> dict[str, str]:
    payload = _http_get_json(RQA_CKAN_URL)
    resources = payload.get("result", {}).get("resources", [])
    urls: dict[str, str] = {}
    for res in resources:
        url = (res.get("url") or "").strip()
        name = strip_accents((res.get("name") or "")).lower()
        fmt = (res.get("format") or "").upper()
        if not url:
            continue
        if "odonymes_renvois" in url.lower() or ("odonyme" in name and fmt == "CSV"):
            urls["renvois"] = url
        elif "echantillon_csv" in url.lower() or ("echantillon" in name and "csv" in url.lower()):
            urls["sample_zip"] = url
        elif url.lower().endswith("rqa_csv.zip") and "echantillon" not in url.lower():
            urls["full_zip"] = url

    missing = [k for k in ("renvois", "sample_zip", "full_zip") if k not in urls]
    if missing:
        raise RuntimeError(f"Ressources RQA CKAN introuvables : {missing} (trouvées={urls})")
    return urls


def load_odonymes_renvois(
    csv_path: Path, fallback_date: str
) -> tuple[dict[tuple[str, str], set[str]], int, str]:
    renvois_map: dict[tuple[str, str], set[str]] = defaultdict(set)
    total_rows = 0
    version_date = fallback_date

    with open(csv_path, encoding="utf-8-sig", errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_rows += 1
            if total_rows == 1 and row.get("date_diffusion_version"):
                version_date = format_yyyymmdd(row["date_diffusion_version"], fallback_date)
            target_seq = (row.get("renvoi_seqodo") or "").strip()
            code_mun = (row.get("code_municipalite") or "").strip()
            if not target_seq or not code_mun:
                continue
            for raw_alias in (
                row.get("odonyme_recompose_normal") or "",
                row.get("specifique_odonyme") or "",
            ):
                folded = fold_address_token(raw_alias)
                if folded:
                    renvois_map[(code_mun, target_seq)].add(folded)

    return renvois_map, total_rows, version_date


def build_local_sqlite(
    sample_only: bool = False,
    rqa_zip_path: Path | None = None,
    renvois_csv_path: Path | None = None,
    db_path: Path = LOCAL_DB_PATH,
) -> dict[str, int]:
    work_dir = db_path.parent
    work_dir.mkdir(parents=True, exist_ok=True)
    scratch_db_path = work_dir / "_scratch_civiques.db"
    today_iso = dt.date.today().isoformat()

    if rqa_zip_path is not None and renvois_csv_path is not None:
        rqa_zip = rqa_zip_path
        renvois_csv = renvois_csv_path
    else:
        print("[CKAN] Résolution dynamique des URL du RQA et d'Odonymes et renvois...", flush=True)
        urls = resolve_rqa_urls()

        renvois_csv = (
            renvois_csv_path
            if renvois_csv_path is not None
            else _download_stream(urls["renvois"], work_dir / "Odonymes_renvois.csv", "ODONYMES-RENVOIS")
        )
        if rqa_zip_path is not None:
            rqa_zip = rqa_zip_path
        elif sample_only:
            rqa_zip = _download_stream(
                urls["sample_zip"], work_dir / "RQA_echantillon.zip", "RQA-ECHANTILLON"
            )
        else:
            manual_full = SOURCES_DIR / "RQA_CSV.zip"
            if manual_full.exists() and zipfile.is_zipfile(manual_full):
                rqa_zip = manual_full
                print(f"[RQA] Utilisation de {manual_full}", flush=True)
            else:
                rqa_zip = _download_stream(urls["full_zip"], work_dir / "RQA_CSV.zip", "RQA-COMPLET")

    print("[ODONYMES] Analyse des renvois d'odonymes...", flush=True)
    renvois_map, renvois_rows, renvois_date = load_odonymes_renvois(renvois_csv, today_iso)
    print(
        f"[ODONYMES] {renvois_rows} entrées lues, {len(renvois_map)} odonymes actifs enrichis de renvois (diffusion {renvois_date}).",
        flush=True,
    )

    if db_path.exists():
        db_path.unlink()
    if scratch_db_path.exists():
        scratch_db_path.unlink()

    scratch = sqlite3.connect(scratch_db_path)
    scratch.execute("PRAGMA journal_mode = OFF;")
    scratch.execute("PRAGMA synchronous = OFF;")
    scratch.execute("PRAGMA temp_store = MEMORY;")
    scratch.execute(
        """
        CREATE TABLE s_civ (
          odo_id INTEGER NOT NULL,
          numero_municipal INTEGER NOT NULL,
          suffixe TEXT NOT NULL,
          numero_unite TEXT NOT NULL,
          type_unite TEXT,
          code_postal TEXT,
          etat TEXT NOT NULL,
          categorie TEXT,
          numero_lot TEXT,
          matricule TEXT,
          latitude REAL,
          longitude REAL
        );
        """
    )

    mun_info: dict[str, tuple[str, str, str | None, str | None]] = {}
    mun_aliases: dict[str, set[str]] = defaultdict(set)

    odo_id_by_key: dict[tuple[str, str], int] = {}
    odo_rows: list[
        tuple[
            int,
            str,
            str,
            str | None,
            str | None,
            str,
            str | None,
            str,
            str,
            str,
            str,
            str,
        ]
    ] = []

    rqa_version_date = today_iso
    civ_batch: list[tuple] = []
    total_civ = 0

    print(f"[RQA] Lecture en flux de {rqa_zip.name}...", flush=True)
    with zipfile.ZipFile(rqa_zip, "r") as zf:
        csv_members = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if not csv_members:
            raise RuntimeError(f"Aucun fichier CSV trouvé dans {rqa_zip}")
        with zf.open(csv_members[0]) as raw_f:
            reader = csv.DictReader(io.TextIOWrapper(raw_f, encoding="utf-8-sig", errors="replace"))
            for row in reader:
                num_raw = (row.get("numero_municipal") or "").strip()
                code_mun = (row.get("code_municipalite") or "").strip()
                seqodo = (row.get("seqodo") or "").strip()
                if not num_raw or not code_mun or not seqodo:
                    continue
                try:
                    num_mun = int(num_raw)
                except ValueError:
                    continue

                if total_civ == 0 and row.get("date_diffusion_version"):
                    rqa_version_date = format_yyyymmdd(row["date_diffusion_version"], today_iso)

                if code_mun not in mun_info:
                    nom_mun = " ".join((row.get("nom_municipalite") or "").split()) or code_mun
                    nom_norm = fold_address_token(nom_mun)
                    mrc = " ".join((row.get("nom_mrc") or "").split()) or None
                    reg = " ".join((row.get("nom_region_administrative") or "").split()) or None
                    mun_info[code_mun] = (nom_mun, nom_norm, mrc, reg)
                    for st_alias in STATIC_CITY_ALIASES.get(nom_norm, []):
                        mun_aliases[code_mun].add(st_alias)
                    if nom_norm.startswith("saint "):
                        mun_aliases[code_mun].add("st " + nom_norm[6:])
                    elif nom_norm.startswith("sainte "):
                        mun_aliases[code_mun].add("ste " + nom_norm[7:])

                arr = fold_address_token(row.get("nom_arrondissement") or "")
                if arr:
                    mun_aliases[code_mun].add(arr)

                odo_key = (code_mun, seqodo)
                odo_id = odo_id_by_key.get(odo_key)
                if odo_id is None:
                    odo_id = len(odo_rows) + 1
                    odo_id_by_key[odo_key] = odo_id
                    gen = " ".join((row.get("generique_odonyme") or "").split()) or None
                    part = " ".join((row.get("particule_odonyme") or "").split()) or None
                    odo_norm = " ".join((row.get("odonyme_recompose_normal") or "").split())
                    spec = (
                        " ".join((row.get("specifique_odonyme") or "").split())
                        or odo_norm
                        or seqodo
                    )
                    if not odo_norm:
                        odo_norm = spec
                    odo_long = (
                        " ".join((row.get("odonyme_recompose_long") or "").split()) or odo_norm
                    )
                    card = " ".join((row.get("point_cardinal_odonyme") or "").split()) or None
                    spec_norm = fold_address_token(spec)
                    cle_cons = compute_consonant_key(spec)

                    renv_set = set(renvois_map.get(odo_key, set()))
                    inline_renv = fold_address_token(row.get("renvoi_specifique_odonyme") or "")
                    if inline_renv and inline_renv != spec_norm:
                        renv_set.add(inline_renv)
                    renv_str = " ".join(sorted(renv_set))

                    odo_rows.append(
                        (
                            odo_id,
                            code_mun,
                            seqodo,
                            gen,
                            part,
                            spec,
                            card,
                            odo_norm,
                            odo_long,
                            spec_norm,
                            cle_cons,
                            renv_str,
                        )
                    )

                suf = (row.get("numero_municipal_suffixe") or "").strip().upper()
                unite = (row.get("numero_unite") or "").strip().upper()
                typ_unite = " ".join((row.get("type_unite") or "").split()) or None
                cp_raw = re.sub(r"\s+", "", (row.get("code_postal") or "")).upper()
                cp = cp_raw if cp_raw else None
                etat = encode_etat(row.get("etat") or "")
                cat = (row.get("categorie") or "").strip() or None
                lot = (row.get("numero_lot") or "").strip() or None
                mat = (row.get("matricule_unite_evaluation") or "").strip() or None

                lat_s = (row.get("latitude") or "").strip()
                lon_s = (row.get("longitude") or "").strip()
                lat = round(float(lat_s), 6) if lat_s else None
                lon = round(float(lon_s), 6) if lon_s else None

                civ_batch.append(
                    (odo_id, num_mun, suf, unite, typ_unite, cp, etat, cat, lot, mat, lat, lon)
                )
                total_civ += 1

                if len(civ_batch) >= 60_000:
                    scratch.executemany(
                        "INSERT INTO s_civ VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        civ_batch,
                    )
                    civ_batch.clear()
                    if total_civ % 600_000 == 0:
                        print(
                            f"  [RQA] {total_civ:,} adresses civiques lues ({len(odo_rows):,} odonymes)...",
                            flush=True,
                        )

    if civ_batch:
        scratch.executemany(
            "INSERT INTO s_civ VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", civ_batch
        )
        civ_batch.clear()
    scratch.commit()
    scratch.close()

    print(
        f"[SQLITE] Assemblage final de {db_path.name} ({len(mun_info)} municipalités, {len(odo_rows)} odonymes, {total_civ} adresses)...",
        flush=True,
    )
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode = OFF;")
    conn.execute("PRAGMA synchronous = OFF;")
    conn.execute("PRAGMA temp_store = MEMORY;")
    conn.execute("PRAGMA cache_size = -500000;")
    conn.executescript((HERE / "schema.sql").read_text(encoding="utf-8"))

    mun_rows = []
    for code_mun, (nom_mun, nom_norm, mrc, reg) in sorted(mun_info.items()):
        aliases = " ".join(sorted(a for a in mun_aliases.get(code_mun, set()) if a and a != nom_norm))
        mun_rows.append((code_mun, nom_mun, nom_norm, aliases, mrc, reg))

    conn.executemany("INSERT INTO municipalites VALUES (?, ?, ?, ?, ?, ?)", mun_rows)
    conn.executemany(
        "INSERT INTO odonymes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", odo_rows
    )

    conn.execute(f"ATTACH DATABASE '{scratch_db_path.as_posix()}' AS scratch;")
    conn.execute(
        """
        INSERT INTO adresses_civiques (
          odo_id, numero_municipal, suffixe, numero_unite, type_unite,
          code_postal, etat, categorie, numero_lot, matricule, latitude, longitude
        )
        SELECT odo_id, numero_municipal, suffixe, numero_unite, type_unite,
               code_postal, etat, categorie, numero_lot, matricule, latitude, longitude
          FROM scratch.s_civ
         ORDER BY odo_id, numero_municipal, suffixe, numero_unite;
        """
    )
    conn.commit()
    conn.execute("DETACH DATABASE scratch;")
    if scratch_db_path.exists():
        scratch_db_path.unlink()

    print("[LOTS] Construction de lots_cadastraux_index...", flush=True)
    lot_batch: list[tuple[int, int]] = []
    skipped_lot_tokens = 0
    lot_cur = conn.cursor()
    lot_cur.execute(
        "SELECT id, numero_lot FROM adresses_civiques WHERE numero_lot IS NOT NULL AND numero_lot != ''"
    )
    while True:
        lot_rows = lot_cur.fetchmany(60_000)
        if not lot_rows:
            break
        for civ_id, raw_lot in lot_rows:
            lot_nums, skipped = _extract_lot_numbers(raw_lot)
            skipped_lot_tokens += skipped
            for lot_num in lot_nums:
                lot_batch.append((lot_num, civ_id))
            if len(lot_batch) >= 60_000:
                conn.executemany(
                    "INSERT OR IGNORE INTO lots_cadastraux_index (lot_num, civ_id) VALUES (?, ?)",
                    lot_batch,
                )
                lot_batch.clear()
    if lot_batch:
        conn.executemany(
            "INSERT OR IGNORE INTO lots_cadastraux_index (lot_num, civ_id) VALUES (?, ?)",
            lot_batch,
        )
        lot_batch.clear()
    conn.commit()

    conn.executemany(
        "INSERT INTO meta_sources VALUES (?, ?, ?, ?, ?)",
        [
            (
                "rqa",
                "Référentiel québécois des adresses (RQA) — MRNF",
                "CC-BY-4.0",
                rqa_version_date,
                total_civ,
            ),
            (
                "odonymes_renvois",
                "Odonymes et renvois — MRNF",
                "CC-BY-4.0",
                renvois_date,
                renvois_rows,
            ),
        ],
    )

    print("[INDEX] Construction des index secondaires et FTS5 sur odonymes...", flush=True)
    conn.executescript((HERE / "indexes.sql").read_text(encoding="utf-8"))
    for stmt in build_fts_slice_statements(
        conn,
        "odonymes_fts",
        "odonymes",
        "id",
        ["specifique", "odonyme_normal", "renvois_recherche"],
        slice_size=30_000,
    ):
        conn.execute(stmt)
    for stmt in build_fts_slice_statements(
        conn,
        "odonymes_trigram",
        "odonymes",
        "id",
        ["specifique_norm"],
        slice_size=30_000,
    ):
        conn.execute(stmt)
    conn.commit()

    stats = {
        "municipalites": conn.execute("SELECT COUNT(*) FROM municipalites").fetchone()[0],
        "odonymes": conn.execute("SELECT COUNT(*) FROM odonymes").fetchone()[0],
        "adresses_civiques": conn.execute("SELECT COUNT(*) FROM adresses_civiques").fetchone()[0],
        "lots_cadastraux_index": conn.execute("SELECT COUNT(*) FROM lots_cadastraux_index").fetchone()[0],
        "skipped_lot_tokens": skipped_lot_tokens,
    }
    conn.close()
    mb = db_path.stat().st_size / (1024 * 1024)
    print(f"[OK] Base locale générée ({mb:.1f} Mo) : {stats}", flush=True)
    return stats


def _split_sql_statements(sql_text: str) -> list[str]:
    stmts: list[str] = []
    buf: list[str] = []
    for line in sql_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        buf.append(line)
        if stripped.endswith(";"):
            stmts.append("\n".join(buf) + "\n")
            buf.clear()
    if buf:
        stmts.append("\n".join(buf) + ";\n")
    return stmts


def export_local_batches(
    db_path: Path = LOCAL_DB_PATH, batch_dir: Path = BATCH_DIR
) -> tuple[list[Path], dict[str, int]]:
    if not db_path.exists():
        raise FileNotFoundError(f"Base locale introuvable : {db_path}")

    if batch_dir.exists():
        for old in batch_dir.glob("*.sql"):
            old.unlink()
    batch_dir.mkdir(parents=True, exist_ok=True)

    schema_file = batch_dir / "0000_schema.sql"
    schema_file.write_text(
        (HERE / "schema.sql").read_text(encoding="utf-8"), encoding="utf-8", newline="\n"
    )
    batch_files: list[Path] = [schema_file]

    conn = sqlite3.connect(db_path)
    for table, cols, prefix, order, max_bytes in [
        (
            "meta_sources",
            ["source_key", "source_label", "licence", "version_date", "row_count"],
            "01_meta",
            "source_key",
            BATCH_MAX_FILE_BYTES,
        ),
        (
            "municipalites",
            [
                "code_municipalite",
                "nom_municipalite",
                "nom_normalise",
                "aliases_recherche",
                "mrc",
                "region_administrative",
            ],
            "02_mun",
            "code_municipalite",
            BATCH_MAX_FILE_BYTES,
        ),
        (
            "odonymes",
            [
                "id",
                "code_municipalite",
                "seqodo",
                "generique",
                "particule",
                "specifique",
                "cardinal",
                "odonyme_normal",
                "odonyme_long",
                "specifique_norm",
                "cle_consonnes",
                "renvois_recherche",
            ],
            "03_odo",
            "id",
            BATCH_MAX_FILE_BYTES,
        ),
        (
            "adresses_civiques",
            [
                "id",
                "odo_id",
                "numero_municipal",
                "suffixe",
                "numero_unite",
                "type_unite",
                "code_postal",
                "etat",
                "categorie",
                "numero_lot",
                "matricule",
                "latitude",
                "longitude",
            ],
            "04_civ",
            "id",
            BATCH_MAX_FILE_BYTES,
        ),
        (
            "lots_cadastraux_index",
            ["lot_num", "civ_id"],
            "05_lots",
            "lot_num, civ_id",
            6_000_000,
        ),
    ]:
        files, count = export_table_batches(
            conn, table, cols, batch_dir, prefix, order, max_file_bytes=max_bytes
        )
        print(f"  Export {table} : {count} lignes -> {len(files)} lot(s)", flush=True)
        batch_files.extend(files)

    expected_counts = {
        "adresses_civiques": conn.execute("SELECT COUNT(*) FROM adresses_civiques").fetchone()[0],
        "odonymes": conn.execute("SELECT COUNT(*) FROM odonymes").fetchone()[0],
        "lots_cadastraux_index": conn.execute(
            "SELECT COUNT(*) FROM lots_cadastraux_index"
        ).fetchone()[0],
    }

    idx_stmts = _split_sql_statements((HERE / "indexes.sql").read_text(encoding="utf-8"))
    for i, stmt in enumerate(idx_stmts, 1):
        p = batch_dir / f"9000_idx_{i:02d}.sql"
        p.write_text(stmt, encoding="utf-8", newline="\n")
        batch_files.append(p)

    fts_stmts = build_fts_slice_statements(
        conn,
        "odonymes_fts",
        "odonymes",
        "id",
        ["specifique", "odonyme_normal", "renvois_recherche"],
        slice_size=30_000,
    )
    tri_stmts = build_fts_slice_statements(
        conn,
        "odonymes_trigram",
        "odonymes",
        "id",
        ["specifique_norm"],
        slice_size=30_000,
    )
    conn.close()

    for i, stmt in enumerate([*fts_stmts, *tri_stmts], 1):
        p = batch_dir / f"9100_fts_{i:02d}.sql"
        p.write_text(stmt + "\n", encoding="utf-8", newline="\n")
        batch_files.append(p)

    print(f"[BATCH] {len(batch_files)} fichiers SQL générés dans {batch_dir}", flush=True)
    return batch_files, expected_counts


def push_to_remote_d1(db_name: str, location: str = "enam") -> str:
    if not LOCAL_DB_PATH.exists():
        raise FileNotFoundError(f"Base locale introuvable : {LOCAL_DB_PATH}")

    db_info = provision_or_get_d1(db_name, location=location)
    db_id = str(db_info["uuid"])
    print(f"[D1] Cible distante : {db_name} (uuid={db_id}, compte={ACCOUNT_ID})", flush=True)

    batch_files, expected_counts = export_local_batches(LOCAL_DB_PATH, BATCH_DIR)
    expected_civ = expected_counts["adresses_civiques"]
    expected_odo = expected_counts["odonymes"]
    expected_lots = expected_counts["lots_cadastraux_index"]

    print(f"[D1] Envoi de {len(batch_files)} lots SQL vers {db_name}...", flush=True)
    execute_sql_files_remote(db_name, batch_files)

    rem_civ = d1_query_remote(db_id, "SELECT COUNT(*) AS c FROM adresses_civiques")[0]["c"]
    rem_odo = d1_query_remote(db_id, "SELECT COUNT(*) AS c FROM odonymes")[0]["c"]
    rem_lots = d1_query_remote(db_id, "SELECT COUNT(*) AS c FROM lots_cadastraux_index")[0]["c"]
    if rem_civ != expected_civ or rem_odo != expected_odo or rem_lots != expected_lots:
        raise RuntimeError(
            f"Comptes distants incohérents : civ={rem_civ}/{expected_civ}, odo={rem_odo}/{expected_odo}, lots={rem_lots}/{expected_lots}"
        )

    verif = verify_remote_candidate(
        db_id,
        "SELECT COUNT(*) AS c FROM odonymes_fts WHERE odonymes_fts MATCH '\"rue\"* OR \"chemin\"*'",
        min_rows=1,
    )
    print(
        f"[OK] {db_name} ({db_id}) validée : {rem_civ} adresses, {rem_odo} odonymes, {rem_lots} lots, info={verif}",
        flush=True,
    )
    return db_id


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingestion DB_ADRESSES (RQA + Odonymes)")
    parser.add_argument("--build-local", action="store_true")
    parser.add_argument("--sample", action="store_true")
    parser.add_argument("--export-batches", action="store_true")
    parser.add_argument("--push-remote", action="store_true")
    parser.add_argument("--db-name", default="outils-adresses")
    parser.add_argument("--blue-green", action="store_true")
    parser.add_argument("--swap", action="store_true")
    parser.add_argument("--location", default="enam")
    args = parser.parse_args()

    if args.build_local:
        build_local_sqlite(sample_only=args.sample)
    if args.export_batches and not args.push_remote:
        export_local_batches(LOCAL_DB_PATH, BATCH_DIR)
    if args.push_remote:
        target_name = dated_db_name("DB_ADRESSES") if args.blue_green else args.db_name
        db_id = push_to_remote_d1(target_name, location=args.location)
        if args.swap:
            swap_wrangler_binding("DB_ADRESSES", target_name, db_id)


if __name__ == "__main__":
    main()
