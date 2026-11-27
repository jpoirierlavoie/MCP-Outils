from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

from pipeline.common.d1_batch import (
    REPO_ROOT,
    d1_query_remote,
    get_d1_database_info,
    list_d1_databases,
    provision_or_get_d1,
)

WRANGLER_JSONC = REPO_ROOT / "wrangler.jsonc"

VALID_BINDINGS: dict[str, str] = {
    "DB_TERMINOLOGIE": "outils-terminologie",
    "DB_REGISTRES": "outils-registres",
    "DB_ADRESSES": "outils-adresses",
    "DB_ECONOMIE": "outils-economie",
}


def dated_db_name(binding: str, date_tag: str | None = None) -> str:
    if binding not in VALID_BINDINGS:
        raise ValueError(f"Binding inconnu : {binding}")
    tag = date_tag or dt.date.today().strftime("%Y%m%d")
    return f"{VALID_BINDINGS[binding]}-{tag}"


def swap_wrangler_binding(
    binding: str,
    new_db_name: str,
    new_db_id: str,
    wrangler_path: Path = WRANGLER_JSONC,
) -> None:
    if binding not in VALID_BINDINGS:
        raise ValueError(f"Binding D1 non reconnu : {binding}")

    cfg = json.loads(wrangler_path.read_text(encoding="utf-8"))
    updated = False
    for entry in cfg.get("d1_databases", []):
        if entry.get("binding") == binding:
            entry["database_name"] = new_db_name
            entry["database_id"] = new_db_id
            updated = True
            break

    if not updated:
        raise RuntimeError(f"Binding {binding} introuvable dans {wrangler_path}")

    wrangler_path.write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"[BLUE-GREEN] {wrangler_path.name} mis à jour : {binding} -> {new_db_name} ({new_db_id})")


def verify_remote_candidate(db_id: str, probe_sql: str, min_rows: int = 1) -> dict:
    info = get_d1_database_info(db_id)
    size_mb = (info.get("file_size") or 0) / (1024 * 1024)
    if size_mb >= 9800:
        raise RuntimeError(f"Taille D1 critique ({size_mb:.1f} Mo >= 9,8 Go) sur {db_id}")
    rows = d1_query_remote(db_id, probe_sql)
    val = int(next(iter(rows[0].values()))) if rows else 0
    if val < min_rows:
        raise RuntimeError(f"Sonde distante insuffisante ({val} < {min_rows}) : {probe_sql}")
    return {"uuid": db_id, "name": info.get("name"), "size_mb": round(size_mb, 2), "probe_value": val}


def main() -> None:
    parser = argparse.ArgumentParser(description="Gestionnaire bleu-vert D1")
    parser.add_argument("--list", action="store_true", help="Lister les bases outils-* du compte")
    parser.add_argument("--provision-dated", choices=sorted(VALID_BINDINGS.keys()))
    parser.add_argument("--date-tag", default=None)
    parser.add_argument("--swap", action="store_true")
    parser.add_argument("--binding", choices=sorted(VALID_BINDINGS.keys()))
    parser.add_argument("--db-name")
    parser.add_argument("--db-id")
    args = parser.parse_args()

    if args.list:
        for db in list_d1_databases():
            name = str(db.get("name", ""))
            if name.startswith("outils-"):
                det = get_d1_database_info(str(db["uuid"]))
                mb = (det.get("file_size") or 0) / (1024 * 1024)
                print(
                    f"- {name:32s} uuid={db['uuid']}  region={det.get('running_in_region')}  "
                    f"tables={det.get('num_tables')}  size={mb:.2f} Mo"
                )

    if args.provision_dated:
        target = dated_db_name(args.provision_dated, args.date_tag)
        created = provision_or_get_d1(target, location="enam")
        print(f"[OK] Base bleu-vert prête : {target} (uuid={created['uuid']})")

    if args.swap:
        if not (args.binding and args.db_name and args.db_id):
            raise SystemExit("--swap requiert --binding, --db-name et --db-id")
        swap_wrangler_binding(args.binding, args.db_name, args.db_id)


if __name__ == "__main__":
    main()
