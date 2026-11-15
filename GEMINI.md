# pratique-civile-outils — Architecture, principes et consignes de travail

Directives de développement, architecture et règles anti-dérive pour le serveur MCP `pratique-civile-outils`. Ce document définit les principes de conception, les contrats de données, les garde-fous d'arête HTTP, et les obligations de synchronisation avec le plugin cadre `pratique-civile-quebecoise`. Il s'applique de façon identique à Claude et à Gemini / Antigravity.

---

## 1. Rôle architectural et intégration dans le cadre global

`pratique-civile-outils` est un serveur MCP public, sans état, sans base de données, déterministe et sans secret, déployé comme Cloudflare Worker sur `https://outils.poirierlavoie.ca/mcp`.

Il constitue l'un des trois serveurs MCP du cadre d'assistance juridique québécois (`pratique-civile-quebecoise`) :

```
             ┌────────────────────────────────────────────────────────┐
             │       pratique-civile-quebecoise (Plugin Cadre)        │
             │   5 compétences : recherche-juridique, analyse-doc,     │
             │  calendrier-proc, redaction-juridique, déontologie     │
             └──────┬───────────────────────┬──────────────────┬──────┘
                    │                       │                  │
   (10 outils `legislation_*`)    (10 outils `jurisprudence_*`) (6 outils `calendrier_*`,
                    │                       │           `interets_*`, `greffe_*`, `palais_*`)
                    ▼                       ▼                  ▼
         ┌─────────────────────┐ ┌─────────────────────┐ ┌──────────────────────────┐
         │   MCP-Legislation   │ │  MCP-Jurisprudence  │ │  pratique-civile-outils  │
         │  (Worker Cloudflare │ │ (Worker Cloudflare  │ │    (Worker Cloudflare    │
         │  D1 + Vectorize +   │ │  D1 cache CanLII    │ │    public, sans état,    │
         │    Workers AI)      │ │  authentifié Bearer │ │    zéro secret, Zod)     │
         └──────────┬──────────┘ └──────────┬──────────┘ └──────────────────────────┘
                    │                       │
                    └───────────┬───────────┘
                                ▼ (dépendance de dev `#v0.6.0`, zéro runtime dep)
                 ┌─────────────────────────────┐
                 │    MCP-Socle-Juridique      │
                 │  Transport JSON-RPC 2.0     │
                 │  Streamable HTTP sans état  │
                 │  Auth SHA-256 temps constant│
                 │  Zéro concept juridique     │
                 └─────────────────────────────┘
```

### Intégration avec les compétences du plugin (`pratique-civile-quebecoise`)
- **`skills/calendrier-procedural`** : Consomme directement `calendrier_compute_deadlines` et `calendrier_list_holidays` (avec repli local `scripts/calcul_delai.py`) pour calculer de 1 à 25 échéances de procédure civile (art. 83 C.p.c., report de fin de semaine, notification technologique après 17h00 selon l'art. 111 al. 2 C.p.c., délais à rebours, périodes de non-séance de l'art. 82 al. 2 C.p.c.). Exprime les besoins d'aptitude `CALCUL`, `INSCRIPTION`, `TEXTE`.
- **`skills/redaction-juridique`** : Consomme directement `interets_compute_1619` pour chiffrer avec exactitude les conclusions pécuniaires (intérêts légaux à 5 % et indemnité additionnelle de l'art. 1619 C.c.Q. selon l'art. 28 L.A.F.) et `calendrier_compute_deadlines` pour les délais procéduraux dans les actes de procédure. Exprime les besoins `CALCUL` et `GREFFE`.
- **`skills/recherche-juridique`** : Consomme `interets_compute_1619`, `greffe_parse_court_file_number`, `palais_list` et `palais_get` (besoins `TEXTE`, `CALCUL`, `GREFFE`, `INSCRIPTION`).
- **`skills/analyse-documentaire`** : Ne nomme AUCUN outil MCP directement. Exprime des besoins d'aptitude abstraits `GREFFE`, `TEXTE` et `INSCRIPTION` en déléguant la recherche juridique et la vérification des pièces et citations à `recherche-juridique` et le calcul des échéances à `calendrier-procedural`.
- **`skills/deontologie-professionnelle`** : Ne nomme AUCUN outil MCP directement ; délègue le droit hors déontologie à `recherche-juridique` et les délais à `calendrier-procedural`.

### Relations inter-dépôts et séparation des responsabilités
- **Découplage de `MCP-Jurisprudence`** : Le 2026-11-14 (v0.2.0), les outils `greffe_*` et `palais_*` ainsi que le répertoire `src/qc/` ont été transférés depuis `MCP-Jurisprudence` vers ce dépôt afin de séparer nettement l'interrogation distante de CanLII (avec secret Bearer) des outils québécois locaux déterministes.
- **Découplage de `MCP-Socle-Juridique`** : Ce serveur étant public et sans authentification, il n'utilise pas `@poirierlavoie/socle-juridique` mais directement `@modelcontextprotocol/server` avec `zod`.
- **Complémentarité avec `MCP-Legislation`** : `MCP-Legislation` fournit le texte verbatim des dispositions législatives (art. 83 C.p.c., art. 1619 C.c.Q.), tandis que `pratique-civile-outils` en exécute le calcul arithmétique rigoureux.

---

## 2. Inventaire des 6 outils MCP (2 familles)

Tous les outils déclarent les annotations MCP :
- `openWorldHint: false` (aucun appel réseau sortant, données entièrement locales)
- `readOnlyHint: true` (aucune modification d'état)
- `idempotentHint: true` (résultats identiques pour mêmes arguments)
- `destructiveHint: false` (aucune destruction)

### A. Famille Calcul (arithmétique déterministe)
1. `calendrier_list_holidays` : Liste les jours fériés et chômés pour une année civile selon trois régimes (`qc_cpc` pour le Code de procédure civile, `qc_li` pour la Loi d'interprétation du Québec, `ca_li` pour la Loi d'interprétation fédérale).
2. `calendrier_compute_deadlines` : Calcule une chaîne de 1 à 25 délais procéduraux ou légaux. Prend en compte :
   - Point d'ancrage (`anchor_date`).
   - Notification technologique après 17h00 (décalage au lendemain ouvrable suivant, art. 111 al. 2 C.p.c.).
   - Report de fin de semaine et de jours fériés (art. 83 C.p.c.).
   - Délais à rebours (`direction: "backward"`) avant une audience.
   - Périodes de non-séance des tribunaux (art. 82 al. 2 C.p.c.).
   - Étapes enchaînées avec `depends_on_index`.
3. `interets_compute_1619` : Calcul arithmétique exact en `BigInt` des intérêts légaux au taux de 5 % l'an (art. 1618 C.c.Q.) et de l'indemnité additionnelle (art. 1619 C.c.Q.) selon la table des taux trimestriels de l'art. 28 L.A.F. (`src/data/laf_art28_rates.json`). Gère de 1 à 50 tranches de capital, applique la convention Exact/Exact (365/366 jours), exclut la date initiale et inclut la date finale.

### B. Famille Greffe (tables statiques MJQ)
4. `greffe_parse_court_file_number` : Analyse la nomenclature d'un numéro de dossier de cour (`NNN-NN-NNNNNN-NNN` ou préfixes administratifs/fédéraux `TAL-`, `C.F.-`, etc.) pour identifier le greffe, le district judiciaire, et le tribunal. Pure nomenclature : ne valide jamais les chiffres de séquence ou de contrôle (positions 7+) et n'atteste aucunement de l'existence d'une instance.
5. `palais_list` : Répertoire officiel des 43 palais de justice et 8 points de service du Québec issu du relevé du Ministère de la Justice (MJQ) au 2026-07-15.
6. `palais_get` : Fiche détaillée d'un palais ou point de service par numéro de greffe (3 chiffres) ou nom de palais. Une absence de coordonnées publiées signifie non répertorié au relevé officiel, jamais inexistant.

---

## 3. Contrat de données et format de sortie

Contrairement à `MCP-Jurisprudence` (qui s'interdit `structuredContent` pour contraindre la lecture textuelle), `pratique-civile-outils` adopte une **double sortie standardisée** :

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
    // ...
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
1. **`structuredContent` obligatoire** : Permet aux outils automatisés et aux compétences d'extraire les données numériques et dates sans parsing textuel.
2. **`content[0].text` obligatoire** : Présente une synthèse humaine en français immédiatement exploitable par le juriste.
3. **Tableau `gardes` obligatoire** : Tout avertissement légal ou statutaire (`GardeCode`) doit obligatoirement être joint dans `structuredContent.gardes`.
4. **Constantes textuelles de garde figées (`src/qc/format.ts`)** :
   - `SANS_PLUMITIF`
   - `GARDE_PALAIS`
   - `GARDE_SANS_ADRESSE`
   - `GARDE_DOSSIER`
   Ces textes sont protégés par tests unitaires et ne doivent jamais être affaiblis.
5. **Gestion applicative des erreurs** : Toute erreur de validation ou paramètre invalide est renvoyée sous la forme `{ content: [{ type: "text", text: "..." }], isError: true }`. Ne JAMAIS renvoyer d'erreur HTTP 500 ni de code d'erreur JSON-RPC fatal `-32602`.

---

## 4. Points d'accès HTTP et garde-fous d'arête (`src/index.ts`)

Le routage d'entrée implémente des contrôles d'arête stricts :

1. **`GET` / `HEAD /` (Page d'accueil)** : Rendu HTML bilingue dynamique (FR/EN) dérivé directement de `listToolDescriptors()` via `pagePubliqueHtml()`. Renvoie HTTP 200 (`Content-Type: text/html; charset=utf-8`, CSP stricte, `Cache-Control: public, max-age=600`). Ne renvoie **jamais de JSON à la racine**. Toute autre méthode HTTP sur `/` reçoit HTTP 405 (`Allow: GET, HEAD`).
2. **`GET` / `HEAD /healthz` (Bilan de santé)** : Contrôle de santé JSON (`status: "ok"`, nom du service, version, mode sans état, logging désactivé, dernier trimestre L.A.F., liste des outils).
3. **`POST` / `OPTIONS /mcp` (Point de terminaison MCP)** :
   - **Protection anti-rebouclage DNS (DNS-rebinding)** : Vérification de l'en-tête `Host` via `extractHostname` contre `ALLOWED_HOSTNAMES` et `localhostAllowedHostnames()`. Si rejeté : HTTP `403` `{ error: "Forbidden host" }`.
   - **Prévérification CORS (`OPTIONS`)** : Réponse HTTP `204` immédiate avec en-têtes `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: POST, OPTIONS`, et en-têtes autorisés.
   - **Plafond de taille du corps (`MAX_MCP_BODY_BYTES = 65_536`)** : Tout corps dépassant 64 KiB (vérifié sur `Content-Length` et sur la mémoire tampon) est rejeté en HTTP `413` `{ error: "Payload Too Large (max 64 KiB)" }`.
   - **Rejet des requêtes par lots ou identifiants complexes** : Tout tableau JSON-RPC (requêtes par lots) ou objet dont `id` est un objet/tableau est rejeté en HTTP `400` avec l'erreur JSON-RPC standard `-32600` (`Invalid Request`).
   - **Désencapsulation SSE vers JSON** : Lorsque l'en-tête `Accept` n'inclut pas `text/event-stream`, la réponse interne SSE du SDK MCP est automatiquement désencapsulée pour extraire la ligne `data: ` et renvoyer directement une réponse `application/json`.
4. **Autres chemins** : Renvoient HTTP `404` avec `{ error: "Not Found", mcp_endpoint: "/mcp" }`.
5. **Limiteur de débit d'arête (`RATE_LIMITER`)** : Binding Cloudflare limitant à 60 requêtes par minute par adresse IP (`CF-Connecting-IP`). En cas de dépassement : HTTP `429` avec `Retry-After: 60`.

---

## 5. Évaluation d'impact obligatoire (intra-dépôt, README.md, Page publique HTML et inter-dépôts)

**Aucune modification de ce dépôt n'est terminée tant que ses répercussions n'ont pas été évaluées et explicitement rapportées sur les quatre axes ci-dessous** (« non touché » est une réponse valide uniquement si elle est vérifiée et énoncée) :

| # | Axe d'impact | Éléments à inspecter et maintenir synchronisés | Règle / Garde associée |
|---|---|---|---|
| 1 | **Outils MCP, calculs et schémas** | `src/core/`, `src/mcp/`, `src/qc/`, `src/data/laf_art28_rates.json`, `src/index.ts` | Double sortie obligatoire (`content[0].text` + `structuredContent` avec `provenance` et `gardes`), `openWorldHint: false`, arithmétique `BigInt`, constantes `src/qc/format.ts` |
| 2 | **`README.md` et gouvernance du dépôt** | `README.md`, `SECURITY.md`, `LICENSE` (`CC-BY-NC-SA-4.0`), `package.json`, `wrangler.jsonc`, `CLAUDE.md`, `GEMINI.md` | Tout changement d'outil, de source de données (L.A.F. / MJQ), de politique de confidentialité/zéro-log, de version ou de déploiement |
| 3 | **Page publique HTML (`GET /`) et `/healthz`** | `src/site.ts`, `src/site.i18n.ts`, `src/index.ts`, `test/site.test.ts` | La table d'outils, schémas, gardes et relevés dérivent de `listToolDescriptors()` et du code ; maintenir la parité bilingue `OUTILS_EN`, les variables CSS clair/sombre, la liste blanche `ALLOWED_URL_PREFIXES` et l'exactitude des sections `#acces` et pied de page |
| 4 | **Impacts inter-dépôts (`Cross-repository`)** | **`pratique-civile-quebecoise`** (`.mcp.json`, `mcp_config.json`, `gemini-extension.json`, `.claude-plugin/*`, `plugin.json`, `skills/calendrier-procedural` et son repli `scripts/calcul_delai.py`, `skills/redaction-juridique`, `skills/recherche-juridique`, scripts `regenerer_cache_mcp.py --apply`, `synchroniser_plugin_gemini.py --apply`, `verifier.py`, `verifier_tout.py`) ; **`MCP-Legislation` & `MCP-Jurisprudence`** (cohérence visuelle HTML/CSS `GET /`, frontière de responsabilité hors ligne vs sources primaires) | Signaler et répercuter toute évolution d'outil, de schéma, d'URL, de licence ou d'accès vers les dépôts dépendants |

---

## 6. Surfaces de synchronisation du plugin cadre (`pratique-civile-quebecoise`)

Toute modification apportée aux outils, schémas, noms ou comportements de ce dépôt impose la mise à jour synchronisée des surfaces du plugin cadre `pratique-civile-quebecoise` :
1. **Manifestes clients** :
   - `.mcp.json`
   - `mcp_config.json`
   - `gemini-extension.json`
   - `.claude-plugin/plugin.json`
   - `plugin.json`
2. **Définitions manuelles des compétences (`skills/`)** :
   - `skills/calendrier-procedural` (nomme `calendrier_compute_deadlines`, `calendrier_list_holidays`)
   - `skills/redaction-juridique` (nomme `calendrier_compute_deadlines`, `interets_compute_1619`)
   - `skills/recherche-juridique` (nomme `interets_compute_1619`, `greffe_parse_court_file_number`, `palais_list`, `palais_get`)
3. **Scripts de synchronisation et validation** :
   - `scripts/regenerer_cache_mcp.py --apply`
   - `scripts/synchroniser_plugin_gemini.py --apply`
   - `python verifier.py`
   - `python verifier_tout.py --mode mock` / `python verifier_tout.py --mode live`

---

## 7. Invariants critiques et règles anti-dérive

1. **Invariant 1 : Absence totale d'état et journalisation zéro**
   - Aucune base de données persistante (zéro D1, zéro KV, zéro R2).
   - Dans `wrangler.jsonc` : `observability.enabled = false`, `logs.enabled = false`, `logs.invocation_logs = false`.
   - Ne jamais consigner ni journaliser les adresses IP (`CF-Connecting-IP`), ni les corps de requêtes, ni les paramètres de calcul.
2. **Invariant 2 : Aucune extrapolation des taux de l'art. 28 L.A.F.**
   - Le calcul d'intérêts s'arrête strictement à la fin du dernier trimestre vérifié consigné dans `src/data/laf_art28_rates.json` (actuellement `2026-Q4`), sauf si l'appelant fournit explicitement `rate_overrides`.
   - Ne jamais extrapoler ni deviner un taux d'indemnité additionnelle futur.
3. **Invariant 3 : Arithmétique rationnelle exacte en `BigInt`**
   - Tout calcul d'intérêt et d'indemnité additionnelle est exécuté en arithmétique rationnelle entière (`BigInt`) avec le dénominateur commun exact `EXACT_EXACT_COMMON_DENOMINATOR = 1_335_900_000n` et la convention Exact/Exact.
   - Zéro arrondi intermédiaire en nombres à virgule flottante (`Number`).
4. **Invariant 4 : Intégrité verbatim des gardes MJQ**
   - Ne jamais modifier, adoucir ou supprimer les constantes de garde de `src/qc/format.ts`.
5. **Invariant 5 : Nomenclature pure sans plumitif**
   - `greffe_parse_court_file_number` analyse uniquement les positions 1 à 6 (nature, juridiction, greffe). Les positions 7 et suivantes (numéro séquentiel et clé de contrôle) ne doivent jamais être validées. L'outil analyse la nomenclature et ne vérifie aucun plumitif.
6. **Invariant 6 : La page publique `/` dérive du code**
   - La page d'accueil bilingue à `GET /` dérive dynamiquement sa table d'outils et de schémas de `listToolDescriptors()`.
   - Elle partage la même identité visuelle (police Georgia, variables CSS `--f`, `--m`, `--b`, `--a`, `--bg`, `--card`) que `MCP-Legislation` et `MCP-Jurisprudence`.
7. **Invariant 7 : Règle de propagation sur les 4 surfaces locales + inter-dépôts**
   Toute modification exige la mise à jour synchronisée et vérifiée de chaque surface touchée (voir section 5) :
   1. Handler et schéma d'entrée/sortie Zod dans `src/core/`, `src/qc/` et `src/mcp/` (avec `gardes`).
   2. `README.md`, `SECURITY.md`, `LICENSE` et `package.json`.
   3. Page publique HTML (`GET /` via `src/site.ts` et `src/site.i18n.ts`).
   4. Dépôt cadre `pratique-civile-quebecoise` (manifestes, compétences et scripts de synchronisation) et cohérence avec `MCP-Legislation` / `MCP-Jurisprudence`.
8. **Invariant 8 : Limitation de débit d'arête et taille maximale**
   - Le binding Cloudflare `RATE_LIMITER` impose 60 requêtes par minute par IP cliente.
   - Taille maximale du corps MCP : 64 KiB (`MAX_MCP_BODY_BYTES = 65_536`).

---

## 8. Commandes de développement et vérification (PowerShell Windows)

Employer `npm.cmd` et `npx.cmd` :

```powershell
npm.cmd run typecheck    # npx.cmd tsc --noEmit
npm.cmd run lint         # npx.cmd biome check .
npm.cmd test             # npx.cmd vitest run (223 tests passants)
npm.cmd run build        # npx.cmd wrangler deploy --dry-run --outdir dist
```

## 9. Surveillance et maintenance automatisée (CI/CD)

- `.github/workflows/check-laf-rates.yml` : Tâche cron trimestrielle (`15 13 15 3,6,9,12 *`) vérifiant que le trimestre à venir est couvert dans `src/data/laf_art28_rates.json`.
- `.github/workflows/deploy.yml` : Déploiement automatisé sur push vers `main` après validation des tests et des contrôles préalables en lecture seule.
