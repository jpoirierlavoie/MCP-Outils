import {
  localhostAllowedHostnames,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import bocPrimeRatesJson from "./data/boc_prime_rates.json" with { type: "json" };
import lafRatesJson from "./data/laf_art28_rates.json" with { type: "json" };
import {
  createOutilsMcpServer,
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

export const SERVER_CARD_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";

export const SERVER_CARD_CONTENT_TYPE = "application/mcp-server-card+json; charset=utf-8";

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
        supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
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

function repondreCarteServeur(method: string): Response {
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Accept, Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  if (method !== "GET" && method !== "HEAD") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Allow: "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  const headers: Record<string, string> = {
    "Content-Type": SERVER_CARD_CONTENT_TYPE,
    "Cache-Control": "public, max-age=600",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
  };
  return method === "HEAD"
    ? new Response(null, { status: 200, headers })
    : new Response(JSON.stringify(carteServeur()), { status: 200, headers });
}

const MAX_MCP_BODY_BYTES = 65_536;

const DEFAULT_ALLOWED_HOSTNAMES = Array.from(
  new Set(["outils.poirierlavoie.ca", ...localhostAllowedHostnames()]),
);

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

function buildHandler(allowedHostnames: string[], env: Env) {
  return createMcpHandler(() => createOutilsMcpServer(env), {
    route: "/mcp",
    allowedHostnames,
    allowedOriginHostnames: "*",
  });
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

function healthzResponse(env: Env): Response {
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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    if (url.pathname === "/healthz" && (request.method === "GET" || request.method === "HEAD")) {
      return healthzResponse(env);
    }
    if (url.pathname === "/mcp/server-card") {
      return repondreCarteServeur(request.method);
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
              "Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id, Accept",
            "Access-Control-Max-Age": "86400",
          },
        });
      }

      const handler = buildHandler(allowedHostnames, env);

      const rawAccept = request.headers.get("accept");
      const wantsSse = Boolean(rawAccept?.includes("text/event-stream"));

      let mcpRequest = request;
      if (request.method === "POST") {
        const declaredLength = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(declaredLength) && declaredLength > MAX_MCP_BODY_BYTES) {
          return Response.json(
            { error: "Payload Too Large (max 64 KiB)" },
            { status: 413, headers: { "Cache-Control": "no-store" } },
          );
        }

        const rawBytes = new Uint8Array(await request.arrayBuffer());
        if (rawBytes.byteLength > MAX_MCP_BODY_BYTES) {
          return Response.json(
            { error: "Payload Too Large (max 64 KiB)" },
            { status: 413, headers: { "Cache-Control": "no-store" } },
          );
        }

        let parsed: unknown;
        let isValidJson = false;
        try {
          parsed = JSON.parse(new TextDecoder().decode(rawBytes));
          isValidJson = true;
        } catch {
          // Malformed JSON falls through to the MCP handler so JSON-RPC returns -32700.
        }

        if (
          isValidJson &&
          (Array.isArray(parsed) ||
            (typeof parsed === "object" &&
              parsed !== null &&
              "id" in parsed &&
              (parsed as { id: unknown }).id !== null &&
              typeof (parsed as { id: unknown }).id === "object"))
        ) {
          return Response.json(
            {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32600, message: "Invalid Request" },
            },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          );
        }

        const headers = new Headers(request.headers);
        if (!wantsSse || !rawAccept?.includes("application/json")) {
          headers.set("accept", "application/json, text/event-stream");
        }
        mcpRequest = new Request(request.url, {
          method: "POST",
          headers,
          body: rawBytes,
        });
      }

      const response = await handler(mcpRequest, env, ctx);

      if (
        !wantsSse &&
        request.method === "POST" &&
        response.headers.get("content-type")?.includes("text/event-stream")
      ) {
        const text = await response.text();
        const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data: "));
        if (dataLine) {
          const jsonText = dataLine.slice(6);
          return new Response(jsonText, {
            status: response.status,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });
        }
      }

      return response;
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
