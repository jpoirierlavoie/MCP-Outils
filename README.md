# MCP-Outils

Serveur MCP (**Model Context Protocol**) public en lecture seule (`mcp-outils`), sans authentification et sans journalisation, conçu pour la pratique du litige civil et commercial québécois et les compétences du greffon [`droit-civil-quebecois`](https://github.com/jpoirierlavoie/droit-civil-quebecois).

> **In English:** Public, unauthenticated, read-only MCP server for Québec civil and commercial litigation (`outils.poirierlavoie.ca/mcp`). Provides deterministic C.C.P. holiday/deadline and art. 1619 C.C.Q. interest calculators alongside offline lookups for court file numbers, courthouses, corporate registries and LEI hierarchies (REQ, Corporations Canada, GLEIF), Québec civic addresses (RQA), and bilingual/bijural legal terminology. Queries and inputs are never logged.

Point d'accès public (sans compte ni jeton) : `https://outils.poirierlavoie.ca/mcp`  
Page publique et schémas : <https://outils.poirierlavoie.ca/> (`/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/mcp/server-card`)

## Outils exposés (v2.2.0 — 12 outils sur 5 familles)

| Famille | Outil | Rôle | Sources et conventions |
|---|---|---|---|
| `calcul` | `calendrier_holidays` | Liste les jours fériés et non juridiques d'une année civile (`qc_cpc`, `qc_prescription`, `qc_li`, `ca_li` avec `province` optionnel). | Art. 82 al. 1 C.p.c., art. 2879 al. 2 C.c.Q., art. 61 par. 23° & art. 52 L.I. (RLRQ, c. I-16), art. 35(1) L.I. (L.R.C. 1985, c. I-21). |
| `calcul` | `calendrier_deadlines` | Calculateur exact de 1 à 25 délais procéduraux ou légaux (prospectifs ou à rebours, chaînés au besoin via `depends_on_index`) sous `qc_cpc`, `qc_prescription`, `qc_li` et `ca_li`. | Art. 82, 83, 107 et 111 al. 2 C.p.c., art. 2879 al. 2 C.c.Q., art. 52 L.I. (`rollover_saturday=false` par défaut sous `qc_li`), `province='QC'` sous `ca_li`. |
| `calcul` | `interets_1619` | Calcul au cent près des intérêts simples et de l'indemnité additionnelle (1 à 50 tranches, arithmétique exacte `BigInt` en convention Exact/Exact 365/366, date de départ exclue / fin incluse). | Art. 1618–1620 C.c.Q., art. 28 L.A.F. (Revenu Québec `2001-Q1` à `2026-Q4`), art. 3 *Loi sur l'intérêt*. Aucune extrapolation au-delà du dernier trimestre publié. |
| `greffe` | `greffe_parse_number` | Décompose un numéro de dossier de cour du Québec (`NNN-NN-NNNNNN-NNN` ou préfixe `TAL-`, `C.F.-`, etc.) : greffe, district, juridiction et adresse connue. | Tables locales compilées du ministère de la Justice du Québec (`2026-11-17` / `2026-07-22`). Aucun appel sortant, aucun accès au plumitif. |
| `greffe` | `palais_list` | Répertorie les 44 palais de justice et 9 points de service du Québec, filtrables par district, type ou texte libre. | Relevé du ministère de la Justice du Québec (`2026-11-17`). Employer `palais_get` pour les coordonnées ; vérifier à la source avant signification ou dépôt. |
| `greffe` | `palais_get` | Fiche complète d'un lieu de justice (adresse municipale, postale s'il y a lieu, heures d'ouverture, télécopieur, téléphones et courriels par chambre/service, greffes et localités itinérantes), par `greffe_number` ou `palais`. | Relevé du ministère de la Justice du Québec (`2026-11-17` / `2026-07-22`). Une adresse absente signifie inconnue, jamais inexistante. |
| `registre` | `registre_search` | Recherche hors ligne d'entreprises québécoises, fédérales et canadiennes titulaires d'un LEI par nom, autre nom utilisé, société à numéro, NEQ, numéro fédéral ou LEI (20 car.), avec indicateur `has_lei`. | `DB_REGISTRES` en lecture seule : REQ (`CC BY-NC-SA 4.0`), RBQ, OPC, AMP — RENA (`CC BY 4.0`), Corporations Canada (`OGL-Canada`), GLEIF Golden Copy (`CC0 1.0`). Sans dirigeants personnes physiques (L.P.L.E. / L.C.S.A.). |
| `registre` | `registre_get_entity` | Fiche détaillée d'une entité par NEQ (10 chiffres), numéro de société fédérale, NE/BN (9 chiffres) ou LEI (20 car.) : REQ, RBQ/OPC/RENA, Corporations Canada, hiérarchie comptable GLEIF Level 2 et liens directs vers les portails officiels (REQ, Corporations Canada, PCI/ISC, GLEIF). | Instantanés locaux en lecture seule sans valeur de certificat ni d'attestation officielle ; la consolidation comptable GLEIF n'établit pas le contrôle juridique (`REGISTRE_GLEIF_DECLARATIF_CONSOLIDATION`). |
| `adresse` | `adresse_verify` | Vérification de l'existence municipale et normalisation d'une adresse québécoise (tolérance aux fautes de frappe, anciens odonymes, code postal, lots/matricules indicatifs, district judiciaire probable). | `DB_ADRESSES` en lecture seule : Référentiel québécois des adresses (RQA) et Odonymes et renvois (MRNF, `CC BY 4.0`). N'établit ni le domicile d'une partie ni un titre foncier. |
| `terminologie` | `terminologie_lookup` | Recherche bilingue FR/EN dans 4 sources hiérarchisées avec repérage des calques et faux amis de common law ou de droit français (`mortgage` vs `hypothec`, `solidary` vs `joint and several`). | `DB_TERMINOLOGIE` en lecture seule : glossaire curé QC (rang 1), concordancier législatif (rang 2), TERMIUM Plus® (`OGL-Canada`, rang 3), OQLF (`CC BY-NC-SA 4.0`, rang 4). |
| `terminologie` | `termino_attestations` | Comptage exact et extraits bilingues alignés FR/EN dans le corpus législatif consolidé du Québec et du Canada (art. 8.1–8.2 L.I.). | Concordancier bilingue dérivé de LégisQuébec et Justice Canada (97 lois alignées). Ne remplace pas la lecture intégrale via `MCP-Legislation`. |
| `terminologie` | `terminologie_scan` | Contrôle en lecture seule d'un extrait de projet d'acte (jusqu'à 32 000 car., FR/EN) pour signaler francismes de France, anglicismes / faux amis de common law et archaïsmes d'avant 2016. | Signale positions, motifs, remplacements civilistes suggérés et fondements légaux sans jamais réécrire le texte. |

Chaque réponse réussie retourne un résumé lisible en français (`content[0].text`), des données structurées validées (`structuredContent`), la provenance des sources et des mises en garde (`gardes`) rappelant les limites documentaires à vérifier (tous les outils sont hors ligne et en lecture seule : `openWorldHint: false`, `readOnlyHint: true`).

## Confidentialité et politique de journalisation zéro

Ce serveur est public (sans secret ni compte requis) tout en protégeant la confidentialité des dossiers :

- **Traitement local en lecture seule et zéro appel externe :** toutes les bases de données (`DB_TERMINOLOGIE`, `DB_REGISTRES`, `DB_ADRESSES`) ne contiennent que des jeux de données ouvertes préchargés en lecture seule. Aucune écriture, aucun témoin de connexion et aucun appel réseau sortant n'a lieu lors d'une requête. Les données soumises (nom d'entreprise, adresse civique, extrait de projet d'acte) ne sont ni conservées ni transmises à un tiers.
- **Aucune journalisation des requêtes :** les journaux d'invocation Cloudflare (`observability`, `logs`, `logpush` dans [`wrangler.jsonc`](wrangler.jsonc)) sont désactivés et le serveur n'enregistre ni les requêtes, ni les paramètres, ni les adresses IP.
- **Limitation de débit :** un plafond technique de 240 requêtes par minute et par adresse IP (`RATE_LIMITER`) protège la disponibilité du service sans stocker le contenu des appels.

## Configuration dans les clients MCP

> **Avec le greffon [`droit-civil-quebecois`](https://github.com/jpoirierlavoie/droit-civil-quebecois) :** si vous installez le greffon complet dans Claude Code, Claude Desktop, Antigravity ou Gemini CLI, le connecteur `outils` est configuré automatiquement sans étape supplémentaire. Les instructions ci-dessous servent à connecter `outils` seul ou sur le Web.

### `claude.ai` et ChatGPT (Web / Desktop)

Ajouter `https://outils.poirierlavoie.ca/mcp` comme connecteur MCP personnalisé sans authentification (*No authentication*).

### Claude Desktop / Claude Code (`.mcp.json`)

```json
{
  "mcpServers": {
    "outils": {
      "type": "http",
      "url": "https://outils.poirierlavoie.ca/mcp"
    }
  }
}
```

### Antigravity (`mcp_config.json` / `plugin.json`)

```json
{
  "mcpServers": {
    "outils": {
      "url": "https://outils.poirierlavoie.ca/mcp"
    }
  }
}
```

### Gemini CLI (`~/.gemini/settings.json` ou `gemini-extension.json`)

```json
{
  "mcpServers": {
    "outils": {
      "httpUrl": "https://outils.poirierlavoie.ca/mcp"
    }
  }
}
```

### Inspection avec MCP Inspector / Modes Deep Research

- **URL Streamable HTTP** : `https://outils.poirierlavoie.ca/mcp`
- **Claude Research & [Gemini Deep Research](https://ai.google.dev/gemini-api/docs/deep-research) (Gemini API, via l'API Interactions — `deep-research-preview-04-2026`)** : raccordement direct au serveur MCP sans jeton ni OAuth côté `outils` (l'authentification à l'API Gemini ou à Claude demeure requise côté client), en tant que connecteur public en lecture seule (`openWorldHint: false`, `readOnlyHint: true`). Pour obtenir des jetons individuels ou connecter via OAuth 2.1 les serveurs complémentaires de sources primaires (`lois` et `juris`, réservés aux membres en règle du Barreau du Québec), consulter [`acces.poirierlavoie.ca`](https://acces.poirierlavoie.ca) et le greffon [`droit-civil-quebecois`](https://github.com/jpoirierlavoie/droit-civil-quebecois). Par prudence professionnelle en mode Deep Research autonome (où la recherche web et `store=True` peuvent s'exécuter), **n'inclure aucun nom de client ni fait confidentiel** dans les invites.
- **Fiche de découverte publique SEP-2127** : `GET https://outils.poirierlavoie.ca/mcp/server-card`
- **Page documentaire publique** : `GET https://outils.poirierlavoie.ca/` (HTML bilingue FR/EN généré dynamiquement depuis les schémas et tables compilées)
- **Vérification de santé** : `GET https://outils.poirierlavoie.ca/healthz`

## Architecture du dépôt

```text
assets/logo.svg      Icône SVG carrée des manifestes Antigravity / Gemini
plugin.json          Manifeste autonome Google Antigravity
mcp_config.json      Configuration Streamable HTTP Antigravity (`outils`)
gemini-extension.json Manifeste autonome Gemini CLI (`outils`, `contextFileName: []`)
src/
  core/              Logique pure TypeScript + Zod (`holidays`, `deadlines`, `interest1619`, `qcTools`, `registres`, `adresses`, `terminologie`, `gardes`)
  data/              Tables statiques versionnées (`laf_art28_rates.json`, `glossaire_bijuridique_qc.json`)
  qc/                Tables et parseur de nomenclature judiciaire QC (dossiers, greffes, palais, lieux MJQ)
  mcp/               Serveur McpServer agnostique du transport (`createOutilsMcpServer`, `listToolDescriptors`)
  site.ts            Page HTML publique (`GET /`) et traductions (`site.i18n.ts`)
  index.ts           Entrée Cloudflare Worker (`createMcpHandler`, D1 lecture seule, `RATE_LIMITER`, `/mcp/server-card`, `/healthz`, `/`)
pipeline/
  common/            Exportateur SQL par lots et bascule bleu-vert D1 (`d1_batch.py`, `blue_green.py`)
  terminologie/      Schéma, index FTS5 et ingestion (`build_glossaire.py`, `ingest_terminologie.py`)
  registres/         Schéma, index FTS5 et ingestion REQ + RBQ + OPC + RENA + Corporations Canada + GLEIF (`ingest_req.py`)
  adresses/          Schéma normalisé 3 tables, index FTS5 odonymes et ingestion RQA (`ingest_adresses.py`)
sources-officielles/ Instantanés officiels du ministère de la Justice (greffes/lieux et fiches des palais `mjq-palais-2026-11-17.json`)
scripts/             Générateurs des tables MJQ (`extraire-lieux-mjq.mjs`, `extraire-palais-mjq.mjs`)
test/                Suite de tests Vitest hors réseau (`node:sqlite` en mémoire avec `PRAGMA query_only = ON`, parité des manifestes)
```

## Développement local, pipelines D1 et déploiement (Wrangler)

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

### Pipelines Python hors ligne et bascule bleu-vert D1 (`pipeline/`)

Chaque base D1 est construite et validée localement en SQLite avant chargement par lots sur Cloudflare D1 (ou dans une nouvelle base datée `--blue-green` suivie d'une bascule atomique `--swap` dans `wrangler.jsonc` sans coupure de service). Pour le jeu ouvert du REQ (`req.zip`), déposer l'archive téléchargée via navigateur dans `pipeline/sources/req.zip` (aucun grattage du portail REQ).

```powershell
$env:PYTHONUTF8 = "1"
pipeline\.venv\Scripts\python.exe -m pipeline.terminologie.ingest_terminologie --build-local --push-remote --blue-green --swap
pipeline\.venv\Scripts\python.exe -m pipeline.registres.ingest_req --build-local --push-remote --blue-green --swap
pipeline\.venv\Scripts\python.exe -m pipeline.adresses.ingest_adresses --build-local --push-remote --blue-green --swap
```

### Mise à jour trimestrielle des taux (art. 28 L.A.F.)

1. Consultez les taux publiés par Revenu Québec (`metadata.source_url` dans [`src/data/laf_art28_rates.json`](src/data/laf_art28_rates.json)). Le workflow [`.github/workflows/check-laf-rates.yml`](.github/workflows/check-laf-rates.yml) ouvre automatiquement un billet de rappel trimestriel lorsque le trimestre suivant manque.
2. Ajoutez le nouveau trimestre dans `src/data/laf_art28_rates.json` et mettez à jour `metadata.last_quarter`, `metadata.table_version` et `metadata.verified_at`.
3. Exécutez `npm.cmd run typecheck`, `npm.cmd test` et `npm.cmd run build`.

## Sécurité, confidentialité et licences

- **Sécurité, vie privée et secret professionnel :** Consulter [`SECURITY.md`](SECURITY.md) pour signaler de manière privée et coordonnée toute vulnérabilité ou question de confidentialité / secret professionnel à Jason Poirier Lavoie (`jason@poirierlavoie.ca`).
- **Licence logicielle et attributions de données ouvertes :** Le logiciel, les schémas, le glossaire curé, les tests et la documentation originale (élaborés en grande partie avec l'assistance de l'IA pour l'intérêt public) sont publiés gratuitement sous licence **`Apache-2.0`** ([`LICENSE`](LICENSE)). Aucun droit d'auteur n'est revendiqué sur les jeux de données publics tiers — voir [`NOTICE`](NOTICE). Attributions des jeux de données publics : Revenu Québec (art. 28 L.A.F.) ; ministère de la Justice du Québec (greffes et palais) ; Registraire des entreprises du Québec et Office québécois de la langue française (`CC BY-NC-SA 4.0`) ; Régie du bâtiment du Québec, Office de la protection du consommateur, Autorité des marchés publics (RENA) et ministère des Ressources naturelles et des Forêts — RQA (`CC BY 4.0`) ; Corporations Canada et TERMIUM Plus®, Bureau de la traduction (`OGL-Canada`) ; Global Legal Entity Identifier Foundation — GLEIF Golden Copy L1/L2/REPEX (`CC0 1.0`).
