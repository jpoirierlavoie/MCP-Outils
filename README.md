# MCP-Outils

Serveur MCP (**Model Context Protocol**) en lecture seule et sans journalisation (`mcp-outils`), conçu pour la pratique du litige civil et commercial québécois et les compétences du greffon [`droit-civil-quebecois`](https://github.com/jpoirierlavoie/droit-civil-quebecois). Accès réservé gratuitement aux membres actifs en règle du Barreau du Québec via [`acces.poirierlavoie.ca`](https://acces.poirierlavoie.ca) (**aucune clé API CanLII requise**).

> **In English:** Read-only, zero-logging MCP server for Québec civil and commercial litigation (`outils.poirierlavoie.ca`). Free access reserved for active members in good standing of the Barreau du Québec via [`acces.poirierlavoie.ca`](https://acces.poirierlavoie.ca) (**no CanLII API key required**). Provides deterministic C.C.P. holiday/deadline, art. 1619 C.C.Q. interest, and TAL rent-fixing calculators alongside offline lookups for court file numbers, courthouses, corporate registries and LEI hierarchies (REQ, Corporations Canada, GLEIF), Québec civic addresses and lots (RQA), bijural legal terminology, Bank of Canada FX/policy rates, StatCan CPI, and CMHC rents. Queries and inputs are never logged.

Points d'accès : `https://outils.poirierlavoie.ca/mcp/oauth` (OAuth 2.1 PKCE par navigateur, défaut du greffon) et `https://outils.poirierlavoie.ca/mcp` (jeton `Bearer` ou `?key=` sans navigateur)  
Page publique et schémas : <https://outils.poirierlavoie.ca/> (`/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/.well-known/oauth-protected-resource/mcp/oauth`, `/mcp/server-card`, `/.well-known/mcp/server-card.json`)

## Outils exposés (v3.0.0 — 15 outils sur 6 familles)

| Famille | Outil | Rôle | Sources et conventions |
|---|---|---|---|
| `calcul` | `calendrier_holidays` | Liste les jours fériés et non juridiques d'une année civile (`qc_cpc`, `qc_prescription`, `qc_li`, `ca_li` avec `province` optionnel). | Art. 82 al. 1 C.p.c., art. 2879 al. 2 C.c.Q., art. 61 par. 23° & art. 52 L.I. (RLRQ, c. I-16), art. 35(1) L.I. (L.R.C. 1985, c. I-21). |
| `calcul` | `calendrier_deadlines` | Calculateur exact de 1 à 25 délais procéduraux ou légaux (prospectifs ou à rebours, chaînés au besoin via `depends_on_index`) sous `qc_cpc`, `qc_prescription`, `qc_li` et `ca_li`. | Art. 82, 83, 107 et 111 al. 2 C.p.c., art. 2879 al. 2 C.c.Q., art. 52 L.I. (`rollover_saturday=false` par défaut sous `qc_li`), `province='QC'` sous `ca_li`. |
| `calcul` | `interets_1619` | Calcul au cent près des intérêts simples et de l'indemnité additionnelle (1 à 50 tranches, arithmétique exacte `BigInt` en convention Exact/Exact 365/366, modes `legal_plus_1619`, `legal_only`, `contractual` et `prime_plus_margin`). | Art. 1618–1620 C.c.Q., art. 28 L.A.F. (Revenu Québec `2001-Q1` à `2026-Q4`), Banque du Canada `V80691311` (`boc_prime_rates.json`), art. 3 *Loi sur l'intérêt*. Aucune extrapolation au-delà de la dernière période vérifiée. |
| `greffe` | `greffe_parse_number` | Décompose un numéro de dossier de cour du Québec (`NNN-NN-NNNNNN-NNN` ou préfixe `TAL-`, `C.F.-`, etc.) : greffe, district, juridiction et adresse connue. | Tables locales compilées du ministère de la Justice du Québec (`2026-11-17` / `2026-07-22`). Aucun appel sortant, aucun accès au plumitif. |
| `greffe` | `palais_list` | Répertorie les 44 palais de justice et 9 points de service du Québec, filtrables par district, type ou texte libre. | Relevé du ministère de la Justice du Québec (`2026-11-17`). Employer `palais_get` pour les coordonnées ; vérifier à la source avant signification ou dépôt. |
| `greffe` | `palais_get` | Fiche complète d'un lieu de justice (adresse municipale, postale s'il y a lieu, heures d'ouverture, télécopieur, téléphones et courriels par chambre/service, greffes et localités itinérantes), par `greffe_number` ou `palais`. | Relevé du ministère de la Justice du Québec (`2026-11-17` / `2026-07-22`). Une adresse absente signifie inconnue, jamais inexistante. |
| `registre` | `registre_search` | Recherche hors ligne d'entreprises québécoises, fédérales et canadiennes titulaires d'un LEI par nom, autre nom utilisé, société à numéro, NEQ, numéro fédéral ou LEI (20 car.), avec indicateur `has_lei`. | `DB_REGISTRES` en lecture seule : REQ (`CC BY-NC-SA 4.0`), RBQ, OPC, AMP — RENA (`CC BY 4.0`), Corporations Canada (`OGL-Canada`), GLEIF Golden Copy (`CC0 1.0`). Sans dirigeants personnes physiques (L.P.L.E. / L.C.S.A.). |
| `registre` | `registre_get_entity` | Fiche détaillée d'une entité par NEQ (10 chiffres), numéro de société fédérale, NE/BN (9 chiffres) ou LEI (20 car.) : REQ, RBQ/OPC/RENA, Corporations Canada, hiérarchie comptable GLEIF Level 2 et liens directs vers les portails officiels (REQ, Corporations Canada, PCI/ISC, GLEIF). | Instantanés locaux en lecture seule sans valeur de certificat ni d'attestation officielle ; la consolidation comptable GLEIF n'établit pas le contrôle juridique (`REGISTRE_GLEIF_DECLARATIF_CONSOLIDATION`). |
| `adresse` | `adresse_verify` | Vérification de l'existence municipale et normalisation d'une adresse québécoise (tolérance aux fautes de frappe, anciens odonymes, code postal, lots/matricules indicatifs, district judiciaire probable). | `DB_ADRESSES` en lecture seule : Référentiel québécois des adresses (RQA) et Odonymes et renvois (MRNF, `CC BY 4.0`). N'établit ni le domicile d'une partie ni un titre foncier. |
| `terminologie` | `terminologie_lookup` | Recherche bilingue FR/EN dans 4 sources hiérarchisées avec repérage des calques et faux amis de common law ou de droit français (`mortgage` vs `hypothec`, `solidary` vs `joint and several`). | `DB_TERMINOLOGIE` en lecture seule : glossaire curé QC (rang 1), concordancier législatif (rang 2), TERMIUM Plus® (`OGL-Canada`, rang 3), OQLF (`CC BY-NC-SA 4.0`, rang 4). |
| `terminologie` | `termino_attestations` | Comptage exact et extraits bilingues alignés FR/EN dans le corpus législatif consolidé du Québec et du Canada (art. 8.1–8.2 L.I.). | Concordancier bilingue dérivé de LégisQuébec et Justice Canada (97 lois alignées). Ne remplace pas la lecture intégrale via `MCP-Legislation`. |
| `terminologie` | `terminologie_scan` | Contrôle en lecture seule d'un extrait de projet d'acte (jusqu'à 32 000 car., FR/EN) pour signaler francismes de France, anglicismes / faux amis de common law et archaïsmes d'avant 2016. | Signale positions, motifs, remplacements civilistes suggérés et fondements légaux sans jamais réécrire le texte. |
| `economie` | `taux_boc_rates` | Consultation hors ligne des taux de change face au CAD (2001–2026+) et des taux directeur (`V39079`), d'escompte (`V122530`) et préférentiel (`V80691311`), avec conversion exacte `BigInt` (*Loi sur la monnaie*, art. 12). | `DB_ECONOMIE` en lecture seule : Banque du Canada (`FX_RATES_DAILY` 2017+ à 16 h 30 HE ; `LEGACY_NOON_RATES` 2007–2017 à midi HE) et Statistique Canada `10-10-0008-01` (2001–2007, `OGL-Canada`). |
| `economie` | `indice_ipc` | Consultation hors ligne des indices IPC StatCan (mensuel `18-10-0004-01`, annuel `18-10-0005-01`) pour Québec, Montréal, RMR de Québec et Canada, variation annuelle (%) et indexation contractuelle `BigInt` (plancher/plafond, contrôle d'année de base). | `DB_ECONOMIE` en lecture seule : Statistique Canada (`OGL-Canada`), bases `2002=100` et `1992=100` avec refus sécuritaire de division entre bases distinctes (`IPC_BASE_REINDEXATION_ATTENTION`). |
| `economie` | `loyer_tal` | Barèmes officiels du TAL (2015–2027), calculateur déterministe post-1er janv. 2026 en `BigInt` (base IPC, part RPA, taxes/assurances asymétriques, travaux 5 % et arrondi art. 15.1) et loyers moyens du marché SCHL (`34-10-0133-01`). | *Règlement sur les critères de fixation de loyer* (`RLRQ, c. T-15.01, r. 2` ; Décret 1455-2025) dans `tal_criteres.json` + `DB_ECONOMIE` (`34-10-0133-01`, `OGL-Canada`). Gardes `< 2026-01-01`, art. 1955 C.c.Q. et appréciation du TAL. |

Chaque réponse réussie retourne un résumé lisible en français (`content[0].text`), des données structurées validées (`structuredContent`), la provenance des sources et des mises en garde (`gardes`) rappelant les limites documentaires à vérifier (tous les outils sont hors ligne et en lecture seule : `openWorldHint: false`, `readOnlyHint: true`).

## Confidentialité, gouvernance d'accès et politique de journalisation zéro

L'accès est réservé aux membres du Barreau du Québec sans journalisation ni clé CanLII requise :

- **Accès approuvé sans clé CanLII :** déposez une demande unique sur [`acces.poirierlavoie.ca/demande`](https://acces.poirierlavoie.ca/demande) (clé API CanLII facultative sur `/demande`, ajoutable/gérable ensuite dans `/moi`, et exigée **uniquement** pour `juris` — jamais pour `outils` ni `lois`), puis autorisez le connecteur dans votre navigateur via OAuth 2.1 (`PKCE S256`) ou créez un jeton personnel dans `/moi` (portées acceptées : `tous`, `outils` et rétrocompatible `les_deux`). Seuls les compteurs quotidiens sans contenu (`3 000` appels locaux/jour à l'état `actif`, `300` à l'état `limite`) et événements techniques sans paramètres sont inscrits dans `DB_IDENTITE`.
- **Traitement local en lecture seule et zéro appel externe :** toutes les bases de données (`DB_TERMINOLOGIE`, `DB_REGISTRES`, `DB_ADRESSES`, `DB_ECONOMIE`) ne contiennent que des jeux de données ouvertes préchargés en lecture seule. Aucun témoin de connexion et aucun appel réseau sortant n'a lieu lors d'une requête. Les données soumises (nom d'entreprise, adresse civique, extrait de projet d'acte) ne sont ni conservées ni transmises à un tiers.
- **Aucune journalisation des requêtes :** les journaux d'invocation Cloudflare (`observability`, `logs`, `logpush` dans [`wrangler.jsonc`](wrangler.jsonc)) sont désactivés et le serveur n'enregistre ni les requêtes, ni les paramètres, ni les adresses IP.
- **Limitation de débit et fermeture par défaut :** cinq limiteurs d'arête par `namespace_id` (`1041`–`1045`, dont `600 req/min/IP` pré-auth et `300 req/min` par titulaire actif) protègent le service, et `MCP_ENABLED !== "true"` coupe les points MCP et `/health`.

## Configuration dans les clients MCP

> **Avec le greffon [`droit-civil-quebecois`](https://github.com/jpoirierlavoie/droit-civil-quebecois) :** si vous installez le greffon complet dans Claude Code, Claude Desktop, Antigravity ou Gemini CLI, le connecteur `outils` pointe déjà vers `https://outils.poirierlavoie.ca/mcp/oauth` et déclenche la connexion OAuth 2.1 automatiquement. Les instructions ci-dessous servent à connecter `outils` seul ou sur le Web.

### `claude.ai` et ChatGPT (Web / Desktop)

Ajouter `https://outils.poirierlavoie.ca/mcp/oauth` comme connecteur MCP personnalisé avec authentification **OAuth** (via [`acces.poirierlavoie.ca`](https://acces.poirierlavoie.ca)), ou `https://outils.poirierlavoie.ca/mcp?key=<VOTRE_JETON>` sur `claude.ai`.

### Claude Desktop / Claude Code (`.mcp.json`)

```json
{
  "mcpServers": {
    "outils": {
      "type": "http",
      "url": "https://outils.poirierlavoie.ca/mcp/oauth"
    }
  }
}
```

### Antigravity (`mcp_config.json` / `plugin.json`)

```json
{
  "mcpServers": {
    "outils": {
      "url": "https://outils.poirierlavoie.ca/mcp/oauth"
    }
  }
}
```

### Gemini CLI (`~/.gemini/settings.json` ou `gemini-extension.json`)

```json
{
  "mcpServers": {
    "outils": {
      "type": "http",
      "url": "https://outils.poirierlavoie.ca/mcp/oauth"
    }
  }
}
```

### Modes sans navigateur (CLI / scripts / Gemini API Deep Research)

- **URL OAuth 2.1 (navigateur)** : `https://outils.poirierlavoie.ca/mcp/oauth` (`401` + RFC 9728 `/.well-known/oauth-protected-resource/mcp/oauth`)
- **URL à jeton personnel (`Bearer` / `?key=`)** : `https://outils.poirierlavoie.ca/mcp` (`Authorization: Bearer <jeton>`, rend `404` vide sans jeton valide)
- **Claude Research & [Gemini Deep Research](https://ai.google.dev/gemini-api/docs/deep-research) (`deep-research-preview-04-2026`)** : passer un jeton personnel (`tous` ou `outils`) émis sur `acces.poirierlavoie.ca/moi` dans `"headers": {"Authorization": f"Bearer {MCP_JETON}"}` sur `https://outils.poirierlavoie.ca/mcp`. Par prudence professionnelle en mode Deep Research autonome (où la recherche web et `store=True` peuvent s'exécuter), **n'inclure aucun nom de client ni fait confidentiel** dans les invites.
- **Fiche de découverte publique SEP-2127** : `GET https://outils.poirierlavoie.ca/mcp/server-card` et `GET https://outils.poirierlavoie.ca/.well-known/mcp/server-card.json`
- **Page documentaire publique** : `GET https://outils.poirierlavoie.ca/` (HTML bilingue FR/EN généré dynamiquement depuis les schémas et tables compilées)
- **Vérification de santé** : `GET https://outils.poirierlavoie.ca/health` (alias `/healthz`)

## Auto-hébergement d'une fourche autonome / Self-hosting a standalone fork

Ce dépôt est entièrement autonome : vous pouvez le fourcher (*fork*) et le déployer seul **sans** fourcher `MCP-Acces`, `droit-civil-quebecois` ni créer de base `DB_IDENTITE`. / *This repository is self-contained: you can fork and self-host it **without** forking `MCP-Acces`, `droit-civil-quebecois`, or creating `DB_IDENTITE`.*

1. **Créer vos 4 bases D1 et charger les données ouvertes / Create the 4 D1 databases & run pipelines :** exécutez `npx wrangler d1 create` pour `outils-terminologie`, `outils-registres`, `outils-adresses` et `outils-economie`, mettez à jour leurs `database_id` dans `wrangler.jsonc`, puis lancez les scripts Python sous `pipeline/` (`terminologie`, `registres`, `adresses`, `economie`) — les outils `calcul` et `greffe` fonctionnent même sans aucune base D1 liée.
2. **Mode autonome sans `MCP-Acces` / Standalone auth without `DB_IDENTITE` :** retirez l'entrée `DB_IDENTITE` de `wrangler.jsonc` (optionnelle dans le code) et définissez votre propre secret Bearer statique (`npx wrangler secret put MCP_TOKEN` — `MCP_SHARED_SECRET` est aussi accepté).
3. **Domaine `*.workers.dev` ou domaine personnalisé :** aucune liste figée d'hôtes (`ALLOWED_HOSTNAMES`) ne bloque les déploiements tiers ; activez `"workers_dev": true` (ou configurez `routes`) dans `wrangler.jsonc`, conservez `"MCP_ENABLED": "true"`, déployez (`npx wrangler deploy`), puis connectez `/mcp` avec `Authorization: Bearer <votre MCP_TOKEN>`.

## Architecture du dépôt

```text
assets/logo.svg      Icône SVG carrée des manifestes Antigravity / Gemini
plugin.json          Manifeste autonome Google Antigravity
mcp_config.json      Configuration Streamable HTTP Antigravity (`outils`)
gemini-extension.json Manifeste autonome Gemini CLI (`outils`, `contextFileName: []`)
src/
  core/              Logique pure TypeScript + Zod (`holidays`, `deadlines`, `interest1619`, `qcTools`, `registres`, `adresses`, `terminologie`, `economie`, `ipc`, `tal`, `gardes`)
  data/              Tables statiques versionnées (`laf_art28_rates.json`, `boc_prime_rates.json`, `tal_criteres.json`, `glossaire_bijuridique_qc.json`)
  qc/                Tables et parseur de nomenclature judiciaire QC (dossiers, greffes, palais, lieux MJQ)
  mcp/               Registre des 15 outils et exécuteur Zod (`callOutilsTool`, `listToolDescriptors`, `listMcpToolDescriptors`)
  site.ts            Page HTML publique (`GET /`) et traductions (`site.i18n.ts`)
  index.ts           Entrée Cloudflare Worker (`servirRequeteMcp` via `@poirierlavoie/mcp-socle`, D1 lecture seule, `RATE_LIMITER`, `/mcp/server-card`, `/health`, `/`)
pipeline/
  common/            Exportateur SQL par lots et bascule bleu-vert D1 (`d1_batch.py`, `blue_green.py`)
  terminologie/      Schéma, index FTS5 et ingestion (`build_glossaire.py`, `ingest_terminologie.py`)
  registres/         Schéma, index FTS5 et ingestion REQ + RBQ + OPC + RENA + Corporations Canada + GLEIF (`ingest_req.py`)
  adresses/          Schéma normalisé 3 tables, index FTS5 odonymes et ingestion RQA (`ingest_adresses.py`)
  economie/          Schéma compact `WITHOUT ROWID` et ingestion Valet BdC + StatCan `10-10-0008-01`, IPC `18-10-0004/05-01` et SCHL `34-10-0133-01` (`ingest_economie.py`)
sources-officielles/ Instantanés officiels du ministère de la Justice (greffes/lieux et fiches des palais `mjq-palais-2026-11-17.json`)
scripts/             Générateurs MJQ (`extraire-lieux-mjq.mjs`, `extraire-palais-mjq.mjs`), déploiement (`deployer.mjs`) et audit (`verifier-audit.mjs`)
test/                Suite de tests Vitest hors réseau (`node:sqlite` en mémoire avec `PRAGMA query_only = ON`, parité des manifestes)
```

## Développement local, pipelines D1 et déploiement (Wrangler)

```powershell
npm.cmd install
npm.cmd run type-check
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run audit
```

### Pipelines Python hors ligne et bascule bleu-vert D1 (`pipeline/`)

Chaque base D1 est construite et validée localement en SQLite avant chargement par lots sur Cloudflare D1 (ou dans une nouvelle base datée `--blue-green` suivie d'une bascule atomique `--swap` dans `wrangler.jsonc` sans coupure de service). Pour le jeu ouvert du REQ (`req.zip`), déposer l'archive téléchargée via navigateur dans `pipeline/sources/req.zip` (aucun grattage du portail REQ).

```powershell
$env:PYTHONUTF8 = "1"
pipeline\.venv\Scripts\python.exe -m pipeline.terminologie.ingest_terminologie --build-local --push-remote --blue-green --swap
pipeline\.venv\Scripts\python.exe -m pipeline.registres.ingest_req --build-local --push-remote --blue-green --swap
pipeline\.venv\Scripts\python.exe -m pipeline.adresses.ingest_adresses --build-local --push-remote --blue-green --swap
pipeline\.venv\Scripts\python.exe -m pipeline.economie.ingest_economie --build-local --push-remote --blue-green --swap
```

### Mise à jour des taux (art. 28 L.A.F., Banque du Canada & TAL)

1. Consultez les taux publiés par Revenu Québec (`metadata.source_url` dans [`src/data/laf_art28_rates.json`](src/data/laf_art28_rates.json)). Le workflow [`.github/workflows/check-laf-rates.yml`](.github/workflows/check-laf-rates.yml) ouvre automatiquement un billet de rappel trimestriel lorsque le trimestre suivant manque.
2. Pour le taux préférentiel et les taux directeurs de la Banque du Canada ([`src/data/boc_prime_rates.json`](src/data/boc_prime_rates.json)), le workflow [`.github/workflows/check-boc-rates.yml`](.github/workflows/check-boc-rates.yml) ouvre un billet de rappel `[Taux BdC]` en cas de variation ou de décalage `>= 28` jours, et [`.github/workflows/sync-economie.yml`](.github/workflows/sync-economie.yml) synchronise incrémentalement `DB_ECONOMIE` les jours ouvrables (FX/taux) et mensuellement le 20 (IPC StatCan et loyers SCHL) sans commit Git.
3. Pour les critères annuels de fixation de loyer du TAL ([`src/data/tal_criteres.json`](src/data/tal_criteres.json)), le workflow [`.github/workflows/check-tal-criteres.yml`](.github/workflows/check-tal-criteres.yml) vérifie chaque 20 janvier et 20 février la couverture du cycle à venir.
4. Après mise à jour des tables statiques, exécutez `npm.cmd run type-check`, `npm.cmd test` et `npm.cmd run build`.

## Sécurité, confidentialité et licences

- **Sécurité, vie privée et secret professionnel :** Consulter [`SECURITY.md`](SECURITY.md) pour signaler de manière privée et coordonnée toute vulnérabilité ou question de confidentialité / secret professionnel à Jason Poirier Lavoie (`jason@poirierlavoie.ca`).
- **Licence logicielle et attributions de données ouvertes :** Le logiciel, les schémas, le glossaire curé, les tests et la documentation originale (élaborés en grande partie avec l'assistance de l'IA pour l'intérêt public) sont publiés gratuitement sous licence **`Apache-2.0`** ([`LICENSE`](LICENSE)). Aucun droit d'auteur n'est revendiqué sur les jeux de données publics tiers — voir [`NOTICE`](NOTICE). Attributions des jeux de données publics : Revenu Québec (art. 28 L.A.F.) ; Tribunal administratif du logement / LégisQuébec (`RLRQ, c. T-15.01, r. 2`) ; Banque du Canada (API Valet : taux de change quotidiens et historiques au comptant de midi, `V39079`, `V122530`, `V80691311`) ; ministère de la Justice du Québec (greffes et palais) ; Registraire des entreprises du Québec et Office québécois de la langue française (`CC BY-NC-SA 4.0`) ; Régie du bâtiment du Québec, Office de la protection du consommateur, Autorité des marchés publics (RENA) et ministère des Ressources naturelles et des Forêts — RQA (`CC BY 4.0`) ; Corporations Canada, Statistique Canada (Tableaux `10-10-0008-01`, `18-10-0004-01`, `18-10-0005-01` et `34-10-0133-01` SCHL) et TERMIUM Plus®, Bureau de la traduction (`OGL-Canada`) ; Global Legal Entity Identifier Foundation — GLEIF Golden Copy L1/L2/REPEX (`CC0 1.0`).
