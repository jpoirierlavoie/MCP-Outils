# Security, Privacy & Professional Secrecy Policy / Politique de sécurité, confidentialité et secret professionnel

> **Français :** Ce dépôt héberge le connecteur MCP sans journalisation **`MCP-Outils`** (`mcp-outils`, Worker Cloudflare `outils`, `https://outils.poirierlavoie.ca/mcp/oauth` et `/mcp`), déployé sur Cloudflare Workers pour le calcul déterministe (jours fériés, délais C.p.c./L.I., intérêts art. 1619 C.c.Q., fixation de loyer TAL), l'annuaire statique des greffes et palais de justice du Québec et la consultation locale en lecture seule de jeux de données ouvertes (registres d'entreprises dont GLEIF, adresses RQA, terminologie juridique bilingue, taux Banque du Canada, IPC Statistique Canada et loyers SCHL), en appui au greffon [`droit-civil-quebecois`](https://github.com/jpoirierlavoie/droit-civil-quebecois) (`v3.5.0`) et gouverné avec `MCP-Legislation` et `MCP-Jurisprudence` via [`MCP-Acces`](https://github.com/jpoirierlavoie/MCP-Acces) (`acces.poirierlavoie.ca`).
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
- Le Worker `outils` déployé sur `outils.poirierlavoie.ca` (`POST /mcp/oauth`, `POST /mcp`, `GET /.well-known/oauth-protected-resource/mcp/oauth`, `GET /mcp/server-card`, `GET /.well-known/mcp/server-card.json`, `GET /`, `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `GET /health` et alias `/healthz`) ;
- Les modules sous `src/index.ts`, `src/auth.ts`, `src/core/`, `src/mcp/`, `src/qc/`, `src/data/`, `src/site.ts`, `src/site.i18n.ts` et les pipelines d'ingestion hors ligne sous `pipeline/`.

Hors portée :
- Attaques physiques, ingénierie sociale ou attaques volumétriques (DoS) sur le réseau Cloudflare ;
- Publications sources officielles externes (Revenu Québec, MJQ, Registraire des entreprises, RBQ, OPC, AMP, Corporations Canada, GLEIF, MRNF, Bureau de la traduction, OQLF, Banque du Canada, Statistique Canada / SCHL, TAL / LégisQuébec).

---

## Architecture de confidentialité par conception (« accès vérifié, zéro appel sortant, zéro journalisation »)

`MCP-Outils` n'est pas un point d'accès anonyme : il requiert un accès gratuit approuvé pour les membres actifs en règle du Barreau du Québec via [`acces.poirierlavoie.ca`](https://acces.poirierlavoie.ca) (`MCP-Acces`). `/mcp/oauth` (OAuth 2.1 + PKCE `S256`, refus `401` RFC 9728) est le mode par défaut des manifestes clients (`mcp_config.json`, `gemini-extension.json` et `.mcp.json` du greffon), tandis que `/mcp` (jeton Bearer personnel ou `?key=`, refus silencieux `404`) vise les CLI/API sans navigateur. Sur fourche autonome, le dépôt est entièrement autosuffisant (schémas et migrations embarqués sous `pipeline/`, repli par secret statique `MCP_TOKEN` / `MCP_TOKEN_VEILLE` / `MCP_SHARED_SECRET` sans `DB_IDENTITE` ni `MCP-Acces`). La clé API CanLII est facultative sur `/demande` (gérable dans `/moi`) et requise **uniquement** pour `juris` (`MCP-Jurisprudence`), jamais pour `outils` ni `lois`, et toute persistance du contenu des requêtes est éliminée :

1. **Bases D1 strictement en lecture seule à la requête et zéro appel sortant :** Les quatre bases Cloudflare D1 (`DB_TERMINOLOGIE`, `DB_REGISTRES`, `DB_ADRESSES`, `DB_ECONOMIE`, région `ENAM`) hébergent uniquement des instantanés publics de données ouvertes préchargés hors ligne. À la requête, aucune écriture sur ces 4 bases, aucun KV/R2 et aucun appel HTTP sortant (`openWorldHint: false`, `readOnlyHint: true` sur les 15 outils) ne sont effectués ; seuls des compteurs agrégés sans contenu (`local`, plafond `3 000`/j actif et `300`/j limité) et des événements techniques sans paramètres sont inscrits dans `DB_IDENTITE` lorsqu'elle est liée. Aucun nom d'entreprise, aucune adresse civique et aucun extrait de projet d'acte soumis à l'outil ne quitte l'isolat Cloudflare ni n'est enregistré.
2. **Exclusion stricte des personnes physiques protégées aux registres :** Les dirigeants, administrateurs et actionnaires personnes physiques sont exclus du jeu ouvert du REQ (L.P.L.E.), et les inscriptions RENA visant des personnes physiques sont purgées lors de l'ingestion hors ligne (`REGISTRE_ABSENCE_PERSONNES_PHYSIQUES`). Les dispenses d'adresse publiées au REQ sont intégralement respectées.
3. **Journalisation désactivée dans [`wrangler.jsonc`](wrangler.jsonc) :**
   - `observability.enabled = false`
   - `observability.logs.enabled = false`, `invocation_logs = false`, `persist = false`
   - `observability.traces.enabled = false`, `logpush = false`, `redact_query_string = true`
   Le code du Worker ne journalise ni les adresses IP, ni les corps de requêtes, ni les paramètres transmis.
4. **Limitation de débit sans stockage de contenu (`1041`–`1045`) :** Cinq limiteurs Cloudflare distincts protègent les points MCP (`RL_PRE_AUTH_IP` 600/min/IP, `RL_ECHEC_IP` 20/min/IP + quarantaine mémoire, `RL_ECHECS_GLOBAL` 300/min, `RL_TITULAIRE` 300/min, `RL_TITULAIRE_LIMITE` 20/min) sans stocker aucune charge utile applicative.
5. **Prudence en mode Deep Research autonome :** Lors d'exécutions autonomes (`Claude Research`, `Gemini API Deep Research` avec `store=True`), l'agent hôte peut lancer parallèlement des recherches web ouvertes ou archiver la session : ne jamais inclure de noms de clients, numéros de dossier ou faits confidentiels dans les invites soumises au modèle.

---

## Contrôles de sécurité en production (`src/index.ts`)

- **Double porte d'authentification et coupe-circuit `MCP_ENABLED` :** `/mcp/oauth` répond `401` avec en-tête RFC 9728 (`/.well-known/oauth-protected-resource/mcp/oauth`, `scopes_supported: ["outils", "tous"]`) et accepte uniquement les jetons OAuth D1 de portée `outils` / `tous` (ou héritée `les_deux`) ; `/mcp` (et `/mcp/<jeton>`) répond `404` vide sans jeton valide et accepte soit un jeton D1 de même portée, soit un secret statique (`MCP_TOKEN` / `MCP_TOKEN_VEILLE` / `MCP_SHARED_SECRET`) pour les scripts et fourches autonomes sans `DB_IDENTITE` ; `MCP_ENABLED !== "true"` ferme `/health` (`/healthz`), les métadonnées OAuth et les routes MCP en `404` tout en préservant `/`, les fichiers de découverte publique et `/mcp/server-card`. Le contrôle d'origine CORS (`ALLOWED_ORIGINS`) rejette toute origine navigateur non autorisée en `403`, sans verrouillage restrictif de l'en-tête `Host` afin de permettre les déploiements sur `*.workers.dev`.
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
