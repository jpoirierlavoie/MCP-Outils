# pratique-civile-outils — Architecture, principes et consignes de travail

Directives de développement, architecture et règles anti-dérive pour le serveur MCP `pratique-civile-outils` (`v0.3.0`). Ce document définit les principes de conception, les contrats de données, les garde-fous d'arête HTTP, la topologie D1 en lecture seule et les obligations de synchronisation avec le plugin cadre `pratique-civile-quebecoise`. Il s'applique de façon identique à Claude (`CLAUDE.md`) et à Gemini / Antigravity (`GEMINI.md`).

---

## 1. Rôle architectural et intégration dans le cadre global

`pratique-civile-outils` est un serveur MCP public, sans état applicatif, sans écriture au fil de l'eau, sans appel HTTP sortant, sans journalisation et sans secret, déployé comme Cloudflare Worker sur `https://outils.poirierlavoie.ca/mcp` avec trois bases D1 strictement en lecture seule à la requête (`ENAM`).

Il constitue l'un des trois serveurs MCP du cadre d'assistance juridique québécois (`pratique-civile-quebecoise`, 32 outils MCP au total) :

```
             ┌────────────────────────────────────────────────────────┐
             │       pratique-civile-quebecoise (Plugin Cadre)        │
             │   5 compétences : recherche-juridique, analyse-doc,     │
             │  calendrier-proc, redaction-juridique, déontologie     │
             └──────┬───────────────────────┬──────────────────┬──────┘
                    │                       │                  │
   (10 outils `legislation_*`)    (10 outils `jurisprudence_*`) (12 outils sur 5 familles :
                    │                       │            `calcul`, `greffe`, `registre`,
                    ▼                       ▼            `adresse`, `terminologie`)
         ┌─────────────────────┐ ┌─────────────────────┐ ┌──────────────────────────┐
         │   MCP-Legislation   │ │  MCP-Jurisprudence  │ │  pratique-civile-outils  │
         │  (Worker Cloudflare │ │ (Worker Cloudflare  │ │    (Worker Cloudflare    │
         │  D1 + Vectorize +   │ │  D1 cache CanLII    │ │   public, zéro secret,   │
         │    Workers AI)      │ │  authentifié Bearer │ │  3 D1 lecture seule, Zod)│
         └──────────┬──────────┘ └──────────┬──────────┘ └──────────────────────────┘
                    │                       │
                    └───────────┬───────────┘
                                ▼ (dépendance de dev `#v0.6.2`, zéro runtime dep)
                 ┌─────────────────────────────┐
                 │    MCP-Socle-Juridique      │
                 │  Transport JSON-RPC 2.0     │
                 │  Streamable HTTP sans état  │
                 │  Auth SHA-256 temps constant│
                 │  Zéro concept juridique     │
                 └─────────────────────────────┘
```

### Intégration avec les compétences du plugin (`pratique-civile-quebecoise`)
- **`skills/calendrier-procedural`** : Consomme `calendrier_compute_deadlines` et `calendrier_list_holidays` (avec repli local `scripts/calcul_delai.py`) pour calculer de 1 à 25 échéances de procédure civile (art. 83 C.p.c., report de fin de semaine, notification technologique après 17h00 selon l'art. 111 al. 2 C.p.c., délais à rebours, périodes de non-séance de l'art. 82 al. 2 C.p.c.).
- **`skills/redaction-juridique`** : Consomme `interets_compute_1619` et `calendrier_compute_deadlines` (chiffrage et délais), `registre_search_entities`, `registre_get_entity` et `adresse_verify` (désignation des parties morales et vérification d'adresse civique en en-tête d'acte ou mise en demeure, sous réserve des gardes LPLE / RQA / Registre foncier), ainsi que `terminologie_lookup`, `terminologie_attestations` et `terminologie_scan_text` (contrôle de pureté terminologique civiliste FR/EN et prévention des calques de common law ou de droit français).
- **`skills/recherche-juridique`** : Consomme `interets_compute_1619`, `greffe_parse_court_file_number`, `palais_list`, `palais_get`, `registre_search_entities`, `registre_get_entity`, `adresse_verify`, `terminologie_lookup` et `terminologie_attestations`.
- **`skills/analyse-documentaire`** : Ne nomme AUCUN outil MCP directement (délègue à `recherche-juridique` et `calendrier-procedural`).
- **`skills/deontologie-professionnelle`** : Ne nomme AUCUN outil MCP directement (délègue le droit hors déontologie à `recherche-juridique` et les délais à `calendrier-procedural`).

### Relations inter-dépôts et séparation des responsabilités
- **Découplage de `MCP-Jurisprudence`** : Depuis `v0.2.0`, les outils `greffe_*` et `palais_*` ainsi que `src/qc/` résident ici afin de séparer l'interrogation distante de CanLII (avec secret Bearer) des outils locaux déterministes.
- **Découplage de `MCP-Socle-Juridique`** : Ce serveur étant public et sans authentification, il utilise directement `@modelcontextprotocol/server` avec `zod`.
- **Complémentarité avec `MCP-Legislation`** : `MCP-Legislation` demeure la seule source du texte intégral consolidé des lois et règlements, tandis que `pratique-civile-outils` exécute les calculs arithmétiques et fournit les attestations terminologiques précalculées en lecture seule.

---

## 2. Inventaire des 12 outils MCP (5 familles)

Tous les outils déclarent les annotations MCP :
- `openWorldHint: false` (aucun appel réseau sortant à la requête)
- `readOnlyHint: true` (aucune modification d'état)
- `idempotentHint: true` (résultats identiques pour mêmes arguments)
- `destructiveHint: false` (aucune destruction)

### A. Famille `calcul` (arithmétique déterministe pure)
1. `calendrier_list_holidays` : Jours fériés et non juridiques d'une année civile (`qc_cpc`, `qc_li`, `ca_li`).
2. `calendrier_compute_deadlines` : Chaîne de 1 à 25 délais procéduraux ou légaux (report art. 83 C.p.c., art. 111 al. 2 C.p.c. après 17h00, délais à rebours, hors séance art. 82 al. 2 C.p.c.).
3. `interets_compute_1619` : Calcul rationnel exact en `BigInt` des intérêts légaux (5 %) et de l'indemnité additionnelle (art. 1619 C.c.Q. / art. 28 L.A.F., convention Exact/Exact, 1 à 50 tranches).

### B. Famille `greffe` (tables statiques MJQ compilées)
4. `greffe_parse_court_file_number` : Analyse de nomenclature d'un numéro de dossier (`NNN-NN-NNNNNN-NNN` ou préfixe `TAL-`, `C.F.-`, etc.) sans accès au plumitif ni validation des positions 7+.
5. `palais_list` : Répertoire des 43 palais de justice et 8 points de service du Québec (relevé MJQ `2026-07-15`).
6. `palais_get` : Fiche détaillée d'un palais ou point de service par numéro de greffe ou nom.

### C. Famille `registre` (`DB_REGISTRES` — `outils-registres`)
7. `registre_search_entities` : Recherche hors ligne dans les instantanés ouverts du REQ (enrichi RBQ, OPC, RENA) et de Corporations Canada (dénomination, autres noms, sociétés à numéro `9123-4567`, NEQ, numéro fédéral).
8. `registre_get_entity` : Fiche complète par `neq` (10 chiffres), `corporation_number` ou `bn_ne` (9 chiffres). Respecte les dispenses d'adresse REQ et exclut toute personne physique dirigeante/actionnaire (`REGISTRE_ABSENCE_PERSONNES_PHYSIQUES`).

### D. Famille `adresse` (`DB_ADRESSES` — `outils-adresses`)
9. `adresse_verify` : Vérification municipale et normalisation au Référentiel québécois des adresses (RQA, ~5M d'adresses) et Odonymes et renvois (MRNF). Tolérance aux fautes de frappe (squelette consonantique + trigrammes FTS5 sur odonymes), distinction des unités confirmées vs non subdivisées, plage civique de rue, lots cadastraux / matricules indicatifs et district judiciaire probable via `lieux.ts`.

### E. Famille `terminologie` (`DB_TERMINOLOGIE` — `outils-terminologie`)
10. `terminologie_lookup` : Recherche bilingue FR/EN hiérarchisée (rang 1 : glossaire curé `src/data/glossaire_bijuridique_qc.json` ; rang 2 : concordancier législatif et doublets bijuridiques ; rang 3 : TERMIUM Plus® ; rang 4 : OQLF domaines juridiques).
11. `terminologie_attestations` : Comptage exact par loi et extraits bilingues FR/EN côte à côte dans le concordancier législatif aligné (97 lois QC/CA).
12. `terminologie_scan_text` : Détection en lecture seule des francismes de France, anglicismes / faux amis de common law et archaïsmes d'avant 2016 sur un extrait de projet d'acte (≤ 32 000 car.), sans réécriture.

---

## 3. Contrat de données et format de sortie

`pratique-civile-outils` adopte une **double sortie standardisée** obligatoire sur les 12 outils :

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
2. **Tableau `gardes` obligatoire** (`src/core/gardes.ts`), incluant les nouvelles gardes v0.3.0 (`REGISTRE_ABSENCE_PERSONNES_PHYSIQUES`, `REGISTRE_FRAICHEUR_ET_OPPOSABILITE_LPLE`, `REGISTRE_ABSENCE_NON_PROBANTE_ANCILLAIRES`, `ADRESSE_EXISTENCE_CIVIQUE_NON_DOMICILE`, `ADRESSE_LOT_ET_MATRICULE_SANS_VALEUR_LEGALE`, `ADRESSE_CORRESPONDANCE_APPROXIMATIVE`, `TERMINOLOGIE_AIDE_REDACTION_NON_NORMATIVE`, `LICENCE_DONNEES_OUVERTES_NC_SA`).
3. **Constantes textuelles figées (`src/qc/format.ts`)** : `SANS_PLUMITIF`, `GARDE_PALAIS`, `GARDE_SANS_ADRESSE`, `GARDE_DOSSIER` — protégées par tests unitaires, ne jamais les modifier.
4. **Gestion applicative des erreurs** : Toute erreur de validation Zod (`z.strictObject`), paramètre invalide ou absence de binding D1 dans `env` renvoie `{ content: [{ type: "text", text: "..." }], isError: true }` — jamais HTTP 500 ni `-32602` fatal.

---

## 4. Points d'accès HTTP, topologie D1 et pipelines hors ligne

1. **Contrôles d'arête (`src/index.ts`)** :
   - `GET` / `HEAD /` : Page HTML bilingue dérivée de `listToolDescriptors()` (CSP stricte, zéro JSON à la racine, `405` sur autres méthodes).
   - `GET` / `HEAD /healthz` : Statut JSON (`version: "0.3.0"`, `databases: { terminologie, registres, adresses }`, `laf_table_last_quarter`, liste des 12 outils).
   - `POST` / `OPTIONS /mcp` : Protection anti-rebouclage DNS (`Host`), CORS `204`, plafond `MAX_MCP_BODY_BYTES = 65_536` (`413`), rejet des requêtes par lots ou `id` non scalaires (`400` / `-32600`), désencapsulation SSE → JSON, limiteur `RATE_LIMITER` (60 req/min/IP → `429`).
2. **Topologie D1 à 3 bases isolées (`ENAM`) et bascule bleu-vert (`pipeline/`)** :
   - `DB_TERMINOLOGIE` (`outils-terminologie`), `DB_REGISTRES` (`outils-registres`), `DB_ADRESSES` (`outils-adresses`).
   - Les pipelines Python (`pipeline/terminologie/`, `pipeline/registres/`, `pipeline/adresses/`) assemblent d'abord une base SQLite locale validée, exportent des lots SQL sans `BEGIN`/`COMMIT` explicites, construisent les index et `FTS5` par tranches en fin de chargement, et supportent `--blue-green --swap` pour basculer sans coupure.
   - Pour `DB_ADRESSES`, `FTS5` est créé uniquement sur `odonymes` (~85k lignes), jamais sur `adresses_civiques` (~5M lignes).
   - Pour le REQ, aucune tentative de contournement du défi Cloudflare du portail : `ingest_req.py` lit `pipeline/sources/req.zip` téléchargé manuellement.

---

## 5. Évaluation d'impact obligatoire (4 axes locaux + inter-dépôts)

| # | Axe d'impact | Éléments à inspecter et maintenir synchronisés | Règle / Garde associée |
|---|---|---|---|
| 1 | **Outils MCP, calculs, D1 et schémas** | `src/core/`, `src/mcp/`, `src/qc/`, `src/data/`, `pipeline/`, `src/index.ts` | Double sortie obligatoire + `gardes`, `openWorldHint: false`, `readOnlyHint: true`, arithmétique `BigInt`, constantes `src/qc/format.ts`, zéro source sous droit d'auteur fermée |
| 2 | **`README.md` et gouvernance du dépôt** | `README.md`, `SECURITY.md`, `LICENSE` (`CC-BY-NC-SA-4.0`), `package.json`, `wrangler.jsonc`, `CLAUDE.md`, `GEMINI.md` | Tout changement d'outil, de base D1, de source de données ouvertes, de politique zéro-log, de version ou de déploiement |
| 3 | **Page publique HTML (`GET /`) et `/healthz`** | `src/site.ts`, `src/site.i18n.ts`, `src/index.ts`, `test/site.test.ts` | Parité bilingue `OUTILS_EN` (12 outils, 5 familles), variables CSS clair/sombre, liste blanche `ALLOWED_URL_PREFIXES` |
| 4 | **Impacts inter-dépôts (`Cross-repository`)** | **`pratique-civile-quebecoise`** (`verifier.py`, `verifier_tout.py`, `scripts/regenerer_cache_mcp.py --apply`, `skills/redaction-juridique`, `skills/recherche-juridique`, `README.md`, `CLAUDE.md`, `GEMINI.md`, manifestes) ; **`MCP-Legislation` & `MCP-Jurisprudence`** (lecture seule stricte, cohérence visuelle HTML/CSS) | Maintenir les fins de ligne LF (`\n`), `< 3000` mots par `SKILL.md`, aucun nom d'outil dans `analyse-documentaire` / `deontologie-professionnelle` |

---

## 6. Invariants critiques et règles anti-dérive

1. **Invariant 1 : Bases D1 strictement en lecture seule à la requête, zéro appel HTTP sortant et journalisation zéro**
   - Bases D1 (`DB_TERMINOLOGIE`, `DB_REGISTRES`, `DB_ADRESSES`) interrogées uniquement par `SELECT` (`PRAGMA query_only = ON` dans le harnais de tests), zéro écriture au fil de l'eau, zéro KV/R2, zéro appel HTTP sortant.
   - Dans `wrangler.jsonc` : `observability.enabled = false`, `logs.enabled = false`, `logs.invocation_logs = false`, `logpush = false`.
   - Ne jamais journaliser les adresses IP, corps de requêtes, noms de parties, adresses civiques ou extraits d'actes.
2. **Invariant 2 : Aucune extrapolation des taux de l'art. 28 L.A.F.** (`src/data/laf_art28_rates.json`, sauf `rate_overrides` explicite).
3. **Invariant 3 : Arithmétique rationnelle exacte en `BigInt`** (`EXACT_EXACT_COMMON_DENOMINATOR = 1_335_900_000n`).
4. **Invariant 4 : Intégrité verbatim des gardes MJQ** (`src/qc/format.ts`) et **exclusion des sources terminologiques protégées** (jamais Crépeau/McGill, Juriterm ni Juridictionnaire).
5. **Invariant 5 : Nomenclature pure sans plumitif** (`greffe_parse_court_file_number`, positions 1 à 6 uniquement), **instantanés corporatifs sans dirigeants personnes physiques** (`registre_*`) et **existence civique municipale distincte du domicile et du Registre foncier** (`adresse_verify`).
6. **Invariant 6 : La page publique `/` dérive du code** (`listToolDescriptors()`, identité visuelle partagée avec `MCP-Legislation` et `MCP-Jurisprudence`).
7. **Invariant 7 : Synchronisation complète des surfaces locales et de `pratique-civile-quebecoise`**.
8. **Invariant 8 : Limitation de débit d'arête (60 req/min/IP) et taille maximale (64 KiB)**.

---

## 7. Commandes de développement et vérification (PowerShell Windows)

Employer `npm.cmd`, `npx.cmd` et `$env:PYTHONUTF8 = "1"` :

```powershell
npm.cmd run typecheck    # npx.cmd tsc --noEmit
npm.cmd run lint         # npx.cmd biome check .
npm.cmd test             # npx.cmd vitest run (240 tests hors réseau)
npm.cmd run build        # npx.cmd wrangler deploy --dry-run --outdir dist
```
