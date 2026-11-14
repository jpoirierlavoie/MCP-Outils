import { localhostAllowedHostnames } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import lafRatesJson from "./data/laf_art28_rates.json" with { type: "json" };
import {
  SERVER_NAME,
  SERVER_VERSION,
  createOutilsMcpServer,
} from "./mcp/server.js";

export interface Env {
  RATE_LIMITER?: RateLimit;
  ALLOWED_HOSTNAMES?: string;
}

const DEFAULT_ALLOWED_HOSTNAMES = Array.from(
  new Set(["outils.poirierlavoie.ca", ...localhostAllowedHostnames()])
);

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

function buildHandler(allowedHostnames: string[]) {
  return createMcpHandler(() => createOutilsMcpServer(), {
    route: "/mcp",
    allowedHostnames,
    allowedOriginHostnames: "*",
  });
}

const defaultMcpHandler = buildHandler(DEFAULT_ALLOWED_HOSTNAMES);

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
    }
  );
}

function healthzResponse(): Response {
  return Response.json(
    {
      status: "ok",
      service: SERVER_NAME,
      version: SERVER_VERSION,
      endpoint: "/mcp",
      stateless: true,
      request_payload_logging: false,
      laf_table_last_quarter: lafRatesJson.metadata.last_quarter,
      tools: [
        "calendrier_list_holidays",
        "calendrier_compute_deadlines",
        "interets_compute_1619",
      ],
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function landingResponse(): Response {
  return Response.json(
    {
      service: SERVER_NAME,
      version: SERVER_VERSION,
      description:
        "Serveur MCP public, sans état et sans journalisation des charges utiles pour le litige civil québécois (délais procéduraux C.p.c./L.I. et intérêts art. 1619 C.c.Q.).",
      mcp_endpoint: "/mcp",
      health_endpoint: "/healthz",
      tools: [
        "calendrier_list_holidays",
        "calendrier_compute_deadlines",
        "interets_compute_1619",
      ],
      privacy: "Aucune journalisation ni conservation des requêtes, dates ou montants.",
      source: "https://github.com/jpoirierlavoie/pratique-civile-outils",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    }
  );
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    if (env.RATE_LIMITER) {
      const clientIp =
        request.headers.get("CF-Connecting-IP") ?? "anonymous";
      const outcome = await env.RATE_LIMITER.limit({ key: clientIp });
      if (!outcome.success) {
        return rateLimitExceededResponse();
      }
    }

    const url = new URL(request.url);
    if (
      url.pathname === "/healthz" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return healthzResponse();
    }
    if (
      url.pathname === "/" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return landingResponse();
    }
    if (url.pathname === "/mcp") {
      const handler = env.ALLOWED_HOSTNAMES
        ? buildHandler(buildAllowedHostnames(env.ALLOWED_HOSTNAMES))
        : defaultMcpHandler;
      return handler(request, env, ctx);
    }

    return Response.json(
      {
        error: "Not Found",
        mcp_endpoint: "/mcp",
      },
      { status: 404 }
    );
  },
};
