# MCP-Outils

Serveur MCP (**Model Context Protocol**) public, sans journalisation et déterministe (`mcp-outils`, Worker Cloudflare `outils`), conçu pour outiller la pratique du litige civil et commercial québécois et les compétences du greffon [`droit-civil-quebecois`](https://github.com/jpoirierlavoie/droit-civil-quebecois).

Point d'accès public (Streamable HTTP) : `https://outils.poirierlavoie.ca/mcp`

## Outils exposés (v2.1.0 — 12 outils sur 5 familles)

| Famille | Outil | Rôle | Sources et conventions |
|---|---|---|---|
| `calcul` | `calendrier_holidays` | Liste les jours fériés et non juridiques d'une année civile (`qc_cpc`, `qc_li`, `ca_li`). | Art. 82 al. 1 C.p.c., art. 61 par. 23° & art. 52 L.I. (RLRQ, c. I-16), art. 35(1) L.I. (L.R.C. 1985, c. I-21). |
| `calcul` | `calendrier_deadlines` | Moteur arithmétique pur de calcul de délais (1 à 25 étapes en lot ou chaînées via `depends_on_index`, prospectifs ou à rebours). | Art. 82, 83, 107 et 111 al. 2 C.p.c. (report après 17 h 00 / jour non juridique en mode technologique, repérage des périodes hors séance). |
| `calcul` | `interets_1619` | Calcul en arithmétique exacte (`BigInt`, convention Exact/Exact 365/366, date de départ exclue / fin incluse) des intérêts simples et de l'indemnité additionnelle (1 à 50 tranches). | Art. 1618–1620 C.c.Q., art. 28 L.A.F. (Revenu Québec `2001-Q1` à `2026-Q4`), art. 3 *Loi sur l'intérêt*. Aucune extrapolation au-delà du dernier trimestre publié. |
| `greffe` | `greffe_parse_number` | Décompose un numéro de dossier de cour du Québec (`NNN-NN-NNNNNN-NNN` ou préfixe `TAL-`, `C.F.-`, etc.) : greffe, district, juridiction et adresse connue. | Tables locales compilées du ministère de la Justice du Québec (`2026-11-17` / `2026-07-22`). Aucun appel sortant, aucun accès au plumitif. |
| `greffe` | `palais_list` | Répertorie les 44 palais de justice et 9 points de service du Québec, filtrables par district, type ou texte libre. | Relevé du ministère de la Justice du Québec (`2026-11-17`). Employer `palais_get` pour les coordonnées ; vérifier à la source avant signification ou dépôt. |
| `greffe` | `palais_get` | Fiche complète d'un lieu de justice (adresse municipale, postale s'il y a lieu, heures d'ouverture, télécopieur, téléphones et courriels par chambre/service, greffes et localités itinérantes), par `greffe_number` ou `palais`. | Relevé du ministère de la Justice du Québec (`2026-11-17` / `2026-07-22`). Une adresse absente signifie inconnue, jamais inexistante. |
| `registre` | `registre_search` | Recherche hors ligne d'entreprises québécoises et fédérales par nom, autre nom utilisé, société à numéro, NEQ ou numéro fédéral. | `DB_REGISTRES` en lecture seule : REQ (`CC BY-NC-SA 4.0`), RBQ, OPC, AMP — RENA (`CC BY 4.0`), Corporations Canada (`OGL-Canada`). Sans dirigeants personnes physiques (L.P.L.E.). |
| `registre` | `registre_get_entity` | Fiche détaillée d'une entité par NEQ (10 chiffres), numéro de société fédérale ou NE/BN (9 chiffres), incluant licences RBQ, permis OPC et inscriptions RENA. | Instantanés locaux en lecture seule sans valeur de certificat ni d'attestation officielle ; vérifier au Registraire avant toute signification. |
| `adresse` | `adresse_verify` | Vérification de l'existence municipale et normalisation d'une adresse québécoise (tolérance aux fautes de frappe, anciens odonymes, code postal, lots/matricules indicatifs, district judiciaire probable). | `DB_ADRESSES` en lecture seule : Référentiel québécois des adresses (RQA) et Odonymes et renvois (MRNF, `CC BY 4.0`). N'établit ni le domicile d'une partie ni un titre foncier. |
| `terminologie` | `terminologie_lookup` | Recherche bilingue FR/EN dans 4 sources hiérarchisées avec repérage des calques et faux amis de common law ou de droit français (`mortgage` vs `hypothec`, `solidary` vs `joint and several`). | `DB_TERMINOLOGIE` en lecture seule : glossaire curé QC (rang 1), concordancier législatif (rang 2), TERMIUM Plus® (`OGL-Canada`, rang 3), OQLF (`CC BY-NC-SA 4.0`, rang 4). |
| `terminologie` | `termino_attestations` | Comptage exact et extraits bilingues alignés FR/EN dans le corpus législatif consolidé du Québec et du Canada (art. 8.1–8.2 L.I.). | Concordancier bilingue dérivé de LégisQuébec et Justice Canada (97 lois alignées). Ne remplace pas la lecture intégrale via `MCP-Legislation`. |
| `terminologie` | `terminologie_scan` | Contrôle en lecture seule d'un extrait de projet d'acte (jusqu'à 32 000 car., FR/EN) pour signaler francismes de France, anglicismes / faux amis de common law et archaïsmes d'avant 2016. | Signale positions, motifs, remplacements civilistes suggérés et fondements légaux sans jamais réécrire le texte. |

Chaque réponse réussie retourne à la fois des données structurées validées (`structuredContent`), un résumé lisible en français (`content[0].text`), des métadonnées de `provenance` et un tableau de `gardes` signalant les limites statutaires ou documentaires à vérifier (tous avec `openWorldHint: false` et `readOnlyHint: true`).

## Confidentialité et politique de journalisation zéro

Ce serveur est conçu pour être interrogé publiquement sans secret tout en protégeant rigoureusement la confidentialité des dossiers :

- **Bases D1 strictement en lecture seule à la requête et zéro appel sortant** : les trois bases Cloudflare D1 (`DB_TERMINOLOGIE`, `DB_REGISTRES`, `DB_ADRESSES`, région `ENAM`) contiennent exclusivement des jeux de données ouvertes préchargés hors ligne. Aucune écriture (`INSERT`/`UPDATE`/`DELETE`), aucun KV/R2, aucun témoin de connexion et aucun appel HTTP sortant n'ont lieu lors du traitement d'une requête. Aucune donnée soumise par un avocat (nom d'entreprise, adresse civique, extrait de projet d'acte) ne quitte l'isolat Cloudflare ni n'est enregistrée.
- **Aucune journalisation des charges utiles** : `observability.enabled = false`, `logs.enabled = false`, `logs.invocation_logs = false` et `logpush = false` dans [`wrangler.jsonc`](wrangler.jsonc). Le code du Worker ne journalise ni corps de requête, ni arguments d'outils, ni adresses IP.
- **Limitation de débit à la périphérie** : un binding Cloudflare Rate Limiting (`RATE_LIMITER`, 60 requêtes / 60 s par IP client via `CF-Connecting-IP`) protège le point d'accès contre les abus sans stocker de contenu applicatif.

## Configuration dans les clients MCP

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
- **Claude Research & Gemini Deep Research (`deep-research-preview-04-2026`, Gemini App / Vertex AI)** : raccordement direct sans jeton ni OAuth en tant que connecteur public en lecture seule (`openWorldHint: false`, `readOnlyHint: true`). Pour obtenir des jetons individuels ou connecter via OAuth 2.1 les serveurs complémentaires de sources primaires (`lois` et `juris`, réservés aux membres en règle du Barreau du Québec), consulter [`acces.poirierlavoie.ca`](https://acces.poirierlavoie.ca) et le greffon [`droit-civil-quebecois`](https://github.com/jpoirierlavoie/droit-civil-quebecois). Par prudence professionnelle en mode Deep Research autonome (où la recherche web et `store=True` peuvent s'exécuter), **n'inclure aucun nom de client ni fait confidentiel** dans les invites.
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
  registres/         Schéma, index FTS5 et ingestion REQ + RBQ + OPC + RENA + Corporations Canada (`ingest_req.py`)
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
- **Licence logicielle et attributions de données ouvertes :** Le logiciel, les schémas, le glossaire curé, les tests et la documentation originale dont Jason Poirier Lavoie est titulaire sont mis à disposition sous licence **`CC-BY-NC-SA-4.0`** assortie d'une **Autorisation complémentaire de pratique professionnelle du droit** (*Companion Professional Legal Practice Grant*) pour les membres en règle du Barreau du Québec — voir [`LICENSE`](LICENSE). Attributions des jeux de données publics : Revenu Québec (art. 28 L.A.F.) ; ministère de la Justice du Québec (greffes et palais) ; Registraire des entreprises du Québec et Office québécois de la langue française (`CC BY-NC-SA 4.0`) ; Régie du bâtiment du Québec, Office de la protection du consommateur, Autorité des marchés publics (RENA) et ministère des Ressources naturelles et des Forêts — RQA (`CC BY 4.0`) ; Corporations Canada et TERMIUM Plus®, Bureau de la traduction (`OGL-Canada`).
