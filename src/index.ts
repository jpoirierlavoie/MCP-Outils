import {
  CHEMIN_WELL_KNOWN_CARTE_SERVEUR,
  type ClasseOutil,
  type CodeErreurTechnique,
  construireRessourceProtegee,
  creerDepotJetonsD1,
  creerQuarantaineIpEchecs,
  drapeau,
  ecrireEvenementTechniqueD1,
  enregistrerEchecAuth,
  err,
  erreurQuotaEpuise,
  errorResponse,
  formaterEvenementTechnique,
  INVALID_REQUEST,
  type InfoClient,
  type IssueTechnique,
  incrementerCompteurJourD1,
  type JsonRpcMessage,
  jsonResponse,
  type Limiteur,
  lireCompteursJourD1,
  lireCorpsBorne,
  lireMeta,
  MAX_OCTETS_CORPS_MCP,
  methodeNonPermise,
  origineAutorisee,
  origineInterdite,
  origineRefusee,
  originesAdmises,
  ouvrirPrincipal,
  PARSE_ERROR,
  PORTEE_UNIVERSELLE,
  type Principal,
  porteursPresentes,
  preflight,
  refuser,
  repondreCarteServeur,
  repondreRessourceProtegee,
  SERVER_CARD_SCHEMA,
  sansBarresFinales,
  servirRequeteMcp,
  type ToolResult,
  tropDeRequetes,
  verifierDebitPreAuth,
  verifierDebitTitulaire,
  verifierQuotaJour,
} from "@poirierlavoie/mcp-socle";
import { PORTE, PORTE_OAUTH, SERVICE_ID } from "./auth.js";
import bocPrimeRatesJson from "./data/boc_prime_rates.json" with { type: "json" };
import lafRatesJson from "./data/laf_art28_rates.json" with { type: "json" };
import talCriteresJson from "./data/tal_criteres.json" with { type: "json" };
import {
  callOutilsTool,
  INSTRUCTIONS,
  listMcpToolDescriptors,
  listToolDescriptors,
  type OutilsBindings,
  SERVER_DESCRIPTION,
  SERVER_NAME,
  SERVER_TITLE,
  SERVER_VERSION,
} from "./mcp/server.js";
import {
  estCheminDecouvertePublique,
  pagePubliqueHtml,
  repondreDecouvertePublique,
} from "./site.js";

export interface Env extends OutilsBindings {
  DB_IDENTITE?: D1Database;
  MCP_TOKEN?: string;
  MCP_TOKEN_VEILLE?: string;
  MCP_SHARED_SECRET?: string;
  MCP_ENABLED?: string;
  ORIGINE_PORTAIL?: string;
  ALLOWED_ORIGINS?: string;
  RL_PRE_AUTH_IP?: Limiteur;
  RL_ECHEC_IP?: Limiteur;
  RL_ECHECS_GLOBAL?: Limiteur;
  RL_TITULAIRE?: Limiteur;
  RL_TITULAIRE_LIMITE?: Limiteur;
  COMMIT?: string;
}

const VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"] as const;
const ORIGINE_SITE = "https://outils.poirierlavoie.ca";
const ORIGINE_PORTAIL_DEFAUT = "https://acces.poirierlavoie.ca";
const META_RESSOURCE_OAUTH_URL = `${ORIGINE_SITE}/.well-known/oauth-protected-resource/mcp/oauth`;
const MOTIF_OUTIL_SUR = /^[A-Za-z0-9_.:-]{1,80}$/;
const KNOWN_TOOL_NAMES = new Set(listToolDescriptors().map((d) => d.name));

export const SCOPE_OAUTH = `${SERVICE_ID} ${PORTEE_UNIVERSELLE}`;

let quarantaine = creerQuarantaineIpEchecs();

export function reinitialiserQuarantaineIpPourTests(): void {
  quarantaine = creerQuarantaineIpEchecs();
}

export function ressourceProtegeeOAuth(originePortail?: string) {
  const portail = sansBarresFinales(originePortail || ORIGINE_PORTAIL_DEFAUT);
  return construireRessourceProtegee({
    resource: `${ORIGINE_SITE}/mcp/oauth`,
    authorizationServers: [portail],
    scopesSupported: [SERVICE_ID, PORTEE_UNIVERSELLE],
    resourceDocumentation: ORIGINE_SITE,
  });
}

export function carteServeur() {
  return {
    $schema: SERVER_CARD_SCHEMA,
    name: `ca.poirierlavoie.outils/${SERVER_NAME}`,
    title: SERVER_TITLE,
    version: SERVER_VERSION,
    description: SERVER_DESCRIPTION,
    websiteUrl: `${ORIGINE_SITE}/`,
    repository: {
      url: "https://github.com/jpoirierlavoie/MCP-Outils",
      source: "github" as const,
    },
    remotes: [
      {
        type: "streamable-http" as const,
        url: `${ORIGINE_SITE}/mcp/oauth`,
        supportedProtocolVersions: [...VERSIONS],
        headers: [] as Array<{
          name: string;
          description: string;
          isRequired: boolean;
          isSecret: boolean;
        }>,
      },
      {
        type: "streamable-http" as const,
        url: `${ORIGINE_SITE}/mcp`,
        supportedProtocolVersions: [...VERSIONS],
        headers: [
          {
            name: "Authorization",
            description:
              "Jeton Bearer personnel émis sur acces.poirierlavoie.ca/moi (ou secret statique d'instance autonome).",
            isRequired: true,
            isSecret: true,
          },
        ],
      },
    ],
  };
}

function healthResponse(env: Env): Response {
  return Response.json(
    {
      status: "ok",
      service: SERVER_NAME,
      version: SERVER_VERSION,
      commit: env.COMMIT?.trim() || "inconnu",
      endpoint: "/mcp",
      stateless: true,
      request_payload_logging: false,
      laf_table_last_quarter: lafRatesJson.metadata.last_quarter,
      prime_table_last_verified_date: bocPrimeRatesJson.metadata.last_verified_date,
      tal_table_last_lease_renewal_end_date: talCriteresJson.metadata.last_lease_renewal_end_date,
      databases: {
        terminologie: Boolean(env.DB_TERMINOLOGIE),
        registres: Boolean(env.DB_REGISTRES),
        adresses: Boolean(env.DB_ADRESSES),
        economie: Boolean(env.DB_ECONOMIE),
      },
      tools: listToolDescriptors().map((t) => t.name),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function pagePublique(request: Request): Response {
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
      "img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "public, max-age=600",
  };
  const html = pagePubliqueHtml();
  return request.method === "HEAD"
    ? new Response(null, { status: 200, headers })
    : new Response(html, { status: 200, headers });
}

function extraireClientInfo(message?: JsonRpcMessage): InfoClient | undefined {
  return lireMeta(message?.params).clientInfo;
}

function planifier(
  ctx: Pick<ExecutionContext, "waitUntil"> | undefined,
  tache: Promise<unknown>,
): void {
  const sure = tache.catch(() => {});
  if (ctx) ctx.waitUntil(sure);
}

function enregistrerEvenementTitulaire(
  dbIdentite: D1Database,
  ctx: Pick<ExecutionContext, "waitUntil"> | undefined,
  principal: Extract<Principal, { type: "titulaire" }>,
  params: {
    outil: string;
    classe: ClasseOutil;
    issue: IssueTechnique;
    code?: CodeErreurTechnique;
    ms?: number;
    clientInfo?: InfoClient;
  },
): void {
  const outilSur = MOTIF_OUTIL_SUR.test(params.outil) ? params.outil : "outil_inconnu";
  planifier(
    ctx,
    ecrireEvenementTechniqueD1(
      dbIdentite,
      formaterEvenementTechnique({
        titulaireId: principal.titulaireId,
        jetonId: principal.jetonId,
        service: SERVICE_ID,
        outil: outilSur,
        classe: params.classe,
        issue: params.issue,
        code: params.code,
        ms: params.ms,
        clientInfo: params.clientInfo,
      }),
    ),
  );
}

function classifierIssueOutil(resultat: ToolResult): {
  issue: IssueTechnique;
  code?: CodeErreurTechnique;
  estErreur: boolean;
  estIntrouvable: boolean;
} {
  if (!resultat.isError) {
    return { issue: "ok", estErreur: false, estIntrouvable: false };
  }
  const texte = resultat.content[0]?.text ?? "";
  if (
    /^(?:Arguments invalides|« arguments » doit être un objet|Erreur de validation)/.test(texte)
  ) {
    return {
      issue: "erreur_usager",
      code: "ARGUMENTS_INVALIDES",
      estErreur: true,
      estIntrouvable: false,
    };
  }
  if (/^Base D1 en lecture seule/.test(texte)) {
    return {
      issue: "refus",
      code: "HORS_SERVICE",
      estErreur: true,
      estIntrouvable: false,
    };
  }
  return { issue: "introuvable", estErreur: false, estIntrouvable: true };
}

async function appelerAvecGouverne(
  env: Env,
  nomBrut: unknown,
  argsBruts: unknown,
  message: JsonRpcMessage | undefined,
  principal: Principal,
  ctx: ExecutionContext,
): Promise<ToolResult> {
  const nom = typeof nomBrut === "string" ? nomBrut : "";
  const clientInfo = extraireClientInfo(message);

  if (!KNOWN_TOOL_NAMES.has(nom)) {
    if (principal.type === "titulaire" && env.DB_IDENTITE) {
      enregistrerEvenementTitulaire(env.DB_IDENTITE, ctx, principal, {
        outil: "outil_inconnu",
        classe: "local",
        issue: "erreur_usager",
        code: "OUTIL_INCONNU",
        ms: 0,
        clientInfo,
      });
    }
    const label = nom.length > 0 ? nom.slice(0, 80) : "(sans nom)";
    return err(`Outil inconnu : ${label}.`);
  }

  if (typeof argsBruts !== "object" || argsBruts === null || Array.isArray(argsBruts)) {
    if (principal.type === "titulaire" && env.DB_IDENTITE) {
      enregistrerEvenementTitulaire(env.DB_IDENTITE, ctx, principal, {
        outil: nom,
        classe: "local",
        issue: "erreur_usager",
        code: "ARGUMENTS_INVALIDES",
        ms: 0,
        clientInfo,
      });
    }
    return err("« arguments » doit être un objet.");
  }

  if (principal.type === "titulaire") {
    if (!env.DB_IDENTITE) {
      return err("Service d'identité temporairement indisponible.");
    }
    let compteurs: Awaited<ReturnType<typeof lireCompteursJourD1>>;
    try {
      compteurs = await lireCompteursJourD1(env.DB_IDENTITE, principal.titulaireId);
    } catch {
      return err("Service d'identité temporairement indisponible.");
    }
    const verdict = verifierQuotaJour(compteurs, "local", principal.etat);
    if (!verdict.autorise) {
      enregistrerEvenementTitulaire(env.DB_IDENTITE, ctx, principal, {
        outil: nom,
        classe: "local",
        issue: "quota",
        code: "QUOTA_EPUISE",
        ms: 0,
        clientInfo,
      });
      return erreurQuotaEpuise(verdict.classe, verdict.plafond);
    }
  }

  const debut = Date.now();
  try {
    const resultat = await callOutilsTool(env, nom, argsBruts);
    const ms = Date.now() - debut;
    if (principal.type === "titulaire" && env.DB_IDENTITE) {
      const bilan = classifierIssueOutil(resultat);
      const evt = formaterEvenementTechnique({
        titulaireId: principal.titulaireId,
        jetonId: principal.jetonId,
        service: SERVICE_ID,
        outil: nom,
        classe: "local",
        issue: bilan.issue,
        code: bilan.code,
        ms,
        clientInfo,
      });
      planifier(
        ctx,
        Promise.all([
          incrementerCompteurJourD1(env.DB_IDENTITE, {
            titulaireId: principal.titulaireId,
            classe: "local",
            estErreur: bilan.estErreur,
            estIntrouvable: bilan.estIntrouvable,
          }),
          ecrireEvenementTechniqueD1(env.DB_IDENTITE, evt),
        ]),
      );
    }
    return resultat;
  } catch (erreur) {
    const ms = Date.now() - debut;
    if (principal.type === "titulaire" && env.DB_IDENTITE) {
      enregistrerEvenementTitulaire(env.DB_IDENTITE, ctx, principal, {
        outil: nom,
        classe: "local",
        issue: "refus",
        code: "ERREUR_INTERNE",
        ms,
        clientInfo,
      });
    }
    throw erreur;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const admises = originesAdmises(env.ALLOWED_ORIGINS);
    const origin = origineAutorisee(request, admises);

    if (url.pathname === "/") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
      }
      return pagePublique(request);
    }

    if (estCheminDecouvertePublique(url.pathname)) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
      }
      return repondreDecouvertePublique(url.pathname, request.method);
    }

    if (url.pathname === "/mcp/server-card" || url.pathname === CHEMIN_WELL_KNOWN_CARTE_SERVEUR) {
      return repondreCarteServeur(request.method, carteServeur());
    }

    const estSante = url.pathname === "/health" || url.pathname === "/healthz";
    const estMetaOAuth = url.pathname === "/.well-known/oauth-protected-resource/mcp/oauth";
    const estMcpOAuth = url.pathname === "/mcp/oauth" || url.pathname.startsWith("/mcp/oauth/");
    const estMcpDirect =
      !estMcpOAuth && (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/"));

    if (estSante || estMetaOAuth || estMcpOAuth || estMcpDirect) {
      if (!drapeau(env.MCP_ENABLED, false)) {
        return refuser("404", origin);
      }

      if (estSante) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response("Method not allowed", {
            status: 405,
            headers: { Allow: "GET, HEAD" },
          });
        }
        return healthResponse(env);
      }

      if (estMetaOAuth) {
        return repondreRessourceProtegee(
          request.method,
          ressourceProtegeeOAuth(env.ORIGINE_PORTAIL),
        );
      }

      if (origineRefusee(request, admises)) return origineInterdite();

      if (request.method === "OPTIONS" && origin) return preflight(origin);

      const porte = estMcpOAuth ? PORTE_OAUTH : PORTE;
      const refuserAcces = () =>
        estMcpOAuth
          ? refuser("401", origin, {
              resourceMetadata: META_RESSOURCE_OAUTH_URL,
              scope: SCOPE_OAUTH,
            })
          : refuser("404", origin);

      const ip = request.headers.get("CF-Connecting-IP") ?? "sans-ip";
      const candidatsJetons = porteursPresentes(request, url, porte);
      const preAuthOk = await verifierDebitPreAuth({
        ip,
        quarantaine,
        limiteurRafaleIp: env.RL_PRE_AUTH_IP,
        candidatsJetons,
      });
      if (!preAuthOk) {
        return estMcpOAuth ? tropDeRequetes(60, origin) : refuser("404", origin);
      }

      const depot = env.DB_IDENTITE ? creerDepotJetonsD1(env.DB_IDENTITE) : undefined;
      const autorise = await ouvrirPrincipal(
        request,
        url,
        env as unknown as Record<string, unknown>,
        porte,
        {
          depot,
          service: SERVICE_ID,
          planifierArrierePlan: (tache) => ctx.waitUntil(tache),
          surEmpreinteValide: (h) => quarantaine.marquerEmpreinteValide(h),
        },
      );
      if (!autorise) {
        await enregistrerEchecAuth({
          ip,
          quarantaine,
          limiteurEchecIp: env.RL_ECHEC_IP,
          limiteurEchecsGlobal: env.RL_ECHECS_GLOBAL,
          candidatsJetons,
        });
        return refuserAcces();
      }

      if (request.method !== "POST") return methodeNonPermise(origin);

      if (autorise.principal.type === "titulaire") {
        const refusDebit = await verifierDebitTitulaire({
          titulaireId: autorise.principal.titulaireId,
          etat: autorise.principal.etat,
          limiteurActif: env.RL_TITULAIRE,
          limiteurLimite: env.RL_TITULAIRE_LIMITE,
          origin,
        });
        if (refusDebit) return refusDebit;
      }

      const lecture = await lireCorpsBorne(autorise.requete, MAX_OCTETS_CORPS_MCP);
      if (!lecture.ok) {
        if (lecture.motif === "trop_grand") {
          return jsonResponse(
            errorResponse(null, INVALID_REQUEST, "Payload Too Large (max 64 KiB)"),
            413,
            origin,
          );
        }
        return jsonResponse(
          errorResponse(null, PARSE_ERROR, "Encodage UTF-8 invalide."),
          200,
          origin,
        );
      }

      let parsed: unknown;
      let isValidJson = false;
      try {
        parsed = JSON.parse(lecture.texte);
        isValidJson = true;
      } catch {}

      if (
        isValidJson &&
        (Array.isArray(parsed) ||
          (typeof parsed === "object" &&
            parsed !== null &&
            "id" in parsed &&
            (parsed as { id: unknown }).id !== null &&
            typeof (parsed as { id: unknown }).id === "object"))
      ) {
        return jsonResponse(errorResponse(null, INVALID_REQUEST, "Invalid Request"), 400, origin);
      }

      const hdrs = new Headers(autorise.requete.headers);
      hdrs.delete("content-length");
      const mcpRequest = new Request(autorise.requete.url, {
        method: "POST",
        headers: hdrs,
        body: lecture.texte,
      });

      const mcpResponse = await servirRequeteMcp(mcpRequest, {
        versions: VERSIONS,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: SERVER_NAME,
          title: SERVER_TITLE,
          version: SERVER_VERSION,
        },
        instructions: INSTRUCTIONS,
        descripteurs: listMcpToolDescriptors,
        appeler: (nom, args, message) =>
          appelerAvecGouverne(env, nom, args, message, autorise.principal, ctx),
        origin,
        sertAvant2025_06_18: true,
        ttlListeMs: 3_600_000,
      });

      if (mcpResponse.status === 404) {
        return new Response(mcpResponse.body, {
          status: 200,
          headers: mcpResponse.headers,
        });
      }

      return mcpResponse;
    }

    return Response.json(
      {
        error: "Not Found",
        mcp_endpoint: "/mcp",
      },
      { status: 404 },
    );
  },
};
