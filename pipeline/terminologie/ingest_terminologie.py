from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import json
import os
import re
import sqlite3
import urllib.request
import zipfile
from pathlib import Path

from pipeline.common.blue_green import (
    dated_db_name,
    swap_wrangler_binding,
    verify_remote_candidate,
)
from pipeline.common.d1_batch import (
    ACCOUNT_ID,
    REPO_ROOT,
    build_fts_slice_statements,
    d1_query_remote,
    execute_sql_file_remote,
    execute_sql_files_remote,
    export_table_batches,
    normalize_search_text,
    provision_or_get_d1,
)

LEGISLATION_DB_ID = "82779d59-480f-4847-9716-6f4d7c62af5b"
TERMIUM_ZIP_URL = (
    "https://donnees-data.tpsgc-pwgsc.gc.ca/bt1/tp-tp/domaine-droitJustice-Subject-LawJustice.zip"
)
OQLF_CKAN_PACKAGE_URL = (
    "https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=donnees-linguistiques"
)

HERE = Path(__file__).resolve().parent
WORK_DIR = REPO_ROOT / "pipeline" / "work" / "terminologie"
BATCH_DIR = REPO_ROOT / "pipeline" / "batches" / "terminologie"
LOCAL_DB_PATH = WORK_DIR / "outils_terminologie.db"
GLOSSAIRE_PATH = REPO_ROOT / "src" / "data" / "glossaire_bijuridique_qc.json"

POS_SUFFIX_RE = re.compile(r"\s*\((?:n\.|adj\.|v\.|loc\.|adv\.|abrév\.)[^)]*\)\s*$", re.I)

BIJURAL_COMPANIONS_EN: dict[str, str] = {
    "mortgage": "hypothec",
    "real property": "immovable",
    "personal property": "movable",
    "security interest": "hypothec",
    "tort": "extracontractual",
    "easement": "servitude",
    "joint and several": "solidar",
    "estoppel": "fin de non-recevoir",
}

BIJURAL_COMPANIONS_FR: dict[str, str] = {
    "mortgage": "hypothèque",
    "bien réel": "immeuble",
    "biens réels": "immeubles",
    "bien personnel": "meuble",
    "biens personnels": "meubles",
    "estoppel": "fin de non-recevoir",
}

EXTRA_SCAN_RULES: list[dict] = [
    {
        "code_regle": "fr-art-1240-code-civil",
        "lang": "fr",
        "pattern_term": "article 1240",
        "case_sensitive": 0,
        "risk_category": "francisme_france",
        "allowed_in_bijural_if": None,
        "reason_fr": "Référence probable à l'art. 1240 du Code civil français (responsabilité délictuelle) ; au Québec, la responsabilité extracontractuelle relève de l'art. 1457 C.c.Q. (l'art. 1240 C.c.Q. traite de la constitution du patrimoine familial ou de la réserve).",
        "suggested_replacement": "article 1457 C.c.Q.",
        "legal_basis": "Art. 1457 C.c.Q.",
    },
    {
        "code_regle": "fr-art-1382-code-civil",
        "lang": "fr",
        "pattern_term": "article 1382",
        "case_sensitive": 0,
        "risk_category": "francisme_france",
        "allowed_in_bijural_if": None,
        "reason_fr": "Ancien article 1382 du Code civil français (responsabilité délictuelle) souvent produit par contamination ; au C.c.Q., la faute civile relève de l'art. 1457 C.c.Q.",
        "suggested_replacement": "article 1457 C.c.Q.",
        "legal_basis": "Art. 1457 C.c.Q.",
    },
    {
        "code_regle": "fr-art-1134-code-civil",
        "lang": "fr",
        "pattern_term": "article 1134",
        "case_sensitive": 0,
        "risk_category": "francisme_france",
        "allowed_in_bijural_if": None,
        "reason_fr": "Ancien article 1134 du Code civil français (force obligatoire du contrat) ; au Québec, la force obligatoire du contrat découle de l'art. 1434 C.c.Q.",
        "suggested_replacement": "article 1434 C.c.Q.",
        "legal_basis": "Art. 1434 C.c.Q.",
    },
    {
        "code_regle": "fr-vu-l-article",
        "lang": "fr",
        "pattern_term": "Vu l'article",
        "case_sensitive": 0,
        "risk_category": "francisme_france",
        "allowed_in_bijural_if": None,
        "reason_fr": "Formule de visa française ; au Québec, un acte de procédure énonce les faits sans plaider les visas législatifs (art. 99 C.p.c.).",
        "suggested_replacement": "Énoncer directement les faits générateurs du droit (art. 99 C.p.c.)",
        "legal_basis": "Art. 99 C.p.c.",
    },
    {
        "code_regle": "fr-consideration-1-dollar",
        "lang": "fr",
        "pattern_term": "contrepartie de 1 $",
        "case_sensitive": 0,
        "risk_category": "anglicisme_ou_common_law",
        "allowed_in_bijural_if": None,
        "reason_fr": "Calque de la « nominal consideration » de common law ; en droit civil québécois, le contrat se forme par le seul échange de consentements avec cause et objet (art. 1385 et 1410 C.c.Q.).",
        "suggested_replacement": "Omettre la clause de contrepartie symbolique (art. 1385 C.c.Q.)",
        "legal_basis": "Art. 1385 et 1410 C.c.Q.",
    },
    {
        "code_regle": "en-consideration-1-dollar",
        "lang": "en",
        "pattern_term": "sum of $1.00",
        "case_sensitive": 0,
        "risk_category": "anglicisme_ou_common_law",
        "allowed_in_bijural_if": None,
        "reason_fr": "Formule de « nominal consideration » propre à la common law, étrangère au droit des obligations du C.c.Q. (art. 1385 et 1410 C.c.Q.).",
        "suggested_replacement": "Retirer la clause de peppercorn consideration dans un contrat régi par le droit québécois",
        "legal_basis": "Art. 1385 et 1410 C.c.Q.",
    },
    {
        "code_regle": "en-tort",
        "lang": "en",
        "pattern_term": "tort",
        "case_sensitive": 0,
        "risk_category": "anglicisme_ou_common_law",
        "allowed_in_bijural_if": "extracontractual",
        "reason_fr": "Catégorie propre à la common law ; en droit civil québécois, employer « extracontractual liability » ou « civil fault » (art. 1457 C.c.Q.).",
        "suggested_replacement": "extracontractual liability / fault",
        "legal_basis": "Art. 1457 C.c.Q.",
    },
    {
        "code_regle": "en-duty-of-care",
        "lang": "en",
        "pattern_term": "duty of care",
        "case_sensitive": 0,
        "risk_category": "anglicisme_ou_common_law",
        "allowed_in_bijural_if": None,
        "reason_fr": "Élément du « tort of negligence » de common law ; l'art. 1457 C.c.Q. repose sur le devoir général de respecter les règles de conduite (« duty to abide by the rules of conduct »).",
        "suggested_replacement": "duty to abide by the rules of conduct / fault (art. 1457 C.C.Q.)",
        "legal_basis": "Art. 1457 C.c.Q.",
    },
    {
        "code_regle": "en-joint-and-several",
        "lang": "en",
        "pattern_term": "joint and several",
        "case_sensitive": 0,
        "risk_category": "anglicisme_ou_common_law",
        "allowed_in_bijural_if": "solidar",
        "reason_fr": "Concept de common law ; dans la version anglaise officielle du C.c.Q., la solidarité se dit « solidary obligation / solidarily » (art. 1523 C.c.Q.).",
        "suggested_replacement": "solidary / solidarily",
        "legal_basis": "Art. 1523 C.c.Q.",
    },
    {
        "code_regle": "en-estoppel",
        "lang": "en",
        "pattern_term": "estoppel",
        "case_sensitive": 0,
        "risk_category": "anglicisme_ou_common_law",
        "allowed_in_bijural_if": "fin de non-recevoir",
        "reason_fr": "Doctrine d'equity de common law étrangère au droit civil québécois ; employer plutôt la fin de non-recevoir fondée sur la bonne foi et l'interdiction de l'abus de droit (art. 6, 7 et 1375 C.c.Q.).",
        "suggested_replacement": "fin de non-recevoir (art. 6, 7 et 1375 C.c.Q.)",
        "legal_basis": "Art. 6, 7 et 1375 C.c.Q.",
        "override": True,
    },
    {
        "code_regle": "fr-estoppel",
        "lang": "fr",
        "pattern_term": "estoppel",
        "case_sensitive": 0,
        "risk_category": "anglicisme_ou_common_law",
        "allowed_in_bijural_if": "fin de non-recevoir",
        "reason_fr": "Doctrine d'equity de common law étrangère au droit civil québécois ; employer plutôt la fin de non-recevoir fondée sur la bonne foi et l'interdiction de l'abus de droit (art. 6, 7 et 1375 C.c.Q.).",
        "suggested_replacement": "fin de non-recevoir (art. 6, 7 et 1375 C.c.Q.)",
        "legal_basis": "Art. 6, 7 et 1375 C.c.Q.",
        "override": True,
    },
    {
        "code_regle": "en-hold-harmless",
        "lang": "en",
        "pattern_term": "hold harmless",
        "case_sensitive": 0,
        "risk_category": "anglicisme_ou_common_law",
        "allowed_in_bijural_if": None,
        "reason_fr": "Formule de common law ; en droit civil québécois, employer « indemnify and take up the defence » (« garantir et prendre fait et cause »).",
        "suggested_replacement": "indemnify and take up the defence (garantir et prendre fait et cause)",
        "legal_basis": "Art. 1434 C.c.Q. ; art. 184 C.p.c.",
    },
    {
        "code_regle": "en-liquidated-damages",
        "lang": "en",
        "pattern_term": "liquidated damages",
        "case_sensitive": 0,
        "risk_category": "anglicisme_ou_common_law",
        "allowed_in_bijural_if": "penal clause",
        "reason_fr": "Distinction de common law entre « liquidated damages » et « penalty » inapplicable sous le C.c.Q., qui reconnaît la « penal clause » (« clause pénale »).",
        "suggested_replacement": "penal clause (clause pénale)",
        "legal_basis": "Art. 1622–1623 C.c.Q.",
    },
    {
        "code_regle": "fr-specific-performance",
        "lang": "fr",
        "pattern_term": "specific performance",
        "case_sensitive": 0,
        "risk_category": "anglicisme_ou_common_law",
        "allowed_in_bijural_if": None,
        "reason_fr": "Emprunt à l'anglais dans un texte français ; en droit civil québécois, employer « exécution en nature » (art. 1590 et 1601 C.c.Q.).",
        "suggested_replacement": "exécution en nature",
        "legal_basis": "Art. 1590 et 1601 C.c.Q.",
    },
    {
        "code_regle": "fr-punitive-damages",
        "lang": "fr",
        "pattern_term": "punitive damages",
        "case_sensitive": 0,
        "risk_category": "anglicisme_ou_common_law",
        "allowed_in_bijural_if": None,
        "reason_fr": "Emprunt à l'anglais dans un texte français ; employer « dommages-intérêts punitifs » (art. 1621 C.c.Q.).",
        "suggested_replacement": "dommages-intérêts punitifs",
        "legal_basis": "Art. 1621 C.c.Q.",
    },
    {
        "code_regle": "fr-trustee",
        "lang": "fr",
        "pattern_term": "trustee",
        "case_sensitive": 0,
        "risk_category": "anglicisme_ou_common_law",
        "allowed_in_bijural_if": None,
        "reason_fr": "Emprunt à l'anglais dans un texte français ; selon le contexte, employer « fiduciaire » (art. 1260 C.c.Q.) ou « syndic » (L.F.I.).",
        "suggested_replacement": "fiduciaire / syndic",
        "legal_basis": "Art. 1260 C.c.Q. ; art. 2 L.F.I.",
    },
]


def _download_if_missing(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists() or dest.stat().st_size == 0:
        print(f"  Téléchargement : {url} -> {dest.name}")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=180) as resp, open(dest, "wb") as f:
            while True:
                chunk = resp.read(1024 * 256)
                if not chunk:
                    break
                f.write(chunk)
    return dest


def _legislation_select_readonly(sql: str, params: list[object] | None = None) -> list[dict]:
    upper = sql.strip().upper()
    if not (upper.startswith("SELECT") or upper.startswith("PRAGMA")):
        raise PermissionError(f"Requête non-SELECT interdite sur legislation : {sql[:80]}")
    return d1_query_remote(LEGISLATION_DB_ID, sql, params)


def _clean_oqlf_term(raw: str) -> str:
    cleaned = POS_SUFFIX_RE.sub("", raw.strip())
    return " ".join(cleaned.split())


def _extract_legal_oqlf_domain(domaines_str: str) -> str | None:
    legal_branches: list[str] = []
    for branch in domaines_str.split(";"):
        cleaned = " ".join(branch.split())
        low = cleaned.lower()
        if low == "droit" or low.startswith("droit >"):
            if cleaned not in legal_branches:
                legal_branches.append(cleaned)
    return "; ".join(legal_branches) if legal_branches else None


def _detect_termium_system(row: dict[str, str]) -> str:
    blob = " ".join(
        [
            row.get("SUBJECT_EN", ""),
            row.get("DOMAINE_FR", ""),
            row.get("TERM_EN_PARAMETER", ""),
            row.get("TERME_FR_PARAMETRE", ""),
            row.get("JUSTIFICATION_1_FR", ""),
            row.get("TEXTUAL_SUPPORT_1_EN", ""),
        ]
    ).lower()
    has_civil = "droit civil" in blob or "civil law" in blob or "code civil du québec" in blob
    has_cl = "common law" in blob or "equity" in blob
    if "bijurid" in blob or (has_civil and has_cl):
        return "bijuridique_federal"
    if has_civil:
        return "droit_civil_qc"
    if has_cl or row.get("DOMAINE_FR", "").strip().upper() == "PAJLO":
        return "common_law"
    return "general"


def build_local_sqlite(sample_only: bool = False) -> dict[str, int]:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    if LOCAL_DB_PATH.exists():
        LOCAL_DB_PATH.unlink()

    conn = sqlite3.connect(LOCAL_DB_PATH)
    conn.execute("PRAGMA synchronous = OFF;")
    conn.execute("PRAGMA journal_mode = MEMORY;")
    conn.executescript((HERE / "schema.sql").read_text(encoding="utf-8"))

    today_iso = dt.date.today().isoformat()
    fiche_id = 0
    seen_fiches: set[tuple[int, str, str]] = set()

    def add_fiche(
        *,
        slug: str | None,
        rang_source: int,
        source_nom: str,
        licence_source: str,
        terme_fr: str,
        terme_en: str,
        syn_fr: list[str],
        syn_en: list[str],
        deconseilles: list[dict[str, str]],
        systeme_juridique: str,
        domaine: str,
        note_ou_definition: str,
        base_legale: str | None,
        url_fiche: str | None,
        date_verif: str,
    ) -> bool:
        nonlocal fiche_id
        t_fr = " ".join(terme_fr.split())
        t_en = " ".join(terme_en.split())
        if not t_fr or not t_en:
            return False
        fr_norm = normalize_search_text(t_fr)
        en_norm = normalize_search_text(t_en)
        if not fr_norm or not en_norm:
            return False
        key = (rang_source, fr_norm, en_norm)
        if key in seen_fiches:
            return False
        seen_fiches.add(key)

        forbidden_check = f"{source_nom} {url_fiche or ''} {note_ou_definition}".lower()
        for banned in ("crépeau", "crepeau", "juriterm", "juridictionnaire"):
            if banned in forbidden_check:
                return False

        fiche_id += 1
        search_bag = " | ".join(
            [
                t_fr,
                t_en,
                *syn_fr,
                *syn_en,
                *(d.get("terme", "") for d in deconseilles),
                base_legale or "",
            ]
        )
        conn.execute(
            """
            INSERT INTO fiches_terminologiques (
              id, slug, rang_source, source_nom, licence_source,
              terme_fr, terme_en, terme_fr_norm, terme_en_norm,
              synonymes_fr_json, synonymes_en_json, termes_deconseilles_json,
              termes_recherche, systeme_juridique, domaine,
              note_ou_definition, base_legale, url_fiche, date_verification
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                fiche_id,
                slug,
                rang_source,
                source_nom,
                licence_source,
                t_fr,
                t_en,
                fr_norm,
                en_norm,
                json.dumps(syn_fr, ensure_ascii=False),
                json.dumps(syn_en, ensure_ascii=False),
                json.dumps(deconseilles, ensure_ascii=False),
                search_bag,
                systeme_juridique,
                domaine,
                note_ou_definition,
                base_legale,
                url_fiche,
                date_verif,
            ),
        )
        return True

    glossaire_raw = json.loads(GLOSSAIRE_PATH.read_text(encoding="utf-8"))
    r1_count = 0
    regles_seen: set[tuple[str, str]] = set()
    regle_id = 0

    def add_regle(
        code_regle: str,
        lang: str,
        pattern_term: str,
        case_sensitive: int,
        risk_category: str,
        allowed_in_bijural_if: str | None,
        reason_fr: str,
        suggested_replacement: str,
        legal_basis: str,
        override: bool = False,
    ) -> None:
        nonlocal regle_id
        p_norm = normalize_search_text(pattern_term)
        if not p_norm:
            return
        if (lang, p_norm) in regles_seen:
            if not override:
                return
            conn.execute(
                """
                UPDATE regles_contamination
                   SET code_regle = ?, pattern_term = ?, case_sensitive = ?, risk_category = ?,
                       allowed_in_bijural_if = ?, reason_fr = ?, suggested_replacement = ?, legal_basis = ?
                 WHERE lang = ? AND pattern_norm = ?
                """,
                (
                    code_regle,
                    pattern_term,
                    case_sensitive,
                    risk_category,
                    allowed_in_bijural_if,
                    reason_fr,
                    suggested_replacement,
                    legal_basis,
                    lang,
                    p_norm,
                ),
            )
            return
        regles_seen.add((lang, p_norm))
        regle_id += 1
        conn.execute(
            """
            INSERT INTO regles_contamination (
              id, code_regle, lang, pattern_term, pattern_norm, case_sensitive,
              risk_category, allowed_in_bijural_if, reason_fr, suggested_replacement, legal_basis
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                regle_id,
                code_regle,
                lang,
                pattern_term,
                p_norm,
                case_sensitive,
                risk_category,
                allowed_in_bijural_if,
                reason_fr,
                suggested_replacement,
                legal_basis,
            ),
        )

    for entry in glossaire_raw["entries"]:
        dec_combined: list[dict[str, str]] = []
        for d_fr in entry.get("termes_deconseilles_fr", []):
            dec_combined.append({**d_fr, "langue": "fr"})
            orig = d_fr.get("origine", "")
            cat = (
                "francisme_france"
                if "francais" in orig
                else "archaisme_qc"
                if "archa" in orig
                else "anglicisme_ou_common_law"
            )
            term_pat = d_fr["terme"]
            cs = 1 if term_pat.isupper() and len(term_pat) >= 3 else 0
            add_regle(
                code_regle=f"r1-fr-{entry['id']}-{len(regles_seen)}",
                lang="fr",
                pattern_term=term_pat,
                case_sensitive=cs,
                risk_category=cat,
                allowed_in_bijural_if=BIJURAL_COMPANIONS_FR.get(term_pat.lower()),
                reason_fr=d_fr["motif"],
                suggested_replacement=entry["terme_fr"],
                legal_basis=entry["base_legale"],
            )
        for d_en in entry.get("termes_deconseilles_en", []):
            dec_combined.append({**d_en, "langue": "en"})
            term_pat = d_en["terme"]
            add_regle(
                code_regle=f"r1-en-{entry['id']}-{len(regles_seen)}",
                lang="en",
                pattern_term=term_pat,
                case_sensitive=0,
                risk_category="anglicisme_ou_common_law",
                allowed_in_bijural_if=BIJURAL_COMPANIONS_EN.get(term_pat.lower()),
                reason_fr=d_en["motif"],
                suggested_replacement=entry["terme_en"],
                legal_basis=entry["base_legale"],
            )

        if add_fiche(
            slug=entry["id"],
            rang_source=1,
            source_nom="Glossaire curé de pratique civile et commerciale québécoise",
            licence_source=glossaire_raw["metadata"]["license"],
            terme_fr=entry["terme_fr"],
            terme_en=entry["terme_en"],
            syn_fr=entry.get("synonymes_fr", []),
            syn_en=entry.get("synonymes_en", []),
            deconseilles=dec_combined,
            systeme_juridique=entry["systeme_juridique"],
            domaine=entry["domaine"],
            note_ou_definition=entry["note_explicative"],
            base_legale=entry["base_legale"],
            url_fiche=None,
            date_verif=glossaire_raw["metadata"]["verified_at"],
        ):
            r1_count += 1

    for extra in EXTRA_SCAN_RULES:
        add_regle(**extra)

    conn.execute(
        "INSERT INTO meta_sources VALUES (?, ?, ?, ?, ?, ?)",
        (
            "glossaire_qc",
            "Glossaire curé de pratique civile et commerciale québécoise",
            1,
            glossaire_raw["metadata"]["license"],
            glossaire_raw["metadata"]["verified_at"],
            r1_count,
        ),
    )
    print(f"[Rang 1] {r1_count} fiches curées et {regle_id} règles de contamination.")

    r2_fiches = 0
    aligned_articles_count = 0

    if sample_only and not os.environ.get("CLOUDFLARE_API_TOKEN"):
        sample_laws = [
            ("ccq", "qc", "Code civil du Québec", "Civil Code of Québec", "RLRQ, c. CCQ-1991", None, "2026-04-07", "2026-04-07"),
            ("cpc", "qc", "Code de procédure civile", "Code of Civil Procedure", "RLRQ, c. C-25.01", None, "2026-04-07", "2026-04-07"),
            ("ca-i-21", "ca", "Loi d’interprétation", "Interpretation Act", "L.R.C. (1985), ch. I-21", "R.S.C. 1985, c. I-21", "2026-07-21", "2026-07-21"),
        ]
        for sl in sample_laws:
            conn.execute("INSERT INTO lois_bilingues VALUES (?, ?, ?, ?, ?, ?, ?, ?)", sl)
        sample_arts = [
            (1, "ccq", "2660", 2660, "L’hypothèque est un droit réel sur un bien, meuble ou immeuble, affecté à l’exécution d’une obligation.", "A hypothec is a real right on a movable or immovable property made liable for the performance of an obligation."),
            (2, "cpc", "141", 141, "La demande introductive d’instance est écrite, présentée par le demandeur ou son avocat.", "An originating application must be in writing and be presented by the plaintiff or the plaintiff’s lawyer."),
            (3, "ca-i-21", "8.1", 8001, "Le droit civil et la common law font pareillement autorité et sont tous deux sources de droit en matière de propriété et de droits civils au Canada.", "Both the common law and the civil law are equally authoritative and recognized sources of the law of property and civil rights in Canada."),
        ]
        for sa in sample_arts:
            conn.execute("INSERT INTO articles_bilingues VALUES (?, ?, ?, ?, ?, ?)", sa)
        aligned_articles_count = len(sample_arts)
    else:
        print("[Rang 2] Lecture seule des lois, intitulés et articles bilingues depuis MCP-Legislation...")
        laws_rows = _legislation_select_readonly(
            "SELECT id, jurisdiction, name_fr, name_en, official_cite, official_cite_en, "
            "consol_date_fr, consol_date_en FROM laws ORDER BY id"
        )
        laws_by_id: dict[str, dict] = {}
        for lw in laws_rows:
            jur = lw.get("jurisdiction") or ("ca" if str(lw["id"]).startswith("ca-") else "qc")
            laws_by_id[lw["id"]] = lw
            conn.execute(
                "INSERT INTO lois_bilingues VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    lw["id"],
                    jur,
                    lw["name_fr"],
                    lw["name_en"],
                    lw["official_cite"],
                    lw.get("official_cite_en"),
                    lw.get("consol_date_fr"),
                    lw.get("consol_date_en"),
                ),
            )
            if add_fiche(
                slug=f"loi-{lw['id']}",
                rang_source=2,
                source_nom="Concordancier législatif officiel (LégisQuébec / Justice Canada)",
                licence_source="Reproduction législative autorisée (LégisQuébec / OGL-Canada)",
                terme_fr=lw["name_fr"],
                terme_en=lw["name_en"],
                syn_fr=[lw["official_cite"]],
                syn_en=[lw["official_cite_en"]] if lw.get("official_cite_en") else [],
                deconseilles=[],
                systeme_juridique="bijuridique_federal" if jur == "ca" else "droit_civil_qc",
                domaine="législation consolidée",
                note_ou_definition=f"Intitulé officiel bilingue de la loi ({lw['official_cite']}).",
                base_legale=lw["official_cite"],
                url_fiche=None,
                date_verif=lw.get("consol_date_fr") or today_iso,
            ):
                r2_fiches += 1

        div_fr: dict[tuple[str, str], str] = {}
        div_en: dict[tuple[str, str], str] = {}
        last_div_id = -1
        while True:
            drows = _legislation_select_readonly(
                f"SELECT id, law_id, lang, path, heading FROM divisions "
                f"WHERE id > {last_div_id} AND repealed = 0 AND heading IS NOT NULL "
                f"ORDER BY id ASC LIMIT 5000"
            )
            if not drows:
                break
            for dr in drows:
                last_div_id = int(dr["id"])
                h = str(dr["heading"]).strip()
                if 3 <= len(h) <= 130:
                    if dr["lang"] == "fr":
                        div_fr[(dr["law_id"], dr["path"])] = h
                    elif dr["lang"] == "en":
                        div_en[(dr["law_id"], dr["path"])] = h

        for (law_id, _path), h_fr in div_fr.items():
            h_en = div_en.get((law_id, _path))
            if not h_en:
                continue
            lw = laws_by_id.get(law_id, {})
            jur = lw.get("jurisdiction") or ("ca" if law_id.startswith("ca-") else "qc")
            sys_j = (
                "bijuridique_federal"
                if jur == "ca"
                else "procedure_qc"
                if law_id == "cpc"
                else "droit_civil_qc"
            )
            if add_fiche(
                slug=None,
                rang_source=2,
                source_nom="Concordancier législatif officiel (rubriques de loi)",
                licence_source="Reproduction législative autorisée (LégisQuébec / OGL-Canada)",
                terme_fr=h_fr.title() if h_fr.isupper() else h_fr,
                terme_en=h_en.title() if h_en.isupper() else h_en,
                syn_fr=[],
                syn_en=[],
                deconseilles=[],
                systeme_juridique=sys_j,
                domaine=f"rubrique législative ({law_id})",
                note_ou_definition=f"Intitulé de division aligné FR/EN dans {lw.get('name_fr', law_id)}.",
                base_legale=lw.get("official_cite", law_id),
                url_fiche=None,
                date_verif=lw.get("consol_date_fr") or today_iso,
            ):
                r2_fiches += 1

        arts_fr: dict[tuple[str, str], tuple[int, str]] = {}
        arts_en: dict[tuple[str, str], tuple[int, str]] = {}
        last_art_id = -1
        while True:
            arows = _legislation_select_readonly(
                f"SELECT id, law_id, lang, number, sort_key, text FROM articles "
                f"WHERE id > {last_art_id} AND repealed = 0 "
                f"ORDER BY id ASC LIMIT 4000"
            )
            if not arows:
                break
            for ar in arows:
                last_art_id = int(ar["id"])
                key = (str(ar["law_id"]), str(ar["number"]))
                txt = " ".join(str(ar["text"]).split())
                sk = int(ar["sort_key"] or 0)
                if ar["lang"] == "fr":
                    arts_fr[key] = (sk, txt)
                elif ar["lang"] == "en":
                    arts_en[key] = (sk, txt)

        doublet_en_re = re.compile(
            r"\b((?:real property or immovables|immovables or real property|"
            r"personal property or movables|movables or personal property|"
            r"mortgage[a-z\s,]{0,30}or hypothec[a-z\s]{0,25}|"
            r"security interest[a-z\s,]{0,30}or movable hypothec|"
            r"solidarily or jointly and severally|jointly and severally, or solidarily))\b",
            re.I,
        )
        doublet_fr_re = re.compile(
            r"\b((?:biens? immeubles? ou biens? réels?|biens? réels? ou immeubles?|"
            r"biens? meubles? ou biens? personnels?|hypothèque[a-zàâéèêëîïôùûç\s,]{0,35}ou mortgage|"
            r"solidairement ou conjointement et solidairement))\b",
            re.I,
        )

        art_pk = 0
        for key in sorted(arts_fr.keys()):
            if key not in arts_en:
                continue
            law_id, number = key
            sk, t_fr = arts_fr[key]
            _, t_en = arts_en[key]
            if not t_fr or not t_en:
                continue
            art_pk += 1
            conn.execute(
                "INSERT INTO articles_bilingues VALUES (?, ?, ?, ?, ?, ?)",
                (art_pk, law_id, number, sk, t_fr, t_en),
            )
            if law_id.startswith("ca-"):
                m_en = doublet_en_re.search(t_en)
                m_fr = doublet_fr_re.search(t_fr)
                if m_en and m_fr:
                    lw = laws_by_id.get(law_id, {})
                    cite = f"{lw.get('official_cite', law_id)}, art. {number}"
                    if add_fiche(
                        slug=None,
                        rang_source=2,
                        source_nom="Doublet bijuridique fédéral attesté (Justice Canada)",
                        licence_source="OGL-Canada",
                        terme_fr=m_fr.group(1).strip(),
                        terme_en=m_en.group(1).strip(),
                        syn_fr=[],
                        syn_en=[],
                        deconseilles=[],
                        systeme_juridique="bijuridique_federal",
                        domaine="bijuridisme fédéral",
                        note_ou_definition=f"Doublet bijuridique fédéral extrait de {cite}.",
                        base_legale=cite,
                        url_fiche=None,
                        date_verif=lw.get("consol_date_fr") or today_iso,
                    ):
                        r2_fiches += 1

        aligned_articles_count = art_pk

    conn.execute(
        "INSERT INTO meta_sources VALUES (?, ?, ?, ?, ?, ?)",
        (
            "concordancier_legislatif",
            "Concordancier législatif bilingue QC/CA (LégisQuébec / Justice Canada)",
            2,
            "Reproduction législative autorisée / OGL-Canada",
            today_iso,
            aligned_articles_count,
        ),
    )
    print(f"[Rang 2] {r2_fiches} fiches législatives et {aligned_articles_count} articles FR/EN alignés.")

    r3_count = 0
    if not sample_only:
        termium_zip = _download_if_missing(TERMIUM_ZIP_URL, WORK_DIR / "termium_droit.zip")
        with zipfile.ZipFile(termium_zip, "r") as zf:
            for info in sorted(zf.infolist(), key=lambda i: i.filename):
                if not info.filename.lower().endswith(".csv"):
                    continue
                with zf.open(info) as raw_stream:
                    text_stream = io.TextIOWrapper(raw_stream, encoding="utf-8-sig", errors="replace")
                    reader = csv.DictReader(text_stream)
                    for row in reader:
                        t_fr = (row.get("TERME_FR") or "").strip()
                        t_en = (row.get("TERM_EN") or "").strip()
                        if not t_fr or not t_en:
                            continue
                        p_fr = (row.get("TERME_FR_PARAMETRE") or "").lower()
                        p_en = (row.get("TERM_EN_PARAMETER") or "").lower()
                        if "avoid" in p_fr or "avoid" in p_en:
                            continue

                        syn_fr = [
                            s.strip()
                            for s in (row.get("SYNONYMES_FR") or "").split(";")
                            if s.strip()
                        ]
                        if (row.get("ABBREVIATION_FR") or "").strip():
                            syn_fr.append(row["ABBREVIATION_FR"].strip())

                        syn_en = [
                            s.strip()
                            for s in (row.get("SYNONYMS_EN") or "").split(";")
                            if s.strip()
                        ]
                        if (row.get("ABBREVIATION_EN") or "").strip():
                            syn_en.append(row["ABBREVIATION_EN"].strip())

                        just_fr = " ".join(
                            (row.get("JUSTIFICATION_1_FR") or row.get("TEXTUAL_SUPPORT_1_EN") or "").split()
                        )
                        dom = (row.get("DOMAINE_FR") or row.get("SUBJECT_EN") or "Droit et justice").strip()
                        sys_j = _detect_termium_system(row)

                        if add_fiche(
                            slug=None,
                            rang_source=3,
                            source_nom="TERMIUM Plus® — Bureau de la traduction (Droit et justice)",
                            licence_source="OGL-Canada",
                            terme_fr=t_fr,
                            terme_en=t_en,
                            syn_fr=syn_fr[:6],
                            syn_en=syn_en[:6],
                            deconseilles=[],
                            systeme_juridique=sys_j,
                            domaine=dom,
                            note_ou_definition=just_fr[:700],
                            base_legale=None,
                            url_fiche=None,
                            date_verif=today_iso,
                        ):
                            r3_count += 1

    conn.execute(
        "INSERT INTO meta_sources VALUES (?, ?, ?, ?, ?, ?)",
        (
            "termium_plus_droit",
            "TERMIUM Plus® — Domaine Droit et justice (Gouvernement du Canada)",
            3,
            "OGL-Canada",
            today_iso,
            r3_count,
        ),
    )
    print(f"[Rang 3] {r3_count} fiches TERMIUM Plus® chargées.")

    r4_count = 0
    if not sample_only:
        req_ckan = urllib.request.Request(
            OQLF_CKAN_PACKAGE_URL, headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req_ckan, timeout=30) as resp:
            pkg = json.loads(resp.read().decode("utf-8"))

        url_officialises = ""
        url_fiches_rec = ""
        for res in pkg["result"]["resources"]:
            u = res.get("url") or ""
            if "termes_officialises" in u:
                url_officialises = u
            elif "fiches_recentes" in u:
                url_fiches_rec = u

        if not url_officialises or not url_fiches_rec:
            raise RuntimeError("Impossible de résoudre les CSV OQLF via l'API CKAN Données Québec.")

        p_off = _download_if_missing(url_officialises, WORK_DIR / Path(url_officialises).name)
        p_rec = _download_if_missing(url_fiches_rec, WORK_DIR / Path(url_fiches_rec).name)

        with open(p_off, encoding="utf-8-sig", errors="replace") as f:
            for row in csv.DictReader(f):
                dom_raw = row.get("Domaines") or ""
                legal_dom = _extract_legal_oqlf_domain(dom_raw)
                if not legal_dom:
                    continue
                fr_terms = [
                    _clean_oqlf_term(x)
                    for x in (row.get("Termes_Officialises") or "").split(";")
                    if _clean_oqlf_term(x)
                ]
                en_terms = [
                    _clean_oqlf_term(x)
                    for x in (row.get("Equivalent_anglais") or "").split(";")
                    if _clean_oqlf_term(x)
                ]
                if not fr_terms:
                    continue
                head_fr = fr_terms[0]
                head_en = en_terms[0] if en_terms else head_fr
                defn = " ".join((row.get("Definition") or "").split())
                typ_off = (row.get("Type_Officialisation") or "").strip()
                note = f"[{typ_off}] {defn}".strip() if typ_off else defn
                if add_fiche(
                    slug=None,
                    rang_source=4,
                    source_nom="Office québécois de la langue française (OQLF — Grand dictionnaire terminologique)",
                    licence_source="CC-BY-NC-SA-4.0",
                    terme_fr=head_fr,
                    terme_en=head_en,
                    syn_fr=fr_terms[1:6],
                    syn_en=en_terms[1:6],
                    deconseilles=[],
                    systeme_juridique="droit_civil_qc",
                    domaine=legal_dom,
                    note_ou_definition=note[:700],
                    base_legale=None,
                    url_fiche=(row.get("URL_fiche") or "").strip() or None,
                    date_verif=(row.get("Date_fiche") or today_iso).strip(),
                ):
                    r4_count += 1

        with open(p_rec, encoding="utf-8-sig", errors="replace") as f:
            for row in csv.DictReader(f):
                dom_raw = row.get("Domaines") or ""
                legal_dom = _extract_legal_oqlf_domain(dom_raw)
                if not legal_dom:
                    continue
                fr_terms = [
                    _clean_oqlf_term(x)
                    for x in (row.get("Termes_francais") or "").split(";")
                    if _clean_oqlf_term(x)
                ]
                en_terms = [
                    _clean_oqlf_term(x)
                    for x in (row.get("Termes_anglais") or "").split(";")
                    if _clean_oqlf_term(x)
                ]
                if not fr_terms or not en_terms:
                    continue
                defn = " ".join((row.get("Definition") or "").split())
                if add_fiche(
                    slug=None,
                    rang_source=4,
                    source_nom="Office québécois de la langue française (OQLF — Vitrine linguistique)",
                    licence_source="CC-BY-NC-SA-4.0",
                    terme_fr=fr_terms[0],
                    terme_en=en_terms[0],
                    syn_fr=fr_terms[1:6],
                    syn_en=en_terms[1:6],
                    deconseilles=[],
                    systeme_juridique="droit_civil_qc",
                    domaine=legal_dom,
                    note_ou_definition=defn[:700],
                    base_legale=None,
                    url_fiche=(row.get("URL_fiche") or "").strip() or None,
                    date_verif=(row.get("Date_fiche") or today_iso).strip(),
                ):
                    r4_count += 1

    conn.execute(
        "INSERT INTO meta_sources VALUES (?, ?, ?, ?, ?, ?)",
        (
            "oqlf_droit",
            "Office québécois de la langue française (OQLF — domaines juridiques)",
            4,
            "CC-BY-NC-SA-4.0",
            today_iso,
            r4_count,
        ),
    )
    print(f"[Rang 4] {r4_count} fiches juridiques OQLF chargées.")

    conn.executescript((HERE / "indexes.sql").read_text(encoding="utf-8"))
    for stmt in build_fts_slice_statements(
        conn,
        "fiches_fts",
        "fiches_terminologiques",
        "id",
        ["terme_fr", "terme_en", "termes_recherche", "domaine"],
    ):
        conn.execute(stmt)
    for stmt in build_fts_slice_statements(
        conn, "articles_fr_fts", "articles_bilingues", "id", ["text_fr"]
    ):
        conn.execute(stmt)
    for stmt in build_fts_slice_statements(
        conn, "articles_en_fts", "articles_bilingues", "id", ["text_en"]
    ):
        conn.execute(stmt)
    conn.commit()

    non_droit_r4 = conn.execute(
        "SELECT COUNT(*) FROM fiches_terminologiques WHERE rang_source = 4 AND LOWER(domaine) NOT LIKE 'droit%'"
    ).fetchone()[0]
    if non_droit_r4 != 0:
        raise RuntimeError(
            f"Validation locale échouée : {non_droit_r4} fiche(s) OQLF de rang 4 hors domaine 'droit'."
        )

    stats = {
        "fiches_terminologiques": conn.execute(
            "SELECT COUNT(*) FROM fiches_terminologiques"
        ).fetchone()[0],
        "lois_bilingues": conn.execute("SELECT COUNT(*) FROM lois_bilingues").fetchone()[0],
        "articles_bilingues": conn.execute("SELECT COUNT(*) FROM articles_bilingues").fetchone()[0],
        "regles_contamination": conn.execute(
            "SELECT COUNT(*) FROM regles_contamination"
        ).fetchone()[0],
    }
    conn.close()
    print(
        f"[OK] Base SQLite locale générée ({LOCAL_DB_PATH.stat().st_size / (1024 * 1024):.1f} Mo) : {stats}"
    )
    return stats


def push_to_remote_d1(db_name: str, location: str = "enam") -> str:
    if not LOCAL_DB_PATH.exists():
        raise FileNotFoundError(f"Base locale introuvable : {LOCAL_DB_PATH}")

    db_info = provision_or_get_d1(db_name, location=location)
    db_id = str(db_info["uuid"])
    print(f"[D1] Cible distante : {db_name} (uuid={db_id}, compte={ACCOUNT_ID})")

    if BATCH_DIR.exists():
        for old in BATCH_DIR.glob("*.sql"):
            old.unlink()
    BATCH_DIR.mkdir(parents=True, exist_ok=True)

    schema_file = BATCH_DIR / "0000_schema.sql"
    schema_file.write_text((HERE / "schema.sql").read_text(encoding="utf-8"), encoding="utf-8", newline="\n")

    conn = sqlite3.connect(LOCAL_DB_PATH)
    batch_files: list[Path] = [schema_file]

    f_meta, _ = export_table_batches(
        conn,
        "meta_sources",
        ["source_key", "source_label", "rang_source", "licence", "version_date", "row_count"],
        BATCH_DIR,
        "01_meta",
        "rang_source",
    )
    batch_files.extend(f_meta)

    f_regles, _ = export_table_batches(
        conn,
        "regles_contamination",
        [
            "id",
            "code_regle",
            "lang",
            "pattern_term",
            "pattern_norm",
            "case_sensitive",
            "risk_category",
            "allowed_in_bijural_if",
            "reason_fr",
            "suggested_replacement",
            "legal_basis",
        ],
        BATCH_DIR,
        "02_regles",
        "id",
    )
    batch_files.extend(f_regles)

    f_fiches, n_fiches = export_table_batches(
        conn,
        "fiches_terminologiques",
        [
            "id",
            "slug",
            "rang_source",
            "source_nom",
            "licence_source",
            "terme_fr",
            "terme_en",
            "terme_fr_norm",
            "terme_en_norm",
            "synonymes_fr_json",
            "synonymes_en_json",
            "termes_deconseilles_json",
            "termes_recherche",
            "systeme_juridique",
            "domaine",
            "note_ou_definition",
            "base_legale",
            "url_fiche",
            "date_verification",
        ],
        BATCH_DIR,
        "03_fiches",
        "id",
    )
    batch_files.extend(f_fiches)

    f_lois, _ = export_table_batches(
        conn,
        "lois_bilingues",
        [
            "law_id",
            "jurisdiction",
            "name_fr",
            "name_en",
            "official_cite",
            "official_cite_en",
            "consol_date_fr",
            "consol_date_en",
        ],
        BATCH_DIR,
        "04_lois",
        "law_id",
    )
    batch_files.extend(f_lois)

    f_arts, n_arts = export_table_batches(
        conn,
        "articles_bilingues",
        ["id", "law_id", "article_number", "sort_key", "text_fr", "text_en"],
        BATCH_DIR,
        "05_articles",
        "id",
    )
    batch_files.extend(f_arts)

    idx_file = BATCH_DIR / "9000_indexes.sql"
    idx_file.write_text((HERE / "indexes.sql").read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
    batch_files.append(idx_file)

    fts_stmts = (
        build_fts_slice_statements(
            conn,
            "fiches_fts",
            "fiches_terminologiques",
            "id",
            ["terme_fr", "terme_en", "termes_recherche", "domaine"],
            slice_size=15_000,
        )
        + build_fts_slice_statements(
            conn, "articles_fr_fts", "articles_bilingues", "id", ["text_fr"], slice_size=10_000
        )
        + build_fts_slice_statements(
            conn, "articles_en_fts", "articles_bilingues", "id", ["text_en"], slice_size=10_000
        )
    )
    conn.close()

    for s_idx, stmt in enumerate(fts_stmts, 1):
        p = BATCH_DIR / f"9100_fts_{s_idx:03d}.sql"
        p.write_text(stmt + "\n", encoding="utf-8", newline="\n")
        batch_files.append(p)

    print(f"[D1] Envoi de {len(batch_files)} lots SQL vers {db_name}...")
    execute_sql_files_remote(db_name, batch_files)

    rem_fiches = d1_query_remote(db_id, "SELECT COUNT(*) AS c FROM fiches_terminologiques")[0]["c"]
    rem_arts = d1_query_remote(db_id, "SELECT COUNT(*) AS c FROM articles_bilingues")[0]["c"]
    rem_bad_r4 = d1_query_remote(
        db_id,
        "SELECT COUNT(*) AS c FROM fiches_terminologiques "
        "WHERE rang_source = 4 AND LOWER(domaine) NOT LIKE 'droit%'",
    )[0]["c"]
    fts_probe = d1_query_remote(
        db_id,
        "SELECT COUNT(*) AS c FROM articles_en_fts f JOIN articles_bilingues a ON a.id = f.rowid "
        "WHERE a.law_id = 'ccq' AND articles_en_fts MATCH '\"hypothec\"'",
    )[0]["c"]
    if rem_fiches != n_fiches or rem_arts != n_arts or rem_bad_r4 != 0 or fts_probe <= 0:
        raise RuntimeError(
            f"Validation D1 échouée : fiches={rem_fiches}/{n_fiches}, "
            f"articles={rem_arts}/{n_arts}, bad_r4={rem_bad_r4}, ccq_hypothec_fts={fts_probe}"
        )
    verif = verify_remote_candidate(
        db_id,
        "SELECT COUNT(*) AS c FROM articles_en_fts f JOIN articles_bilingues a ON a.id = f.rowid "
        "WHERE a.law_id = 'ccq' AND articles_en_fts MATCH '\"hypothec\"'",
        min_rows=1,
    )
    print(
        f"[OK] {db_name} ({db_id}) validée : {rem_fiches} fiches, {rem_arts} articles alignés, "
        f"{fts_probe} occurrences de 'hypothec' dans le C.c.Q., info={verif}"
    )
    return db_id


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingestion DB_TERMINOLOGIE")
    parser.add_argument("--build-local", action="store_true")
    parser.add_argument("--sample", action="store_true")
    parser.add_argument("--push-remote", action="store_true")
    parser.add_argument("--db-name", default="outils-terminologie")
    parser.add_argument("--blue-green", action="store_true")
    parser.add_argument("--swap", action="store_true")
    parser.add_argument("--location", default="enam")
    args = parser.parse_args()

    if args.build_local:
        build_local_sqlite(sample_only=args.sample)
    if args.push_remote:
        target_name = dated_db_name("DB_TERMINOLOGIE") if args.blue_green else args.db_name
        db_id = push_to_remote_d1(target_name, location=args.location)
        if args.swap:
            swap_wrangler_binding("DB_TERMINOLOGIE", target_name, db_id)


if __name__ == "__main__":
    main()
