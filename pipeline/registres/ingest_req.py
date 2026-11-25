"""Pipeline d'ingestion et de chargement D1 — Domaine B : Registres d'entreprises (QC + Canada + GLEIF).

Sources intégrées (zéro appel réseau sortant au moment de la requête MCP) :
  1. REQ — Fichier ouvert local `pipeline/sources/req.zip` (ou `req.zip.zip` déposé après
     téléchargement navigateur ; ZÉRO grattage ni contournement du défi Cloudflare du portail REQ).
  2. RENA — Entreprises non admissibles aux contrats publics (AMP, `CC BY 4.0`, joint sur NEQ,
     excluant strictement les personnes physiques et dirigeants/actionnaires personnes physiques).
  3. RBQ — Licences actives d'entrepreneurs (`CC BY 4.0`, regroupées par licence et NEQ).
  4. OPC — Permis et exemptions en vigueur (`CC BY 4.0`, URL datée résolue dynamiquement via CKAN).
  5. Corporations Canada — Sociétés fédérales actives et dissoutes (`OGL-Canada`, CKAN dynamique).
  6. GLEIF Golden Copy (`CC0 1.0`) — LEI canadiens (`lei2`), relations mères/filiales (`rr`)
     et exceptions de déclaration (`repex`), appariés via `RA000081`/`RA000842` (NEQ) et
     `RA000072` (Corporations Canada) plus entités canadiennes autonomes titulaires d'un LEI.

Usage :
  python -m pipeline.registres.ingest_req --build-local --sample --export-batches
  python -m pipeline.registres.ingest_req --build-local --push-remote --db-name outils-registres
  python -m pipeline.registres.ingest_req --build-local --push-remote --blue-green --swap
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import itertools
import json
import re
import sqlite3
import urllib.request
import zipfile
from pathlib import Path

from pipeline.common.blue_green import dated_db_name, swap_wrangler_binding, verify_remote_candidate
from pipeline.common.d1_batch import (
    ACCOUNT_ID,
    REPO_ROOT,
    build_fts_slice_statements,
    d1_query_remote,
    execute_sql_files_remote,
    export_table_batches,
    normalize_search_text,
    provision_or_get_d1,
)

HERE = Path(__file__).resolve().parent
SOURCES_DIR = REPO_ROOT / "pipeline" / "sources"
WORK_DIR = REPO_ROOT / "pipeline" / "work" / "registres"
BATCH_DIR = REPO_ROOT / "pipeline" / "batches" / "registres"
LOCAL_DB_PATH = WORK_DIR / "outils_registres.db"
SCRATCH_DB_PATH = WORK_DIR / "_scratch_req_children.db"

RENA_CKAN_URL = (
    "https://www.donneesquebec.ca/recherche/api/3/action/"
    "package_show?id=registre-des-entreprises-non-admissibles-aux-contrats-publics-rena"
)
RBQ_CKAN_URL = "https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=licencesactives"
OPC_CKAN_URL = (
    "https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=liste-des-permis-actifs"
)
CORP_CA_CKAN_URL = (
    "https://open.canada.ca/data/api/action/package_show?id=0032ce54-c5dd-4b66-99a0-320a7b5e99f2"
)
GLEIF_PUBLISHES_LATEST_URL = "https://goldencopy.gleif.org/api/v2/golden-copies/publishes/latest"

FLAG_RBQ = 1
FLAG_OPC = 2
FLAG_RENA = 4
FLAG_FAILLITE = 8

NUMBERED_CORP_RE = re.compile(r"\b(\d{4})[-\s]+(\d{4})\b")
ACRONYM_DOTS_RE = re.compile(r"\b(?:[A-Za-z]\.){2,}[A-Za-z]?\b")
CITY_CLEAN_RE = re.compile(r"\s*\((?:QUÉBEC|QUEBEC|QC)\)\s*$", re.I)
CRA_PROGRAM_BN_RE = re.compile(r"^(\d{9})R[A-Z]\d{4}$", re.I)

BATCH_MAX_FILE_BYTES = 18_000_000  # ~18 Mo par lot SQL pour maximiser le débit vers D1

ENTITES_INSERT_SQL = (
    "INSERT INTO entites "
    "(id, juridiction, identifiant_principal, bn_ne, is_active, nom_officiel, "
    "nom_recherche, autres_noms_appercu, forme_code, statut_code, date_constitution, "
    "ville, flags, fiche_json, lei) "
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
)


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


def _download_file(url: str, dest: Path, force: bool = False) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not force and dest.exists() and dest.stat().st_size > 0:
        return dest
    print(f"  Téléchargement : {url} -> {dest.name}", flush=True)
    req = urllib.request.Request(
        url, headers={"User-Agent": "mcp-outils-pipeline/0.3"}
    )
    with urllib.request.urlopen(req, timeout=300) as resp, open(dest, "wb") as out:
        while True:
            chunk = resp.read(1024 * 512)
            if not chunk:
                break
            out.write(chunk)
    return dest


def _find_req_archive() -> Path | None:
    p1 = SOURCES_DIR / "req.zip"
    if p1.exists() and p1.stat().st_size > 0:
        return p1
    p2 = SOURCES_DIR / "req.zip.zip"
    if p2.exists() and p2.stat().st_size > 0:
        return p2
    return None


def _clean_neq(val: str | None) -> str | None:
    if not val:
        return None
    digits = re.sub(r"\D", "", val)
    return digits if len(digits) == 10 else None


def _clean_bn(val: str | None) -> str | None:
    if not val:
        return None
    digits = re.sub(r"\D", "", val)
    return digits if len(digits) == 9 else None


def _extract_city_from_req_lines(lign2: str, lign3: str = "") -> str | None:
    s3 = " ".join(lign3.split())
    s2 = " ".join(lign2.split())
    # Lorsque l'adresse comporte un étage ou bureau en ligne 2, la municipalité figure en ligne 3
    if s3 and (CITY_CLEAN_RE.search(s3) or not CITY_CLEAN_RE.search(s2)):
        cleaned3 = CITY_CLEAN_RE.sub("", s3).strip(" ,-")
        if cleaned3 and not re.fullmatch(r"[A-Z]\d[A-Z]\s*\d[A-Z]\d", cleaned3, re.IGNORECASE):
            return cleaned3[:80]
    if not s2:
        return None
    cleaned2 = CITY_CLEAN_RE.sub("", s2).strip(" ,-")
    return cleaned2[:80] if cleaned2 else None


def _build_extra_search_tokens(official_name: str, extra_names: list[str]) -> str:
    official_collapsed = ACRONYM_DOTS_RE.sub(
        lambda m: m.group(0).replace(".", ""), official_name
    )
    official_tokens = set(normalize_search_text(official_name).split())
    out_tokens: list[str] = []
    seen = set(official_tokens)

    # Ajouter la forme soudée de « S.E.N.C.R.L. » -> « sencrl » si présente dans nom_officiel
    for tok in normalize_search_text(official_collapsed).split():
        if tok not in seen:
            seen.add(tok)
            out_tokens.append(tok)

    # Ajouter la forme 8 chiffres soudée des sociétés à numéro « 9123-4567 » -> « 91234567 »
    for m in NUMBERED_CORP_RE.finditer(official_name):
        merged = f"{m.group(1)}{m.group(2)}"
        if merged not in seen:
            seen.add(merged)
            out_tokens.append(merged)

    for alt in extra_names:
        alt_collapsed = ACRONYM_DOTS_RE.sub(lambda m: m.group(0).replace(".", ""), alt)
        for m in NUMBERED_CORP_RE.finditer(alt):
            merged = f"{m.group(1)}{m.group(2)}"
            if merged not in seen:
                seen.add(merged)
                out_tokens.append(merged)
        for tok in normalize_search_text(alt_collapsed).split():
            if tok not in seen:
                seen.add(tok)
                out_tokens.append(tok)
        if len(out_tokens) >= 60:
            break

    return " ".join(out_tokens[:60])


def _short_regime_ca(regime: str) -> str:
    low = regime.lower()
    if "sociétés par actions" in low:
        return "LCSA"
    if "but non lucratif" in low:
        return "LCOBNL"
    if "coopératives" in low:
        return "LCCoop"
    if "chambres de commerce" in low:
        return "LChC"
    return regime[:40] if regime else "Fédéral"


def _ingest_ancillary_qc(
    conn: sqlite3.Connection,
    sample_only: bool,
    today_iso: str,
    work_dir: Path = WORK_DIR,
) -> tuple[set[str], set[str], set[str]]:
    rbq_neqs: set[str] = set()
    opc_neqs: set[str] = set()
    rena_neqs: set[str] = set()

    if sample_only:
        rbq_neqs.add("1170123456")
        opc_neqs.add("1170123456")
        rena_neqs.add("1170123456")
        conn.execute(
            "INSERT INTO rbq_licences VALUES (?, ?, ?)",
            (
                "1170123456",
                "5789-1234-01",
                json.dumps(
                    {
                        "statut": "Active",
                        "type_licence": "Entrepreneur",
                        "categorie": "Generale",
                        "sous_categories": ["1.2", "1.3"],
                        "restriction": False,
                        "date_delivrance": "2020-01-15",
                        "date_paiement_annuel": "2027-01-15",
                        "cautionnement_montant": "40000",
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            ),
        )
        conn.execute(
            "INSERT INTO opc_permis VALUES (?, ?, ?, ?)",
            (
                1,
                "1170123456",
                "700912",
                json.dumps(
                    {
                        "categorie_permis": "Commerçant itinérant",
                        "nom_commercant": "9123-4567 QUÉBEC INC.",
                        "adresse_etablissement": "500 boul. René-Lévesque Ouest",
                        "ville_etablissement": "Montréal",
                        "code_postal": "H2Z 1W7",
                        "autres_noms": None,
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            ),
        )
        conn.execute(
            "INSERT INTO rena_inscriptions VALUES (?, ?, ?, ?, ?)",
            (
                1,
                "1170123456",
                "9123-4567 QUÉBEC INC.",
                "9123 4567 quebec inc",
                json.dumps(
                    {
                        "categorie": "Personnes morales",
                        "adresse": "Montréal",
                        "date_debut": "2024-06-01",
                        "date_fin": "2029-06-01",
                        "infraction": "LCOP art. 21.1",
                        "decision_amp": "Inscription RENA",
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            ),
        )
        for k, lbl, lic in [
            ("rbq", "RBQ (échantillon)", "CC-BY-4.0"),
            ("opc", "OPC (échantillon)", "CC-BY-4.0"),
            ("rena", "RENA (échantillon)", "CC-BY-4.0"),
        ]:
            conn.execute("INSERT INTO meta_sources VALUES (?, ?, ?, ?, 1)", (k, lbl, lic, today_iso))
        return rbq_neqs, opc_neqs, rena_neqs

    # 1) RENA (JSON via CKAN — exclusion stricte des personnes physiques)
    print("[RENA] Résolution CKAN et chargement...", flush=True)
    rena_pkg = _http_get_json(RENA_CKAN_URL)["result"]
    rena_url = next(
        r["url"] for r in rena_pkg["resources"] if str(r.get("format", "")).upper() == "JSON"
    )
    rena_path = _download_file(rena_url, work_dir / "rena.json")
    rena_data = json.loads(rena_path.read_text(encoding="utf-8-sig"))
    inscriptions = rena_data.get("rena", {}).get("inscription", [])
    if isinstance(inscriptions, dict):
        inscriptions = [inscriptions]

    rena_count = 0
    for item in inscriptions:
        nom_ent = (item.get("Nom_entreprise") or "").strip()
        neq = _clean_neq(item.get("NEQ"))
        # Exclure les inscriptions visant uniquement une personne physique (aucun Nom_entreprise ni NEQ)
        if not nom_ent and not neq:
            continue
        if neq:
            rena_neqs.add(neq)
        rena_count += 1
        payload = {
            "categorie": (item.get("Categorie") or "").strip() or None,
            "adresse": (item.get("Adresse") or "").strip() or None,
            "date_debut": (item.get("Inscription_registre") or "").strip() or None,
            "date_fin": (item.get("Fin_inadmissibilite") or "").strip() or None,
            "infraction": " ".join((item.get("Infraction") or "").split())[:350] or None,
            "decision_amp": " ".join((item.get("Decision_AMP") or "").split())[:250] or None,
        }
        conn.execute(
            "INSERT INTO rena_inscriptions VALUES (?, ?, ?, ?, ?)",
            (
                rena_count,
                neq,
                nom_ent or f"Entreprise NEQ {neq}",
                normalize_search_text(nom_ent or ""),
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            ),
        )
    conn.execute(
        "INSERT INTO meta_sources VALUES ('rena', 'Autorité des marchés publics — RENA', 'CC-BY-4.0', ?, ?)",
        (today_iso, rena_count),
    )
    print(f"[RENA] {rena_count} inscriptions d'entreprises chargées ({len(rena_neqs)} NEQ).", flush=True)

    # 2) OPC (URL datée résolue dynamiquement via CKAN)
    print("[OPC] Résolution CKAN dynamique et chargement...", flush=True)
    opc_pkg = _http_get_json(OPC_CKAN_URL)["result"]
    opc_url = next(
        r["url"] for r in opc_pkg["resources"] if str(r.get("format", "")).upper() == "CSV"
    )
    opc_date_match = re.search(r"(\d{4}-\d{2}-\d{2})", opc_url)
    opc_date = opc_date_match.group(1) if opc_date_match else today_iso
    opc_path = _download_file(opc_url, work_dir / Path(opc_url).name)

    opc_count = 0
    seen_opc: set[tuple[str, str, str]] = set()
    with open(opc_path, encoding="utf-8-sig", errors="replace") as f:
        for row in csv.DictReader(f):
            neq = _clean_neq(row.get("NEQ"))
            no_permis = (row.get("NO_PERMIS") or "").strip()
            cat = (row.get("CATEGORIE_PERMIS") or "").strip()
            if not neq or not no_permis:
                continue
            dedup_key = (neq, no_permis, cat)
            if dedup_key in seen_opc:
                continue
            seen_opc.add(dedup_key)
            opc_neqs.add(neq)
            opc_count += 1
            adr_parts = [
                (row.get("ETABLISSEMENT_NO") or "").strip(),
                (row.get("ETABLISSEMENT_RUE") or "").strip(),
                f"bur. {(row.get('ETABLISSEMENT_APP') or '').strip()}"
                if (row.get("ETABLISSEMENT_APP") or "").strip()
                else "",
            ]
            adr_str = " ".join(p for p in adr_parts if p) or None
            payload = {
                "categorie_permis": cat,
                "nom_commercant": (row.get("NOM_COMMERCANT") or "").strip(),
                "adresse_etablissement": adr_str,
                "ville_etablissement": (row.get("ETABLISSEMENT_VILLE") or "").strip() or None,
                "code_postal": (row.get("ETABLISSEMENT_CODE_POSTAL") or "").strip() or None,
                "autres_noms": (row.get("AUTRES_NOMS") or "").strip()[:200] or None,
            }
            conn.execute(
                "INSERT INTO opc_permis VALUES (?, ?, ?, ?)",
                (
                    opc_count,
                    neq,
                    no_permis,
                    json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                ),
            )
    conn.execute(
        "INSERT INTO meta_sources VALUES ('opc', 'Office de la protection du consommateur — Permis actifs', 'CC-BY-4.0', ?, ?)",
        (opc_date, opc_count),
    )
    print(f"[OPC] {opc_count} permis chargés ({len(opc_neqs)} NEQ, date={opc_date}).", flush=True)

    # 3) RBQ (CSV compressé via CKAN — agrégation des sous-catégories par NEQ + licence)
    print("[RBQ] Résolution CKAN et agrégation des sous-catégories...", flush=True)
    rbq_pkg = _http_get_json(RBQ_CKAN_URL)["result"]
    rbq_url = next(
        r["url"]
        for r in rbq_pkg["resources"]
        if str(r.get("url", "")).lower().endswith(".zip")
    )
    rbq_zip_path = _download_file(rbq_url, work_dir / "rbq.zip")
    rbq_grouped: dict[tuple[str, str], dict] = {}
    with zipfile.ZipFile(rbq_zip_path, "r") as zf:
        csv_info = next(i for i in zf.infolist() if i.filename.lower().endswith(".csv"))
        with zf.open(csv_info) as raw_f:
            reader = csv.DictReader(io.TextIOWrapper(raw_f, encoding="utf-8-sig", errors="replace"))
            for row in reader:
                neq = _clean_neq(row.get("NEQ"))
                lic = (row.get("Numéro de licence") or "").strip()
                if not neq or not lic:
                    continue
                rbq_neqs.add(neq)
                key = (neq, lic)
                entry = rbq_grouped.get(key)
                if entry is None:
                    entry = {
                        "statut": (row.get("Statut de la licence") or "Active").strip(),
                        "type_licence": (row.get("Type de licence") or "").strip(),
                        "categorie": (row.get("Categorie") or "").strip(),
                        "sous_categories": [],
                        "restriction": (row.get("Restriction") or "").strip().lower() == "oui",
                        "date_delivrance": (row.get("Date de délivrance") or "").strip() or None,
                        "date_paiement_annuel": (row.get("Date du paiement annuel") or "").strip()
                        or None,
                        "cautionnement_montant": (row.get("Montant de la caution") or "").strip()
                        or None,
                    }
                    rbq_grouped[key] = entry
                sc = (row.get("Sous-catégories") or "").strip()
                if sc and sc not in entry["sous_categories"]:
                    entry["sous_categories"].append(sc)

    for (neq, lic), payload in rbq_grouped.items():
        conn.execute(
            "INSERT INTO rbq_licences VALUES (?, ?, ?)",
            (neq, lic, json.dumps(payload, ensure_ascii=False, separators=(",", ":"))),
        )
    conn.execute(
        "INSERT INTO meta_sources VALUES ('rbq', 'Régie du bâtiment du Québec — Licences actives', 'CC-BY-4.0', ?, ?)",
        (today_iso, len(rbq_grouped)),
    )
    print(f"[RBQ] {len(rbq_grouped)} licences actives uniques chargées ({len(rbq_neqs)} NEQ).", flush=True)
    return rbq_neqs, opc_neqs, rena_neqs


def _ingest_req_archive(
    conn: sqlite3.Connection,
    req_zip: Path | None,
    sample_only: bool,
    rbq_neqs: set[str],
    opc_neqs: set[str],
    rena_neqs: set[str],
    start_id: int,
    today_iso: str,
    work_dir: Path = WORK_DIR,
) -> int:
    entite_id = start_id

    if sample_only:
        dv_sample = [
            ("STAT_IMMAT", "IM", "Immatriculée"),
            ("STAT_IMMAT", "RO", "Radiée d'office"),
            ("FORM_JURI", "CIE", "Société par actions ou compagnie"),
            ("REGIM_JURI", "094", "Loi sur les sociétés par actions (RLRQ, c. S-31.1)"),
            ("STAT_NOM", "V", "En vigueur"),
            ("TYP_NOM", "N", "Nom de l'assujetti"),
        ]
        conn.executemany("INSERT INTO domaine_valeur VALUES (?, ?, ?)", dv_sample)
        entite_id += 1
        conn.execute(
            ENTITES_INSERT_SQL,
            (
                entite_id,
                "qc",
                "1170123456",
                None,
                1,
                "9123-4567 QUÉBEC INC.",
                "91234567 constructions tremblay",
                '["Constructions Tremblay"]',
                "CIE",
                "IM",
                "2018-04-12",
                "Montréal",
                7,
                json.dumps(
                    {"im": "2018-04-12", "rj": "094", "rc": "094", "ad": "500 boul. René-Lévesque Ouest", "cp": "H2Z1W7"},
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                None,
            ),
        )
        conn.execute(
            "INSERT INTO meta_sources VALUES ('req', 'REQ (échantillon)', 'CC-BY-NC-SA-4.0', ?, 1)",
            (today_iso,),
        )
        return entite_id

    if req_zip is None:
        print(
            "[REQ] AVERTISSEMENT : aucune archive locale trouvée sous pipeline/sources/req.zip "
            "(ni req.zip.zip). Conformément aux règles de conformité, aucun contournement du portail "
            "Web du REQ n'est tenté ; seules les autres sources ouvertes sont chargées.",
            flush=True,
        )
        return entite_id

    print(f"[REQ] Lecture de l'archive locale : {req_zip} ({req_zip.stat().st_size / (1024*1024):.1f} Mo)", flush=True)
    scratch_db_path = work_dir / "_scratch_req_children.db"
    if scratch_db_path.exists():
        scratch_db_path.unlink()

    scratch = sqlite3.connect(scratch_db_path)
    scratch.execute("PRAGMA synchronous = OFF;")
    scratch.execute("PRAGMA journal_mode = OFF;")
    scratch.execute("PRAGMA temp_store = MEMORY;")
    scratch.execute("PRAGMA cache_size = -256000;")
    scratch.executescript(
        """
        CREATE TABLE s_nom (
          neq TEXT NOT NULL,
          nom TEXT NOT NULL,
          etr TEXT,
          stat TEXT NOT NULL,
          typ TEXT NOT NULL,
          deb TEXT,
          fin TEXT
        );
        CREATE TABLE s_etab (
          neq TEXT NOT NULL,
          suf TEXT NOT NULL,
          nom TEXT,
          princ INTEGER NOT NULL,
          adr TEXT,
          cp TEXT,
          act TEXT
        );
        CREATE TABLE s_fus (
          neq TEXT NOT NULL,
          rel TEXT NOT NULL,
          neq_rel TEXT,
          denom TEXT NOT NULL,
          dt TEXT,
          adr TEXT
        );
        CREATE TABLE s_cont (
          neq TEXT NOT NULL,
          typ TEXT NOT NULL,
          reg TEXT,
          loc TEXT,
          dt TEXT
        );
        """
    )

    req_snapshot_date = today_iso
    with zipfile.ZipFile(req_zip, "r") as zf:
        # Date de modification interne du zip comme date d'instantané REQ vérifiée
        for zi in zf.infolist():
            if zi.filename == "Entreprise.csv" and zi.date_time:
                req_snapshot_date = f"{zi.date_time[0]:04d}-{zi.date_time[1]:02d}-{zi.date_time[2]:02d}"

        # 1) DomaineValeur.csv
        with zf.open("DomaineValeur.csv") as raw_dv:
            dv_rows = [
                (
                    (r["TYP_DOM_VAL"] or "").strip(),
                    (r["COD_DOM_VAL"] or "").strip(),
                    (r["VAL_DOM_FRAN"] or "").strip(),
                )
                for r in csv.DictReader(io.TextIOWrapper(raw_dv, encoding="utf-8-sig", errors="replace"))
                if (r.get("TYP_DOM_VAL") or "").strip() and (r.get("COD_DOM_VAL") or "").strip()
            ]
        conn.executemany("INSERT OR REPLACE INTO domaine_valeur VALUES (?, ?, ?)", dv_rows)
        print(f"[REQ] DomaineValeur : {len(dv_rows)} codes chargés (instantané {req_snapshot_date}).", flush=True)

        # 2) Nom.csv -> scratch
        print("[REQ] Indexation temporaire de Nom.csv...", flush=True)
        batch_nom: list[tuple] = []
        with zf.open("Nom.csv") as raw_f:
            for r in csv.DictReader(io.TextIOWrapper(raw_f, encoding="utf-8-sig", errors="replace")):
                neq = (r.get("NEQ") or "").strip()
                nom = " ".join((r.get("NOM_ASSUJ") or "").split())
                if not neq or not nom:
                    continue
                batch_nom.append(
                    (
                        neq,
                        nom,
                        " ".join((r.get("NOM_ASSUJ_LANG_ETRNG") or "").split()) or None,
                        (r.get("STAT_NOM") or "").strip(),
                        (r.get("TYP_NOM_ASSUJ") or "").strip(),
                        (r.get("DAT_INIT_NOM_ASSUJ") or "").strip() or None,
                        (r.get("DAT_FIN_NOM_ASSUJ") or "").strip() or None,
                    )
                )
                if len(batch_nom) >= 50_000:
                    scratch.executemany("INSERT INTO s_nom VALUES (?, ?, ?, ?, ?, ?, ?)", batch_nom)
                    batch_nom.clear()
        if batch_nom:
            scratch.executemany("INSERT INTO s_nom VALUES (?, ?, ?, ?, ?, ?, ?)", batch_nom)
            batch_nom.clear()

        # 3) Etablissements.csv -> scratch
        print("[REQ] Indexation temporaire de Etablissements.csv...", flush=True)
        batch_etab: list[tuple] = []
        with zf.open("Etablissements.csv") as raw_f:
            for r in csv.DictReader(io.TextIOWrapper(raw_f, encoding="utf-8-sig", errors="replace")):
                neq = (r.get("NEQ") or "").strip()
                if not neq:
                    continue
                disp = (r.get("IND_DISP") or "").strip().upper() == "O"
                adr = (
                    None
                    if disp
                    else ", ".join(
                        p
                        for p in [
                            " ".join((r.get("LIGN1_ADR") or "").split()),
                            " ".join((r.get("LIGN2_ADR") or "").split()),
                            " ".join((r.get("LIGN3_ADR") or "").split()),
                        ]
                        if p
                    )
                    or None
                )
                cp = None if disp else ((r.get("LIGN4_ADR") or "").strip() or None)
                act = " ".join((r.get("DESC_ACT_ECON_ETAB") or "").split())
                if act in ("-", "NON DÉCLARÉ", ""):
                    act = ""
                batch_etab.append(
                    (
                        neq,
                        (r.get("NO_SUF_ETAB") or "").strip(),
                        " ".join((r.get("NOM_ETAB") or "").split()) or None,
                        1 if (r.get("IND_ETAB_PRINC") or "").strip().upper() == "O" else 0,
                        adr,
                        cp,
                        act[:120] or None,
                    )
                )
                if len(batch_etab) >= 50_000:
                    scratch.executemany("INSERT INTO s_etab VALUES (?, ?, ?, ?, ?, ?, ?)", batch_etab)
                    batch_etab.clear()
        if batch_etab:
            scratch.executemany("INSERT INTO s_etab VALUES (?, ?, ?, ?, ?, ?, ?)", batch_etab)
            batch_etab.clear()

        # 4) FusionScissions.csv -> scratch
        print("[REQ] Indexation temporaire de FusionScissions.csv...", flush=True)
        batch_fus: list[tuple] = []
        with zf.open("FusionScissions.csv") as raw_f:
            for r in csv.DictReader(io.TextIOWrapper(raw_f, encoding="utf-8-sig", errors="replace")):
                neq = (r.get("NEQ") or "").strip()
                denom = " ".join((r.get("DENOMN_SOC") or "").split())
                if not neq or not denom:
                    continue
                disp = (r.get("IND_DISP") or "").strip().upper() == "O"
                adr = (
                    None
                    if disp
                    else ", ".join(
                        p
                        for p in [
                            " ".join((r.get("LIGN1_ADR") or "").split()),
                            " ".join((r.get("LIGN2_ADR") or "").split()),
                        ]
                        if p
                    )
                    or None
                )
                batch_fus.append(
                    (
                        neq,
                        (r.get("COD_RELA_ASSUJ") or "").strip(),
                        (r.get("NEQ_ASSUJ_REL") or "").strip() or None,
                        denom,
                        (r.get("DAT_EFCTVT") or "").strip() or None,
                        adr,
                    )
                )
        if batch_fus:
            scratch.executemany("INSERT INTO s_fus VALUES (?, ?, ?, ?, ?, ?)", batch_fus)
            batch_fus.clear()

        # 5) ContinuationsTransformations.csv -> scratch
        batch_cont: list[tuple] = []
        with zf.open("ContinuationsTransformations.csv") as raw_f:
            for r in csv.DictReader(io.TextIOWrapper(raw_f, encoding="utf-8-sig", errors="replace")):
                neq = (r.get("NEQ") or "").strip()
                if not neq:
                    continue
                reg = (r.get("COD_REGIM_JURI") or "").strip() or (
                    (r.get("AUTR_REGIM_JURI") or "").strip() or None
                )
                batch_cont.append(
                    (
                        neq,
                        (r.get("COD_TYP_CHANG") or "").strip(),
                        reg,
                        " ".join((r.get("NOM_LOCLT") or "").split()) or None,
                        (r.get("DAT_EFCTVT") or "").strip() or None,
                    )
                )
        if batch_cont:
            scratch.executemany("INSERT INTO s_cont VALUES (?, ?, ?, ?, ?)", batch_cont)
            batch_cont.clear()

        print("[REQ] Création des index de jointure sur les tables enfants...", flush=True)
        scratch.executescript(
            """
            CREATE INDEX idx_s_nom ON s_nom(neq);
            CREATE INDEX idx_s_etab ON s_etab(neq);
            CREATE INDEX idx_s_fus ON s_fus(neq);
            CREATE INDEX idx_s_cont ON s_cont(neq);
            """
        )
        scratch.commit()

        # Itérateurs triés par NEQ pour jointure en flux (merge-join O(N) mémoire minimale)
        def _grouped_iter(table_sql: str):
            cur = scratch.execute(table_sql)
            for k, grp in itertools.groupby(cur, key=lambda row: row[0]):
                yield k, list(grp)

        # Charger Entreprise.csv dans une table temporaire triée par NEQ aussi pour un vrai merge-join
        print("[REQ] Chargement de Entreprise.csv dans le trieur local...", flush=True)
        scratch.execute(
            """
            CREATE TABLE s_ent (
              neq TEXT PRIMARY KEY,
              ind_fail TEXT,
              dat_immat TEXT,
              cod_regim_juri TEXT,
              cod_intval_emplo TEXT,
              dat_cess TEXT,
              cod_stat TEXT,
              cod_forme TEXT,
              dat_stat TEXT,
              cod_regim_consti TEXT,
              an_prod TEXT,
              cae1 TEXT,
              desc1 TEXT,
              cae2 TEXT,
              desc2 TEXT,
              loc_consti TEXT,
              dat_consti TEXT,
              ind_cua TEXT,
              adr_disp TEXT,
              lign1 TEXT,
              lign2 TEXT,
              lign3 TEXT,
              lign4 TEXT
            )
            """
        )
        ent_batch: list[tuple] = []
        with zf.open("Entreprise.csv") as raw_f:
            for r in csv.DictReader(io.TextIOWrapper(raw_f, encoding="utf-8-sig", errors="replace")):
                neq = (r.get("NEQ") or "").strip()
                if len(neq) != 10:
                    continue
                ent_batch.append(
                    (
                        neq,
                        (r.get("IND_FAIL") or "").strip(),
                        (r.get("DAT_IMMAT") or "").strip(),
                        (r.get("COD_REGIM_JURI") or "").strip(),
                        (r.get("COD_INTVAL_EMPLO_QUE") or "").strip(),
                        (r.get("DAT_CESS_PREVU") or "").strip(),
                        (r.get("COD_STAT_IMMAT") or "").strip(),
                        (r.get("COD_FORME_JURI") or "").strip(),
                        (r.get("DAT_STAT_IMMAT") or "").strip(),
                        (r.get("COD_REGIM_JURI_CONSTI") or "").strip(),
                        (r.get("AN_PROD") or "").strip(),
                        (r.get("COD_ACT_ECON_CAE") or "").strip(),
                        " ".join((r.get("DESC_ACT_ECON_ASSUJ") or "").split()),
                        (r.get("COD_ACT_ECON_CAE2") or "").strip(),
                        " ".join((r.get("DESC_ACT_ECON_ASSUJ2") or "").split()),
                        " ".join((r.get("NOM_LOCLT_CONSTI") or "").split()),
                        (r.get("DAT_CONSTI") or "").strip(),
                        (r.get("IND_CONVEN_UNMN_ACTNR") or "").strip(),
                        (r.get("ADR_DOMCL_ADR_DISP") or "").strip(),
                        " ".join((r.get("ADR_DOMCL_LIGN1_ADR") or "").split()),
                        " ".join((r.get("ADR_DOMCL_LIGN2_ADR") or "").split()),
                        " ".join((r.get("ADR_DOMCL_LIGN3_ADR") or "").split()),
                        (r.get("ADR_DOMCL_LIGN4_ADR") or "").strip(),
                    )
                )
                if len(ent_batch) >= 50_000:
                    scratch.executemany(
                        "INSERT OR REPLACE INTO s_ent VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        ent_batch,
                    )
                    ent_batch.clear()
        if ent_batch:
            scratch.executemany(
                "INSERT OR REPLACE INTO s_ent VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                ent_batch,
            )
            ent_batch.clear()
        scratch.commit()

    print("[REQ] Assemblage par jointure triée (merge-join) vers entites...", flush=True)
    nom_it = _grouped_iter("SELECT * FROM s_nom ORDER BY neq")
    etab_it = _grouped_iter("SELECT * FROM s_etab ORDER BY neq")
    fus_it = _grouped_iter("SELECT * FROM s_fus ORDER BY neq")
    cont_it = _grouped_iter("SELECT * FROM s_cont ORDER BY neq")

    cur_nom = next(nom_it, (None, []))
    cur_etab = next(etab_it, (None, []))
    cur_fus = next(fus_it, (None, []))
    cur_cont = next(cont_it, (None, []))

    out_batch: list[tuple] = []
    skipped_redacted_ind = 0
    kept_req = 0

    for erow in scratch.execute("SELECT * FROM s_ent ORDER BY neq"):
        (
            neq,
            ind_fail,
            dat_immat,
            cod_regim_juri,
            cod_intval_emplo,
            dat_cess,
            cod_stat,
            cod_forme,
            dat_stat,
            cod_regim_consti,
            an_prod,
            cae1,
            desc1,
            cae2,
            desc2,
            loc_consti,
            dat_consti,
            ind_cua,
            adr_disp,
            lign1,
            lign2,
            lign3,
            lign4,
        ) = erow

        while cur_nom[0] is not None and cur_nom[0] < neq:
            cur_nom = next(nom_it, (None, []))
        noms = cur_nom[1] if cur_nom[0] == neq else []

        while cur_etab[0] is not None and cur_etab[0] < neq:
            cur_etab = next(etab_it, (None, []))
        etabs = cur_etab[1] if cur_etab[0] == neq else []

        while cur_fus[0] is not None and cur_fus[0] < neq:
            cur_fus = next(fus_it, (None, []))
        fusions = cur_fus[1] if cur_fus[0] == neq else []

        while cur_cont[0] is not None and cur_cont[0] < neq:
            cur_cont = next(cont_it, (None, []))
        conts = cur_cont[1] if cur_cont[0] == neq else []

        flags = 0
        if neq in rbq_neqs:
            flags |= FLAG_RBQ
        if neq in opc_neqs:
            flags |= FLAG_OPC
        if neq in rena_neqs:
            flags |= FLAG_RENA
        if ind_fail.upper() == "O":
            flags |= FLAG_FAILLITE

        # Coquilles d'entreprises individuelles (IND) sans aucun nom commercial publié ni volet joint
        if cod_forme == "IND" and not noms and flags == 0:
            skipped_redacted_ind += 1
            continue

        # Sélection du nom officiel : (1) V+N, (2) V+autre, (3) A+N le plus récent, (4) A+autre
        nom_officiel = ""
        v_n = [n for n in noms if n[3] == "V" and n[4] == "N"]
        v_a = [n for n in noms if n[3] == "V" and n[4] != "N"]
        a_n = sorted(
            [n for n in noms if n[3] != "V" and n[4] == "N"],
            key=lambda x: x[6] or x[5] or "",
            reverse=True,
        )
        a_any = sorted(
            [n for n in noms if n[3] != "V"],
            key=lambda x: x[6] or x[5] or "",
            reverse=True,
        )
        if v_n:
            nom_officiel = v_n[0][1]
        elif v_a:
            nom_officiel = v_a[0][1]
        elif a_n:
            nom_officiel = a_n[0][1]
        elif a_any:
            nom_officiel = a_any[0][1]
        else:
            nom_officiel = f"Entreprise immatriculée NEQ {neq}"

        extra_name_strs: list[str] = []
        active_alt_preview: list[str] = []
        nm_compact: list[list] = []

        for _, n_txt, n_etr, n_stat, n_typ, n_deb, n_fin in noms[:15]:
            if n_txt != nom_officiel and n_txt not in extra_name_strs:
                extra_name_strs.append(n_txt)
                if n_stat == "V" and len(active_alt_preview) < 4:
                    active_alt_preview.append(n_txt)
            if n_etr and n_etr not in extra_name_strs:
                extra_name_strs.append(n_etr)
                if n_stat == "V" and len(active_alt_preview) < 4:
                    active_alt_preview.append(n_etr)
            if n_txt != nom_officiel or n_etr:
                nm_compact.append([n_txt, n_etr, n_stat, n_typ, n_deb, n_fin])

        nom_recherche = _build_extra_search_tokens(nom_officiel, extra_name_strs)
        is_active = 1 if cod_stat in ("IM", "AI") else 0
        disp_bool = adr_disp.upper() == "O"
        ville = (
            None
            if disp_bool
            else (
                _extract_city_from_req_lines(lign2, lign3)
                or (loc_consti[:80] if loc_consti else None)
            )
        )

        fiche: dict[str, object] = {}
        if dat_immat:
            fiche["im"] = dat_immat
        if dat_stat:
            fiche["ds"] = dat_stat
        if dat_cess:
            fiche["dc"] = dat_cess
        if cod_regim_juri:
            fiche["rj"] = cod_regim_juri
        if cod_regim_consti:
            fiche["rc"] = cod_regim_consti
        if loc_consti:
            fiche["lc"] = loc_consti[:80]
        if an_prod:
            fiche["ap"] = an_prod
        if ind_cua.upper() == "O":
            fiche["cu"] = 1
        if cod_intval_emplo and cod_intval_emplo != "N":
            fiche["tr"] = cod_intval_emplo
        if disp_bool:
            fiche["da"] = 1
        else:
            adr_full = ", ".join(p for p in (lign1, lign2, lign3) if p)
            if adr_full:
                fiche["ad"] = adr_full[:200]
            if lign4:
                fiche["cp"] = lign4[:12]

        acts: list[list[str]] = []
        if cae1 and desc1 and desc1 not in ("NON DÉCLARÉ", "-"):
            acts.append([cae1, desc1[:120]])
        if cae2 and desc2 and desc2 not in ("NON DÉCLARÉ", "-"):
            acts.append([cae2, desc2[:120]])
        if acts:
            fiche["ac"] = acts

        if nm_compact:
            fiche["nm"] = nm_compact[:12]
        if etabs:
            et_sorted = sorted(etabs, key=lambda x: (-x[3], x[1]))[:15]
            fiche["et"] = [[x[1], x[2], x[3], x[4], x[5], x[6]] for x in et_sorted]
        if fusions:
            fiche["fs"] = [[x[1], x[2], x[3][:120], x[4], x[5]] for x in fusions[:12]]
        if conts:
            fiche["ct"] = [[x[1], x[2], x[3], x[4]] for x in conts[:10]]

        entite_id += 1
        kept_req += 1
        out_batch.append(
            (
                entite_id,
                "qc",
                neq,
                None,
                is_active,
                nom_officiel,
                nom_recherche,
                json.dumps(active_alt_preview, ensure_ascii=False, separators=(",", ":"))
                if active_alt_preview
                else None,
                cod_forme or None,
                cod_stat or "IM",
                dat_consti or dat_immat or None,
                ville,
                flags,
                json.dumps(fiche, ensure_ascii=False, separators=(",", ":")),
                None,
            )
        )
        if len(out_batch) >= 40_000:
            conn.executemany(ENTITES_INSERT_SQL, out_batch)
            out_batch.clear()

    if out_batch:
        conn.executemany(ENTITES_INSERT_SQL, out_batch)
        out_batch.clear()

    scratch.close()
    if scratch_db_path.exists():
        scratch_db_path.unlink()

    conn.execute(
        "INSERT INTO meta_sources VALUES ('req', 'Registraire des entreprises du Québec (fichier ouvert)', 'CC-BY-NC-SA-4.0', ?, ?)",
        (req_snapshot_date, kept_req),
    )
    print(
        f"[REQ] {kept_req} entités québécoises chargées "
        f"({skipped_redacted_ind} coquilles IND anonymisées sans nom commercial ignorées).",
        flush=True,
    )
    return entite_id


def _ingest_corporations_canada(
    conn: sqlite3.Connection,
    sample_only: bool,
    start_id: int,
    today_iso: str,
    work_dir: Path = WORK_DIR,
) -> int:
    entite_id = start_id
    if sample_only:
        entite_id += 1
        conn.execute(
            ENTITES_INSERT_SQL,
            (
                entite_id,
                "ca",
                "8284083",
                "801423500",
                1,
                "TECHNOLOGIES NORDIQUES SAINT-LAURENT INC.",
                "st lawrence nordic technologies",
                '["ST. LAWRENCE NORDIC TECHNOLOGIES INC."]',
                "LCSA",
                "Actif",
                "2012-09-01",
                "Montréal",
                0,
                json.dumps(
                    {
                        "n2": ["ST. LAWRENCE NORDIC TECHNOLOGIES INC."],
                        "rl": "Loi canadienne sur les sociétés par actions",
                        "ad": "1000 rue De La Gauchetière Ouest",
                        "pr": "QC",
                        "py": "CA",
                        "cp": "H3B 4W5",
                        "dmin": 1,
                        "dmax": 10,
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                None,
            ),
        )
        conn.execute(
            "INSERT INTO meta_sources VALUES ('corp_ca', 'Corporations Canada (échantillon)', 'OGL-Canada', ?, 1)",
            (today_iso,),
        )
        return entite_id

    print("[CORP-CA] Résolution CKAN Open Canada et chargement des 4 fichiers FR...", flush=True)
    pkg = _http_get_json(CORP_CA_CKAN_URL)["result"]
    fr_urls = [
        r["url"]
        for r in pkg.get("resources", [])
        if str(r.get("format", "")).upper() == "CSV" and str(r.get("url", "")).endswith("-fr.csv")
    ]
    # Charger les actives d'abord afin qu'en cas de doublon, l'état actif prime
    fr_urls.sort(key=lambda u: 0 if "actives-" in u else 1)

    seen_corp: set[str] = set()
    ca_count = 0
    out_batch: list[tuple] = []

    for url in fr_urls:
        csv_path = _download_file(url, work_dir / Path(url).name)
        with open(csv_path, encoding="utf-8-sig", errors="replace") as f:
            for row in csv.DictReader(f):
                corp_no = (row.get("Numéro de société") or "").strip()
                if not corp_no or corp_no in seen_corp:
                    continue
                seen_corp.add(corp_no)

                v1 = " ".join((row.get("Dénomination sociale - version 1") or "").split())
                v2 = " ".join((row.get("Dénomination sociale - version 2") or "").split())
                nom_officiel = v1 or v2 or f"{corp_no} CANADA INC."
                alt_list = [v2] if v2 and v2 != nom_officiel else []

                bn = _clean_bn(row.get("Numéro d’entreprise (NE)") or row.get("Numéro d'entreprise (NE)"))
                regime = " ".join((row.get("Régime législatif") or "").split())
                statut = (row.get("Statut") or "").strip() or "Actif"
                detail_statut = " ".join((row.get("Détail du statut") or "").split())
                is_active = 1 if statut.lower().startswith("actif") else 0

                dt_anniv = (row.get("Date d'anniversaire") or row.get("Date d’anniversaire") or "").strip() or None
                an_depot = (row.get("Année du dernier dépôt annuel") or "").strip() or None
                dt_ag = (row.get("Date de la dernière assemblée annuelle") or "").strip() or None
                rue1 = " ".join((row.get("Rue") or "").split())
                rue2 = " ".join((row.get("Rue 2") or "").split())
                rue = ", ".join(p for p in (rue1, rue2) if p) or None
                ville = " ".join((row.get("Municipalité/ville") or "").split()) or None
                prov = (row.get("Province/territoire") or "").strip() or None
                pays = (row.get("Pays") or "").strip() or None
                cp = (row.get("Code postal") or "").strip() or None

                dmin_raw = (row.get("Nombre minimal d’administrateurs") or row.get("Nombre minimal d'administrateurs") or "").strip()
                dmax_raw = (row.get("Nombre maximal d’administrateurs") or row.get("Nombre maximal d'administrateurs") or "").strip()
                dmin = int(dmin_raw) if dmin_raw.isdigit() else None
                dmax = int(dmax_raw) if dmax_raw.isdigit() else None

                fiche: dict[str, object] = {}
                if alt_list:
                    fiche["n2"] = alt_list
                if regime:
                    fiche["rl"] = regime
                if detail_statut and detail_statut != statut:
                    fiche["ds"] = detail_statut
                if an_depot:
                    fiche["an"] = an_depot
                if dt_ag:
                    fiche["ag"] = dt_ag
                if rue:
                    fiche["ad"] = rue[:180]
                if prov:
                    fiche["pr"] = prov[:20]
                if pays:
                    fiche["py"] = pays[:20]
                if cp:
                    fiche["cp"] = cp[:12]
                if dmin is not None:
                    fiche["dmin"] = dmin
                if dmax is not None:
                    fiche["dmax"] = dmax

                nom_recherche = _build_extra_search_tokens(nom_officiel, alt_list)
                entite_id += 1
                ca_count += 1
                out_batch.append(
                    (
                        entite_id,
                        "ca",
                        corp_no,
                        bn,
                        is_active,
                        nom_officiel,
                        nom_recherche,
                        json.dumps(alt_list, ensure_ascii=False, separators=(",", ":"))
                        if alt_list
                        else None,
                        _short_regime_ca(regime),
                        statut,
                        dt_anniv,
                        ville[:80] if ville else None,
                        0,
                        json.dumps(fiche, ensure_ascii=False, separators=(",", ":")),
                        None,
                    )
                )
                if len(out_batch) >= 40_000:
                    conn.executemany(ENTITES_INSERT_SQL, out_batch)
                    out_batch.clear()

    if out_batch:
        conn.executemany(ENTITES_INSERT_SQL, out_batch)
        out_batch.clear()

    conn.execute(
        "INSERT INTO meta_sources VALUES ('corp_ca', 'Corporations Canada — Sociétés fédérales', 'OGL-Canada', ?, ?)",
        (today_iso, ca_count),
    )
    print(f"[CORP-CA] {ca_count} sociétés fédérales chargées.", flush=True)
    return entite_id


def _gleif_status_priority(reg_status: str | None) -> int:
    if reg_status == "ISSUED":
        return 0
    if reg_status == "LAPSED":
        return 1
    return 2


def _open_single_zip_csv(zip_path: Path):
    zf = zipfile.ZipFile(zip_path, "r")
    csv_info = next(i for i in zf.infolist() if i.filename.lower().endswith(".csv"))
    raw_f = zf.open(csv_info)
    txt_f = io.TextIOWrapper(raw_f, encoding="utf-8-sig", errors="replace", newline="")
    return zf, raw_f, txt_f


def _col_get(row: list[str], idx_map: dict[str, int], col: str) -> str:
    idx = idx_map.get(col)
    if idx is None or idx >= len(row):
        return ""
    return row[idx].strip()


def _match_gleif_to_entites(
    conn: sqlite3.Connection,
    ra_pairs: list[tuple[str, str]],
) -> tuple[int | None, str | None, int | None, str | None]:
    """Apparie les autorités d'enregistrement GLEIF aux lignes `qc` (NEQ) et `ca` (CorpCan)."""
    qc_id: int | None = None
    matched_neq: str | None = None
    ca_id: int | None = None
    matched_corp_no: str | None = None

    # Priorité Québec : RA000081 (REQ), puis repli RA000842 si NEQ à 10 chiffres
    qc_candidates: list[str] = []
    for ra_id, ra_val in ra_pairs:
        if ra_id == "RA000081":
            neq = _clean_neq(ra_val)
            if neq and neq not in qc_candidates:
                qc_candidates.append(neq)
    for ra_id, ra_val in ra_pairs:
        if ra_id == "RA000842":
            neq = _clean_neq(ra_val)
            if neq and neq not in qc_candidates:
                qc_candidates.append(neq)

    for neq in qc_candidates:
        row = conn.execute(
            "SELECT id FROM entites WHERE juridiction = 'qc' AND identifiant_principal = ? LIMIT 1",
            (neq,),
        ).fetchone()
        if row is not None:
            qc_id = int(row[0])
            matched_neq = neq
            break

    # Corporations Canada : RA000072
    for ra_id, ra_val in ra_pairs:
        if ra_id != "RA000072":
            continue
        raw_trim = ra_val.strip()
        if not raw_trim:
            continue
        stripped = re.sub(r"[\s-]+", "", raw_trim)
        no_zero = re.sub(r"^0+(?=\d)", "", stripped)
        row = conn.execute(
            "SELECT id, identifiant_principal FROM entites "
            "WHERE juridiction = 'ca' AND identifiant_principal IN (?, ?, ?) LIMIT 1",
            (raw_trim, stripped, no_zero),
        ).fetchone()
        if row is not None:
            ca_id = int(row[0])
            matched_corp_no = str(row[1])
            break
        m_bn = CRA_PROGRAM_BN_RE.fullmatch(stripped)
        if m_bn:
            bn = m_bn.group(1)
            row = conn.execute(
                "SELECT id, identifiant_principal FROM entites "
                "WHERE juridiction = 'ca' AND bn_ne = ? ORDER BY is_active DESC, id ASC LIMIT 1",
                (bn,),
            ).fetchone()
            if row is not None:
                ca_id = int(row[0])
                matched_corp_no = str(row[1])
                break

    return qc_id, matched_neq, ca_id, matched_corp_no


def _ingest_gleif(
    conn: sqlite3.Connection,
    sample_only: bool,
    start_id: int,
    today_iso: str,
    work_dir: Path = WORK_DIR,
    force_download: bool = False,
) -> int:
    entite_id = start_id

    gleif_ent_insert = (
        "INSERT INTO gleif_entites "
        "(lei, is_canadian, legal_name, legal_jurisdiction, entity_category, entity_status, "
        "legal_form_code, registration_status, initial_registration_date, next_renewal_date, "
        "last_update_date, managing_lou, validation_sources, ra_id, ra_entity_id, "
        "matched_neq, matched_corp_no, country, region, city, postal_code, fiche_json) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    )
    gleif_liens_insert = (
        "INSERT INTO gleif_liens "
        "(id, child_lei, parent_lei, relationship_type, relationship_status, "
        "accounting_standard, quantifier_amount, quantifier_units, period_start, period_end, "
        "validation_sources) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    )
    gleif_exc_insert = (
        "INSERT OR REPLACE INTO gleif_exceptions (lei, category, reasons_json, references_json) "
        "VALUES (?,?,?,?)"
    )

    if sample_only:
        sample_entities = [
            {
                "lei": "549300QC912345670001",
                "is_canadian": 1,
                "legal_name": "9123-4567 QUÉBEC INC.",
                "legal_jurisdiction": "CA-QC",
                "entity_category": "GENERAL",
                "entity_status": "ACTIVE",
                "legal_form_code": "T15C",
                "registration_status": "ISSUED",
                "initial_registration_date": "2020-04-12T00:00:00Z",
                "next_renewal_date": "2027-04-12T00:00:00Z",
                "last_update_date": "2026-04-12T00:00:00Z",
                "managing_lou": "5493001KJTIIGC8Y1R12",
                "validation_sources": "FULLY_CORROBORATED",
                "ra_pairs": [("RA000081", "1170123456")],
                "country": "CA",
                "region": "CA-QC",
                "city": "Montréal",
                "postal_code": "H2Z 1W7",
                "autres_noms": ["Constructions Tremblay"],
            },
            {
                "lei": "549300CA828408300002",
                "is_canadian": 1,
                "legal_name": "TECHNOLOGIES NORDIQUES SAINT-LAURENT INC.",
                "legal_jurisdiction": "CA",
                "entity_category": "GENERAL",
                "entity_status": "ACTIVE",
                "legal_form_code": "T15C",
                "registration_status": "ISSUED",
                "initial_registration_date": "2018-09-01T00:00:00Z",
                "next_renewal_date": "2027-09-01T00:00:00Z",
                "last_update_date": "2026-09-01T00:00:00Z",
                "managing_lou": "5493001KJTIIGC8Y1R12",
                "validation_sources": "FULLY_CORROBORATED",
                "ra_pairs": [("RA000072", "828408-3")],
                "country": "CA",
                "region": "CA-QC",
                "city": "Montréal",
                "postal_code": "H3B 4W5",
                "autres_noms": ["ST. LAWRENCE NORDIC TECHNOLOGIES INC."],
            },
            {
                "lei": "549300CAPARENT000003",
                "is_canadian": 1,
                "legal_name": "HOLDING SAINT-LAURENT LTÉE",
                "legal_jurisdiction": "CA-QC",
                "entity_category": "GENERAL",
                "entity_status": "ACTIVE",
                "legal_form_code": "T15C",
                "registration_status": "ISSUED",
                "initial_registration_date": "2017-01-15T00:00:00Z",
                "next_renewal_date": "2027-01-15T00:00:00Z",
                "last_update_date": "2026-01-15T00:00:00Z",
                "managing_lou": "5493001KJTIIGC8Y1R12",
                "validation_sources": "FULLY_CORROBORATED",
                "ra_pairs": [("RA000079", "ON-9901234")],
                "country": "CA",
                "region": "CA-ON",
                "city": "Toronto",
                "postal_code": "M5H 2N2",
                "autres_noms": ["St. Lawrence Holding Ltd."],
            },
            {
                "lei": "549300USULTIMATE0004",
                "is_canadian": 0,
                "legal_name": "NORDIC GLOBAL HOLDINGS LLC",
                "legal_jurisdiction": "US-DE",
                "entity_category": "GENERAL",
                "entity_status": "ACTIVE",
                "legal_form_code": "H435",
                "registration_status": "ISSUED",
                "initial_registration_date": "2015-03-01T00:00:00Z",
                "next_renewal_date": "2027-03-01T00:00:00Z",
                "last_update_date": "2026-03-01T00:00:00Z",
                "managing_lou": "5493001KJTIIGC8Y1R12",
                "validation_sources": "FULLY_CORROBORATED",
                "ra_pairs": [("RA000602", "DE-5511990")],
                "country": "US",
                "region": "US-DE",
                "city": "Wilmington",
                "postal_code": "19801",
                "autres_noms": [],
            },
            {
                "lei": "549300CASUBSIDIARY05",
                "is_canadian": 1,
                "legal_name": "FILIALE QUÉBEC NORDIQUE INC.",
                "legal_jurisdiction": "CA-QC",
                "entity_category": "GENERAL",
                "entity_status": "ACTIVE",
                "legal_form_code": "T15C",
                "registration_status": "ISSUED",
                "initial_registration_date": "2021-06-10T00:00:00Z",
                "next_renewal_date": "2027-06-10T00:00:00Z",
                "last_update_date": "2026-06-10T00:00:00Z",
                "managing_lou": "5493001KJTIIGC8Y1R12",
                "validation_sources": "FULLY_CORROBORATED",
                "ra_pairs": [("RA000081", "1179998888")],
                "country": "CA",
                "region": "CA-QC",
                "city": "Québec",
                "postal_code": "G1R 4P5",
                "autres_noms": [],
            },
            {
                "lei": "549300CABANKROYALE06",
                "is_canadian": 1,
                "legal_name": "BANQUE NATIONALE ÉCHANTILLON DU CANADA",
                "legal_jurisdiction": "CA",
                "entity_category": "GENERAL",
                "entity_status": "ACTIVE",
                "legal_form_code": "T15C",
                "registration_status": "LAPSED",
                "initial_registration_date": "2014-06-01T00:00:00Z",
                "next_renewal_date": "2025-06-01T00:00:00Z",
                "last_update_date": "2024-06-01T00:00:00Z",
                "managing_lou": "5493001KJTIIGC8Y1R12",
                "validation_sources": "ENTITY_SUPPLIED_ONLY",
                "ra_pairs": [("RA000831", "BS-0012")],
                "country": "CA",
                "region": "CA-QC",
                "city": "Montréal",
                "postal_code": "H3B 5G2",
                "autres_noms": ["Sample National Bank of Canada"],
            },
        ]

        for item in sample_entities:
            ra_pairs: list[tuple[str, str]] = item["ra_pairs"]  # type: ignore[assignment]
            ra_id, ra_entity_id = ra_pairs[0]
            matched_neq: str | None = None
            matched_corp_no: str | None = None

            if item["is_canadian"] == 1:
                qc_id, matched_neq, ca_id, matched_corp_no = _match_gleif_to_entites(
                    conn, ra_pairs
                )
                if qc_id is not None:
                    conn.execute(
                        "UPDATE entites SET lei = ? WHERE id = ?", (item["lei"], qc_id)
                    )
                if ca_id is not None:
                    conn.execute(
                        "UPDATE entites SET lei = ? WHERE id = ?", (item["lei"], ca_id)
                    )
                if qc_id is None and ca_id is None:
                    entite_id += 1
                    autres = list(item["autres_noms"])  # type: ignore[arg-type]
                    nom_rech = _build_extra_search_tokens(str(item["legal_name"]), autres)
                    conn.execute(
                        ENTITES_INSERT_SQL,
                        (
                            entite_id,
                            "lei",
                            item["lei"],
                            None,
                            1 if item["entity_status"] == "ACTIVE" else 0,
                            item["legal_name"],
                            nom_rech,
                            json.dumps(autres, ensure_ascii=False, separators=(",", ":"))
                            if autres
                            else None,
                            item["entity_category"],
                            item["registration_status"],
                            None,
                            item["city"],
                            0,
                            json.dumps(
                                {
                                    "jur": item["legal_jurisdiction"],
                                    "reg": item["registration_status"],
                                    "ren": item["next_renewal_date"],
                                },
                                ensure_ascii=False,
                                separators=(",", ":"),
                            ),
                            item["lei"],
                        ),
                    )

            conn.execute(
                gleif_ent_insert,
                (
                    item["lei"],
                    item["is_canadian"],
                    item["legal_name"],
                    item["legal_jurisdiction"],
                    item["entity_category"],
                    item["entity_status"],
                    item["legal_form_code"],
                    item["registration_status"],
                    item["initial_registration_date"],
                    item["next_renewal_date"],
                    item["last_update_date"],
                    item["managing_lou"],
                    item["validation_sources"],
                    ra_id,
                    ra_entity_id,
                    matched_neq,
                    matched_corp_no,
                    item["country"],
                    item["region"],
                    item["city"],
                    item["postal_code"],
                    json.dumps(
                        {"autres_noms": item["autres_noms"]},
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                    if item["autres_noms"]
                    else None,
                ),
            )

        sample_liens = [
            (
                1,
                "549300CA828408300002",
                "549300CAPARENT000003",
                "IS_DIRECTLY_CONSOLIDATED_BY",
                "ACTIVE",
                "IFRS",
                100.0,
                "PERCENTAGE",
                "2025-01-01",
                "2025-12-31",
                "FULLY_CORROBORATED",
            ),
            (
                2,
                "549300CA828408300002",
                "549300USULTIMATE0004",
                "IS_ULTIMATELY_CONSOLIDATED_BY",
                "ACTIVE",
                "IFRS",
                None,
                None,
                "2025-01-01",
                "2025-12-31",
                "FULLY_CORROBORATED",
            ),
            (
                3,
                "549300CASUBSIDIARY05",
                "549300CA828408300002",
                "IS_DIRECTLY_CONSOLIDATED_BY",
                "ACTIVE",
                "IFRS",
                100.0,
                "PERCENTAGE",
                "2025-01-01",
                "2025-12-31",
                "FULLY_CORROBORATED",
            ),
            (
                4,
                "549300CASUBSIDIARY05",
                "549300USULTIMATE0004",
                "IS_ULTIMATELY_CONSOLIDATED_BY",
                "ACTIVE",
                "IFRS",
                None,
                None,
                "2025-01-01",
                "2025-12-31",
                "FULLY_CORROBORATED",
            ),
        ]
        conn.executemany(gleif_liens_insert, sample_liens)

        sample_exceptions = [
            (
                "549300QC912345670001",
                "DIRECT_ACCOUNTING_CONSOLIDATION_PARENT",
                json.dumps(["NO_LEI"]),
                None,
            ),
            (
                "549300QC912345670001",
                "ULTIMATE_ACCOUNTING_CONSOLIDATION_PARENT",
                json.dumps(["NATURAL_PERSONS"]),
                None,
            ),
        ]
        conn.executemany(gleif_exc_insert, sample_exceptions)
        conn.execute(
            "INSERT INTO meta_sources VALUES ('gleif', 'GLEIF Golden Copy L1/L2/REPEX (échantillon)', 'CC0-1.0', ?, ?)",
            (today_iso, len(sample_entities)),
        )
        return entite_id

    print("[GLEIF] Résolution des archives Golden Copy (lei2, rr, repex)...", flush=True)
    pub_payload = _http_get_json(GLEIF_PUBLISHES_LATEST_URL).get("data", {})
    publish_date = str(pub_payload.get("publish_date") or today_iso)[:10]
    gleif_dir = work_dir / "gleif"
    rr_url = pub_payload["rr"]["full_file"]["csv"]["url"]
    lei2_url = pub_payload["lei2"]["full_file"]["csv"]["url"]
    repex_url = pub_payload["repex"]["full_file"]["csv"]["url"]

    rr_zip = _download_file(rr_url, gleif_dir / Path(rr_url).name, force=force_download)
    repex_zip = _download_file(repex_url, gleif_dir / Path(repex_url).name, force=force_download)
    lei2_zip = _download_file(lei2_url, gleif_dir / Path(lei2_url).name, force=force_download)

    # Étape A : balayage unique de rr (relations mères/filiales)
    print("[GLEIF] Balayage Level 2 (rr)...", flush=True)
    all_rr_ends: set[str] = set()
    rr_rows: list[tuple] = []
    zf, raw_f, txt_f = _open_single_zip_csv(rr_zip)
    try:
        reader = csv.reader(txt_f)
        header = next(reader)
        idx = {col: i for i, col in enumerate(header)}
        i_start = idx["Relationship.StartNode.NodeID"]
        i_end = idx["Relationship.EndNode.NodeID"]
        i_type = idx["Relationship.RelationshipType"]
        i_stat = idx["Relationship.RelationshipStatus"]
        i_val_src = idx.get("Registration.ValidationSources")

        period_triples = [
            (
                idx.get(f"Relationship.Period.{k}.startDate"),
                idx.get(f"Relationship.Period.{k}.endDate"),
                idx.get(f"Relationship.Period.{k}.periodType"),
            )
            for k in range(1, 6)
        ]
        qual_pairs = [
            (
                idx.get(f"Relationship.Qualifiers.{k}.QualifierDimension"),
                idx.get(f"Relationship.Qualifiers.{k}.QualifierCategory"),
            )
            for k in range(1, 6)
        ]
        quant_triples = [
            (
                idx.get(f"Relationship.Quantifiers.{k}.MeasurementMethod"),
                idx.get(f"Relationship.Quantifiers.{k}.QuantifierAmount"),
                idx.get(f"Relationship.Quantifiers.{k}.QuantifierUnits"),
            )
            for k in range(1, 6)
        ]

        for row in reader:
            start_lei = row[i_start].strip() if i_start < len(row) else ""
            end_lei = row[i_end].strip() if i_end < len(row) else ""
            if not start_lei or not end_lei:
                continue
            all_rr_ends.add(end_lei)
            rel_type = row[i_type].strip() if i_type < len(row) else ""
            rel_stat = row[i_stat].strip() if i_stat < len(row) else ""
            val_src = (
                (row[i_val_src].strip() or None)
                if i_val_src is not None and i_val_src < len(row)
                else None
            )

            acc_std: str | None = None
            for dim_i, cat_i in qual_pairs:
                if cat_i is None or cat_i >= len(row):
                    continue
                cat_v = row[cat_i].strip()
                dim_v = row[dim_i].strip() if dim_i is not None and dim_i < len(row) else ""
                if cat_v and (dim_v == "ACCOUNTING_STANDARD" or acc_std is None):
                    acc_std = cat_v
                    if dim_v == "ACCOUNTING_STANDARD":
                        break

            q_amt: float | None = None
            q_units: str | None = None
            for _, amt_i, unit_i in quant_triples:
                if amt_i is None or amt_i >= len(row):
                    continue
                raw_amt = row[amt_i].strip()
                if raw_amt:
                    try:
                        q_amt = float(raw_amt)
                    except ValueError:
                        q_amt = None
                    q_units = (
                        (row[unit_i].strip() or None)
                        if unit_i is not None and unit_i < len(row)
                        else None
                    )
                    break

            p_start: str | None = None
            p_end: str | None = None
            for s_i, e_i, t_i in period_triples:
                sv = row[s_i].strip() if s_i is not None and s_i < len(row) else ""
                ev = row[e_i].strip() if e_i is not None and e_i < len(row) else ""
                tv = row[t_i].strip() if t_i is not None and t_i < len(row) else ""
                if sv or ev:
                    if tv in ("RELATIONSHIP_PERIOD", "ACCOUNTING_PERIOD") or p_start is None:
                        p_start = sv[:10] or None
                        p_end = ev[:10] or None
                        if tv == "RELATIONSHIP_PERIOD":
                            break

            rr_rows.append(
                (
                    start_lei,
                    end_lei,
                    rel_type,
                    rel_stat,
                    acc_std,
                    q_amt,
                    q_units,
                    p_start,
                    p_end,
                    val_src,
                )
            )
    finally:
        txt_f.close()
        raw_f.close()
        zf.close()
    print(f"[GLEIF] {len(rr_rows)} relations Level 2 lues ({len(all_rr_ends)} mères distinctes).", flush=True)

    # Étape B : balayage unique de lei2 (Level 1 LEI-CDF 3.1)
    print("[GLEIF] Balayage Level 1 (lei2)...", flush=True)
    ca_leis: set[str] = set()
    ca_records: list[dict] = []
    foreign_candidates: dict[str, dict] = {}

    zf, raw_f, txt_f = _open_single_zip_csv(lei2_zip)
    try:
        reader = csv.reader(txt_f)
        header = next(reader)
        idx = {col: i for i, col in enumerate(header)}

        other_name_cols = [
            idx.get(f"Entity.OtherEntityNames.OtherEntityName.{k}") for k in range(1, 6)
        ] + [
            idx.get(f"Entity.TransliteratedOtherEntityNames.TransliteratedOtherEntityName.{k}")
            for k in range(1, 6)
        ]
        other_val_cols = [
            (
                idx.get(f"Registration.OtherValidationAuthorities.OtherValidationAuthority.{k}.ValidationAuthorityID"),
                idx.get(f"Registration.OtherValidationAuthorities.OtherValidationAuthority.{k}.ValidationAuthorityEntityID"),
            )
            for k in range(1, 6)
        ]

        i_lei = idx["LEI"]
        i_name = idx["Entity.LegalName"]
        i_l_country = idx.get("Entity.LegalAddress.Country")
        i_h_country = idx.get("Entity.HeadquartersAddress.Country")
        i_l_region = idx.get("Entity.LegalAddress.Region")
        i_l_city = idx.get("Entity.LegalAddress.City")
        i_l_postal = idx.get("Entity.LegalAddress.PostalCode")
        i_h_region = idx.get("Entity.HeadquartersAddress.Region")
        i_h_city = idx.get("Entity.HeadquartersAddress.City")
        i_h_postal = idx.get("Entity.HeadquartersAddress.PostalCode")
        i_ra_id = idx.get("Entity.RegistrationAuthority.RegistrationAuthorityID")
        i_ra_ent = idx.get("Entity.RegistrationAuthority.RegistrationAuthorityEntityID")
        i_va_id = idx.get("Registration.ValidationAuthority.ValidationAuthorityID")
        i_va_ent = idx.get("Registration.ValidationAuthority.ValidationAuthorityEntityID")
        i_jur = idx.get("Entity.LegalJurisdiction")
        i_cat = idx.get("Entity.EntityCategory")
        i_stat = idx.get("Entity.EntityStatus")
        i_elf = idx.get("Entity.LegalForm.EntityLegalFormCode")
        i_init = idx.get("Registration.InitialRegistrationDate")
        i_upd = idx.get("Registration.LastUpdateDate")
        i_reg_stat = idx.get("Registration.RegistrationStatus")
        i_next = idx.get("Registration.NextRenewalDate")
        i_lou = idx.get("Registration.ManagingLOU")
        i_vsrc = idx.get("Registration.ValidationSources")

        def _val(r: list[str], col_i: int | None) -> str:
            if col_i is None or col_i >= len(r):
                return ""
            return r[col_i].strip()

        for row in reader:
            lei = _val(row, i_lei).upper()
            if not lei:
                continue
            l_country = _val(row, i_l_country).upper()
            h_country = _val(row, i_h_country).upper()
            legal_jur = _val(row, i_jur).upper()

            ra_pairs: list[tuple[str, str]] = []
            ra1, re1 = _val(row, i_ra_id), _val(row, i_ra_ent)
            if ra1:
                ra_pairs.append((ra1, re1))
            va1, ve1 = _val(row, i_va_id), _val(row, i_va_ent)
            if va1:
                ra_pairs.append((va1, ve1))
            for ova_i, ove_i in other_val_cols:
                ova, ove = _val(row, ova_i), _val(row, ove_i)
                if ova:
                    ra_pairs.append((ova, ove))

            is_ca = (
                l_country == "CA"
                or h_country == "CA"
                or legal_jur == "CA"
                or legal_jur.startswith("CA-")
                or any(ra in {"RA000081", "RA000842", "RA000072"} for ra, _ in ra_pairs)
            )
            if not is_ca and lei not in all_rr_ends:
                continue

            legal_name = " ".join(_val(row, i_name).split()) or lei
            autres_noms: list[str] = []
            for on_i in other_name_cols:
                on_v = " ".join(_val(row, on_i).split())
                if on_v and on_v != legal_name and on_v not in autres_noms:
                    autres_noms.append(on_v)

            rec = {
                "lei": lei,
                "is_canadian": 1 if is_ca else 0,
                "legal_name": legal_name,
                "legal_jurisdiction": legal_jur or None,
                "entity_category": _val(row, i_cat) or None,
                "entity_status": _val(row, i_stat) or None,
                "legal_form_code": _val(row, i_elf) or None,
                "registration_status": _val(row, i_reg_stat) or None,
                "initial_registration_date": _val(row, i_init) or None,
                "next_renewal_date": _val(row, i_next) or None,
                "last_update_date": _val(row, i_upd) or None,
                "managing_lou": _val(row, i_lou) or None,
                "validation_sources": _val(row, i_vsrc) or None,
                "ra_pairs": ra_pairs,
                "country": l_country or h_country or None,
                "region": _val(row, i_l_region) or _val(row, i_h_region) or None,
                "city": _val(row, i_l_city) or _val(row, i_h_city) or None,
                "postal_code": _val(row, i_l_postal) or _val(row, i_h_postal) or None,
                "autres_noms": autres_noms,
            }
            if is_ca:
                ca_leis.add(lei)
                ca_records.append(rec)
            else:
                foreign_candidates[lei] = rec
    finally:
        txt_f.close()
        raw_f.close()
        zf.close()

    # Étape C : appariement avec entites + insertion des entités canadiennes autonomes
    print(f"[GLEIF] Appariement et insertion de {len(ca_records)} entités canadiennes...", flush=True)
    qc_best_lei: dict[int, tuple[int, str]] = {}
    ca_best_lei: dict[int, tuple[int, str]] = {}
    standalone_batch: list[tuple] = []
    gleif_ent_batch: list[tuple] = []

    for rec in ca_records:
        ra_pairs = rec["ra_pairs"]
        ra_id = ra_pairs[0][0] if ra_pairs else None
        ra_entity_id = ra_pairs[0][1] if ra_pairs else None
        qc_id, matched_neq, ca_id, matched_corp_no = _match_gleif_to_entites(conn, ra_pairs)

        prio = _gleif_status_priority(rec["registration_status"])
        if qc_id is not None:
            prev = qc_best_lei.get(qc_id)
            if prev is None or prio < prev[0]:
                qc_best_lei[qc_id] = (prio, rec["lei"])
        if ca_id is not None:
            prev = ca_best_lei.get(ca_id)
            if prev is None or prio < prev[0]:
                ca_best_lei[ca_id] = (prio, rec["lei"])

        if qc_id is None and ca_id is None:
            entite_id += 1
            autres = rec["autres_noms"][:5]
            nom_rech = _build_extra_search_tokens(rec["legal_name"], autres)
            standalone_batch.append(
                (
                    entite_id,
                    "lei",
                    rec["lei"],
                    None,
                    1 if rec["entity_status"] == "ACTIVE" else 0,
                    rec["legal_name"],
                    nom_rech,
                    json.dumps(autres, ensure_ascii=False, separators=(",", ":"))
                    if autres
                    else None,
                    rec["entity_category"],
                    rec["registration_status"] or rec["entity_status"] or "ACTIVE",
                    None,
                    rec["city"][:80] if rec["city"] else None,
                    0,
                    json.dumps(
                        {
                            "jur": rec["legal_jurisdiction"],
                            "reg": rec["registration_status"],
                            "ren": rec["next_renewal_date"],
                        },
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                    rec["lei"],
                )
            )
            if len(standalone_batch) >= 25_000:
                conn.executemany(ENTITES_INSERT_SQL, standalone_batch)
                standalone_batch.clear()

        gleif_ent_batch.append(
            (
                rec["lei"],
                1,
                rec["legal_name"],
                rec["legal_jurisdiction"],
                rec["entity_category"],
                rec["entity_status"],
                rec["legal_form_code"],
                rec["registration_status"],
                rec["initial_registration_date"],
                rec["next_renewal_date"],
                rec["last_update_date"],
                rec["managing_lou"],
                rec["validation_sources"],
                ra_id,
                ra_entity_id,
                matched_neq,
                matched_corp_no,
                rec["country"],
                rec["region"],
                rec["city"],
                rec["postal_code"],
                json.dumps(
                    {"autres_noms": rec["autres_noms"]},
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                if rec["autres_noms"]
                else None,
            )
        )
        if len(gleif_ent_batch) >= 25_000:
            conn.executemany(gleif_ent_insert, gleif_ent_batch)
            gleif_ent_batch.clear()

    if standalone_batch:
        conn.executemany(ENTITES_INSERT_SQL, standalone_batch)
        standalone_batch.clear()

    # Mères étrangères référencées par une filiale canadienne (is_canadian = 0, absentes de `entites`)
    needed_foreign = {
        end_lei
        for start_lei, end_lei, *_rest in rr_rows
        if start_lei in ca_leis and end_lei not in ca_leis
    }
    for f_lei in needed_foreign:
        rec = foreign_candidates.get(f_lei)
        if rec is None:
            continue
        ra_pairs = rec["ra_pairs"]
        gleif_ent_batch.append(
            (
                rec["lei"],
                0,
                rec["legal_name"],
                rec["legal_jurisdiction"],
                rec["entity_category"],
                rec["entity_status"],
                rec["legal_form_code"],
                rec["registration_status"],
                rec["initial_registration_date"],
                rec["next_renewal_date"],
                rec["last_update_date"],
                rec["managing_lou"],
                rec["validation_sources"],
                ra_pairs[0][0] if ra_pairs else None,
                ra_pairs[0][1] if ra_pairs else None,
                None,
                None,
                rec["country"],
                rec["region"],
                rec["city"],
                rec["postal_code"],
                json.dumps(
                    {"autres_noms": rec["autres_noms"]},
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                if rec["autres_noms"]
                else None,
            )
        )
    if gleif_ent_batch:
        conn.executemany(gleif_ent_insert, gleif_ent_batch)
        gleif_ent_batch.clear()

    conn.executemany(
        "UPDATE entites SET lei = ? WHERE id = ?",
        [(lei, eid) for eid, (_, lei) in qc_best_lei.items()],
    )
    conn.executemany(
        "UPDATE entites SET lei = ? WHERE id = ?",
        [(lei, eid) for eid, (_, lei) in ca_best_lei.items()],
    )

    # Étape D : liens Level 2 (enfants canadiens) + REPEX
    liens_batch: list[tuple] = []
    lien_id = 0
    for row in rr_rows:
        if row[0] not in ca_leis:
            continue
        lien_id += 1
        liens_batch.append((lien_id, *row))
        if len(liens_batch) >= 25_000:
            conn.executemany(gleif_liens_insert, liens_batch)
            liens_batch.clear()
    if liens_batch:
        conn.executemany(gleif_liens_insert, liens_batch)
        liens_batch.clear()

    print("[GLEIF] Balayage des exceptions de déclaration (repex)...", flush=True)
    exc_batch: list[tuple] = []
    zf, raw_f, txt_f = _open_single_zip_csv(repex_zip)
    try:
        reader = csv.reader(txt_f)
        header = next(reader)
        idx = {col: i for i, col in enumerate(header)}
        i_lei = idx["LEI"]
        i_cat = idx["Exception.Category"]
        r_cols = [idx.get(f"Exception.Reason.{k}") for k in range(1, 6)]
        ref_cols = [idx.get(f"Exception.Reference.{k}") for k in range(1, 6)]

        for row in reader:
            lei = row[i_lei].strip().upper() if i_lei < len(row) else ""
            if lei not in ca_leis:
                continue
            cat = row[i_cat].strip() if i_cat < len(row) else ""
            if not cat:
                continue
            reasons = [
                row[c].strip()
                for c in r_cols
                if c is not None and c < len(row) and row[c].strip()
            ]
            refs = [
                row[c].strip()
                for c in ref_cols
                if c is not None and c < len(row) and row[c].strip()
            ]
            exc_batch.append(
                (
                    lei,
                    cat,
                    json.dumps(reasons, ensure_ascii=False, separators=(",", ":")),
                    json.dumps(refs, ensure_ascii=False, separators=(",", ":"))
                    if refs
                    else None,
                )
            )
            if len(exc_batch) >= 25_000:
                conn.executemany(gleif_exc_insert, exc_batch)
                exc_batch.clear()
        if exc_batch:
            conn.executemany(gleif_exc_insert, exc_batch)
            exc_batch.clear()
    finally:
        txt_f.close()
        raw_f.close()
        zf.close()

    total_gleif = len(ca_records) + len(needed_foreign)
    conn.execute(
        "INSERT INTO meta_sources VALUES ('gleif', 'GLEIF — Golden Copy L1/L2/REPEX', 'CC0-1.0', ?, ?)",
        (publish_date, total_gleif),
    )
    print(
        f"[GLEIF] {len(ca_records)} LEI canadiens + {len(needed_foreign)} mères étrangères, "
        f"{lien_id} liens L2, {len(qc_best_lei)} appariés REQ, {len(ca_best_lei)} appariés CorpCan.",
        flush=True,
    )
    return entite_id


def build_local_sqlite(
    sample_only: bool = False,
    work_dir: Path = WORK_DIR,
    force_download: bool = False,
) -> dict[str, int]:
    work_dir.mkdir(parents=True, exist_ok=True)
    db_path = work_dir / "outils_registres.db"
    if db_path.exists():
        db_path.unlink()

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA synchronous = OFF;")
    conn.execute("PRAGMA journal_mode = OFF;")
    conn.execute("PRAGMA temp_store = MEMORY;")
    conn.execute("PRAGMA cache_size = -256000;")
    conn.executescript((HERE / "schema.sql").read_text(encoding="utf-8"))

    today_iso = dt.date.today().isoformat()
    rbq_neqs, opc_neqs, rena_neqs = _ingest_ancillary_qc(
        conn, sample_only, today_iso, work_dir=work_dir
    )
    req_zip = None if sample_only else _find_req_archive()
    cur_id = _ingest_req_archive(
        conn, req_zip, sample_only, rbq_neqs, opc_neqs, rena_neqs, 0, today_iso, work_dir=work_dir
    )
    cur_id = _ingest_corporations_canada(
        conn, sample_only, cur_id, today_iso, work_dir=work_dir
    )

    # Index de recherche créés avant l'appariement GLEIF pour des jointures O(log N)
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_entites_jur_ident "
        "ON entites(juridiction, identifiant_principal)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_entites_bn_ne ON entites(bn_ne) WHERE bn_ne IS NOT NULL"
    )
    _ingest_gleif(
        conn,
        sample_only,
        cur_id,
        today_iso,
        work_dir=work_dir,
        force_download=force_download,
    )

    print("[INDEX] Construction des index secondaires et de entites_fts...", flush=True)
    conn.executescript((HERE / "indexes.sql").read_text(encoding="utf-8"))
    for stmt in build_fts_slice_statements(
        conn, "entites_fts", "entites", "id", ["nom_officiel", "nom_recherche"], slice_size=100_000
    ):
        conn.execute(stmt)
    conn.commit()

    stats = {
        "entites": conn.execute("SELECT COUNT(*) FROM entites").fetchone()[0],
        "domaine_valeur": conn.execute("SELECT COUNT(*) FROM domaine_valeur").fetchone()[0],
        "rbq_licences": conn.execute("SELECT COUNT(*) FROM rbq_licences").fetchone()[0],
        "opc_permis": conn.execute("SELECT COUNT(*) FROM opc_permis").fetchone()[0],
        "rena_inscriptions": conn.execute("SELECT COUNT(*) FROM rena_inscriptions").fetchone()[0],
        "gleif_entites": conn.execute("SELECT COUNT(*) FROM gleif_entites").fetchone()[0],
        "gleif_liens": conn.execute("SELECT COUNT(*) FROM gleif_liens").fetchone()[0],
        "gleif_exceptions": conn.execute("SELECT COUNT(*) FROM gleif_exceptions").fetchone()[0],
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
    for table, cols, prefix, order in [
        (
            "meta_sources",
            ["source_key", "source_label", "licence", "version_date", "row_count"],
            "01_meta",
            "source_key",
        ),
        (
            "domaine_valeur",
            ["typ_dom_val", "cod_dom_val", "libelle_fr"],
            "02_dv",
            "typ_dom_val, cod_dom_val",
        ),
        ("rbq_licences", ["neq", "numero_licence", "payload_json"], "03_rbq", "neq, numero_licence"),
        ("opc_permis", ["id", "neq", "numero_permis", "payload_json"], "04_opc", "id"),
        (
            "rena_inscriptions",
            ["id", "neq", "nom_entreprise", "nom_norm", "payload_json"],
            "05_rena",
            "id",
        ),
        (
            "entites",
            [
                "id",
                "juridiction",
                "identifiant_principal",
                "bn_ne",
                "is_active",
                "nom_officiel",
                "nom_recherche",
                "autres_noms_appercu",
                "forme_code",
                "statut_code",
                "date_constitution",
                "ville",
                "flags",
                "fiche_json",
                "lei",
            ],
            "06_entites",
            "id",
        ),
        (
            "gleif_entites",
            [
                "lei",
                "is_canadian",
                "legal_name",
                "legal_jurisdiction",
                "entity_category",
                "entity_status",
                "legal_form_code",
                "registration_status",
                "initial_registration_date",
                "next_renewal_date",
                "last_update_date",
                "managing_lou",
                "validation_sources",
                "ra_id",
                "ra_entity_id",
                "matched_neq",
                "matched_corp_no",
                "country",
                "region",
                "city",
                "postal_code",
                "fiche_json",
            ],
            "07_gleif_ent",
            "lei",
        ),
        (
            "gleif_liens",
            [
                "id",
                "child_lei",
                "parent_lei",
                "relationship_type",
                "relationship_status",
                "accounting_standard",
                "quantifier_amount",
                "quantifier_units",
                "period_start",
                "period_end",
                "validation_sources",
            ],
            "08_gleif_liens",
            "id",
        ),
        (
            "gleif_exceptions",
            ["lei", "category", "reasons_json", "references_json"],
            "09_gleif_exc",
            "lei, category",
        ),
    ]:
        files, count = export_table_batches(
            conn, table, cols, batch_dir, prefix, order, max_file_bytes=BATCH_MAX_FILE_BYTES
        )
        print(f"  Export {table} : {count} lignes -> {len(files)} lot(s)", flush=True)
        batch_files.extend(files)

    expected_counts = {
        "entites": conn.execute("SELECT COUNT(*) FROM entites").fetchone()[0],
        "gleif_entites": conn.execute("SELECT COUNT(*) FROM gleif_entites").fetchone()[0],
        "gleif_liens": conn.execute("SELECT COUNT(*) FROM gleif_liens").fetchone()[0],
        "gleif_exceptions": conn.execute("SELECT COUNT(*) FROM gleif_exceptions").fetchone()[0],
    }

    # Isoler chaque CREATE INDEX / CREATE VIRTUAL TABLE dans son propre lot pour respecter le budget CPU D1
    idx_stmts = _split_sql_statements((HERE / "indexes.sql").read_text(encoding="utf-8"))
    for i, stmt in enumerate(idx_stmts, 1):
        p = batch_dir / f"9000_idx_{i:02d}.sql"
        p.write_text(stmt, encoding="utf-8", newline="\n")
        batch_files.append(p)

    fts_stmts = build_fts_slice_statements(
        conn, "entites_fts", "entites", "id", ["nom_officiel", "nom_recherche"], slice_size=75_000
    )
    conn.close()

    # Regrouper par 3 tranches FTS par fichier (~225k lignes) pour éviter les délais CPU par requête D1
    for g_idx in range(0, len(fts_stmts), 3):
        chunk = "\n".join(fts_stmts[g_idx : g_idx + 3]) + "\n"
        p = batch_dir / f"9100_fts_{(g_idx // 3) + 1:03d}.sql"
        p.write_text(chunk, encoding="utf-8", newline="\n")
        batch_files.append(p)

    print(f"[BATCH] {len(batch_files)} fichiers SQL générés dans {batch_dir}", flush=True)
    return batch_files, expected_counts


def push_to_remote_d1(
    db_name: str,
    location: str = "enam",
    db_path: Path = LOCAL_DB_PATH,
    batch_dir: Path = BATCH_DIR,
) -> str:
    if not db_path.exists():
        raise FileNotFoundError(f"Base locale introuvable : {db_path}")

    db_info = provision_or_get_d1(db_name, location=location)
    db_id = str(db_info["uuid"])
    print(f"[D1] Cible distante : {db_name} (uuid={db_id}, compte={ACCOUNT_ID})", flush=True)

    batch_files, expected_counts = export_local_batches(db_path, batch_dir)

    print(f"[D1] Envoi de {len(batch_files)} lots SQL vers {db_name}...", flush=True)
    execute_sql_files_remote(db_name, batch_files)

    rem_ent = d1_query_remote(db_id, "SELECT COUNT(*) AS c FROM entites")[0]["c"]
    rem_rbq = d1_query_remote(db_id, "SELECT COUNT(*) AS c FROM rbq_licences")[0]["c"]
    rem_gleif_ent = d1_query_remote(db_id, "SELECT COUNT(*) AS c FROM gleif_entites")[0]["c"]
    rem_gleif_liens = d1_query_remote(db_id, "SELECT COUNT(*) AS c FROM gleif_liens")[0]["c"]
    rem_gleif_exc = d1_query_remote(db_id, "SELECT COUNT(*) AS c FROM gleif_exceptions")[0]["c"]
    if (
        rem_ent != expected_counts["entites"]
        or rem_gleif_ent != expected_counts["gleif_entites"]
        or rem_gleif_liens != expected_counts["gleif_liens"]
        or rem_gleif_exc != expected_counts["gleif_exceptions"]
    ):
        raise RuntimeError(
            "Comptes distants incohérents : "
            f"entites={rem_ent}/{expected_counts['entites']}, "
            f"gleif_entites={rem_gleif_ent}/{expected_counts['gleif_entites']}, "
            f"gleif_liens={rem_gleif_liens}/{expected_counts['gleif_liens']}, "
            f"gleif_exceptions={rem_gleif_exc}/{expected_counts['gleif_exceptions']}"
        )

    verif = verify_remote_candidate(
        db_id,
        "SELECT COUNT(*) AS c FROM entites_fts WHERE entites_fts MATCH '\"quebec\"* OR \"canada\"*'",
        min_rows=1,
    )
    print(
        f"[OK] {db_name} ({db_id}) validée : {rem_ent} entités, {rem_rbq} RBQ, "
        f"{rem_gleif_ent} LEI, {rem_gleif_liens} liens, {rem_gleif_exc} exceptions, info={verif}",
        flush=True,
    )
    return db_id


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingestion DB_REGISTRES")
    parser.add_argument("--build-local", action="store_true")
    parser.add_argument("--sample", action="store_true")
    parser.add_argument("--export-batches", action="store_true")
    parser.add_argument("--push-remote", action="store_true")
    parser.add_argument("--db-name", default="outils-registres")
    parser.add_argument("--blue-green", action="store_true")
    parser.add_argument("--swap", action="store_true")
    parser.add_argument("--location", default="enam")
    parser.add_argument("--work-dir", type=Path, default=WORK_DIR)
    parser.add_argument("--batch-dir", type=Path, default=BATCH_DIR)
    parser.add_argument("--force-download", action="store_true")
    args = parser.parse_args()

    db_path = args.work_dir / "outils_registres.db"
    if args.build_local:
        build_local_sqlite(
            sample_only=args.sample,
            work_dir=args.work_dir,
            force_download=args.force_download,
        )
    if args.export_batches and not args.push_remote:
        export_local_batches(db_path=db_path, batch_dir=args.batch_dir)
    if args.push_remote:
        target_name = dated_db_name("DB_REGISTRES") if args.blue_green else args.db_name
        db_id = push_to_remote_d1(
            target_name,
            location=args.location,
            db_path=db_path,
            batch_dir=args.batch_dir,
        )
        if args.swap:
            swap_wrangler_binding("DB_REGISTRES", target_name, db_id)


if __name__ == "__main__":
    main()
