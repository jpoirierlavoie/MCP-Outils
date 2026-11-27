# MCP-Outils — Architecture, principes et consignes de travail

Directives de développement, architecture et règles anti-dérive pour le serveur MCP `MCP-Outils` (`mcp-outils` `v3.0.0`, Worker Cloudflare `outils`). Ce document définit les principes de conception, les contrats de données, les garde-fous d'arête HTTP, la topologie D1 et les obligations de synchronisation avec le plugin cadre `droit-civil-quebecois`. Il s'applique de façon identique à Claude (`CLAUDE.md`) et à Gemini / Antigravity (`GEMINI.md`).

---

## 1. Rôle architectural et intégration dans le cadre global

`MCP-Outils` est un serveur MCP sans état applicatif, sans écriture sur ses 4 bases D1 en lecture seule (`ENAM`), sans appel HTTP sortant et sans journalisation de contenu, déployé comme Cloudflare Worker (`outils`) sur `https://outils.poirierlavoie.ca/mcp/oauth` et `/mcp`.

Il constitue l'un des trois serveurs MCP du cadre d'assistance juridique québécois (`droit-civil-quebecois`, 37 outils MCP au total), tous trois gouvernés par le portail d'accès et serveur OAuth 2.1 `MCP-Acces` (`acces.poirierlavoie.ca`) :

```
         ┌────────────────────────────────────────────────────────────────┐
         │          droit-civil-quebecois (Plugin Cadre v3.4.0)           │
         │  10 compétences · 60 feuilles · 6 personas · 4 scripts stdlib  │
         └──────────┬───────────────────────┬──────────────────┬──────────┘
                    │ /mcp + /mcp/oauth     │ /mcp + /mcp/oauth│ /mcp + /mcp/oauth
                    ▼                       ▼                  ▼
         ┌─────────────────────┐ ┌─────────────────────┐ ┌──────────────────────────┐
         │   MCP-Legislation   │ │  MCP-Jurisprudence  │ │        MCP-Outils        │
         │  D1 + Vectorize +   │ │  D1 cache CanLII    │ │  OAuth 2.1 / Bearer,     │
         │  Workers AI +       │ │  BYOK CanLII strict │ │  4 D1 lecture seule, Zod │
         │  hybride_permis     │ │  sans fetched_at    │ │  0 clé CanLII requise    │
         └──────────┬──────────┘ └──────────┬──────────┘ └────────────┬─────────────┘
                    │                       │                         │ (`#v0.8.8` dev)
                    ├───────────┬───────────┴────┬────────────────────┘
                    │           ▼ (`#v0.8.8` dev)▼ (`DB_IDENTITE` `mcp-identite`)
                    │  ┌──────────────────┐  ┌──────────────────────────────────────┐
                    │  │    MCP-Socle     │  │              MCP-Acces               │
                    │  │ Transport 2026   │  │     https://acces.poirierlavoie.ca   │
                    └──│ Auth · OAuth 2.1 │◄─┤ Admission Barreau · Coffre AES-GCM · │
                       │ Coffre · Gouverne│  │ Portail /moi · Serveur OAuth PKCE    │
                       └──────────────────┘  └──────────────────────────────────────┘
```

### Intégration avec les compétences du plugin (`droit-civil-quebecois`)
- **`skills/gestion-du-mandat` & `skills/production-et-conformite`** : Consomment `calendrier_deadlines` et `calendrier_holidays` (avec repli local `scripts/calcul_delai.py`) pour calculer de 1 à 25 échéances de procédure civile (art. 83 C.p.c., report de fin de semaine, notification technologique après 17h00 selon l'art. 111 al. 2 C.p.c., délais à rebours, périodes de non-séance de l'art. 82 al. 2 C.p.c.), `interets_1619` (y compris `prime_plus_margin`), `greffe_parse_number`, `palais_list`, `palais_get`, `taux_boc_rates`, `indice_ipc` et `loyer_tal`.
- **`skills/redaction-juridique`** : Consomme `interets_1619`, `calendrier_deadlines`, `taux_boc_rates`, `indice_ipc` et `loyer_tal` (chiffrage, indexation et fixation de loyer), `registre_search`, `registre_get_entity` et `adresse_verify` (désignation des parties morales et vérification d'adresse civique / lots RQA en en-tête d'acte ou mise en demeure, sous réserve des gardes LPLE / RQA / Registre foncier), ainsi que `terminologie_lookup`, `termino_attestations` et `terminologie_scan`.
- **`skills/recherche-juridique`** : Consomme `greffe_parse_number`, `palais_list`, `palais_get`, `registre_search`, `registre_get_entity`, `adresse_verify`, `terminologie_lookup`, `termino_attestations`, `taux_boc_rates`, `indice_ipc` et `loyer_tal` en appui aux connecteurs `lois` et `juris`.
- **`skills/analyse-et-strategie`** & orchestrateurs `skills/phase-*` : Consomment au besoin les connecteurs selon le noyau `SAFETY-KERNEL`, sans dérogation de confidentialité.

### Relations inter-dépôts et séparation des responsabilités
- **Découplage de `MCP-Jurisprudence`** : Depuis `v0.2.0`, les outils `greffe_*` et `palais_*` ainsi que `src/qc/` résident ici afin de séparer l'interrogation distante de CanLII (avec secret Bearer) des outils locaux déterministes.
- **Intégration de `MCP-Socle` (`#v0.8.8`, `devDependencies`)** : `MCP-Outils` embarque `@poirierlavoie/mcp-socle` (`servirRequeteMcp` avec `sertAvant2025_06_18: true`, `ouvrirPrincipal`, `creerDepotJetonsD1`, `repondreCarteServeur`, `repondreRessourceProtegee`, `verifierDebitPreAuth`, `verifierDebitTitulaire`, `verifierQuotaJour`, `lireCorpsBorne`, `methodeNonPermise`, `./verifier-audit`) et `zod` comme dépendances de développement (`0` dépendance d'exécution dans `package.json`).
- **Complémentarité avec `MCP-Legislation`** : `MCP-Legislation` demeure la seule source du texte intégral consolidé des lois et règlements, tandis que `MCP-Outils` exécute les calculs arithmétiques et fournit les attestations terminologiques et données économiques précalculées en lecture seule.

---

## 2. Inventaire des 15 outils MCP (6 familles)

Tous les outils déclarent les annotations MCP :
- `openWorldHint: false` (aucun appel réseau sortant à la requête)
- `readOnlyHint: true` (aucune modification d'état)
- `idempotentHint: true` (résultats identiques pour mêmes arguments)
- `destructiveHint: false` (aucune destruction)

### A. Famille `calcul` (arithmétique déterministe pure)
1. `calendrier_holidays` : Jours fériés et non juridiques d'une année civile (`qc_cpc`, `qc_prescription`, `qc_li`, `ca_li` avec `province` optionnel pour `QC` le 24 juin).
2. `calendrier_deadlines` : Chaîne de 1 à 25 délais procéduraux ou légaux (`qc_cpc`, `qc_prescription` art. 2879 al. 2 C.c.Q., `qc_li` `rollover_saturday=false` par défaut, `ca_li` avec `province`, report art. 83 C.p.c., art. 111 al. 2 C.p.c. après 17h00, délais à rebours, hors séance art. 82 al. 2 C.p.c.).
3. `interets_1619` : Calcul rationnel exact en `BigInt` des intérêts légaux (5 %), de l'indemnité additionnelle (art. 1619 C.c.Q. / art. 28 L.A.F., `src/data/laf_art28_rates.json`), d'un taux contractuel ou du taux préférentiel BDC `V80691311` + marge (`prime_plus_margin`, `src/data/boc_prime_rates.json`), convention Exact/Exact, 1 à 50 tranches.

### B. Famille `greffe` (tables statiques MJQ compilées)
4. `greffe_parse_number` : Analyse de nomenclature d'un numéro de dossier (`NNN-NN-NNNNNN-NNN` ou préfixe `TAL-`, `C.F.-`, etc.) sans accès au plumitif ni validation des positions 7+.
5. `palais_list` : Répertoire des 44 palais de justice et 9 points de service du Québec (relevé MJQ `2026-11-17`).
6. `palais_get` : Fiche détaillée d'un palais ou point de service par numéro de greffe ou nom (adresse, télécopieur, heures d'ouverture, téléphones et courriels par chambre ou service).

### C. Famille `registre` (`DB_REGISTRES` — `outils-registres`)
7. `registre_search` : Recherche hors ligne dans les instantanés ouverts du REQ (enrichi RBQ, OPC, RENA), de Corporations Canada et de la GLEIF (entités canadiennes titulaires d'un LEI, indicateur `has_lei`).
8. `registre_get_entity` : Fiche complète par `neq` (10 chiffres), `corporation_number`, `bn_ne` (9 chiffres) ou `lei` (20 car. ISO 17442), avec hiérarchie comptable GLEIF Level 2 et liens directs vers les portails officiels (REQ, Corporations Canada, PCI/ISC, GLEIF), sans aucune personne physique (`REGISTRE_ABSENCE_PERSONNES_PHYSIQUES`).

### D. Famille `adresse` (`DB_ADRESSES` — `outils-adresses`)
9. `adresse_verify` : Vérification municipale et normalisation au RQA (~5M d'adresses) et Odonymes et renvois (MRNF), ou recherche inversée par `lot_number` / `matricule` (`lots_cadastraux_index`). Indique `lot_source` (`rqa_unite` vs `rqa_immeuble_parent` vs `absent`), les ambiguïtés multi-lots/copropriété et le district judiciaire probable.

### E. Famille `terminologie` (`DB_TERMINOLOGIE` — `outils-terminologie`)
10. `terminologie_lookup` : Recherche bilingue FR/EN hiérarchisée (rang 1 : glossaire curé `src/data/glossaire_bijuridique_qc.json` ; rang 2 : concordancier législatif et doublets bijuridiques ; rang 3 : TERMIUM Plus® ; rang 4 : OQLF domaines juridiques).
11. `termino_attestations` : Comptage exact par loi et extraits bilingues FR/EN côte à côte dans le concordancier législatif aligné (97 lois QC/CA).
12. `terminologie_scan` : Détection en lecture seule des francismes de France, anglicismes / faux amis de common law et archaïsmes d'avant 2016 sur un extrait de projet d'acte (≤ 32 000 car.), sans réécriture.

### F. Famille `economie` (`DB_ECONOMIE` — `outils-economie` & tables embarquées)
13. `taux_boc_rates` : Consultation hors ligne des taux de change face au CAD (2001–2026+, régime midi HE pré-`2017-05-01` vs moyenne 16 h 30 HE) et taux `V39079`/`V122530`/`V80691311`, avec conversion exacte `BigInt` (*Loi sur la monnaie*, art. 12).
14. `indice_ipc` : Indices IPC StatCan (`18-10-0004-01` mensuel, `18-10-0005-01` annuel ; Québec, Montréal RMR, Québec RMR, Canada ; `2002=100` et `1992=100`), variation annuelle (%) et indexation contractuelle `BigInt` avec plancher/plafond et blocage de divergence d'année de base.
15. `loyer_tal` : Barèmes officiels du TAL (2015–2027, `src/data/tal_criteres.json`), calculateur déterministe post-1er janv. 2026 en `BigInt` (*Règlement sur les critères de fixation de loyer*, `RLRQ, c. T-15.01, r. 2`, Décret 1455-2025) avec gardes transitoires (`< 2026-01-01`) et `art. 1955 C.c.Q.`, et loyers moyens SCHL (`34-10-0133-01` dans `DB_ECONOMIE`).

---

## 3. Contrat de données et format de sortie

`MCP-Outils` adopte une **double sortie standardisée** obligatoire sur les 15 outils :

```typescript
{
  content: [
    {
      type: "text",
      text: "..." // Synthèse claire et lisible en français
    }
  ],
  structuredContent: {
    // Schéma Zod fortement typé propre à l'outil
    provenance: {
      source: string,
      verified_at: string,
      table_version?: string
    },
    gardes: [
      {
        code: GardeCode,
        message: string
      }
    ]
  }
}
```

### Règles de sortie :
1. **`structuredContent` et `content[0].text` obligatoires** (textes, titres, descriptions et messages d'erreur exclusivement en français ; seul `src/site.i18n.ts` contient l'anglais de `GET /`).
2. **Tableau `gardes` obligatoire** (`src/core/gardes.ts`), couvrant notamment les gardes registres/GLEIF, adresses/lots (`ADRESSE_LOT_*`), terminologie, BoC (`TAUX_BOC_*`), IPC (`IPC_*`), TAL (`TAL_*`) et SCHL (`SCHL_LOYER_MOYEN_INDICATIF`).
3. **Constantes textuelles figées (`src/qc/format.ts`)** : `SANS_PLUMITIF`, `GARDE_PALAIS`, `GARDE_SANS_ADRESSE`, `GARDE_DOSSIER` — protégées par tests unitaires, ne jamais les modifier.
4. **Gestion applicative des erreurs** : Toute erreur de validation Zod (`z.strictObject`), paramètre invalide ou absence de binding D1 dans `env` renvoie `{ content: [{ type: "text", text: "..." }], isError: true }` — jamais HTTP 500 ni `-32602` fatal.

---

## 4. Points d'accès HTTP, topologie D1 et pipelines hors ligne

1. **Contrôles d'arête (`src/index.ts`)** :
   - `GET` / `HEAD /` & `/robots.txt`, `/sitemap.xml`, `/llms.txt` : Page HTML bilingue dérivée de `listToolDescriptors()` et découverte publique (actifs même si `MCP_ENABLED !== "true"`).
   - `GET` / `HEAD /health` (alias `/healthz` actif si `MCP_ENABLED === "true"`) : Statut JSON (`service: "mcp-outils"`, `version: "3.0.0"`, `commit` injecté au déploiement via `--var COMMIT:<sha7>`, `databases: { terminologie, registres, adresses, economie }`, `laf_table_last_quarter`, `prime_table_last_verified_date`, `tal_table_last_lease_renewal_end_date`, liste des 15 outils ; dérive contrôlée quotidiennement par `.github/workflows/verifier-deploiement.yml`).
   - `GET` / `HEAD` / `OPTIONS /mcp/server-card` & `/.well-known/mcp/server-card.json` : Fiche publique de découverte SEP-2127 (`application/mcp-server-card+json; charset=utf-8`, doubles `remotes` `/mcp/oauth` + `/mcp`, `405` sur autres méthodes).
   - `GET` / `HEAD` / `OPTIONS /.well-known/oauth-protected-resource/mcp/oauth` : Métadonnées RFC 9728 (`scopes_supported: ["outils", "tous"]`) lorsque `MCP_ENABLED === "true"`.
   - `POST` / `OPTIONS /mcp/oauth` & `/mcp` (et `/mcp/<jeton>`) : Fermé par défaut (`MCP_ENABLED === "true"`), CORS `ALLOWED_ORIGINS`, limiteurs pré-auth `1041–1043` + par titulaire `1044–1045`, authentification D1 (`outils`/`tous`/`les_deux`, quota `local` `3 000`/j actif et `300`/j limité) ou secret statique autonome (`MCP_TOKEN`/`MCP_SHARED_SECRET`, `401` sur `/mcp/oauth` et `404` vide sur `/mcp`), plafond `MAX_OCTETS_CORPS_MCP = 65_536` (`413`), rejet des requêtes par lots ou `id` non scalaires (`400` / `-32600`), `servirRequeteMcp` (`sertAvant2025_06_18: true`, normalisation `-32601` -> HTTP `200`, réponses `application/json`). Aucune clé API CanLII requise et aucun blocage `ALLOWED_HOSTNAMES` sur `*.workers.dev`.
2. **Topologie D1 à 4 bases isolées (`ENAM`) et bascule bleu-vert (`pipeline/`)** :
   - `DB_TERMINOLOGIE` (`outils-terminologie`), `DB_REGISTRES` (`outils-registres`), `DB_ADRESSES` (`outils-adresses`), `DB_ECONOMIE` (`outils-economie`, `< 15 Mio`).
   - Les pipelines Python (`pipeline/terminologie/`, `pipeline/registres/`, `pipeline/adresses/`, `pipeline/economie/`) assemblent d'abord une base SQLite locale validée, exportent des lots SQL sans `BEGIN`/`COMMIT` explicites, construisent les index et `FTS5` par tranches en fin de chargement, et supportent `--blue-green --swap` pour basculer sans coupure.
   - Pour `DB_ADRESSES`, `FTS5` est créé uniquement sur `odonymes` (~85k lignes), jamais sur `adresses_civiques` (~5M lignes).
   - Pour le REQ, aucune tentative de contournement du défi Cloudflare du portail : `ingest_req.py` lit `pipeline/sources/req.zip` téléchargé manuellement.

---

## 5. Évaluation d'impact obligatoire (4 axes locaux + inter-dépôts)

| # | Axe d'impact | Éléments à inspecter et maintenir synchronisés | Règle / Garde associée |
|---|---|---|---|
| 1 | **Outils MCP, calculs, D1 et schémas** | `src/core/`, `src/mcp/`, `src/qc/`, `src/data/`, `pipeline/`, `src/index.ts` | Double sortie obligatoire + `gardes`, `openWorldHint: false`, `readOnlyHint: true`, arithmétique `BigInt`, constantes `src/qc/format.ts`, zéro source sous droit d'auteur fermée |
| 2 | **`README.md`, manifestes autonomes et gouvernance** | `README.md`, `SECURITY.md`, `LICENSE` (`Apache-2.0`), `NOTICE` (attributions et non-revendication des données ouvertes), `package.json`, `plugin.json`, `mcp_config.json`, `gemini-extension.json`, `assets/logo.svg`, `wrangler.jsonc`, `scripts/deployer.mjs`, `scripts/verifier-audit.mjs`, `CLAUDE.md`, `GEMINI.md`, `test/doc.test.ts` | Tout changement d'outil, de base D1, de source de données ouvertes, de politique zéro-log, de licence, de version ou de déploiement |
| 3 | **Page publique HTML (`GET /`), `/mcp/server-card` et `/health`** | `src/site.ts`, `src/site.i18n.ts`, `src/index.ts`, `test/site.test.ts`, `test/mcp.integration.test.ts` | Parité bilingue `OUTILS_EN` (15 outils, 6 familles), fiche SEP-2127, variables CSS clair/sombre, liste blanche `ALLOWED_URL_PREFIXES` |
| 4 | **Impacts inter-dépôts (`Cross-repository`)** | **`droit-civil-quebecois`** (`verifier.py`, `verifier_tout.py`, `scripts/regenerer_cache_mcp.py --apply`, `skills/*`, `README.md`, `CLAUDE.md`, `GEMINI.md`, manifestes) ; **`MCP-Legislation` & `MCP-Jurisprudence`** (lecture seule stricte, cohérence visuelle HTML/CSS) | Maintenir les fins de ligne LF (`\n`), le plafond `<= 64` car. des identifiants MCP composés et les feuilles terminales sans liens relatifs |

---

## 6. Invariants critiques et règles anti-dérive

1. **Invariant 1 : Bases D1 strictement en lecture seule à la requête, zéro appel HTTP sortant et journalisation zéro**
   - Bases D1 (`DB_TERMINOLOGIE`, `DB_REGISTRES`, `DB_ADRESSES`, `DB_ECONOMIE`) interrogées uniquement par `SELECT` (`PRAGMA query_only = ON` dans le harnais de tests), zéro écriture au fil de l'eau, zéro KV/R2, zéro appel HTTP sortant.
   - Dans `wrangler.jsonc` : `observability.enabled = false`, `logs.enabled = false`, `logs.invocation_logs = false`, `logpush = false`.
   - Ne jamais journaliser les adresses IP, corps de requêtes, noms de parties, adresses civiques, montants ou extraits d'actes.
2. **Invariant 2 : Aucune extrapolation des taux publiés** (`laf_art28_rates.json` sauf `rate_overrides`, `boc_prime_rates.json`, `tal_criteres.json`, et séries `DB_ECONOMIE` BdC / StatCan).
3. **Invariant 3 : Arithmétique rationnelle exacte en `BigInt`** (`EXACT_EXACT_COMMON_DENOMINATOR = 1_335_900_000n` pour les intérêts ; exact `BigInt` pour conversions monétaires, indexation IPC et calculs TAL).
4. **Invariant 4 : Intégrité verbatim des gardes MJQ** (`src/qc/format.ts`) et **exclusion des sources terminologiques protégées** (jamais Crépeau/McGill, Juriterm ni Juridictionnaire).
5. **Invariant 5 : Séparation stricte entre données indicatives et registres officiels** — nomenclature pure sans plumitif (`greffe_parse_number`), instantanés corporatifs sans dirigeants personnes physiques (`registre_*`), existence civique municipale distincte du domicile et du Registre foncier (`adresse_verify`), IPC/SCHL indicatifs et blocage de divergence de base (`indice_ipc`, `loyer_tal`).
6. **Invariant 6 : La page publique `/` dérive du code** (`listToolDescriptors()`, identité visuelle partagée avec `MCP-Legislation` et `MCP-Jurisprudence`).
7. **Invariant 7 : Synchronisation complète des surfaces locales et de `droit-civil-quebecois`** (`v3.0.0`, 15 outils sur 6 familles, plafonds `<= 64` car.).
8. **Invariant 8 : Limitation de débit d'arête (`1041`–`1045`), taille maximale (`64 KiB`) et quotas journaliers (`3 000` / `300` `local`)**.
9. **Invariant 9 : Gouvernance Git (`main-pr-and-ci`)** — Le contournement administrateur du ruleset `main-pr-and-ci` est restreint à `pull_request` : **ne jamais pousser directement sur `main`** ; travailler sur une branche dédiée, ouvrir une Pull Request, attendre le passage des contrôles requis (`verify`, `CodeQL`, `OSV-Scanner`, `Trivy`), puis fusionner par *squash* (`gh pr merge --squash --delete-branch`).

---

## 7. Commandes de développement et vérification (PowerShell Windows)

Employer `npm.cmd`, `npx.cmd` et `$env:PYTHONUTF8 = "1"` :

```powershell
npm.cmd run type-check   # npx.cmd tsc --noEmit
npm.cmd run lint         # npx.cmd biome check .
npm.cmd test             # npx.cmd vitest run (suite complète hors réseau, PRAGMA query_only = ON)
npm.cmd run build        # npx.cmd wrangler deploy --dry-run --outdir dist
npm.cmd run audit        # node scripts/verifier-audit.mjs (@poirierlavoie/mcp-socle/verifier-audit)
npm.cmd run deploy       # node scripts/deployer.mjs (arbre propre + --var COMMIT:<sha7>)
```
