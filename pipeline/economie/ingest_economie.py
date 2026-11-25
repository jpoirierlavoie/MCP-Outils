"""Pipeline d'ingestion et de chargement D1 — Domaine E : Économie (taux BoC & change).

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

Usage :
  python -m pipeline.economie.ingest_economie --build-local --sample --export-batches
  python -m pipeline.economie.ingest_economie --build-local --export-batches
  python -m pipeline.economie.ingest_economie --incremental-fx --sample --export-batches
  python -m pipeline.economie.ingest_economie --incremental-fx --push-remote
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import re
import sqlite3
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


def _http_get_bytes(url: str, accept: str = "application/json") -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "mcp-outils-pipeline/2.2",
            "Accept": accept,
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


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

    currencies: dict[str, dict] = {}
    rates_map: dict[tuple[str, int, int], int] = {}

    statcan_count, statcan_max = _parse_statcan_fx(statcan_zip_bytes, currencies, rates_map)
    legacy_count, legacy_max = _parse_legacy_noon(legacy_noon, currencies, rates_map)
    daily_count, daily_max = _parse_fx_daily(fx_daily, currencies, rates_map)
    boc_rows, boc_max_dates = _parse_boc_rates(boc_payloads)

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
        f"{len(rates_map)} taux FX, {len(boc_rows)} taux BoC",
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

    rem_ccy = d1_query_remote(db_id, "SELECT COUNT(*) AS c FROM fx_currencies")[0]["c"]
    rem_fx = d1_query_remote(db_id, "SELECT COUNT(*) AS c FROM fx_rates")[0]["c"]
    rem_boc = d1_query_remote(db_id, "SELECT COUNT(*) AS c FROM boc_rates")[0]["c"]
    if (
        rem_ccy != expected_counts["fx_currencies"]
        or rem_fx != expected_counts["fx_rates"]
        or rem_boc != expected_counts["boc_rates"]
    ):
        raise RuntimeError(
            "Comptes distants incohérents : "
            f"fx_currencies={rem_ccy}/{expected_counts['fx_currencies']}, "
            f"fx_rates={rem_fx}/{expected_counts['fx_rates']}, "
            f"boc_rates={rem_boc}/{expected_counts['boc_rates']}"
        )

    verif = verify_remote_candidate(
        db_id,
        "SELECT COUNT(*) AS c FROM fx_rates WHERE regime = 2",
        min_rows=1,
    )
    print(
        f"[OK] {db_name} ({db_id}) validée : {rem_ccy} devises, {rem_fx} FX, {rem_boc} BoC, info={verif}",
        flush=True,
    )
    return db_id


def _resolve_economie_binding_from_wrangler(db_name_override: str | None) -> tuple[str, str | None]:
    cfg = json.loads(WRANGLER_JSONC.read_text(encoding="utf-8"))
    for entry in cfg.get("d1_databases", []):
        if entry.get("binding") == "DB_ECONOMIE":
            name = db_name_override or str(entry.get("database_name") or "outils-economie")
            db_id = str(entry.get("database_id") or "")
            return name, (db_id if db_id and db_id != "00000000-0000-0000-0000-000000000000" else None)
    return (db_name_override or "outils-economie"), None


def incremental_fx_sync(
    lookback_days: int = 10,
    sample_only: bool = False,
    push_remote: bool = False,
    db_name: str | None = None,
    db_path: Path = LOCAL_DB_PATH,
    batch_dir: Path = BATCH_DIR,
) -> Path:
    """Génère un lot SQL idempotent incrémental (zéro commit Git) pour FX_RATES_DAILY et taux BoC."""
    batch_dir.mkdir(parents=True, exist_ok=True)
    target_name, configured_id = _resolve_economie_binding_from_wrangler(db_name)

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


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingestion DB_ECONOMIE (taux BoC et devises)")
    parser.add_argument("--build-local", action="store_true")
    parser.add_argument("--sample", action="store_true")
    parser.add_argument("--export-batches", action="store_true")
    parser.add_argument("--incremental-fx", action="store_true")
    parser.add_argument("--lookback-days", type=int, default=10)
    parser.add_argument("--push-remote", action="store_true")
    parser.add_argument("--db-name", default="outils-economie")
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
    if args.export_batches and not args.push_remote and not args.incremental_fx:
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
    elif args.push_remote:
        target_name = dated_db_name("DB_ECONOMIE") if args.blue_green else args.db_name
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
