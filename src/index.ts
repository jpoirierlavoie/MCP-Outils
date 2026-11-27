import {
  CHEMIN_WELL_KNOWN_CARTE_SERVEUR,
  errorResponse,
  INVALID_REQUEST,
  jsonResponse,
  lireCorpsBorne,
  MAX_OCTETS_CORPS_MCP,
  methodeNonPermise,
  PARSE_ERROR,
  repondreCarteServeur,
  SERVER_CARD_SCHEMA,
  servirRequeteMcp,
} from "@poirierlavoie/mcp-socle";
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
  RATE_LIMITER?: RateLimit;
  ALLOWED_HOSTNAMES?: string;
  COMMIT?: string;
}

const VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"] as const;

export function carteServeur() {
  return {
    $schema: SERVER_CARD_SCHEMA,
    name: `ca.poirierlavoie.outils/${SERVER_NAME}`,
    title: SERVER_TITLE,
    version: SERVER_VERSION,
    description: SERVER_DESCRIPTION,
    websiteUrl: "https://outils.poirierlavoie.ca/",
    repository: {
      url: "https://github.com/jpoirierlavoie/MCP-Outils",
      source: "github" as const,
    },
    remotes: [
      {
        type: "streamable-http" as const,
        url: "https://outils.poirierlavoie.ca/mcp",
        supportedProtocolVersions: [...VERSIONS],
        headers: [] as Array<{
          name: string;
          description: string;
          isRequired: boolean;
          isSecret: boolean;
        }>,
      },
    ],
  };
}

const DEFAULT_ALLOWED_HOSTNAMES = ["outils.poirierlavoie.ca", "localhost", "127.0.0.1", "[::1]"];

function extractHostname(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  const trimmed = hostHeader.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.startsWith("[")) {
    const closeIdx = trimmed.indexOf("]");
    if (closeIdx === -1) return null;
    const remainder = trimmed.slice(closeIdx + 1);
    if (remainder && !/^:\d+$/.test(remainder)) return null;
    return trimmed.slice(0, closeIdx + 1);
  }
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx !== -1) {
    if (!/^:\d+$/.test(trimmed.slice(colonIdx))) return null;
    const host = trimmed.slice(0, colonIdx);
    return host || null;
  }
  return trimmed;
}

function buildAllowedHostnames(extraCsv?: string): string[] {
  if (!extraCsv) return DEFAULT_ALLOWED_HOSTNAMES;
  const extras = extraCsv
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return extras.length > 0
    ? Array.from(new Set([...DEFAULT_ALLOWED_HOSTNAMES, ...extras]))
    : DEFAULT_ALLOWED_HOSTNAMES;
}

function rateLimitExceededResponse(): Response {
  return Response.json(
    {
      error: "Trop de requêtes : limite de débit dépassée. Réessayez plus tard.",
    },
    {
      status: 429,
      headers: {
        "Retry-After": "60",
        "Cache-Control": "no-store",
      },
    },
  );
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

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
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

    if (env.RATE_LIMITER && request.method !== "OPTIONS") {
      const clientIp = request.headers.get("CF-Connecting-IP") ?? "anonymous";
      const outcome = await env.RATE_LIMITER.limit({ key: clientIp });
      if (!outcome.success) {
        return rateLimitExceededResponse();
      }
    }

    if (
      (url.pathname === "/health" || url.pathname === "/healthz") &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return healthResponse(env);
    }
    if (url.pathname === "/mcp/server-card" || url.pathname === CHEMIN_WELL_KNOWN_CARTE_SERVEUR) {
      return repondreCarteServeur(request.method, carteServeur());
    }
    if (url.pathname === "/mcp") {
      const allowedHostnames = env.ALLOWED_HOSTNAMES
        ? buildAllowedHostnames(env.ALLOWED_HOSTNAMES)
        : DEFAULT_ALLOWED_HOSTNAMES;

      const reqHost = extractHostname(request.headers.get("host"));
      if (!reqHost || !allowedHostnames.some((h) => h.toLowerCase() === reqHost)) {
        return Response.json(
          { error: "Forbidden host" },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID, Accept",
            "Access-Control-Max-Age": "86400",
          },
        });
      }

      if (request.method !== "POST") {
        return methodeNonPermise("*");
      }

      const lecture = await lireCorpsBorne(request, MAX_OCTETS_CORPS_MCP);
      if (!lecture.ok) {
        if (lecture.motif === "trop_grand") {
          return jsonResponse(
            errorResponse(null, INVALID_REQUEST, "Payload Too Large (max 64 KiB)"),
            413,
            "*",
          );
        }
        return jsonResponse(errorResponse(null, PARSE_ERROR, "Encodage UTF-8 invalide."), 200, "*");
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
        return jsonResponse(errorResponse(null, INVALID_REQUEST, "Invalid Request"), 400, "*");
      }

      const hdrs = new Headers(request.headers);
      hdrs.delete("content-length");
      const mcpRequest = new Request(request.url, {
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
        appeler: (nom, args) => callOutilsTool(env, nom, args),
        origin: "*",
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
