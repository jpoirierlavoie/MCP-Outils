# pratique-civile-outils

Serveur MCP (**Model Context Protocol**) public, sans état et déterministe, conçu pour outiller la pratique du litige civil et commercial québécois et les compétences du greffon [`pratique-civile-quebecoise`](https://github.com/jpoirierlavoie/pratique-civile-quebecoise).

Point d'accès public (Streamable HTTP) : `https://outils.poirierlavoie.ca/mcp`

## Outils exposés (v0.2.0)

| Outil | Rôle | Sources et conventions |
|---|---|---|
| `calendrier_list_holidays` | Liste les jours fériés et non juridiques d'une année civile (`qc_cpc`, `qc_li`, `ca_li`). | Art. 82 al. 1 C.p.c., art. 61 par. 23° & art. 52 L.I. (RLRQ, c. I-16), art. 35(1) L.I. (L.R.C. 1985, c. I-21). |
| `calendrier_compute_deadlines` | Moteur arithmétique pur de calcul de délais (1 à 25 étapes en lot ou chaînées via `depends_on_index`, prospectifs ou à rebours). | Art. 82, 83, 107 et 111 al. 2 C.p.c. (report après 17 h 00 / jour non juridique en mode technologique, repérage des périodes hors séance). |
| `interets_compute_1619` | Calcul en arithmétique exacte (`BigInt`, convention Exact/Exact 365/366, date de départ exclue / fin incluse) des intérêts simples et de l'indemnité additionnelle (1 à 50 tranches). | Art. 1618–1620 C.c.Q., art. 28 L.A.F. (Revenu Québec `2001-Q1` à `2026-Q4`), art. 3 *Loi sur l'intérêt*. Aucune extrapolation au-delà du dernier trimestre publié. |
| `greffe_parse_court_file_number` | Décompose un numéro de dossier de cour du Québec (`NNN-NN-NNNNNN-NNN` ou préfixe `TAL-`, `C.F.-`, etc.) : greffe, district, juridiction et adresse connue. | Tables locales compilées du ministère de la Justice du Québec (`2026-07-15` / `2026-07-22`). Aucun appel sortant, aucun accès au plumitif. |
| `palais_list` | Répertorie les 43 palais de justice et 8 points de service du Québec, filtrables par district, type ou texte libre. | Relevé du ministère de la Justice du Québec (`2026-07-15`). Aucune coordonnée téléphonique ni courriel ; vérifier à la source avant signification ou dépôt. |
| `palais_get` | Fiche complète d'un lieu de justice (adresse municipale, postale s'il y a lieu, greffes et localités itinérantes), par `greffe_number` ou `palais`. | Relevé du ministère de la Justice du Québec (`2026-07-15` / `2026-07-22`). Une adresse absente signifie inconnue, jamais inexistante. |

Chaque réponse réussie retourne à la fois des données structurées validées (`structuredContent`), un résumé lisible en français (`content[0].text`), des métadonnées de `provenance` et un tableau de `gardes` signalant les limites statutaires ou documentaires à vérifier (tous avec `openWorldHint: false`).

## Confidentialité et politique de journalisation zéro

Ce serveur est conçu pour recevoir des dates, montants et libellés génériques sans exposer de secrets ni constituer de dossier :

- **Sans état et sans base de données** : aucune base D1/KV/R2, aucun appel HTTP sortant, aucun témoin de connexion.
- **Aucune journalisation des charges utiles** : `observability.enabled = false`, `logs.enabled = false`, `logs.invocation_logs = false` et `logpush = false` dans [`wrangler.jsonc`](wrangler.jsonc). Le code du Worker ne journalise ni corps de requête, ni arguments d'outils, ni adresses IP.
- **Limitation de débit à la périphérie** : un binding Cloudflare Rate Limiting (`RATE_LIMITER`, 60 requêtes / 60 s par IP client via `CF-Connecting-IP`) protège le point d'accès contre les abus sans stocker de contenu applicatif.

## Configuration dans les clients MCP

### Claude Desktop / Claude Code (`.mcp.json`)

```json
{
  "mcpServers": {
    "pratique-civile-outils": {
      "type": "http",
      "url": "https://outils.poirierlavoie.ca/mcp"
    }
  }
}
```

### Antigravity (`mcp_config.json`)

```json
{
  "mcpServers": {
    "pratique-civile-outils": {
      "url": "https://outils.poirierlavoie.ca/mcp"
    }
  }
}
```

### Gemini CLI (`~/.gemini/settings.json` ou `gemini-extension.json`)

```json
{
  "mcpServers": {
    "pratique-civile-outils": {
      "httpUrl": "https://outils.poirierlavoie.ca/mcp"
    }
  }
}
```

### Inspection avec MCP Inspector / Client générique

- **URL Streamable HTTP** : `https://outils.poirierlavoie.ca/mcp`
- **Page documentaire publique** : `GET https://outils.poirierlavoie.ca/` (HTML bilingue FR/EN généré depuis les schémas et tables compilées)
- **Vérification de santé** : `GET https://outils.poirierlavoie.ca/healthz`

## Architecture du dépôt

```text
src/
  core/              Logique pure TypeScript + Zod (`holidays`, `deadlines`, `interest1619`, `qcTools`, `gardes`)
  data/              Table statique vérifiée des taux art. 28 L.A.F. (`laf_art28_rates.json`)
  qc/                Tables et parseur de nomenclature judiciaire QC (dossiers, greffes, palais, lieux MJQ)
  mcp/               Serveur McpServer agnostique du transport (`createOutilsMcpServer`, `listToolDescriptors`)
  site.ts            Page HTML publique (`GET /`) et traductions (`site.i18n.ts`)
  index.ts           Entrée Cloudflare Worker (`createMcpHandler`, `RATE_LIMITER`, `/healthz`, `/`)
sources-officielles/ Instantané HTML officiel du ministère de la Justice (greffes et points de service)
scripts/             Générateur de `src/qc/lieux.ts` à partir de l'instantané MJQ (`extraire-lieux-mjq.mjs`)
test/                Tests unitaires Vitest, différentiel Athéna (127 cas), page publique et intégration HTTP MCP
```

Pour régénérer [`src/qc/lieux.ts`](src/qc/lieux.ts) après une nouvelle capture manuelle du relevé MJQ :

```bash
node scripts/extraire-lieux-mjq.mjs sources-officielles/mjq-numeros-greffes-2026-07-22.html
```

La séparation stricte de `src/core/` et `src/mcp/` permet d'ajouter ultérieurement un binaire local `stdio` (`@modelcontextprotocol/server/stdio`) sans dupliquer la logique juridique ou arithmétique.

## Développement local, déploiement et maintenance (Wrangler)

Ce projet utilise la CLI officielle Cloudflare [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) avec [`wrangler.jsonc`](wrangler.jsonc).

```bash
npm install
npm run typecheck
npm test
npm run build
```

Développement local sur Worker :

```bash
npm run dev
```

Pour tester temporairement sur un domaine `*.workers.dev` ou un hôte de prévisualisation, ajoutez la variable d'environnement `ALLOWED_HOSTNAMES` (séparée par des virgules).

### Déploiement

Le déploiement en production sur `outils.poirierlavoie.ca` est automatisé à chaque push sur `main` (ou déclenchement manuel `workflow_dispatch`) par [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) via l'environnement GitHub `production` et le secret `CLOUDFLARE_API_TOKEN`. Aucun secret applicatif n'est requis dans le Worker.

Pour un déploiement manuel local :

```bash
npx wrangler login
npm run deploy
```

### Mise à jour trimestrielle des taux (art. 28 L.A.F.)

1. Consultez les taux publiés par Revenu Québec (`Metadata.source_url` dans [`src/data/laf_art28_rates.json`](src/data/laf_art28_rates.json)). Le workflow [`.github/workflows/check-laf-rates.yml`](.github/workflows/check-laf-rates.yml) ouvre automatiquement un billet de rappel à la mi-mars, mi-juin, mi-septembre et mi-décembre lorsque le trimestre suivant manque.
2. Ajoutez le nouveau trimestre dans `src/data/laf_art28_rates.json` et mettez à jour `metadata.last_quarter`, `metadata.table_version` et `metadata.verified_at`.
3. Exécutez `npm run typecheck && npm test && npx wrangler deploy --dry-run`, puis committez et poussez sur `main` (le workflow `deploy.yml` déploiera automatiquement), ou exécutez `npm run deploy` manuellement.

## Sécurité, confidentialité et licence

- **Sécurité, vie privée et secret professionnel :** Consulter [`SECURITY.md`](SECURITY.md) pour signaler de manière privée et coordonnée toute vulnérabilité ou question de confidentialité / secret professionnel à Jason Poirier Lavoie (`jason@poirierlavoie.ca`), sans ouvrir d'issue publique ni transmettre de renseignements confidentiels de clients.
- **Licence :** Le logiciel, les schémas, les tests et la documentation originale sont mis à disposition sous licence **Creative Commons Attribution - Pas d'Utilisation Commerciale - Partage dans les Mêmes Conditions 4.0 International (`CC-BY-NC-SA-4.0`)** — voir [`LICENSE`](LICENSE). Les taux trimestriels (art. 28 L.A.F.) proviennent de Revenu Québec et les tables de greffes et palais proviennent des relevés publics du ministère de la Justice du Québec.
