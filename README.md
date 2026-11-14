# pratique-civile-outils

Serveur MCP (**Model Context Protocol**) public, sans état et déterministe, conçu pour outiller la pratique du litige civil et commercial québécois et les compétences du greffon [`pratique-civile-quebecoise`](https://github.com/jpoirierlavoie/pratique-civile-quebecoise).

Point d'accès public (Streamable HTTP) : `https://outils.poirierlavoie.ca/mcp`

## Outils exposés (V1)

| Outil | Rôle | Sources et conventions |
|---|---|---|
| `calendrier_list_holidays` | Liste les jours fériés et non juridiques d'une année civile (`qc_cpc`, `qc_li`, `ca_li`). | Art. 82 al. 1 C.p.c., art. 61 par. 23° & art. 52 L.I. (RLRQ, c. I-16), art. 35(1) L.I. (L.R.C. 1985, c. I-21). |
| `calendrier_compute_deadlines` | Moteur arithmétique pur de calcul de délais (1 à 25 étapes en lot ou chaînées via `depends_on_index`, prospectifs ou à rebours). | Art. 82, 83, 107 et 111 al. 2 C.p.c. (report après 17 h 00 / jour non juridique en mode technologique, repérage des périodes hors séance). |
| `interets_compute_1619` | Calcul en arithmétique exacte (`BigInt`, convention Exact/Exact 365/366, date de départ exclue / fin incluse) des intérêts simples et de l'indemnité additionnelle (1 à 50 tranches). | Art. 1618–1620 C.c.Q., art. 28 L.A.F. (Revenu Québec `2001-Q1` à `2026-Q4`), art. 3 *Loi sur l'intérêt*. Aucune extrapolation au-delà du dernier trimestre publié. |

Chaque réponse retourne à la fois des données structurées validées (`structuredContent`), un résumé lisible en français (`content[0].text`), des métadonnées de `provenance` et un tableau de `gardes` signalant les limites statutaires à vérifier.

## Confidentialité et politique de journalisation zéro

Ce serveur est conçu pour recevoir des dates, montants et libellés génériques sans exposer de secrets ni constituer de dossier :

- **Sans état et sans base de données** : aucune base D1/KV/R2, aucun appel HTTP sortant, aucun témoin de connexion.
- **Aucune journalisation des charges utiles** : `observability.enabled = false`, `logs.enabled = false`, `logs.invocationLogs = false` et `logpush = false` dans `cloudflare.config.ts`. Le code du Worker ne journalise ni corps de requête, ni arguments d'outils, ni adresses IP.
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
- **Vérification de santé** : `GET https://outils.poirierlavoie.ca/healthz`

## Architecture du dépôt

```text
src/
  core/        Logique pure TypeScript + Zod (zéro dépendance Cloudflare)
  data/        Table statique vérifiée des taux art. 28 L.A.F. (laf_art28_rates.json)
  mcp/         Serveur McpServer agnostique du transport (createOutilsMcpServer)
  index.ts     Entrée Cloudflare Worker (createMcpHandler, RATE_LIMITER, /healthz)
test/          Tests unitaires Vitest et tests d'intégration HTTP MCP
```

La séparation stricte de `src/core/` et `src/mcp/` permet d'ajouter ultérieurement un binaire local `stdio` (`@modelcontextprotocol/server/stdio`) sans dupliquer la logique juridique ou arithmétique.

## Développement local, déploiement et maintenance (`cf`)

Ce projet utilise la CLI officielle Cloudflare [`cf`](https://developers.cloudflare.com/) avec [`cloudflare.config.ts`](cloudflare.config.ts).

```bash
npm install
npm run typecheck
npm test
npm run build
```

Développement local sur Worker :

```bash
npx cf dev
```

Pour tester temporairement sur un domaine `*.workers.dev` ou un hôte de prévisualisation, ajoutez la variable d'environnement `ALLOWED_HOSTNAMES` (séparée par des virgules).

Déploiement :

```bash
npx cf auth login
npx cf deploy
```

### Mise à jour trimestrielle des taux (art. 28 L.A.F.)

1. Consultez les taux publiés par Revenu Québec (`Metadata.source_url` dans [`src/data/laf_art28_rates.json`](src/data/laf_art28_rates.json)). Le workflow [`.github/workflows/check-laf-rates.yml`](.github/workflows/check-laf-rates.yml) ouvre automatiquement un billet de rappel à la mi-mars, mi-juin, mi-septembre et mi-décembre lorsque le trimestre suivant manque.
2. Ajoutez le nouveau trimestre dans `src/data/laf_art28_rates.json` et mettez à jour `metadata.last_quarter`, `metadata.table_version` et `metadata.verified_at`.
3. Exécutez `npm run typecheck && npm test && npx cf deploy`.

## Licence

CC0 1.0 Universel — voir [LICENSE](LICENSE).
