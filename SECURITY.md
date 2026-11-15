# Security, Privacy & Professional Secrecy Policy / Politique de sécurité, confidentialité et secret professionnel

> **Français :** Ce dépôt héberge le connecteur MCP public et sans état **`pratique-civile-outils`** (`https://outils.poirierlavoie.ca/mcp`), déployé sur Cloudflare Workers pour le calcul déterministe (jours fériés, délais C.p.c./L.I., intérêts art. 1619 C.c.Q.) et l'annuaire statique des greffes et palais de justice du Québec.
> Pour signaler une **vulnérabilité de sécurité** OU un **enjeu de vie privée, de confidentialité ou de secret professionnel / privilège** (`art. 9` *Charte des droits et libertés de la personne*, `art. 131` *Loi sur le Barreau*), **n'ouvrez jamais d'issue publique sur GitHub**. Écrivez directement au mainteneur :
> **Jason Poirier Lavoie, avocat (Québec)** — `jason@poirierlavoie.ca` (accusé de réception sous **72 heures**, divulgation coordonnée).
> **Ne transmettez jamais** de documents clients réels, de renseignements nominatifs privilégiés ni de secrets de déploiement dans un premier signalement ; utilisez des paramètres fictifs.
>
> **English:** To report a **security vulnerability** OR a **privacy, confidentiality, or solicitor-client privilege / secrecy issue**, **do not open a public GitHub issue**. Email the maintainer directly:
> **Jason Poirier Lavoie, Lawyer (Québec)** — `jason@poirierlavoie.ca` (acknowledgement within **72 hours**, coordinated disclosure).
> **Never send** real client materials, privileged dossier details, or deployment tokens in an initial disclosure; use synthetic test inputs.

---

## Portée

Dans la portée :
- Le Worker déployé sur `outils.poirierlavoie.ca` (`POST /mcp`, `GET /`, `GET /healthz`) ;
- Les modules sous `src/core/`, `src/mcp/`, `src/qc/`, `src/data/` et `src/site.ts`.

Hors portée :
- Attaques physiques, ingénierie sociale ou attaques volumétriques (DoS) sur le réseau Cloudflare ;
- Publications sources officielles (tables trimestrielles de Revenu Québec art. 28 L.A.F. et relevés publics du ministère de la Justice du Québec).

---

## Architecture de confidentialité par conception (« zéro état, zéro journalisation »)

`pratique-civile-outils` est conçu pour les flux publics sans authentification tout en minimisant toute empreinte de confidentialité :

1. **Zéro base de données et zéro appel sortant :** Aucune base D1, aucun KV, aucun R2 et aucune requête réseau sortante (`openWorldHint: false` sur les six outils). Tout calcul s'exécute en mémoire à partir des règles statutaires et des tables statiques versionnées.
2. **Journalisation désactivée dans [`wrangler.jsonc`](wrangler.jsonc) :**
   - `observability.enabled = false`
   - `observability.logs.enabled = false`, `invocation_logs = false`, `persist = false`
   - `observability.traces.enabled = false`, `logpush = false`, `redact_query_string = true`
   Le code du Worker ne journalise ni les adresses IP, ni les corps de requêtes, ni les paramètres transmis.
3. **Limitation de débit sans stockage de contenu :** Le binding Cloudflare `RATE_LIMITER` limite le point d'accès à **60 requêtes par 60 secondes par IP** (`CF-Connecting-IP`) afin de prévenir les abus tout en ne conservant aucune charge utile applicative (`HTTP 429` avec `Retry-After: 60`).
4. **Hygiène des libellés libres par le praticien :** Les outils attendent des dates, montants en sous et codes de nomenclature judiciaire. Par bonne pratique déontologique, conserver les libellés optionnels (`deadlines[].label`, `tranches[].label`) génériques plutôt que d'y saisir des noms de clients ou informations identifiantes.

---

## Contrôles de sécurité en production (`src/index.ts`)

- **Défense contre le ré-attachement DNS (`Host` check) :** Validation stricte de l'en-tête `Host` contre `ALLOWED_HOSTNAMES` et `localhostAllowedHostnames()` (`HTTP 403 Forbidden host`).
- **Bornage strict des requêtes MCP :**
  - Taille maximale du corps HTTP plafonnée à `65 536` octets (`MAX_MCP_BODY_BYTES`, vérifié sur `Content-Length` et sur le tampon lu ⇒ `HTTP 413`).
  - Rejet des requêtes JSON-RPC par lots (tableaux) et des `id` non scalaires (`HTTP 400`, erreur JSON-RPC `-32600`).
  - Validation de schémas fermée via `zod`, erreurs d'arguments retournées en `{ content: [...], isError: true }` sans jamais lever d'erreur `500`.
- **Page publique HTML (`GET /`) :** Sans secret, sans en-tête CORS (`Access-Control-Allow-Origin` absent), politique `Content-Security-Policy: default-src 'none' ... frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, aucune dépendance externe (vérifié par `test/site.test.ts`).

---

## Reproduction hors ligne de la suite de tests

La suite complète (`test/`, 223 tests dont les tests différentiels et de page publique) s'exécute localement sans réseau ni secret :

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
```
