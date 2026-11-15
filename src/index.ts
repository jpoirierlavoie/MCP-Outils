import { localhostAllowedHostnames } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import lafRatesJson from "./data/laf_art28_rates.json" with { type: "json" };
import {
  createOutilsMcpServer,
  listToolDescriptors,
  SERVER_NAME,
  SERVER_VERSION,
} from "./mcp/server.js";
import { pagePubliqueHtml } from "./site.js";

export interface Env {
  RATE_LIMITER?: RateLimit;
  ALLOWED_HOSTNAMES?: string;
}

const DEFAULT_ALLOWED_HOSTNAMES = Array.from(
  new Set(["outils.poirierlavoie.ca", ...localhostAllowedHostnames()]),
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
    },
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
    if (env.RATE_LIMITER) {
      const clientIp = request.headers.get("CF-Connecting-IP") ?? "anonymous";
      const outcome = await env.RATE_LIMITER.limit({ key: clientIp });
      if (!outcome.success) {
        return rateLimitExceededResponse();
      }
    }

    const url = new URL(request.url);
    if (url.pathname === "/healthz" && (request.method === "GET" || request.method === "HEAD")) {
      return healthzResponse();
    }
    if (url.pathname === "/") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
      }
      return pagePublique(request);
    }
    if (url.pathname === "/mcp") {
      const handler = env.ALLOWED_HOSTNAMES
        ? buildHandler(buildAllowedHostnames(env.ALLOWED_HOSTNAMES))
        : defaultMcpHandler;

      const rawAccept = request.headers.get("accept");
      const wantsSse = Boolean(rawAccept?.includes("text/event-stream"));

      let mcpRequest = request;
      if (request.method === "POST" && (!wantsSse || !rawAccept?.includes("application/json"))) {
        const headers = new Headers(request.headers);
        headers.set("accept", "application/json, text/event-stream");
        mcpRequest = new Request(request, { headers });
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
