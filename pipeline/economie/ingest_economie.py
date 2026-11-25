"""Pipeline d'ingestion et de chargement D1 — Domaine E : Économie (taux BoC, change, IPC & loyers SCHL).

Sources intégrées (zéro appel réseau sortant au moment de la requête MCP) :
  1. Banque du Canada — Valet `FX_RATES_DAILY` (`regime=2`, moyennes quotidiennes 16 h 30 HE
     à compter du 2017-01-03, 27 devises dont 24 actives et 3 historiques).
  2. Banque du Canada — Valet `LEGACY_NOON_RATES` (`regime=1`, taux au comptant de midi
     du 2007-05-01 au 2017-04-28 ; exclut les séries à terme `IEXE0105`, `IEXE0124`, `IEXE0125`
     et donne préséance à `IEXE2703` sur `IEXE2702` pour `ARS` sur le chevauchement 2010–2012).
  3. Statistique Canada — Tableau `10-10-0008-01` (`regime=1`, 21 séries au comptant de midi
     du 2001-01-01 au 2007-04-30, `OGL-Canada`).
  4. Banque du Canada — Séries d'intérêt Valet : `V39079` (taux cible du financement à un jour,
     quotidien ouvrable à compter du 2009-04-21), `V122530` (taux officiel d'escompte mensuel),
     `V80691311` (taux préférentiel hebdomadaire du mercredi, amorcé dès 2000-12-27 pour couvrir
     le 2001-01-01).
  5. Statistique Canada — IPC WDS (`18-10-0004-01` mensuel, `18-10-0005-01` annuel ; Canada,
     Québec, RMR de Québec, RMR de Montréal ; `2002=100` et série historique `1992=100`, `OGL-Canada`).
  6. Statistique Canada / SCHL — Loyers moyens du marché (`34-10-0133-01`, `OGL-Canada`).

Usage :
  python -m pipeline.economie.ingest_economie --build-local --sample --export-batches
  python -m pipeline.economie.ingest_economie --build-local --export-batches
  python -m pipeline.economie.ingest_economie --incremental-fx --sample --export-batches
  python -m pipeline.economie.ingest_economie --incremental-fx --push-remote
  python -m pipeline.economie.ingest_economie --sync-statcan --push-remote
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import re
import sqlite3
import time
import urllib.error
import urllib.request
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path

from pipeline.common.blue_green import (
    WRANGLER_JSONC,
    dated_db_name,
    swap_wrangler_binding,
    verify_remote_candidate,
)
from pipeline.common.d1_batch import (
    ACCOUNT_ID,
    REPO_ROOT,
    d1_query_remote,
    execute_sql_files_remote,
    export_table_batches,
    normalize_search_text,
    provision_or_get_d1,
    sql_literal,
)

HERE = Path(__file__).resolve().parent
WORK_DIR = REPO_ROOT / "pipeline" / "work" / "economie"
BATCH_DIR = REPO_ROOT / "pipeline" / "batches" / "economie"
LOCAL_DB_PATH = WORK_DIR / "outils_economie.db"

MAX_ECONOMIE_DB_BYTES = 15 * 1024 * 1024  # 15 Mio max

BOC_VALET_BASE = "https://www.bankofcanada.ca/valet/observations"
STATCAN_FX_ZIP_URL = "https://www150.statcan.gc.ca/n1/en/tbl/csv/10100008-eng.zip"
STATCAN_WDS_BASE = "https://www150.statcan.gc.ca/t1/wds/rest"
STATCAN_CMHC_ZIP_URL = "https://www150.statcan.gc.ca/n1/en/tbl/csv/34100133-eng.zip"

CPI_CUBES: tuple[tuple[int, str, int], ...] = (
    (18100004, "M", 2000),
    (18100005, "A", 200),
)
CPI_GEOS: tuple[tuple[int, str], ...] = (
    (2, "canada"),
    (11, "quebec"),
    (12, "quebec_rmr"),
    (13, "montreal_rmr"),
)
CPI_PRODUCTS: tuple[tuple[int, str], ...] = (
    (2, "all_items"),
    (79, "shelter"),
    (80, "rented_accommodation"),
    (81, "rent"),
    (311, "health_care_services"),
    (309, "all_items"),
)
MANDATORY_CPI_COORDS: set[str] = {
    f"{geo_id}.{prod_id}.0.0.0.0.0.0.0.0"
    for geo_id, _ in CPI_GEOS
    for prod_id, _ in CPI_PRODUCTS
    if prod_id != 309 and not (geo_id in (12, 13) and prod_id in (81, 311))
}

PROVINCE_SUFFIX_TO_CODE: dict[str, str] = {
    "Quebec": "QC",
    "Ontario": "ON",
    "Ontario/Quebec": "ON/QC",
    "New-Brunswick/Quebec": "NB/QC",
    "New Brunswick/Quebec": "NB/QC",
    "New Brunswick": "NB",
    "Nova Scotia": "NS",
    "Prince Edward Island": "PE",
    "Newfoundland and Labrador": "NL",
    "Manitoba": "MB",
    "Saskatchewan": "SK",
    "Alberta": "AB",
    "British Columbia": "BC",
    "Yukon": "YT",
    "Northwest Territories": "NT",
    "Nunavut": "NU",
    "Canada": "CA",
}

BOC_SERIES = ("V39079", "V122530", "V80691311")
LEGACY_EXCLUDE = {"IEXE0105", "IEXE0124", "IEXE0125"}
FX_DAILY_RE = re.compile(r"^FX([A-Z]{3})CAD$")
LEGACY_NOON_RE = re.compile(r"^([A-Z]{3})_NOON$")

STATCAN_COORD_TO_CCY: dict[str, tuple[str, str]] = {
    "1.1": ("USD", "United States dollar"),
    "1.3": ("BEF", "Belgian franc"),
    "1.4": ("DKK", "Danish krone"),
    "1.5": ("FRF", "French franc"),
    "1.6": ("DEM", "German mark"),
    "1.7": ("ITL", "Italian lira"),
    "1.8": ("JPY", "Japanese yen"),
    "1.9": ("NLG", "Dutch guilder"),
    "1.10": ("NOK", "Norwegian krone"),
    "1.11": ("SEK", "Swedish krona"),
    "1.12": ("CHF", "Swiss franc"),
    "1.13": ("GBP", "United Kingdom pound sterling"),
    "1.19": ("IEP", "Irish pound"),
    "1.20": ("ATS", "Austrian schilling"),
    "1.21": ("AUD", "Australian dollar"),
    "1.22": ("FIM", "Finnish markka"),
    "1.23": ("ESP", "Spanish peseta"),
    "1.24": ("HKD", "Hong Kong dollar"),
    "1.25": ("NZD", "New Zealand dollar"),
    "1.30": ("MXN", "Mexican peso"),
    "1.33": ("EUR", "European euro"),
}

CURRENCY_NAMES_FR: dict[str, str] = {
    "AED": "Dirham des Émirats arabes unis",
    "ANG": "Florin des Antilles néerlandaises",
    "ARS": "Peso argentin",
    "ATS": "Schilling autrichien (pré-euro)",
    "AUD": "Dollar australien",
    "BEF": "Franc belge (pré-euro)",
    "BRL": "Réal brésilien",
    "BSD": "Dollar des Bahamas",
    "CHF": "Franc suisse",
    "CLP": "Peso chilien",
    "CNY": "Yuan renminbi chinois",
    "COP": "Peso colombien",
    "CZK": "Couronne tchèque",
    "DEM": "Mark allemand (pré-euro)",
    "DKK": "Couronne danoise",
    "ESP": "Peseta espagnole (pré-euro)",
    "EUR": "Euro",
    "FIM": "Mark finlandais (pré-euro)",
    "FJD": "Dollar des Fidji",
    "FRF": "Franc français (pré-euro)",
    "GBP": "Livre sterling",
    "GHC": "Cedi ghanéen (ancien)",
    "GHS": "Cedi ghanéen",
    "GTQ": "Quetzal guatémaltèque",
    "HKD": "Dollar de Hong Kong",
    "HNL": "Lempira hondurien",
    "HRK": "Kuna croate",
    "HUF": "Forint hongrois",
    "IDR": "Roupie indonésienne",
    "IEP": "Livre irlandaise (pré-euro)",
    "ILS": "Nouveau shekel israélien",
    "INR": "Roupie indienne",
    "ISK": "Couronne islandaise",
    "ITL": "Lire italienne (pré-euro)",
    "JMD": "Dollar jamaïcain",
    "JPY": "Yen japonais",
    "KRW": "Won sud-coréen",
    "LKR": "Roupie srilankaise",
    "MAD": "Dirham marocain",
    "MMK": "Kyat birman",
    "MXN": "Peso mexicain",
    "MYR": "Ringgit malaisien",
    "NLG": "Florin néerlandais (pré-euro)",
    "NOK": "Couronne norvégienne",
    "NZD": "Dollar néo-zélandais",
    "PAB": "Balboa panaméen",
    "PEN": "Sol péruvien",
    "PHP": "Peso philippin",
    "PKR": "Roupie pakistanaise",
    "PLN": "Zloty polonais",
    "RON": "Leu roumain",
    "RSD": "Dinar serbe",
    "RUB": "Rouble russe",
    "SAR": "Riyal saoudien",
    "SEK": "Couronne suédoise",
    "SGD": "Dollar de Singapour",
    "SKK": "Couronne slovaque",
    "THB": "Baht thaïlandais",
    "TND": "Dinar tunisien",
    "TRY": "Livre turque",
    "TTD": "Dollar de Trinité-et-Tobago",
    "TWD": "Nouveau dollar de Taïwan",
    "USD": "Dollar américain",
    "VEB": "Bolivar vénézuélien (ancien)",
    "VEF": "Bolivar vénézuélien",
    "VND": "Dong vietnamien",
    "XAF": "Franc CFA (BEAC)",
    "XCD": "Dollar des Caraïbes orientales",
    "XPF": "Franc CFP",
    "ZAR": "Rand sud-africain",
}


def date_str_to_int(date_str: str) -> int:
    dt.date.fromisoformat(date_str)
    return int(date_str.replace("-", ""))


def int_to_date_str(date_int: int) -> str:
    y, m, d = date_int // 10000, (date_int // 100) % 100, date_int % 100
    return dt.date(y, m, d).isoformat()


def to_micros(val_str: str) -> int:
    try:
        scaled = Decimal(str(val_str).strip()) * 1_000_000
    except InvalidOperation as exc:
        raise ValueError(f"Valeur de taux de change invalide : {val_str!r}") from exc
    if scaled != scaled.to_integral_value():
        raise ValueError(
            f"Précision > 6 décimales détectée pour un taux de change ({val_str!r}) ; troncature refusée."
        )
    ival = int(scaled)
    if ival <= 0:
        raise ValueError(f"Taux de change non positif inattendu : {val_str!r}")
    return ival


def to_bps(val_str: str) -> int:
    try:
        scaled = Decimal(str(val_str).strip()) * 100
    except InvalidOperation as exc:
        raise ValueError(f"Valeur de taux d'intérêt invalide : {val_str!r}") from exc
    if scaled != scaled.to_integral_value():
        raise ValueError(
            f"Précision > 2 décimales détectée pour un taux BoC ({val_str!r}) ; troncature refusée."
        )
    return int(scaled)


def to_milli(val_str: str | float | int) -> int:
    try:
        scaled = Decimal(str(val_str).strip()) * 1_000
    except InvalidOperation as exc:
        raise ValueError(f"Valeur IPC invalide : {val_str!r}") from exc
    if scaled != scaled.to_integral_value():
        raise ValueError(
            f"Précision > 3 décimales détectée pour un indice IPC ({val_str!r}) ; troncature refusée."
        )
    ival = int(scaled)
    if ival <= 0:
        raise ValueError(f"Indice IPC non positif inattendu : {val_str!r}")
    return ival


def to_rent_dollars(val_str: str) -> int:
    try:
        d = Decimal(str(val_str).strip())
    except InvalidOperation as exc:
        raise ValueError(f"Valeur de loyer SCHL invalide : {val_str!r}") from exc
    if d != d.to_integral_value():
        raise ValueError(f"Loyer SCHL non entier inattendu ({val_str!r}).")
    ival = int(d)
    if ival <= 0:
        raise ValueError(f"Loyer SCHL non positif inattendu : {val_str!r}")
    return ival


def _http_get_bytes(url: str, accept: str = "application/json", retries: int = 3) -> bytes:
    last_exc: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "mcp-outils-pipeline/2.2",
                "Accept": accept,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            last_exc = exc
            if isinstance(exc, urllib.error.HTTPError) and 400 <= exc.code < 500 and exc.code != 429:
                raise
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
    assert last_exc is not None
    raise last_exc


def _http_post_json(url: str, payload: object, retries: int = 3) -> object:
    body = json.dumps(payload).encode("utf-8")
    last_exc: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "User-Agent": "mcp-outils-pipeline/2.2",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (
            urllib.error.URLError,
            urllib.error.HTTPError,
            TimeoutError,
            OSError,
            json.JSONDecodeError,
        ) as exc:
            last_exc = exc
            if isinstance(exc, urllib.error.HTTPError) and 400 <= exc.code < 500 and exc.code != 429:
                raise
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
    assert last_exc is not None
    raise last_exc


def _download_cached(url: str, dest: Path, force: bool = False, accept: str = "*/*") -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not force:
        return dest
    raw = _http_get_bytes(url, accept=accept)
    dest.write_bytes(raw)
    return dest


def _sample_payloads() -> tuple[dict, dict, bytes, dict[str, dict]]:
    """Construit des jeux de données déterministes hors ligne pour tests E2E `--sample`."""
    fx_daily = {
        "seriesDetail": {
            "FXUSDCAD": {"label": "USD/CAD", "description": "Daily average exchange rate of the US dollar in Canadian dollars."},
            "FXEURCAD": {"label": "EUR/CAD", "description": "Daily average exchange rate of the euro in Canadian dollars."},
            "FXJPYCAD": {"label": "JPY/CAD", "description": "Daily average exchange rate of the Japanese yen in Canadian dollars."},
            "FXRUBCAD": {"label": "RUB/CAD", "description": "Daily average exchange rate of the Russian ruble in Canadian dollars."},
        },
        "observations": [
            {"d": "2017-01-03", "FXUSDCAD": {"v": "1.3435"}, "FXEURCAD": {"v": "1.4010"}, "FXJPYCAD": {"v": "0.01140"}, "FXRUBCAD": {"v": "0.022100"}},
            {"d": "2017-04-28", "FXUSDCAD": {"v": "1.3662"}, "FXEURCAD": {"v": "1.4885"}, "FXJPYCAD": {"v": "0.01226"}, "FXRUBCAD": {"v": "0.023950"}},
            {"d": "2017-05-01", "FXUSDCAD": {"v": "1.3670"}, "FXEURCAD": {"v": "1.4900"}, "FXJPYCAD": {"v": "0.01221"}},
            {"d": "2026-04-30", "FXUSDCAD": {"v": "1.3800"}, "FXRUBCAD": {"v": "0.016500"}},
            {"d": "2026-11-20", "FXUSDCAD": {"v": "1.3955"}, "FXEURCAD": {"v": "1.4750"}, "FXJPYCAD": {"v": "0.009145"}},
            {"d": "2026-11-23", "FXUSDCAD": {"v": "1.3982"}, "FXEURCAD": {"v": "1.4792"}, "FXJPYCAD": {"v": "0.009180"}},
        ],
    }
    legacy_noon = {
        "seriesDetail": {
            "IEXE0101": {"label": "USD_NOON", "description": "U.S. dollar, noon"},
            "IEXE0105": {"label": "USD_90D_FWD", "description": "U.S. dollar 90-day forward"},
            "IEXE0701": {"label": "JPY_NOON", "description": "Japanese yen, noon"},
            "IEXE2702": {"label": "ARS_NOON", "description": "Argentine peso (local)"},
            "IEXE2703": {"label": "ARS_NOON", "description": "Argentine peso"},
            "IEXE5001": {"label": "COP_NOON", "description": "Colombian peso"},
        },
        "observations": [
            {"d": "2007-05-01", "IEXE0101": {"v": "1.1078"}, "IEXE0105": {"v": "1.1090"}, "IEXE0701": {"v": "0.009257"}, "IEXE2702": {"v": "0.3590"}, "IEXE5001": {"v": "0.000531"}},
            {"d": "2010-01-04", "IEXE0101": {"v": "1.0410"}, "IEXE2702": {"v": "0.2690"}, "IEXE2703": {"v": "0.2734"}},
            {"d": "2017-01-03", "IEXE0101": {"v": "1.3438"}, "IEXE0701": {"v": "0.01142"}},
            {"d": "2017-04-28", "IEXE0101": {"v": "1.3652"}, "IEXE0701": {"v": "0.01226"}, "IEXE5001": {"v": "0.000463"}},
        ],
    }
    csv_buf = io.StringIO()
    writer = csv.writer(csv_buf, lineterminator="\n")
    writer.writerow(
        ["REF_DATE", "GEO", "DGUID", "Type of currency", "UOM", "UOM_ID", "SCALAR_FACTOR", "SCALAR_ID", "VECTOR", "COORDINATE", "VALUE", "STATUS", "SYMBOL", "TERMINATED", "DECIMALS"]
    )
    writer.writerow(["2001-01-02", "Canada", "", "United States dollar, noon spot rate", "Dollars", "81", "units", "0", "v1", "1.1", "1.4963", "", "", "", "4"])
    writer.writerow(["2001-01-02", "Canada", "", "United States dollar, 90-day forward noon rate", "Dollars", "81", "units", "0", "v2", "1.2", "1.4990", "", "", "", "4"])
    writer.writerow(["2001-01-02", "Canada", "", "French franc, noon spot rate", "Dollars", "81", "units", "0", "v3", "1.5", "0.2145", "", "", "", "4"])
    writer.writerow(["2001-01-02", "Canada", "", "Japanese yen, noon spot rate", "Dollars", "81", "units", "0", "v4", "1.8", "0.013040", "", "", "", "6"])
    writer.writerow(["2007-04-30", "Canada", "", "United States dollar, noon spot rate", "Dollars", "81", "units", "0", "v1", "1.1", "1.1101", "", "", "", "4"])
    writer.writerow(["2007-05-01", "Canada", "", "United States dollar, noon spot rate", "Dollars", "81", "units", "0", "v1", "1.1", "1.1078", "", "", "", "4"])
    zip_bytes = io.BytesIO()
    with zipfile.ZipFile(zip_bytes, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("10100008.csv", csv_buf.getvalue())

    boc_series = {
        "V39079": {
            "observations": [
                {"d": "2009-04-21", "V39079": {"v": "0.25"}},
                {"d": "2026-11-23", "V39079": {"v": "2.50"}},
            ]
        },
        "V122530": {
            "observations": [
                {"d": "2001-01-01", "V122530": {"v": "5.75"}},
                {"d": "2026-10-01", "V122530": {"v": "2.50"}},
            ]
        },
        "V80691311": {
            "observations": [
                {"d": "2000-12-27", "V80691311": {"v": "7.50"}},
                {"d": "2001-01-03", "V80691311": {"v": "7.50"}},
                {"d": "2026-11-18", "V80691311": {"v": "4.70"}},
            ]
        },
    }
    return fx_daily, legacy_noon, zip_bytes.getvalue(), boc_series


def _sample_statcan_payloads() -> tuple[dict, dict[int, dict], list[dict], list[dict], dict, bytes]:
    """Construit des jeux StatCan IPC & SCHL déterministes hors ligne pour `--sample`."""
    codesets = {
        "status": "SUCCESS",
        "object": {
            "uom": [
                {"memberUomCode": 7, "memberUomEn": "1992=100", "memberUomFr": "1992=100"},
                {"memberUomCode": 17, "memberUomEn": "2002=100", "memberUomFr": "2002=100"},
                {"memberUomCode": 81, "memberUomEn": "Dollars", "memberUomFr": "Dollars"},
            ]
        },
    }
    cpi_geo_members = [
        {"memberId": 2, "memberNameEn": "Canada", "memberNameFr": "Canada"},
        {"memberId": 11, "memberNameEn": "Quebec", "memberNameFr": "Québec"},
        {"memberId": 12, "memberNameEn": "Québec, Quebec", "memberNameFr": "Québec, Québec"},
        {"memberId": 13, "memberNameEn": "Montréal, Quebec", "memberNameFr": "Montréal, Québec"},
    ]
    cpi_prod_members = [
        {"memberId": 2, "memberNameEn": "All-items", "memberNameFr": "Ensemble", "memberUomCode": 17},
        {"memberId": 79, "memberNameEn": "Shelter", "memberNameFr": "Logement", "memberUomCode": 17},
        {"memberId": 80, "memberNameEn": "Rented accommodation", "memberNameFr": "Logement locatif", "memberUomCode": 17},
        {"memberId": 81, "memberNameEn": "Rent", "memberNameFr": "Loyer", "memberUomCode": 17},
        {"memberId": 311, "memberNameEn": "Health care services", "memberNameFr": "Services de soins de santé", "memberUomCode": 17},
        {"memberId": 309, "memberNameEn": "All-items (1992=100)", "memberNameFr": "Ensemble (1992=100)", "memberUomCode": 7},
    ]
    cube_metas = {
        18100004: {
            "productId": 18100004,
            "releaseTime": "2026-11-16T08:30",
            "cubeEndDate": "2026-10-01",
            "dimension": [{"member": cpi_geo_members}, {"member": cpi_prod_members}],
        },
        18100005: {
            "productId": 18100005,
            "releaseTime": "2026-01-19T08:30",
            "cubeEndDate": "2025-01-01",
            "dimension": [{"member": cpi_geo_members}, {"member": cpi_prod_members}],
        },
    }

    series_infos: list[dict] = []
    vector_datas: list[dict] = []
    next_vid = 41690001
    for pid, freq, _ in CPI_CUBES:
        for gid, _ in CPI_GEOS:
            for pmid, _ in CPI_PRODUCTS:
                coord = f"{gid}.{pmid}.0.0.0.0.0.0.0.0"
                # RMR Québec (12) et Montréal (13) n'ont pas Rent (81) ni Health care services (311)
                if gid in (12, 13) and pmid in (81, 311):
                    series_infos.append(
                        {
                            "status": "SUCCESS",
                            "object": {
                                "responseStatusCode": 2,
                                "productId": pid,
                                "coordinate": coord,
                                "vectorId": 0,
                                "memberUomCode": None,
                            },
                        }
                    )
                    continue
                vid = next_vid
                next_vid += 1
                uom_code = 7 if pmid == 309 else 17
                series_infos.append(
                    {
                        "status": "SUCCESS",
                        "object": {
                            "responseStatusCode": 0,
                            "productId": pid,
                            "coordinate": coord,
                            "vectorId": vid,
                            "memberUomCode": uom_code,
                        },
                    }
                )
                if freq == "M":
                    if pmid == 309:
                        pts = [
                            {"refPer": "2017-12-01", "value": 152.1},
                            {"refPer": "2018-12-01", "value": 154.6},
                        ]
                    else:
                        pts = [
                            {"refPer": "1978-08-01", "value": None},
                            {"refPer": "2024-10-01", "value": 164.3 if gid == 11 and pmid == 2 else 160.0},
                            {"refPer": "2025-10-01", "value": 168.4 if gid == 11 and pmid == 2 else 163.2},
                            {"refPer": "2026-10-01", "value": 171.2 if gid == 11 and pmid == 2 else 166.5},
                        ]
                else:
                    if pmid == 309:
                        pts = [
                            {"refPer": "2017-01-01", "value": 151.0},
                            {"refPer": "2018-01-01", "value": 153.5},
                        ]
                    elif gid == 11 and pmid == 2:
                        # Reproduit exactement les variations QC 2022->2025 (moyenne 3,1 %)
                        pts = [
                            {"refPer": "2022-01-01", "value": 147.0},
                            {"refPer": "2023-01-01", "value": 153.6},
                            {"refPer": "2024-01-01", "value": 157.2},
                            {"refPer": "2025-01-01", "value": 161.0},
                        ]
                    elif gid == 11 and pmid == 311:
                        # Reproduit exactement les variations QC soins santé 2022->2025 (moyenne 6,7 %)
                        pts = [
                            {"refPer": "2022-01-01", "value": 140.6},
                            {"refPer": "2023-01-01", "value": 150.6},
                            {"refPer": "2024-01-01", "value": 160.0},
                            {"refPer": "2025-01-01", "value": 170.7},
                        ]
                    else:
                        pts = [
                            {"refPer": "2024-01-01", "value": 158.0},
                            {"refPer": "2025-01-01", "value": 162.0},
                        ]
                vector_datas.append(
                    {
                        "status": "SUCCESS",
                        "object": {
                            "productId": pid,
                            "coordinate": coord,
                            "vectorId": vid,
                            "vectorDataPoint": pts,
                        },
                    }
                )

    cmhc_meta = {
        "productId": 34100133,
        "releaseTime": "2025-12-17T08:30",
        "cubeEndDate": "2025-01-01",
        "dimension": [
            {
                "member": [
                    {"memberId": 37, "memberNameEn": "Ottawa-Gatineau, Quebec part, Ontario/Quebec", "memberNameFr": "Ottawa-Gatineau, partie québécoise, Ontario/Québec"},
                    {"memberId": 46, "memberNameEn": "Montréal, Quebec", "memberNameFr": "Montréal, Québec"},
                    {"memberId": 48, "memberNameEn": "Québec, Quebec", "memberNameFr": "Québec, Québec"},
                    {"memberId": 105, "memberNameEn": "Ottawa-Gatineau, Ontario/Quebec", "memberNameFr": "Ottawa-Gatineau, Ontario/Québec"},
                    {"memberId": 203, "memberNameEn": "Saint-Lin--Laurentides, Quebec", "memberNameFr": "Saint-Lin--Laurentides, Québec"},
                    {"memberId": 219, "memberNameEn": "Sainte- Sophie, Quebec", "memberNameFr": "Sainte- Sophie, Québec"},
                ]
            }
        ],
    }

    cmhc_buf = io.StringIO()
    cw = csv.writer(cmhc_buf, lineterminator="\n")
    cw.writerow(
        ["REF_DATE", "GEO", "DGUID", "Type of structure", "Type of unit", "UOM", "UOM_ID", "SCALAR_FACTOR", "SCALAR_ID", "VECTOR", "COORDINATE", "VALUE", "STATUS", "SYMBOL", "TERMINATED", "DECIMALS"]
    )
    cw.writerow(["2024", "Montréal, Quebec", "", "Row and apartment structures of three units and over", "Two bedroom units", "Dollars", "81", "units", "0", "v3823089", "46.3.3", "1240", "", "", "", "0"])
    cw.writerow(["2025", "Montréal, Quebec", "", "Row and apartment structures of three units and over", "One bedroom units", "Dollars", "81", "units", "0", "v3822955", "46.3.2", "1131", "", "", "", "0"])
    cw.writerow(["2025", "Montréal, Quebec", "", "Row and apartment structures of three units and over", "Two bedroom units", "Dollars", "81", "units", "0", "v3823089", "46.3.3", "1346", "", "", "", "0"])
    cw.writerow(["2025", "Québec, Quebec", "", "Row and apartment structures of three units and over", "Two bedroom units", "Dollars", "81", "units", "0", "v3823095", "48.3.3", "1276", "", "", "", "0"])
    cw.writerow(["2025", "Québec, Quebec", "", "Row structures of three units and over", "Bachelor units", "Dollars", "81", "units", "0", "v3823363", "48.2.1", "", "..", "", "", "0"])
    cw.writerow(["1987", "Québec, Quebec", "", "Row structures of three units and over", "Bachelor units", "Dollars", "81", "units", "0", "v3823363", "48.2.1", "0", "", "", "", "0"])
    cw.writerow(["2025", "Ottawa-Gatineau, Quebec part, Ontario/Quebec", "", "Row and apartment structures of three units and over", "Two bedroom units", "Dollars", "81", "units", "0", "v3823080", "37.3.3", "1452", "", "", "", "0"])
    cw.writerow(["2025", "Ottawa-Gatineau, Ontario/Quebec", "", "Row and apartment structures of three units and over", "Two bedroom units", "Dollars", "81", "units", "0", "v3823148", "105.3.3", "1740", "", "", "", "0"])
    cw.writerow(["2025", "Saint-Lin--Laurentides, Quebec", "", "Row and apartment structures of three units and over", "Two bedroom units", "Dollars", "81", "units", "0", "v9990001", "203.3.3", "1050", "", "", "", "0"])
    cw.writerow(["2025", "Sainte- Sophie, Quebec", "", "Row and apartment structures of three units and over", "Two bedroom units", "Dollars", "81", "units", "0", "v9990002", "219.3.3", "", "F", "", "", "0"])
    cw.writerow(["2025", "Sainte- Sophie, Quebec", "", "Apartment structures of three units and over", "Two bedroom units", "Dollars", "81", "units", "0", "v9990003", "219.1.3", "1105", "", "", "", "0"])

    cmhc_zip = io.BytesIO()
    with zipfile.ZipFile(cmhc_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("34100133.csv", cmhc_buf.getvalue())

    return codesets, cube_metas, series_infos, vector_datas, cmhc_meta, cmhc_zip.getvalue()


def _parse_fx_daily(
    payload: dict,
    currencies: dict[str, dict],
    rates_map: dict[tuple[str, int, int], int],
) -> tuple[int, str]:
    details = payload.get("seriesDetail") or {}
    series_to_ccy: dict[str, str] = {}
    for s_key, meta in details.items():
        m = FX_DAILY_RE.match(s_key)
        if not m:
            continue
        ccy = m.group(1)
        series_to_ccy[s_key] = ccy
        desc = str(meta.get("description") or ccy).strip()
        # Extraire un libellé anglais court lisible
        short_en = desc.replace("Daily average exchange rate of the ", "").replace(" in Canadian dollars.", "").strip()
        if short_en:
            short_en = short_en[0].upper() + short_en[1:]
        entry = currencies.setdefault(
            ccy,
            {"name_en": short_en or ccy, "name_fr": CURRENCY_NAMES_FR.get(ccy, short_en or ccy), "active_daily": 0, "first_date": 99999999, "last_date": 0},
        )
        entry["active_daily"] = 1

    count = 0
    max_date = ""
    for row in payload.get("observations") or []:
        d_str = row.get("d")
        if not d_str or d_str < "2017-01-03":
            continue
        d_int = date_str_to_int(d_str)
        if d_str > max_date:
            max_date = d_str
        for s_key, ccy in series_to_ccy.items():
            cell = row.get(s_key)
            if not isinstance(cell, dict):
                continue
            val = cell.get("v")
            if val is None or val == "":
                continue
            micros = to_micros(str(val))
            rates_map[(ccy, d_int, 2)] = micros
            count += 1
            entry = currencies[ccy]
            if d_int < entry["first_date"]:
                entry["first_date"] = d_int
            if d_int > entry["last_date"]:
                entry["last_date"] = d_int
    return count, max_date


def _parse_legacy_noon(
    payload: dict,
    currencies: dict[str, dict],
    rates_map: dict[tuple[str, int, int], int],
) -> tuple[int, str]:
    details = payload.get("seriesDetail") or {}
    series_to_ccy: dict[str, str] = {}
    for s_key, meta in details.items():
        if s_key in LEGACY_EXCLUDE:
            continue
        label = str(meta.get("label") or "")
        m = LEGACY_NOON_RE.match(label)
        if not m:
            continue
        ccy = m.group(1)
        series_to_ccy[s_key] = ccy
        desc = str(meta.get("description") or ccy).replace(", noon", "").strip()
        if ccy not in currencies:
            currencies[ccy] = {
                "name_en": desc or ccy,
                "name_fr": CURRENCY_NAMES_FR.get(ccy, desc or ccy),
                "active_daily": 0,
                "first_date": 99999999,
                "last_date": 0,
            }

    count = 0
    max_date = ""
    # Trier pour appliquer IEXE2703 en dernier (prioritaire sur IEXE2702 pour ARS 2010..2012)
    ordered_keys = sorted(series_to_ccy.keys(), key=lambda k: (1 if k == "IEXE2703" else 0, k))
    for row in payload.get("observations") or []:
        d_str = row.get("d")
        if not d_str or d_str < "2007-05-01" or d_str > "2017-04-28":
            continue
        d_int = date_str_to_int(d_str)
        if d_str > max_date:
            max_date = d_str
        for s_key in ordered_keys:
            ccy = series_to_ccy[s_key]
            cell = row.get(s_key)
            if not isinstance(cell, dict):
                continue
            val = cell.get("v")
            if val is None or val == "":
                continue
            micros = to_micros(str(val))
            key = (ccy, d_int, 1)
            if key not in rates_map:
                count += 1
            rates_map[key] = micros
            entry = currencies[ccy]
            if d_int < entry["first_date"]:
                entry["first_date"] = d_int
            if d_int > entry["last_date"]:
                entry["last_date"] = d_int
    return count, max_date


def _parse_statcan_fx(
    zip_bytes: bytes,
    currencies: dict[str, dict],
    rates_map: dict[tuple[str, int, int], int],
) -> tuple[int, str]:
    count = 0
    max_date = ""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        csv_names = [n for n in zf.namelist() if n.endswith(".csv") and "MetaData" not in n]
        if not csv_names:
            raise RuntimeError("Aucun CSV trouvé dans l'archive StatCan 10-10-0008-01.")
        with zf.open(csv_names[0]) as fh:
            reader = csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig"))
            for row in reader:
                coord = (row.get("COORDINATE") or "").strip()
                mapped = STATCAN_COORD_TO_CCY.get(coord)
                if not mapped:
                    continue
                d_str = (row.get("REF_DATE") or "").strip()
                if not d_str or d_str < "2001-01-01" or d_str > "2007-04-30":
                    continue
                val = (row.get("VALUE") or "").strip()
                if not val:
                    continue
                # StatCan 10-10-0008-01 encode les fins de semaine et jours fériés par 0.00000000
                if Decimal(val) == 0:
                    continue
                ccy, name_en = mapped
                if ccy not in currencies:
                    currencies[ccy] = {
                        "name_en": name_en,
                        "name_fr": CURRENCY_NAMES_FR.get(ccy, name_en),
                        "active_daily": 0,
                        "first_date": 99999999,
                        "last_date": 0,
                    }
                d_int = date_str_to_int(d_str)
                if d_str > max_date:
                    max_date = d_str
                micros = to_micros(val)
                key = (ccy, d_int, 1)
                if key not in rates_map:
                    count += 1
                rates_map[key] = micros
                entry = currencies[ccy]
                if d_int < entry["first_date"]:
                    entry["first_date"] = d_int
                if d_int > entry["last_date"]:
                    entry["last_date"] = d_int
    return count, max_date


def _parse_boc_rates(
    boc_payloads: dict[str, dict],
) -> tuple[list[tuple[str, int, int]], dict[str, str]]:
    rows: list[tuple[str, int, int]] = []
    max_dates: dict[str, str] = {}
    for sid, payload in boc_payloads.items():
        min_date = "2000-12-27" if sid == "V80691311" else "2001-01-01"
        latest = ""
        for obs in payload.get("observations") or []:
            d_str = obs.get("d")
            if not d_str or d_str < min_date:
                continue
            cell = obs.get(sid)
            if not isinstance(cell, dict):
                continue
            val = cell.get("v")
            if val is None or val == "":
                continue
            bps = to_bps(str(val))
            rows.append((sid, date_str_to_int(d_str), bps))
            if d_str > latest:
                latest = d_str
        max_dates[sid] = latest
    return rows, max_dates


def _parse_cpi_wds(
    codesets_payload: dict,
    cube_metas: dict[int, dict],
    series_infos: list[dict],
    vector_datas: list[dict],
    require_all_mandatory: bool = True,
) -> tuple[list[dict], list[tuple[int, int, int]], dict[str, dict]]:
    uom_map: dict[int, str] = {}
    for entry in (codesets_payload.get("object") or {}).get("uom") or []:
        code = entry.get("memberUomCode")
        if code is not None:
            uom_map[int(code)] = str(entry.get("memberUomEn") or entry.get("memberUomFr") or "")

    geo_code_map = dict(CPI_GEOS)
    prod_code_map = dict(CPI_PRODUCTS)
    cube_freq_map = {pid: freq for pid, freq, _ in CPI_CUBES}

    cube_dim_labels: dict[int, tuple[dict[int, tuple[str, str]], dict[int, tuple[str, str, int | None]]]] = {}
    meta_dates: dict[str, str] = {}
    for pid, freq, _ in CPI_CUBES:
        meta = cube_metas.get(pid) or {}
        dims = meta.get("dimension") or []
        geo_dim = {
            int(m["memberId"]): (str(m.get("memberNameEn") or ""), str(m.get("memberNameFr") or ""))
            for m in (dims[0].get("member") if len(dims) > 0 else []) or []
        }
        prod_dim = {
            int(m["memberId"]): (
                str(m.get("memberNameEn") or ""),
                str(m.get("memberNameFr") or ""),
                int(m["memberUomCode"]) if m.get("memberUomCode") is not None else None,
            )
            for m in (dims[1].get("member") if len(dims) > 1 else []) or []
        }
        cube_dim_labels[pid] = (geo_dim, prod_dim)
        end_d = str(meta.get("cubeEndDate") or "")[:10]
        rel_d = str(meta.get("releaseTime") or "")[:10]
        meta_dates[freq] = end_d or rel_d or dt.date.today().isoformat()

    obs_by_vid: dict[int, list[tuple[int, int]]] = {}
    for v_item in vector_datas:
        if v_item.get("status") != "SUCCESS":
            continue
        v_obj = v_item.get("object") or {}
        vid = int(v_obj.get("vectorId") or 0)
        if vid <= 0:
            continue
        pid = int(v_obj.get("productId") or 0)
        freq = cube_freq_map.get(pid, "M")
        pts: list[tuple[int, int]] = []
        for pt in v_obj.get("vectorDataPoint") or []:
            val = pt.get("value")
            if val is None or val == "":
                continue
            ref_per = str(pt.get("refPer") or "").strip()
            if len(ref_per) < 4:
                continue
            period_int = int(ref_per[:7].replace("-", "")) if freq == "M" else int(ref_per[:4])
            pts.append((period_int, to_milli(val)))
        obs_by_vid[vid] = pts

    series_list: list[dict] = []
    seen_mandatory: dict[int, set[str]] = {pid: set() for pid, _, _ in CPI_CUBES}
    for s_item in series_infos:
        if s_item.get("status") != "SUCCESS":
            continue
        s_obj = s_item.get("object") or {}
        vid = int(s_obj.get("vectorId") or 0)
        if s_obj.get("responseStatusCode") not in (0, None) or vid <= 0:
            continue
        pid = int(s_obj.get("productId") or 0)
        if pid not in cube_freq_map:
            continue
        freq = cube_freq_map[pid]
        coord = str(s_obj.get("coordinate") or "")
        parts = coord.split(".")
        if len(parts) < 2:
            continue
        geo_mid = int(parts[0])
        prod_mid = int(parts[1])
        geo_code = geo_code_map.get(geo_mid)
        prod_code = prod_code_map.get(prod_mid)
        if not geo_code or not prod_code:
            continue
        if coord in MANDATORY_CPI_COORDS:
            seen_mandatory[pid].add(coord)

        geo_dim, prod_dim = cube_dim_labels[pid]
        geo_en, geo_fr = geo_dim.get(geo_mid, (geo_code, geo_code))
        prod_en, prod_fr, prod_uom_code = prod_dim.get(prod_mid, (prod_code, prod_code, None))
        uom_code = s_obj.get("memberUomCode")
        if uom_code is None:
            uom_code = prod_uom_code
        uom = uom_map.get(int(uom_code), "2002=100") if uom_code is not None else "2002=100"

        pts = obs_by_vid.get(vid, [])
        if not pts:
            continue
        periods = [p for p, _ in pts]
        series_list.append(
            {
                "product_id": pid,
                "frequency": freq,
                "geo_code": geo_code,
                "geo_en": geo_en,
                "geo_fr": geo_fr,
                "product_code": prod_code,
                "product_en": prod_en,
                "product_fr": prod_fr,
                "coordinate": coord,
                "vector_id": vid,
                "uom": uom,
                "first_period": min(periods),
                "last_period": max(periods),
                "points": pts,
            }
        )

    if require_all_mandatory:
        for pid, _, _ in CPI_CUBES:
            missing = MANDATORY_CPI_COORDS - seen_mandatory[pid]
            if missing:
                raise RuntimeError(
                    f"Vecteurs IPC obligatoires manquants pour cube {pid} : {sorted(missing)}"
                )

    series_list.sort(key=lambda s: (s["product_id"], s["coordinate"], s["uom"]))
    obs_rows: list[tuple[int, int, int]] = []
    final_series: list[dict] = []
    counts_by_freq = {"M": 0, "A": 0}
    for sid, s in enumerate(series_list, 1):
        entry = {k: v for k, v in s.items() if k != "points"}
        entry["id"] = sid
        final_series.append(entry)
        for p_int, val_m in sorted(set(s["points"])):
            obs_rows.append((sid, p_int, val_m))
            counts_by_freq[s["frequency"]] += 1

    meta_out = {
        "M": {"version_date": meta_dates.get("M", ""), "row_count": counts_by_freq["M"]},
        "A": {"version_date": meta_dates.get("A", ""), "row_count": counts_by_freq["A"]},
    }
    return final_series, obs_rows, meta_out


def _fetch_cpi_wds_payloads(
    months_n: int = 2000,
    years_n: int = 200,
    work_dir: Path | None = None,
    force_download: bool = False,
) -> tuple[dict, dict[int, dict], list[dict], list[dict]]:
    cache_path = (work_dir / "statcan_cpi_wds.json") if work_dir else None
    if cache_path and cache_path.exists() and not force_download:
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        return (
            cached["codesets"],
            {int(k): v for k, v in cached["cube_metas"].items()},
            cached["series_infos"],
            cached["vector_datas"],
        )

    codesets = json.loads(_http_get_bytes(f"{STATCAN_WDS_BASE}/getCodeSets", accept="application/json").decode("utf-8"))
    meta_resp = _http_post_json(
        f"{STATCAN_WDS_BASE}/getCubeMetadata",
        [{"productId": pid} for pid, _, _ in CPI_CUBES],
    )
    cube_metas: dict[int, dict] = {}
    for item in meta_resp if isinstance(meta_resp, list) else []:
        if item.get("status") == "SUCCESS" and isinstance(item.get("object"), dict):
            obj = item["object"]
            cube_metas[int(obj["productId"])] = obj

    coord_reqs = [
        {"productId": pid, "coordinate": f"{gid}.{pmid}.0.0.0.0.0.0.0.0"}
        for pid, _, _ in CPI_CUBES
        for gid, _ in CPI_GEOS
        for pmid, _ in CPI_PRODUCTS
    ]
    series_infos = _http_post_json(f"{STATCAN_WDS_BASE}/getSeriesInfoFromCubePidCoord", coord_reqs)
    if not isinstance(series_infos, list):
        raise RuntimeError("Réponse inattendue de StatCan getSeriesInfoFromCubePidCoord.")

    latest_by_pid = {18100004: months_n, 18100005: years_n}
    vec_reqs = []
    for item in series_infos:
        if item.get("status") != "SUCCESS":
            continue
        obj = item.get("object") or {}
        vid = int(obj.get("vectorId") or 0)
        pid = int(obj.get("productId") or 0)
        if obj.get("responseStatusCode") in (0, None) and vid > 0 and pid in latest_by_pid:
            vec_reqs.append({"vectorId": vid, "latestN": latest_by_pid[pid]})

    vector_datas = _http_post_json(
        f"{STATCAN_WDS_BASE}/getDataFromVectorsAndLatestNPeriods",
        vec_reqs,
    )
    if not isinstance(vector_datas, list):
        raise RuntimeError("Réponse inattendue de StatCan getDataFromVectorsAndLatestNPeriods.")

    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(
            json.dumps(
                {
                    "codesets": codesets,
                    "cube_metas": {str(k): v for k, v in cube_metas.items()},
                    "series_infos": series_infos,
                    "vector_datas": vector_datas,
                }
            ),
            encoding="utf-8",
            newline="\n",
        )
    return codesets, cube_metas, series_infos, vector_datas


def _normalize_cmhc_centre(
    geo_id: int,
    name_en: str,
    name_fr: str,
    used_keys: set[str],
) -> tuple[str, str, str, int]:
    is_qc = 1 if (name_en.endswith(", Quebec") or ", Quebec part," in name_en) else 0

    prov_code = ""
    if ", Quebec part," in name_en:
        prov_code = "QC"
    elif ", Ontario part," in name_en:
        prov_code = "ON"
    elif ", New Brunswick part," in name_en:
        prov_code = "NB"
    elif "," in name_en:
        suffix = name_en.rsplit(",", 1)[1].strip()
        prov_code = PROVINCE_SUFFIX_TO_CODE.get(suffix, "")

    cleaned_fr = re.sub(r"-\s+", "-", name_fr)
    cleaned_fr = re.sub(r"-{2,}", "-", cleaned_fr).strip()
    if "," in cleaned_fr:
        locality_fr = cleaned_fr.rsplit(",", 1)[0].strip()
    else:
        locality_fr = cleaned_fr
    search_norm = normalize_search_text(locality_fr)

    slug = "-".join(search_norm.split()) or f"centre-{geo_id}"
    prov_slug = prov_code.lower().replace("/", "-")
    base_key = f"{slug}-{prov_slug}" if prov_slug else slug
    geo_key = base_key if base_key not in used_keys else f"{base_key}-{geo_id}"
    used_keys.add(geo_key)
    return geo_key, search_norm, prov_code, is_qc


def _parse_statcan_cmhc(
    zip_bytes: bytes,
    cmhc_meta: dict,
) -> tuple[list[dict], list[tuple[int, int, int, int, int]], str]:
    release_date = str(cmhc_meta.get("releaseTime") or cmhc_meta.get("cubeEndDate") or "")[:10]
    dims = cmhc_meta.get("dimension") or []
    member_labels: dict[int, tuple[str, str]] = {}
    for m in (dims[0].get("member") if len(dims) > 0 else []) or []:
        member_labels[int(m["memberId"])] = (
            str(m.get("memberNameEn") or ""),
            str(m.get("memberNameFr") or ""),
        )

    rents_map: dict[tuple[int, int, int, int], int] = {}
    year_bounds: dict[int, tuple[int, int]] = {}
    csv_geo_fallback: dict[int, str] = {}

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        csv_names = [n for n in zf.namelist() if n.endswith(".csv") and "MetaData" not in n]
        if not csv_names:
            raise RuntimeError("Aucun CSV trouvé dans l'archive StatCan 34-10-0133-01.")
        with zf.open(csv_names[0]) as fh:
            reader = csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig"))
            for row in reader:
                uom = (row.get("UOM") or "").strip()
                if uom and uom != "Dollars":
                    raise ValueError(f"Unité SCHL inattendue : {uom!r} (attendu 'Dollars').")
                if (row.get("STATUS") or "").strip() or (row.get("SYMBOL") or "").strip():
                    continue
                val_str = (row.get("VALUE") or "").strip()
                if not val_str:
                    continue
                # StatCan 34-10-0133-01 encode parfois des cellules non enquêtées par '0'
                if Decimal(val_str) == 0:
                    continue
                coord = (row.get("COORDINATE") or "").strip()
                parts = coord.split(".")
                if len(parts) != 3:
                    continue
                geo_id = int(parts[0])
                struct_id = int(parts[1])
                unit_id = int(parts[2])
                if not (1 <= struct_id <= 4 and 1 <= unit_id <= 4):
                    continue
                ref_raw = (row.get("REF_DATE") or "").strip()
                if len(ref_raw) < 4:
                    continue
                year = int(ref_raw[:4])
                dollars = to_rent_dollars(val_str)

                rents_map[(geo_id, struct_id, unit_id, year)] = dollars
                if geo_id not in csv_geo_fallback:
                    csv_geo_fallback[geo_id] = (row.get("GEO") or f"Centre {geo_id}").strip()
                lo, hi = year_bounds.get(geo_id, (year, year))
                year_bounds[geo_id] = (min(lo, year), max(hi, year))

    centres: list[dict] = []
    used_keys: set[str] = set()
    for geo_id in sorted(year_bounds.keys()):
        fallback_name = csv_geo_fallback.get(geo_id, f"Centre {geo_id}")
        name_en, name_fr = member_labels.get(geo_id, (fallback_name, fallback_name))
        geo_key, search_norm, prov_code, is_qc = _normalize_cmhc_centre(
            geo_id, name_en, name_fr, used_keys
        )
        first_y, last_y = year_bounds[geo_id]
        centres.append(
            {
                "geo_member_id": geo_id,
                "geo_key": geo_key,
                "name_en": name_en,
                "name_fr": name_fr,
                "search_norm": search_norm,
                "province_code": prov_code,
                "is_quebec": is_qc,
                "uom": "Dollars",
                "first_year": first_y,
                "last_year": last_y,
            }
        )

    rent_rows = [
        (g_id, s_id, u_id, yr, val)
        for (g_id, s_id, u_id, yr), val in sorted(rents_map.items())
    ]
    return centres, rent_rows, (release_date or dt.date.today().isoformat())


def _fetch_cmhc_payloads(
    work_dir: Path | None = None,
    force_download: bool = False,
) -> tuple[dict, bytes]:
    meta_path = (work_dir / "34100133_meta.json") if work_dir else None
    if meta_path and meta_path.exists() and not force_download:
        cmhc_meta = json.loads(meta_path.read_text(encoding="utf-8"))
    else:
        meta_resp = _http_post_json(f"{STATCAN_WDS_BASE}/getCubeMetadata", [{"productId": 34100133}])
        cmhc_meta = {}
        for item in meta_resp if isinstance(meta_resp, list) else []:
            if item.get("status") == "SUCCESS" and isinstance(item.get("object"), dict):
                cmhc_meta = item["object"]
                break
        if not cmhc_meta:
            raise RuntimeError("Métadonnées StatCan 34-10-0133-01 introuvables.")
        if meta_path:
            meta_path.parent.mkdir(parents=True, exist_ok=True)
            meta_path.write_text(json.dumps(cmhc_meta), encoding="utf-8", newline="\n")

    if work_dir:
        zip_path = _download_cached(
            STATCAN_CMHC_ZIP_URL,
            work_dir / "34100133-eng.zip",
            force=force_download,
        )
        zip_bytes = zip_path.read_bytes()
    else:
        zip_bytes = _http_get_bytes(STATCAN_CMHC_ZIP_URL, accept="*/*")
    return cmhc_meta, zip_bytes


def build_local_sqlite(
    sample_only: bool = False,
    work_dir: Path = WORK_DIR,
    force_download: bool = False,
) -> Path:
    work_dir.mkdir(parents=True, exist_ok=True)
    db_path = work_dir / "outils_economie.db"
    if db_path.exists():
        db_path.unlink()

    if sample_only:
        fx_daily, legacy_noon, statcan_zip_bytes, boc_payloads = _sample_payloads()
        codesets, cube_metas, series_infos, vector_datas, cmhc_meta, cmhc_zip_bytes = (
            _sample_statcan_payloads()
        )
    else:
        fx_daily_path = _download_cached(
            f"{BOC_VALET_BASE}/group/FX_RATES_DAILY/json?start_date=2017-01-01",
            work_dir / "fx_rates_daily.json",
            force=force_download,
            accept="application/json",
        )
        legacy_path = _download_cached(
            f"{BOC_VALET_BASE}/group/LEGACY_NOON_RATES/json",
            work_dir / "legacy_noon_rates.json",
            force=force_download,
            accept="application/json",
        )
        statcan_path = _download_cached(
            STATCAN_FX_ZIP_URL,
            work_dir / "10100008-eng.zip",
            force=force_download,
        )
        fx_daily = json.loads(fx_daily_path.read_text(encoding="utf-8"))
        legacy_noon = json.loads(legacy_path.read_text(encoding="utf-8"))
        statcan_zip_bytes = statcan_path.read_bytes()
        boc_payloads = {}
        for sid in BOC_SERIES:
            p = _download_cached(
                f"{BOC_VALET_BASE}/{sid}/json?start_date=2000-12-01",
                work_dir / f"{sid}.json",
                force=force_download,
                accept="application/json",
            )
            boc_payloads[sid] = json.loads(p.read_text(encoding="utf-8"))

        codesets, cube_metas, series_infos, vector_datas = _fetch_cpi_wds_payloads(
            months_n=2000,
            years_n=200,
            work_dir=work_dir,
            force_download=force_download,
        )
        cmhc_meta, cmhc_zip_bytes = _fetch_cmhc_payloads(
            work_dir=work_dir,
            force_download=force_download,
        )

    currencies: dict[str, dict] = {}
    rates_map: dict[tuple[str, int, int], int] = {}

    statcan_count, statcan_max = _parse_statcan_fx(statcan_zip_bytes, currencies, rates_map)
    legacy_count, legacy_max = _parse_legacy_noon(legacy_noon, currencies, rates_map)
    daily_count, daily_max = _parse_fx_daily(fx_daily, currencies, rates_map)
    boc_rows, boc_max_dates = _parse_boc_rates(boc_payloads)

    cpi_series_rows, cpi_obs_rows, cpi_meta = _parse_cpi_wds(
        codesets, cube_metas, series_infos, vector_datas
    )
    cmhc_centres_rows, cmhc_rent_rows, cmhc_release_date = _parse_statcan_cmhc(
        cmhc_zip_bytes, cmhc_meta
    )

    sorted_ccys = sorted(currencies.keys())
    ccy_to_id = {code: idx for idx, code in enumerate(sorted_ccys, 1)}

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript((HERE / "schema.sql").read_text(encoding="utf-8"))

    conn.executemany(
        "INSERT INTO fx_currencies (id, code, name_en, name_fr, active_daily, first_date, last_date) "
        "VALUES (?,?,?,?,?,?,?)",
        [
            (
                ccy_to_id[code],
                code,
                currencies[code]["name_en"],
                currencies[code]["name_fr"],
                currencies[code]["active_daily"],
                currencies[code]["first_date"],
                currencies[code]["last_date"],
            )
            for code in sorted_ccys
        ],
    )

    conn.executemany(
        "INSERT INTO fx_rates (currency_id, obs_date, regime, rate_micros) VALUES (?,?,?,?)",
        [
            (ccy_to_id[ccy], d_int, regime, micros)
            for (ccy, d_int, regime), micros in sorted(rates_map.items())
        ],
    )

    conn.executemany(
        "INSERT INTO boc_rates (series_id, obs_date, rate_bps) VALUES (?,?,?)",
        sorted(boc_rows),
    )

    conn.executemany(
        "INSERT INTO cpi_series "
        "(id, product_id, frequency, geo_code, geo_en, geo_fr, product_code, product_en, product_fr, "
        "coordinate, vector_id, uom, first_period, last_period) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            (
                s["id"],
                s["product_id"],
                s["frequency"],
                s["geo_code"],
                s["geo_en"],
                s["geo_fr"],
                s["product_code"],
                s["product_en"],
                s["product_fr"],
                s["coordinate"],
                s["vector_id"],
                s["uom"],
                s["first_period"],
                s["last_period"],
            )
            for s in cpi_series_rows
        ],
    )

    conn.executemany(
        "INSERT INTO cpi_observations (series_id, period, value_milli) VALUES (?,?,?)",
        cpi_obs_rows,
    )

    conn.executemany(
        "INSERT INTO cmhc_centres "
        "(geo_member_id, geo_key, name_en, name_fr, search_norm, province_code, is_quebec, uom, first_year, last_year) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        [
            (
                c["geo_member_id"],
                c["geo_key"],
                c["name_en"],
                c["name_fr"],
                c["search_norm"],
                c["province_code"],
                c["is_quebec"],
                c["uom"],
                c["first_year"],
                c["last_year"],
            )
            for c in cmhc_centres_rows
        ],
    )

    conn.executemany(
        "INSERT INTO cmhc_rents (geo_member_id, structure_id, unit_id, year, rent_dollars) VALUES (?,?,?,?,?)",
        cmhc_rent_rows,
    )

    boc_latest = max((v for v in boc_max_dates.values() if v), default=dt.date.today().isoformat())
    conn.executemany(
        "INSERT INTO meta_sources (source_key, source_label, licence, version_date, row_count) VALUES (?,?,?,?,?)",
        [
            (
                "boc_fx_daily",
                "Banque du Canada — Valet FX_RATES_DAILY (moyennes quotidiennes 16 h 30 HE)",
                "Conditions d'utilisation Banque du Canada",
                daily_max or dt.date.today().isoformat(),
                daily_count,
            ),
            (
                "boc_legacy_noon",
                "Banque du Canada — Valet LEGACY_NOON_RATES (midi HE 2007–2017)",
                "Conditions d'utilisation Banque du Canada",
                legacy_max or "2017-04-28",
                legacy_count,
            ),
            (
                "statcan_10100008",
                "Statistique Canada — Tableau 10-10-0008-01 (taux au comptant de midi 2001–2007)",
                "OGL-Canada",
                statcan_max or "2007-04-30",
                statcan_count,
            ),
            (
                "boc_interest_rates",
                "Banque du Canada — Séries V39079 (taux directeur), V122530 (escompte) et V80691311 (préférentiel)",
                "Conditions d'utilisation Banque du Canada",
                boc_latest,
                len(boc_rows),
            ),
            (
                "statcan_cpi_monthly",
                "Statistique Canada — Tableau 18-10-0004-01 (IPC mensuel)",
                "OGL-Canada",
                cpi_meta["M"]["version_date"] or dt.date.today().isoformat(),
                cpi_meta["M"]["row_count"],
            ),
            (
                "statcan_cpi_annual",
                "Statistique Canada — Tableau 18-10-0005-01 (IPC annuel)",
                "OGL-Canada",
                cpi_meta["A"]["version_date"] or dt.date.today().isoformat(),
                cpi_meta["A"]["row_count"],
            ),
            (
                "statcan_cmhc_rents",
                "Statistique Canada / SCHL — Tableau 34-10-0133-01 (loyers moyens du marché)",
                "OGL-Canada",
                cmhc_release_date,
                len(cmhc_rent_rows),
            ),
        ],
    )

    conn.executescript((HERE / "indexes.sql").read_text(encoding="utf-8"))
    conn.commit()
    conn.execute("VACUUM;")
    conn.close()

    size_bytes = db_path.stat().st_size
    size_mb = size_bytes / (1024 * 1024)
    if size_bytes >= MAX_ECONOMIE_DB_BYTES:
        raise RuntimeError(
            f"Base SQLite {db_path.name} trop volumineuse ({size_mb:.2f} Mo >= 15 Mo)."
        )
    print(
        f"[OK] {db_path} créée ({size_mb:.2f} Mo) : {len(sorted_ccys)} devises, "
        f"{len(rates_map)} taux FX, {len(boc_rows)} taux BoC, "
        f"{len(cpi_series_rows)} séries IPC ({len(cpi_obs_rows)} obs.), "
        f"{len(cmhc_centres_rows)} centres SCHL ({len(cmhc_rent_rows)} loyers)",
        flush=True,
    )
    return db_path


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
            buf = []
    if buf:
        stmts.append("\n".join(buf) + ";\n")
    return stmts


def export_local_batches(
    db_path: Path = LOCAL_DB_PATH,
    batch_dir: Path = BATCH_DIR,
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
            "fx_currencies",
            ["id", "code", "name_en", "name_fr", "active_daily", "first_date", "last_date"],
            "02_currencies",
            "id",
        ),
        (
            "fx_rates",
            ["currency_id", "obs_date", "regime", "rate_micros"],
            "03_fx_rates",
            "currency_id, obs_date, regime",
        ),
        (
            "boc_rates",
            ["series_id", "obs_date", "rate_bps"],
            "04_boc_rates",
            "series_id, obs_date",
        ),
        (
            "cpi_series",
            [
                "id",
                "product_id",
                "frequency",
                "geo_code",
                "geo_en",
                "geo_fr",
                "product_code",
                "product_en",
                "product_fr",
                "coordinate",
                "vector_id",
                "uom",
                "first_period",
                "last_period",
            ],
            "05_cpi_series",
            "id",
        ),
        (
            "cpi_observations",
            ["series_id", "period", "value_milli"],
            "06_cpi_obs",
            "series_id, period",
        ),
        (
            "cmhc_centres",
            [
                "geo_member_id",
                "geo_key",
                "name_en",
                "name_fr",
                "search_norm",
                "province_code",
                "is_quebec",
                "uom",
                "first_year",
                "last_year",
            ],
            "07_cmhc_centres",
            "geo_member_id",
        ),
        (
            "cmhc_rents",
            ["geo_member_id", "structure_id", "unit_id", "year", "rent_dollars"],
            "08_cmhc_rents",
            "geo_member_id, structure_id, unit_id, year",
        ),
    ]:
        files, count = export_table_batches(
            conn,
            table,
            cols,
            batch_dir,
            prefix,
            order,
            insert_mode="INSERT OR REPLACE",
        )
        print(f"  Export {table} : {count} lignes -> {len(files)} lot(s)", flush=True)
        batch_files.extend(files)

    expected_counts = {
        "fx_currencies": conn.execute("SELECT COUNT(*) FROM fx_currencies").fetchone()[0],
        "fx_rates": conn.execute("SELECT COUNT(*) FROM fx_rates").fetchone()[0],
        "boc_rates": conn.execute("SELECT COUNT(*) FROM boc_rates").fetchone()[0],
        "cpi_series": conn.execute("SELECT COUNT(*) FROM cpi_series").fetchone()[0],
        "cpi_observations": conn.execute("SELECT COUNT(*) FROM cpi_observations").fetchone()[0],
        "cmhc_centres": conn.execute("SELECT COUNT(*) FROM cmhc_centres").fetchone()[0],
        "cmhc_rents": conn.execute("SELECT COUNT(*) FROM cmhc_rents").fetchone()[0],
    }
    conn.close()

    idx_stmts = _split_sql_statements((HERE / "indexes.sql").read_text(encoding="utf-8"))
    for i, stmt in enumerate(idx_stmts, 1):
        p = batch_dir / f"9000_idx_{i:02d}.sql"
        p.write_text(stmt, encoding="utf-8", newline="\n")
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
    execute_sql_files_remote(db_name, batch_files)

    rem_counts: dict[str, int] = {}
    for tbl in (
        "fx_currencies",
        "fx_rates",
        "boc_rates",
        "cpi_series",
        "cpi_observations",
        "cmhc_centres",
        "cmhc_rents",
    ):
        rem_counts[tbl] = int(d1_query_remote(db_id, f"SELECT COUNT(*) AS c FROM {tbl}")[0]["c"])

    mismatches = [
        f"{tbl}={rem_counts[tbl]}/{expected_counts[tbl]}"
        for tbl in expected_counts
        if rem_counts[tbl] != expected_counts[tbl]
    ]
    if mismatches:
        raise RuntimeError(f"Comptes distants incohérents : {', '.join(mismatches)}")

    verif = verify_remote_candidate(
        db_id,
        "SELECT COUNT(*) AS c FROM fx_rates WHERE regime = 2",
        min_rows=1,
    )
    print(
        f"[OK] {db_name} ({db_id}) validée : {rem_counts['fx_currencies']} devises, "
        f"{rem_counts['fx_rates']} FX, {rem_counts['boc_rates']} BoC, "
        f"{rem_counts['cpi_series']} séries IPC ({rem_counts['cpi_observations']} obs.), "
        f"{rem_counts['cmhc_centres']} centres SCHL ({rem_counts['cmhc_rents']} loyers), info={verif}",
        flush=True,
    )
    return db_id


def _resolve_economie_binding_from_wrangler(
    db_name_override: str | None,
    wrangler_path: Path = WRANGLER_JSONC,
) -> tuple[str, str | None]:
    cfg = json.loads(wrangler_path.read_text(encoding="utf-8"))
    for entry in cfg.get("d1_databases", []):
        if entry.get("binding") == "DB_ECONOMIE":
            entry_name = str(entry.get("database_name") or "outils-economie")
            db_id = str(entry.get("database_id") or "")
            valid_id = (
                db_id
                if db_id and db_id != "00000000-0000-0000-0000-000000000000"
                else None
            )
            if db_name_override:
                if db_name_override != entry_name:
                    return db_name_override, None
                return db_name_override, valid_id
            return entry_name, valid_id
    return (db_name_override or "outils-economie"), None


def incremental_fx_sync(
    lookback_days: int = 10,
    sample_only: bool = False,
    push_remote: bool = False,
    db_name: str | None = None,
    db_path: Path = LOCAL_DB_PATH,
    batch_dir: Path = BATCH_DIR,
    wrangler_path: Path = WRANGLER_JSONC,
) -> Path | None:
    """Génère un lot SQL idempotent incrémental (zéro commit Git) pour FX_RATES_DAILY et taux BoC."""
    batch_dir.mkdir(parents=True, exist_ok=True)
    target_name, configured_id = _resolve_economie_binding_from_wrangler(
        db_name, wrangler_path=wrangler_path
    )

    ccy_rows: list[dict] = []
    max_fx_int = 20170103
    max_boc_map: dict[str, int] = {sid: 20170103 for sid in BOC_SERIES}
    remote_db_id = configured_id

    if push_remote:
        if not remote_db_id:
            db_info = provision_or_get_d1(target_name, location="enam")
            remote_db_id = str(db_info["uuid"])
        ccy_rows = d1_query_remote(remote_db_id, "SELECT id, code, last_date FROM fx_currencies")
        fx_max_res = d1_query_remote(remote_db_id, "SELECT MAX(obs_date) AS m FROM fx_rates WHERE regime = 2")
        if fx_max_res and fx_max_res[0].get("m"):
            max_fx_int = int(fx_max_res[0]["m"])
        for row in d1_query_remote(
            remote_db_id,
            "SELECT series_id, MAX(obs_date) AS m FROM boc_rates GROUP BY series_id",
        ):
            if row.get("m"):
                max_boc_map[str(row["series_id"])] = int(row["m"])
    elif db_path.exists():
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        ccy_rows = [dict(r) for r in conn.execute("SELECT id, code, last_date FROM fx_currencies").fetchall()]
        fx_m = conn.execute("SELECT MAX(obs_date) AS m FROM fx_rates WHERE regime = 2").fetchone()
        if fx_m and fx_m["m"]:
            max_fx_int = int(fx_m["m"])
        for r in conn.execute("SELECT series_id, MAX(obs_date) AS m FROM boc_rates GROUP BY series_id"):
            if r["m"]:
                max_boc_map[str(r["series_id"])] = int(r["m"])
        conn.close()
    elif not sample_only:
        raise FileNotFoundError(
            f"Base locale {db_path} introuvable pour --incremental-fx hors ligne."
        )

    ccy_id_map = {str(r["code"]): int(r["id"]) for r in ccy_rows}
    next_ccy_id = (max(ccy_id_map.values()) + 1) if ccy_id_map else 1

    start_fx_dt = dt.date.fromisoformat(int_to_date_str(max_fx_int)) - dt.timedelta(days=lookback_days)
    start_fx_str = start_fx_dt.isoformat()

    if sample_only:
        if not ccy_id_map:
            ccy_id_map = {"USD": 1, "EUR": 2, "JPY": 3}
            next_ccy_id = 4
        fx_payload = {
            "seriesDetail": {
                "FXUSDCAD": {"label": "USD/CAD", "description": "Daily average exchange rate of the US dollar in Canadian dollars."},
                "FXEURCAD": {"label": "EUR/CAD", "description": "Daily average exchange rate of the euro in Canadian dollars."},
                "FXJPYCAD": {"label": "JPY/CAD", "description": "Daily average exchange rate of the Japanese yen in Canadian dollars."},
            },
            "observations": [
                {"d": "2026-11-24", "FXUSDCAD": {"v": "1.3991"}, "FXEURCAD": {"v": "1.4805"}, "FXJPYCAD": {"v": "0.009195"}},
            ],
        }
        boc_payloads = {
            "V39079": {"observations": [{"d": "2026-11-24", "V39079": {"v": "2.50"}}]},
            "V122530": {"observations": [{"d": "2026-11-01", "V122530": {"v": "2.75"}}]},
            "V80691311": {"observations": [{"d": "2026-11-25", "V80691311": {"v": "4.70"}}]},
        }
    else:
        fx_raw = _http_get_bytes(
            f"{BOC_VALET_BASE}/group/FX_RATES_DAILY/json?start_date={start_fx_str}",
            accept="application/json",
        )
        fx_payload = json.loads(fx_raw.decode("utf-8"))
        boc_payloads = {}
        for sid in BOC_SERIES:
            s_max = max_boc_map.get(sid, 20170103)
            s_start = (
                dt.date.fromisoformat(int_to_date_str(s_max)) - dt.timedelta(days=max(lookback_days, 35 if sid == "V122530" else lookback_days))
            ).isoformat()
            raw = _http_get_bytes(f"{BOC_VALET_BASE}/{sid}/json?start_date={s_start}", accept="application/json")
            boc_payloads[sid] = json.loads(raw.decode("utf-8"))

    temp_ccy: dict[str, dict] = {}
    temp_rates: dict[tuple[str, int, int], int] = {}
    _, fx_max_str = _parse_fx_daily(fx_payload, temp_ccy, temp_rates)
    boc_rows, boc_max_dates = _parse_boc_rates(boc_payloads)

    stmts: list[str] = []
    new_ccys: list[str] = []
    for code, info in sorted(temp_ccy.items()):
        if code not in ccy_id_map:
            ccy_id_map[code] = next_ccy_id
            next_ccy_id += 1
            new_ccys.append(
                f"INSERT INTO fx_currencies (id, code, name_en, name_fr, active_daily, first_date, last_date) "
                f"VALUES ({ccy_id_map[code]}, {sql_literal(code)}, {sql_literal(info['name_en'])}, "
                f"{sql_literal(info['name_fr'])}, 1, {info['first_date']}, {info['last_date']}) "
                f"ON CONFLICT(code) DO UPDATE SET active_daily=1, last_date=MAX(fx_currencies.last_date, excluded.last_date);"
            )
        elif info["last_date"] > 0:
            new_ccys.append(
                f"UPDATE fx_currencies SET active_daily=1, last_date=MAX(last_date, {info['last_date']}) "
                f"WHERE code={sql_literal(code)};"
            )
    stmts.extend(new_ccys)

    fx_tuples = [
        f"({ccy_id_map[ccy]},{d_int},{regime},{micros})"
        for (ccy, d_int, regime), micros in sorted(temp_rates.items())
    ]
    for i in range(0, len(fx_tuples), 500):
        chunk = fx_tuples[i : i + 500]
        stmts.append(
            "INSERT INTO fx_rates (currency_id, obs_date, regime, rate_micros) VALUES\n"
            + ",\n".join(chunk)
            + "\nON CONFLICT(currency_id, obs_date, regime) DO UPDATE SET rate_micros=excluded.rate_micros;"
        )

    boc_tuples = [
        f"({sql_literal(sid)},{d_int},{bps})" for sid, d_int, bps in sorted(boc_rows)
    ]
    for i in range(0, len(boc_tuples), 500):
        chunk = boc_tuples[i : i + 500]
        stmts.append(
            "INSERT INTO boc_rates (series_id, obs_date, rate_bps) VALUES\n"
            + ",\n".join(chunk)
            + "\nON CONFLICT(series_id, obs_date) DO UPDATE SET rate_bps=excluded.rate_bps;"
        )

    if fx_max_str:
        stmts.append(
            f"UPDATE meta_sources SET version_date={sql_literal(fx_max_str)} WHERE source_key='boc_fx_daily';"
        )
    boc_latest = max((v for v in boc_max_dates.values() if v), default="")
    if boc_latest:
        stmts.append(
            f"UPDATE meta_sources SET version_date={sql_literal(boc_latest)} WHERE source_key='boc_interest_rates';"
        )

    tag = dt.date.today().strftime("%Y%m%d")
    out_file = batch_dir / f"incr_fx_{tag}.sql"
    if not stmts:
        print("[INCR] Aucune nouvelle observation à pousser", flush=True)
        return None
    out_file.write_text("\n".join(stmts) + "\n", encoding="utf-8", newline="\n")
    print(
        f"[INCR] {out_file} généré ({len(fx_tuples)} taux FX, {len(boc_tuples)} taux BoC)",
        flush=True,
    )

    if push_remote:
        execute_sql_files_remote(target_name, [out_file])
        if remote_db_id:
            res = d1_query_remote(remote_db_id, "SELECT MAX(obs_date) AS max_fx FROM fx_rates WHERE regime = 2")
            print(f"[INCR] Vérification distante MAX(obs_date) regime=2 : {res}", flush=True)

    return out_file


def sync_statcan_data(
    cpi_months: int = 24,
    cpi_years: int = 5,
    sample_only: bool = False,
    push_remote: bool = False,
    db_name: str | None = None,
    db_path: Path = LOCAL_DB_PATH,
    batch_dir: Path = BATCH_DIR,
    wrangler_path: Path = WRANGLER_JSONC,
) -> Path | None:
    """Génère un lot SQL idempotent (zéro commit Git) pour l'IPC StatCan et les loyers SCHL."""
    batch_dir.mkdir(parents=True, exist_ok=True)
    target_name, configured_id = _resolve_economie_binding_from_wrangler(
        db_name, wrangler_path=wrangler_path
    )

    existing_series_rows: list[dict] = []
    remote_db_id = configured_id
    if push_remote:
        if not remote_db_id:
            db_info = provision_or_get_d1(target_name, location="enam")
            remote_db_id = str(db_info["uuid"])
        existing_series_rows = d1_query_remote(
            remote_db_id,
            "SELECT id, product_id, coordinate, uom FROM cpi_series",
        )
    elif db_path.exists():
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        existing_series_rows = [
            dict(r)
            for r in conn.execute("SELECT id, product_id, coordinate, uom FROM cpi_series").fetchall()
        ]
        conn.close()
    elif not sample_only:
        raise FileNotFoundError(
            f"Base locale {db_path} introuvable pour --sync-statcan hors ligne."
        )

    existing_id_map: dict[tuple[int, str, str], int] = {
        (int(r["product_id"]), str(r["coordinate"]), str(r["uom"])): int(r["id"])
        for r in existing_series_rows
    }
    next_series_id = (max(existing_id_map.values()) + 1) if existing_id_map else 1

    if sample_only:
        codesets, cube_metas, series_infos, vector_datas, cmhc_meta, cmhc_zip_bytes = (
            _sample_statcan_payloads()
        )
        require_all = True
    else:
        codesets, cube_metas, series_infos, vector_datas = _fetch_cpi_wds_payloads(
            months_n=cpi_months,
            years_n=cpi_years,
            work_dir=None,
            force_download=True,
        )
        cmhc_meta, cmhc_zip_bytes = _fetch_cmhc_payloads(work_dir=None, force_download=True)
        require_all = False

    cpi_series_rows, raw_cpi_obs, cpi_meta = _parse_cpi_wds(
        codesets,
        cube_metas,
        series_infos,
        vector_datas,
        require_all_mandatory=require_all,
    )
    cmhc_centres_rows, cmhc_rent_rows, cmhc_release_date = _parse_statcan_cmhc(
        cmhc_zip_bytes, cmhc_meta
    )

    # Réconcilier les IDs avec ceux déjà en base D1/locale
    temp_to_final_id: dict[int, int] = {}
    for s in cpi_series_rows:
        key = (int(s["product_id"]), str(s["coordinate"]), str(s["uom"]))
        if key in existing_id_map:
            final_id = existing_id_map[key]
        else:
            final_id = next_series_id
            next_series_id += 1
            existing_id_map[key] = final_id
        temp_to_final_id[int(s["id"])] = final_id
        s["id"] = final_id

    cpi_obs_rows = [
        (temp_to_final_id[sid], period_int, val_m) for sid, period_int, val_m in raw_cpi_obs
    ]

    stmts: list[str] = []
    if cpi_series_rows:
        series_tuples = [
            f"({s['id']},{s['product_id']},{sql_literal(s['frequency'])},{sql_literal(s['geo_code'])},"
            f"{sql_literal(s['geo_en'])},{sql_literal(s['geo_fr'])},{sql_literal(s['product_code'])},"
            f"{sql_literal(s['product_en'])},{sql_literal(s['product_fr'])},{sql_literal(s['coordinate'])},"
            f"{s['vector_id']},{sql_literal(s['uom'])},{s['first_period']},{s['last_period']})"
            for s in cpi_series_rows
        ]
        for i in range(0, len(series_tuples), 100):
            chunk = series_tuples[i : i + 100]
            stmts.append(
                "INSERT INTO cpi_series "
                "(id, product_id, frequency, geo_code, geo_en, geo_fr, product_code, product_en, "
                "product_fr, coordinate, vector_id, uom, first_period, last_period) VALUES\n"
                + ",\n".join(chunk)
                + "\nON CONFLICT(frequency, geo_code, product_code, uom) DO UPDATE SET "
                "first_period=MIN(cpi_series.first_period, excluded.first_period), "
                "last_period=MAX(cpi_series.last_period, excluded.last_period), "
                "geo_en=excluded.geo_en, geo_fr=excluded.geo_fr, "
                "product_en=excluded.product_en, product_fr=excluded.product_fr;"
            )

    obs_tuples = [f"({sid},{p_int},{val_m})" for sid, p_int, val_m in cpi_obs_rows]
    for i in range(0, len(obs_tuples), 500):
        chunk = obs_tuples[i : i + 500]
        stmts.append(
            "INSERT INTO cpi_observations (series_id, period, value_milli) VALUES\n"
            + ",\n".join(chunk)
            + "\nON CONFLICT(series_id, period) DO UPDATE SET value_milli=excluded.value_milli;"
        )

    if cmhc_centres_rows:
        centre_tuples = [
            f"({c['geo_member_id']},{sql_literal(c['geo_key'])},{sql_literal(c['name_en'])},"
            f"{sql_literal(c['name_fr'])},{sql_literal(c['search_norm'])},{sql_literal(c['province_code'])},"
            f"{c['is_quebec']},{sql_literal(c['uom'])},{c['first_year']},{c['last_year']})"
            for c in cmhc_centres_rows
        ]
        for i in range(0, len(centre_tuples), 150):
            chunk = centre_tuples[i : i + 150]
            stmts.append(
                "INSERT INTO cmhc_centres "
                "(geo_member_id, geo_key, name_en, name_fr, search_norm, province_code, "
                "is_quebec, uom, first_year, last_year) VALUES\n"
                + ",\n".join(chunk)
                + "\nON CONFLICT(geo_member_id) DO UPDATE SET "
                "geo_key=excluded.geo_key, name_en=excluded.name_en, name_fr=excluded.name_fr, "
                "search_norm=excluded.search_norm, province_code=excluded.province_code, "
                "is_quebec=excluded.is_quebec, "
                "first_year=MIN(cmhc_centres.first_year, excluded.first_year), "
                "last_year=MAX(cmhc_centres.last_year, excluded.last_year);"
            )

    rent_tuples = [
        f"({g_id},{s_id},{u_id},{yr},{val})"
        for g_id, s_id, u_id, yr, val in cmhc_rent_rows
    ]
    for i in range(0, len(rent_tuples), 500):
        chunk = rent_tuples[i : i + 500]
        stmts.append(
            "INSERT INTO cmhc_rents (geo_member_id, structure_id, unit_id, year, rent_dollars) VALUES\n"
            + ",\n".join(chunk)
            + "\nON CONFLICT(geo_member_id, structure_id, unit_id, year) DO UPDATE SET "
            "rent_dollars=excluded.rent_dollars;"
        )

    if cpi_obs_rows:
        if cpi_meta["M"]["version_date"]:
            stmts.append(
                f"INSERT INTO meta_sources (source_key, source_label, licence, version_date, row_count) VALUES "
                f"('statcan_cpi_monthly', 'Statistique Canada — Tableau 18-10-0004-01 (IPC mensuel)', 'OGL-Canada', "
                f"{sql_literal(cpi_meta['M']['version_date'])}, {cpi_meta['M']['row_count']}) "
                f"ON CONFLICT(source_key) DO UPDATE SET version_date=excluded.version_date, "
                f"row_count=MAX(meta_sources.row_count, excluded.row_count);"
            )
        if cpi_meta["A"]["version_date"]:
            stmts.append(
                f"INSERT INTO meta_sources (source_key, source_label, licence, version_date, row_count) VALUES "
                f"('statcan_cpi_annual', 'Statistique Canada — Tableau 18-10-0005-01 (IPC annuel)', 'OGL-Canada', "
                f"{sql_literal(cpi_meta['A']['version_date'])}, {cpi_meta['A']['row_count']}) "
                f"ON CONFLICT(source_key) DO UPDATE SET version_date=excluded.version_date, "
                f"row_count=MAX(meta_sources.row_count, excluded.row_count);"
            )
    if cmhc_rent_rows:
        stmts.append(
            f"INSERT INTO meta_sources (source_key, source_label, licence, version_date, row_count) VALUES "
            f"('statcan_cmhc_rents', 'Statistique Canada / SCHL — Tableau 34-10-0133-01 (loyers moyens du marché)', 'OGL-Canada', "
            f"{sql_literal(cmhc_release_date)}, {len(cmhc_rent_rows)}) "
            f"ON CONFLICT(source_key) DO UPDATE SET version_date=excluded.version_date, row_count=excluded.row_count;"
        )

    if not stmts:
        print("[STATCAN] Aucune nouvelle observation StatCan à pousser", flush=True)
        return None

    tag = dt.date.today().strftime("%Y%m%d")
    out_file = batch_dir / f"incr_statcan_{tag}.sql"
    out_file.write_text("\n".join(stmts) + "\n", encoding="utf-8", newline="\n")
    print(
        f"[STATCAN] {out_file} généré ({len(cpi_obs_rows)} obs. IPC, {len(cmhc_rent_rows)} loyers SCHL)",
        flush=True,
    )

    if push_remote:
        execute_sql_files_remote(target_name, [out_file])
        if remote_db_id:
            res_cpi = d1_query_remote(
                remote_db_id, "SELECT MAX(period) AS max_cpi FROM cpi_observations"
            )
            res_cmhc = d1_query_remote(
                remote_db_id, "SELECT MAX(year) AS max_cmhc_year FROM cmhc_rents"
            )
            print(
                f"[STATCAN] Vérification distante IPC={res_cpi}, SCHL={res_cmhc}",
                flush=True,
            )

    return out_file


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ingestion DB_ECONOMIE (taux BoC, change, IPC StatCan et loyers SCHL)"
    )
    parser.add_argument("--build-local", action="store_true")
    parser.add_argument("--sample", action="store_true")
    parser.add_argument("--export-batches", action="store_true")
    parser.add_argument("--incremental-fx", action="store_true")
    parser.add_argument("--sync-statcan", action="store_true")
    parser.add_argument("--lookback-days", type=int, default=10)
    parser.add_argument("--cpi-months", type=int, default=24)
    parser.add_argument("--cpi-years", type=int, default=5)
    parser.add_argument("--push-remote", action="store_true")
    parser.add_argument("--db-name", default=None)
    parser.add_argument("--blue-green", action="store_true")
    parser.add_argument("--swap", action="store_true")
    parser.add_argument("--location", default="enam")
    parser.add_argument("--work-dir", type=Path, default=WORK_DIR)
    parser.add_argument("--batch-dir", type=Path, default=BATCH_DIR)
    parser.add_argument("--force-download", action="store_true")
    args = parser.parse_args()

    db_path = args.work_dir / "outils_economie.db"
    if args.build_local:
        build_local_sqlite(
            sample_only=args.sample,
            work_dir=args.work_dir,
            force_download=args.force_download,
        )
    if (
        args.export_batches
        and not args.push_remote
        and not args.incremental_fx
        and not args.sync_statcan
    ):
        export_local_batches(db_path=db_path, batch_dir=args.batch_dir)
    if args.incremental_fx:
        incremental_fx_sync(
            lookback_days=args.lookback_days,
            sample_only=args.sample,
            push_remote=args.push_remote,
            db_name=args.db_name,
            db_path=db_path,
            batch_dir=args.batch_dir,
        )
    if args.sync_statcan:
        sync_statcan_data(
            cpi_months=args.cpi_months,
            cpi_years=args.cpi_years,
            sample_only=args.sample,
            push_remote=args.push_remote,
            db_name=args.db_name,
            db_path=db_path,
            batch_dir=args.batch_dir,
        )
    if not args.incremental_fx and not args.sync_statcan and args.push_remote:
        target_name = (
            dated_db_name("DB_ECONOMIE")
            if args.blue_green
            else (args.db_name or "outils-economie")
        )
        db_id = push_to_remote_d1(
            target_name,
            location=args.location,
            db_path=db_path,
            batch_dir=args.batch_dir,
        )
        if args.swap:
            swap_wrangler_binding("DB_ECONOMIE", target_name, db_id)


if __name__ == "__main__":
    main()
