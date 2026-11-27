# Security, Privacy & Professional Secrecy Policy / Politique de sécurité, confidentialité et secret professionnel

> **Français :** Ce dépôt héberge le connecteur MCP public et sans journalisation **`MCP-Outils`** (`mcp-outils`, Worker Cloudflare `outils`, `https://outils.poirierlavoie.ca/mcp`), déployé sur Cloudflare Workers pour le calcul déterministe (jours fériés, délais C.p.c./L.I., intérêts art. 1619 C.c.Q., fixation de loyer TAL), l'annuaire statique des greffes et palais de justice du Québec et la consultation locale en lecture seule de jeux de données ouvertes (registres d'entreprises dont GLEIF, adresses RQA, terminologie juridique bilingue, taux Banque du Canada, IPC Statistique Canada et loyers SCHL), en appui au greffon [`droit-civil-quebecois`](https://github.com/jpoirierlavoie/droit-civil-quebecois) (`v3.3.2`) et aux connecteurs authentifiés gérés via [`MCP-Acces`](https://github.com/jpoirierlavoie/MCP-Acces) (`acces.poirierlavoie.ca`).
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
- Le Worker `outils` déployé sur `outils.poirierlavoie.ca` (`POST /mcp`, `GET /mcp/server-card`, `GET /.well-known/mcp/server-card.json`, `GET /`, `GET /health` et alias `/healthz`) ;
- Les modules sous `src/core/`, `src/mcp/`, `src/qc/`, `src/data/`, `src/site.ts` et les pipelines d'ingestion hors ligne sous `pipeline/`.

Hors portée :
- Attaques physiques, ingénierie sociale ou attaques volumétriques (DoS) sur le réseau Cloudflare ;
- Publications sources officielles externes (Revenu Québec, MJQ, Registraire des entreprises, RBQ, OPC, AMP, Corporations Canada, GLEIF, MRNF, Bureau de la traduction, OQLF, Banque du Canada, Statistique Canada / SCHL, TAL / LégisQuébec).

---

## Architecture de confidentialité par conception (« lecture seule, zéro appel sortant, zéro journalisation »)

`MCP-Outils` est conçu pour les flux publics sans authentification tout en éliminant toute fuite ou persistance de données soumises par un avocat :

1. **Bases D1 strictement en lecture seule à la requête et zéro appel sortant :** Les quatre bases Cloudflare D1 (`DB_TERMINOLOGIE`, `DB_REGISTRES`, `DB_ADRESSES`, `DB_ECONOMIE`, région `ENAM`) hébergent uniquement des instantanés publics de données ouvertes préchargés hors ligne. À la requête, aucune écriture (`INSERT`/`UPDATE`/`DELETE`), aucun KV/R2 et aucun appel HTTP sortant (`openWorldHint: false`, `readOnlyHint: true` sur les 15 outils) ne sont effectués. Aucun nom d'entreprise, aucune adresse civique et aucun extrait de projet d'acte soumis à l'outil ne quitte l'isolat Cloudflare ni n'est stocké.
2. **Exclusion stricte des personnes physiques protégées aux registres :** Les dirigeants, administrateurs et actionnaires personnes physiques sont exclus du jeu ouvert du REQ (L.P.L.E.), et les inscriptions RENA visant des personnes physiques sont purgées lors de l'ingestion hors ligne (`REGISTRE_ABSENCE_PERSONNES_PHYSIQUES`). Les dispenses d'adresse publiées au REQ sont intégralement respectées.
3. **Journalisation désactivée dans [`wrangler.jsonc`](wrangler.jsonc) :**
   - `observability.enabled = false`
   - `observability.logs.enabled = false`, `invocation_logs = false`, `persist = false`
   - `observability.traces.enabled = false`, `logpush = false`, `redact_query_string = true`
   Le code du Worker ne journalise ni les adresses IP, ni les corps de requêtes, ni les paramètres transmis.
4. **Limitation de débit sans stockage de contenu :** Le binding Cloudflare `RATE_LIMITER` limite le point d'accès à **240 requêtes par 60 secondes par IP** (`CF-Connecting-IP`) afin de prévenir les abus sans conserver aucune charge utile applicative (`HTTP 429` avec `Retry-After: 60`).
5. **Prudence en mode Deep Research autonome :** Lors d'exécutions autonomes (`Claude Research`, `Gemini API Deep Research` avec `store=True`), l'agent hôte peut lancer parallèlement des recherches web ouvertes ou archiver la session : ne jamais inclure de noms de clients, numéros de dossier ou faits confidentiels dans les invites soumises au modèle.

---

## Contrôles de sécurité en production (`src/index.ts`)

- **Défense contre le ré-attachement DNS (`Host` check) :** Validation stricte de l'en-tête `Host` contre `ALLOWED_HOSTNAMES` et les hôtes locaux (`localhost`, `127.0.0.1`, `[::1]`) (`HTTP 403 Forbidden host`).
- **Bornage strict des requêtes MCP :**
   - Taille maximale du corps HTTP plafonnée à `65 536` octets (`MAX_OCTETS_CORPS_MCP` via `lireCorpsBorne` de `@poirierlavoie/mcp-socle`, vérifié sur `Content-Length` et sur le tampon lu ⇒ `HTTP 413`).
   - Rejet des requêtes JSON-RPC par lots (tableaux) et des `id` non scalaires (`HTTP 400`, erreur JSON-RPC `-32600`).
   - Validation de schémas fermée via `zod` (`z.strictObject`), erreurs d'arguments ou d'absence de binding D1 retournées en `{ content: [...], isError: true }` sans jamais lever d'erreur `500`.
- **Page publique HTML (`GET /`) :** Sans secret, sans en-tête CORS (`Access-Control-Allow-Origin` absent), politique `Content-Security-Policy: default-src 'none' ... frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, aucune dépendance externe (vérifié par `test/site.test.ts`).

---

## Reproduction hors ligne de la suite de tests

La suite complète (`test/`, incluant un harnais `node:sqlite` en mémoire forcé en `PRAGMA query_only = ON`, les tests différentiels, de manifestes et de page publique) s'exécute localement sans réseau ni secret :

```powershell
npm.cmd ci
npm.cmd run type-check
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run audit
```

---

## Gouvernance Git et chaîne d'approvisionnement

- **Rulesets GitHub actifs (`main-integrity`, `immutable-release-tags`, `main-pr-and-ci`) :** Historique linéaire exigé ; suppression et *fast-forward* bloqués sur `main` et sur les étiquettes de version ; contournement administrateur de `main-pr-and-ci` restreint au mode `pull_request` (aucun `push` direct sur `main` ; toute modification passe par Pull Request validée par `CI`, `CodeQL`, `OSV-Scanner` et `Trivy`).
- **Analyse de secrets et chaîne logistique :** GitHub *Secret Scanning* et *Push Protection* activés (complétés en CI par le balayage `secret` de Trivy), Dependabot (`npm`, `github-actions`), Actions épinglées au SHA complet sous `step-security/harden-runner` et OpenSSF Scorecard.
- **Détection de dérive en production :** Le déploiement injecte `--var COMMIT:<sha7>` exposé par `GET /health`, contrôlé après chaque déploiement et quotidiennement via `.github/workflows/verifier-deploiement.yml`.
