import { describe, expect, it } from "vitest";
import { ComputeDeadlinesOutputSchema } from "../src/core/deadlines.js";
import { ListHolidaysOutputSchema } from "../src/core/holidays.js";
import { ComputeInterest1619OutputSchema } from "../src/core/interest1619.js";
import {
  PalaisGetOutputSchema,
  PalaisListOutputSchema,
  ParseCourtFileOutputSchema,
} from "../src/core/qcTools.js";
import worker, { Env } from "../src/index.js";

const dummyCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

interface JsonRpcResponseBody {
  jsonrpc: string;
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function parseMcpResponse(response: Response): Promise<JsonRpcResponseBody> {
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  if (contentType.includes("application/json")) {
    return JSON.parse(raw) as JsonRpcResponseBody;
  }
  const dataLine = raw.split(/\r?\n/).find((line) => line.startsWith("data: "));
  if (!dataLine) {
    throw new Error(`Réponse MCP inattendue (${contentType}) : ${raw}`);
  }
  return JSON.parse(dataLine.slice(6)) as JsonRpcResponseBody;
}

async function mcpPost(
  method: string,
  params: Record<string, unknown>,
  id = 1,
  url = "https://outils.poirierlavoie.ca/mcp",
  env: Env = {},
): Promise<{ status: number; body: JsonRpcResponseBody }> {
  const host = new URL(url).host;
  const req = new Request(url, {
    method: "POST",
    headers: {
      Host: host,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });
  const res = await worker.fetch(req, env, dummyCtx);
  const body = await parseMcpResponse(res);
  return { status: res.status, body };
}

describe("Worker HTTP & intégration MCP", () => {
  it("répond sur GET /healthz, GET /, HEAD /, rejette POST / en 405 et renvoie 404 hors route", async () => {
    const health = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/healthz"),
      {},
      dummyCtx,
    );
    expect(health.status).toBe(200);
    const healthJson = (await health.json()) as Record<string, unknown>;
    expect(healthJson.status).toBe("ok");
    expect(healthJson.version).toBe("0.2.0");
    expect(healthJson.request_payload_logging).toBe(false);
    expect(healthJson.laf_table_last_quarter).toBe("2026-Q4");
    expect(healthJson.tools).toEqual([
      "calendrier_list_holidays",
      "calendrier_compute_deadlines",
      "interets_compute_1619",
      "greffe_parse_court_file_number",
      "palais_list",
      "palais_get",
    ]);

    const landing = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/"),
      {},
      dummyCtx,
    );
    expect(landing.status).toBe(200);
    expect(landing.headers.get("content-type")).toContain("text/html");
    expect(landing.headers.get("access-control-allow-origin")).toBeNull();
    const html = await landing.text();
    expect(html).toContain("pratique-civile-outils");
    expect(html).toContain("greffe_parse_court_file_number");

    const headLanding = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/", { method: "HEAD" }),
      {},
      dummyCtx,
    );
    expect(headLanding.status).toBe(200);
    expect(await headLanding.text()).toBe("");

    const postLanding = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/", { method: "POST" }),
      {},
      dummyCtx,
    );
    expect(postLanding.status).toBe(405);
    expect(postLanding.headers.get("allow")).toBe("GET, HEAD");

    const notFound = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/inconnu"),
      {},
      dummyCtx,
    );
    expect(notFound.status).toBe(404);
  });

  it("valide Host header (accepte outils.poirierlavoie.ca et ALLOWED_HOSTNAMES, rejette un hôte tiers)", async () => {
    const missingHost = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
      {},
      dummyCtx,
    );
    expect(missingHost.status).toBe(403);

    const rejected = await worker.fetch(
      new Request("https://evil.example.com/mcp", {
        method: "POST",
        headers: {
          Host: "evil.example.com",
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
      {},
      dummyCtx,
    );
    expect(rejected.status).toBe(403);

    const customAllowed = await mcpPost("tools/list", {}, 1, "https://staging.example.com/mcp", {
      ALLOWED_HOSTNAMES: "staging.example.com",
    });
    expect(customAllowed.status).toBe(200);
  });

  it("applique la limite de débit (HTTP 429) par CF-Connecting-IP", async () => {
    const seenKeys: string[] = [];
    const env: Env = {
      RATE_LIMITER: {
        limit: async ({ key }) => {
          seenKeys.push(key);
          return { success: false };
        },
      },
    };
    const res = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/mcp", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "198.51.100.42",
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: "{}",
      }),
      env,
      dummyCtx,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(seenKeys).toEqual(["198.51.100.42"]);
  });

  it("expose les 6 outils via tools/list et retourne des résultats conformes aux outputSchema", async () => {
    const listRes = await mcpPost("tools/list", {});
    expect(listRes.status).toBe(200);
    const tools = (listRes.body.result?.tools as Array<{ name: string }>) ?? [];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "calendrier_compute_deadlines",
      "calendrier_list_holidays",
      "greffe_parse_court_file_number",
      "interets_compute_1619",
      "palais_get",
      "palais_list",
    ]);

    const holidaysCall = await mcpPost("tools/call", {
      name: "calendrier_list_holidays",
      arguments: { year: 2026, regime: "qc_cpc" },
    });
    expect(holidaysCall.status).toBe(200);
    expect(holidaysCall.body.result?.isError).not.toBe(true);
    const hStructured = ListHolidaysOutputSchema.parse(holidaysCall.body.result?.structuredContent);
    expect(hStructured.count).toBe(11);

    const deadlinesCall = await mcpPost("tools/call", {
      name: "calendrier_compute_deadlines",
      arguments: {
        event_date: "2026-07-03",
        event_time: "17:40",
        notification_mode: "technological",
        regime: "qc_cpc",
        deadlines: [{ label: "Réponse", amount: 15, unit: "days" }],
      },
    });
    expect(deadlinesCall.status).toBe(200);
    const dStructured = ComputeDeadlinesOutputSchema.parse(
      deadlinesCall.body.result?.structuredContent,
    );
    expect(dStructured.results[0]!.effective_anchor_date).toBe("2026-07-06");
    expect(dStructured.results[0]!.effective_date).toBe("2026-07-21");

    const interestCall = await mcpPost("tools/call", {
      name: "interets_compute_1619",
      arguments: {
        mode: "legal_plus_1619",
        end_date: "2025-12-31",
        tranches: [{ principal_cents: 10_000_000, start_date: "2024-12-31" }],
      },
    });
    expect(interestCall.status).toBe(200);
    const iStructured = ComputeInterest1619OutputSchema.parse(
      interestCall.body.result?.structuredContent,
    );
    expect(iStructured.total_interest_cents).toBe(824_658);

    // Date invalide via MCP -> isError: true sans plantage HTTP 500
    const badDateCall = await mcpPost("tools/call", {
      name: "calendrier_compute_deadlines",
      arguments: {
        event_date: "2025-02-29",
        deadlines: [{ amount: 10, unit: "days" }],
      },
    });
    expect(badDateCall.status).toBe(200);
    expect(badDateCall.body.result?.isError).toBe(true);

    const dossierCall = await mcpPost("tools/call", {
      name: "greffe_parse_court_file_number",
      arguments: { court_file_number: "500-05-123456-241" },
    });
    expect(dossierCall.status).toBe(200);
    expect(dossierCall.body.result?.isError).not.toBe(true);
    const dossierStructured = ParseCourtFileOutputSchema.parse(
      dossierCall.body.result?.structuredContent,
    );
    expect(dossierStructured.outcome).toBe("judicial");
    expect(dossierStructured.greffe_number).toBe("500");

    const palaisListCall = await mcpPost("tools/call", {
      name: "palais_list",
      arguments: { district: "Montréal" },
    });
    expect(palaisListCall.status).toBe(200);
    expect(palaisListCall.body.result?.isError).not.toBe(true);
    const palaisListStructured = PalaisListOutputSchema.parse(
      palaisListCall.body.result?.structuredContent,
    );
    expect(palaisListStructured.count).toBe(1);

    const palaisGetCall = await mcpPost("tools/call", {
      name: "palais_get",
      arguments: { greffe_number: "500" },
    });
    expect(palaisGetCall.status).toBe(200);
    expect(palaisGetCall.body.result?.isError).not.toBe(true);
    const palaisGetStructured = PalaisGetOutputSchema.parse(
      palaisGetCall.body.result?.structuredContent,
    );
    expect(palaisGetStructured.palais?.name).toBe("Montréal");

    const palaisGetXor = await mcpPost("tools/call", {
      name: "palais_get",
      arguments: { greffe_number: "500", palais: "Montréal" },
    });
    expect(palaisGetXor.status).toBe(200);
    expect(palaisGetXor.body.result?.isError).toBe(true);
    expect(palaisGetXor.body.result?.structuredContent).toBeUndefined();
  });

  it("gère la négociation de contenu HTTP Accept (application/json, sans Accept, */*, SSE)", async () => {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 42,
      method: "tools/list",
      params: {},
    });

    // 1. Accept: application/json
    const reqJson = new Request("https://outils.poirierlavoie.ca/mcp", {
      method: "POST",
      headers: {
        Host: "outils.poirierlavoie.ca",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: payload,
    });
    const resJson = await worker.fetch(reqJson, {}, dummyCtx);
    expect(resJson.status).toBe(200);
    expect(resJson.headers.get("content-type")).toContain("application/json");
    const bodyJson = (await resJson.json()) as JsonRpcResponseBody;
    expect(bodyJson.jsonrpc).toBe("2.0");
    expect(bodyJson.id).toBe(42);
    expect(bodyJson.result).toBeDefined();

    // 2. Accept omis
    const reqOmitted = new Request("https://outils.poirierlavoie.ca/mcp", {
      method: "POST",
      headers: {
        Host: "outils.poirierlavoie.ca",
        "Content-Type": "application/json",
      },
      body: payload,
    });
    const resOmitted = await worker.fetch(reqOmitted, {}, dummyCtx);
    expect(resOmitted.status).toBe(200);
    expect(resOmitted.headers.get("content-type")).toContain("application/json");
    const bodyOmitted = (await resOmitted.json()) as JsonRpcResponseBody;
    expect(bodyOmitted.jsonrpc).toBe("2.0");
    expect(bodyOmitted.id).toBe(42);
    expect(bodyOmitted.result).toBeDefined();

    // 3. Accept: */*
    const reqWildcard = new Request("https://outils.poirierlavoie.ca/mcp", {
      method: "POST",
      headers: {
        Host: "outils.poirierlavoie.ca",
        "Content-Type": "application/json",
        Accept: "*/*",
      },
      body: payload,
    });
    const resWildcard = await worker.fetch(reqWildcard, {}, dummyCtx);
    expect(resWildcard.status).toBe(200);
    expect(resWildcard.headers.get("content-type")).toContain("application/json");
    const bodyWildcard = (await resWildcard.json()) as JsonRpcResponseBody;
    expect(bodyWildcard.jsonrpc).toBe("2.0");
    expect(bodyWildcard.id).toBe(42);
    expect(bodyWildcard.result).toBeDefined();

    // 4. Accept: application/json, text/event-stream
    const reqSse = new Request("https://outils.poirierlavoie.ca/mcp", {
      method: "POST",
      headers: {
        Host: "outils.poirierlavoie.ca",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: payload,
    });
    const resSse = await worker.fetch(reqSse, {}, dummyCtx);
    expect(resSse.status).toBe(200);
    expect(resSse.headers.get("content-type")).toContain("text/event-stream");
    const rawSse = await resSse.text();
    expect(rawSse).toContain("data: ");
    const parsedSse = JSON.parse(
      rawSse
        .split(/\r?\n/)
        .find((l) => l.startsWith("data: "))!
        .slice(6),
    ) as JsonRpcResponseBody;
    expect(parsedSse.jsonrpc).toBe("2.0");
    expect(parsedSse.id).toBe(42);
    expect(parsedSse.result).toBeDefined();
  });
});
