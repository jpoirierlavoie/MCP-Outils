import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AdresseVerifyOutputSchema, computeConsonantKey } from "../src/core/adresses.js";
import { ComputeDeadlinesOutputSchema } from "../src/core/deadlines.js";
import { TauxBocRatesOutputSchema } from "../src/core/economie.js";
import { ListHolidaysOutputSchema } from "../src/core/holidays.js";
import { ComputeInterest1619OutputSchema } from "../src/core/interest1619.js";
import {
  PalaisGetOutputSchema,
  PalaisListOutputSchema,
  ParseCourtFileOutputSchema,
} from "../src/core/qcTools.js";
import {
  RegistreGetEntityOutputSchema,
  RegistreSearchEntitiesOutputSchema,
} from "../src/core/registres.js";
import {
  TerminologieAttestationsOutputSchema,
  TerminologieLookupOutputSchema,
  TerminologieScanTextOutputSchema,
} from "../src/core/terminologie.js";
import worker, { Env } from "../src/index.js";
import { createSqliteD1Harness } from "./helpers/sqliteD1.js";

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
    expect(healthJson.service).toBe("mcp-outils");
    expect(healthJson.version).toBe("2.2.0");
    expect(healthJson.commit).toBe("inconnu");
    expect(healthJson.request_payload_logging).toBe(false);

    const healthWithCommit = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/healthz"),
      { COMMIT: "abc1234" },
      dummyCtx,
    );
    expect(healthWithCommit.status).toBe(200);
    const healthCommitJson = (await healthWithCommit.json()) as Record<string, unknown>;
    expect(healthCommitJson.commit).toBe("abc1234");
    expect(healthJson.laf_table_last_quarter).toBe("2026-Q4");
    expect(typeof healthJson.prime_table_last_verified_date).toBe("string");
    expect(healthJson.databases).toEqual({
      terminologie: false,
      registres: false,
      adresses: false,
      economie: false,
    });
    expect(healthJson.tools).toEqual([
      "calendrier_holidays",
      "calendrier_deadlines",
      "interets_1619",
      "greffe_parse_number",
      "palais_list",
      "palais_get",
      "registre_search",
      "registre_get_entity",
      "adresse_verify",
      "terminologie_lookup",
      "termino_attestations",
      "terminologie_scan",
      "taux_boc_rates",
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
    expect(html).toContain("mcp-outils");
    expect(html).toContain("MCP Outils");
    expect(html).toContain("greffe_parse_number");

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

    // SEP-2127 : fiche publique de découverte /mcp/server-card (GET, HEAD, OPTIONS, 405, 404 hors exactitude)
    const cardRes = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/mcp/server-card", {
        headers: { Origin: "https://exemple.invalide" },
      }),
      {},
      dummyCtx,
    );
    expect(cardRes.status).toBe(200);
    expect(cardRes.headers.get("content-type")).toBe(
      "application/mcp-server-card+json; charset=utf-8",
    );
    expect(cardRes.headers.get("access-control-allow-origin")).toBe("*");
    expect(cardRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(cardRes.headers.get("cache-control")).toContain("max-age=600");
    const cardBody = (await cardRes.json()) as {
      $schema: string;
      name: string;
      title: string;
      version: string;
      description: string;
      websiteUrl: string;
      repository: { url: string; source: string };
      remotes: Array<{
        type: string;
        url: string;
        supportedProtocolVersions: string[];
        headers: unknown[];
      }>;
    };
    expect(cardBody.$schema).toBe(
      "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    );
    expect(cardBody.name).toBe("ca.poirierlavoie.outils/mcp-outils");
    expect(cardBody.title).toBe("MCP Outils");
    expect(cardBody.version).toBe("2.2.0");
    expect(cardBody.websiteUrl).toBe("https://outils.poirierlavoie.ca/");
    expect(cardBody.repository).toEqual({
      url: "https://github.com/jpoirierlavoie/MCP-Outils",
      source: "github",
    });
    expect(cardBody.remotes).toHaveLength(1);
    expect(cardBody.remotes[0]?.type).toBe("streamable-http");
    expect(cardBody.remotes[0]?.url).toBe("https://outils.poirierlavoie.ca/mcp");
    expect(cardBody.remotes[0]?.supportedProtocolVersions.length).toBeGreaterThanOrEqual(3);
    expect(cardBody.remotes[0]?.headers).toEqual([]);

    const cardHead = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/mcp/server-card", { method: "HEAD" }),
      {},
      dummyCtx,
    );
    expect(cardHead.status).toBe(200);
    expect(cardHead.headers.get("content-type")).toBe(
      "application/mcp-server-card+json; charset=utf-8",
    );
    expect(await cardHead.text()).toBe("");

    const cardOpt = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/mcp/server-card", { method: "OPTIONS" }),
      {},
      dummyCtx,
    );
    expect(cardOpt.status).toBe(204);
    expect(cardOpt.headers.get("access-control-allow-origin")).toBe("*");
    expect(cardOpt.headers.get("access-control-allow-methods")).toContain("GET");

    for (const badMethod of ["POST", "DELETE"]) {
      const badRes = await worker.fetch(
        new Request("https://outils.poirierlavoie.ca/mcp/server-card", { method: badMethod }),
        {},
        dummyCtx,
      );
      expect(badRes.status, badMethod).toBe(405);
      expect(badRes.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    }

    for (const wrongPath of ["/server-card", "/.well-known/mcp.json", "/mcp/server-card/"]) {
      const r404 = await worker.fetch(
        new Request(`https://outils.poirierlavoie.ca${wrongPath}`),
        {},
        dummyCtx,
      );
      expect(r404.status, wrongPath).toBe(404);
    }
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

  it("expose les 13 outils via tools/list et retourne des résultats conformes aux outputSchema", async () => {
    const listRes = await mcpPost("tools/list", {});
    expect(listRes.status).toBe(200);
    const tools =
      (listRes.body.result?.tools as Array<{
        name: string;
        annotations?: { openWorldHint?: boolean; readOnlyHint?: boolean };
      }>) ?? [];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "adresse_verify",
      "calendrier_deadlines",
      "calendrier_holidays",
      "greffe_parse_number",
      "interets_1619",
      "palais_get",
      "palais_list",
      "registre_get_entity",
      "registre_search",
      "taux_boc_rates",
      "termino_attestations",
      "terminologie_lookup",
      "terminologie_scan",
    ]);
    for (const t of tools) {
      expect(t.annotations?.openWorldHint).toBe(false);
      expect(t.annotations?.readOnlyHint).toBe(true);
    }

    const holidaysCall = await mcpPost("tools/call", {
      name: "calendrier_holidays",
      arguments: { year: 2026, regime: "qc_cpc" },
    });
    expect(holidaysCall.status).toBe(200);
    expect(holidaysCall.body.result?.isError).not.toBe(true);
    const hStructured = ListHolidaysOutputSchema.parse(holidaysCall.body.result?.structuredContent);
    expect(hStructured.count).toBe(11);

    const deadlinesCall = await mcpPost("tools/call", {
      name: "calendrier_deadlines",
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

    const initRes = await mcpPost("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "vitest", version: "1.0.0" },
    });
    expect(initRes.status).toBe(200);
    const instructions = String(initRes.body.result?.instructions ?? "");
    expect(instructions).toContain("« lois »");
    expect(instructions).toContain("« juris »");
    expect(instructions).not.toContain("« Legislation »");
    expect(instructions).not.toContain("« Jurisprudence »");

    const interestCall = await mcpPost("tools/call", {
      name: "interets_1619",
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
    const iText =
      ((interestCall.body.result?.content as Array<{ text?: string }>) ?? [])[0]?.text ?? "";
    expect(iText).toContain("| Période | Dates (incluses) | Jours | Base |");
    expect(iText).toContain("2025-Q1");
    expect(iText).toContain("Sous-total exact");

    const truncCall = await mcpPost("tools/call", {
      name: "interets_1619",
      arguments: {
        mode: "legal_plus_1619",
        end_date: "2027-06-30",
        tranches: [{ principal_cents: 10_000_000, start_date: "2026-09-30" }],
      },
    });
    expect(truncCall.status).toBe(200);
    const tText =
      ((truncCall.body.result?.content as Array<{ text?: string }>) ?? [])[0]?.text ?? "";
    expect(
      tText.startsWith("[CALCUL TRONQUÉ AU 2026-12-31 — TAUX ART. 28 L.A.F. NON PUBLIÉ AU-DELÀ]"),
    ).toBe(true);
    expect(tText).toContain(
      "Grand total (capital + intérêts) [CALCUL TRONQUÉ AU 2026-12-31 — TAUX ART. 28 L.A.F. NON PUBLIÉ AU-DELÀ]",
    );

    // Date invalide via MCP -> isError: true sans plantage HTTP 500
    const badDateCall = await mcpPost("tools/call", {
      name: "calendrier_deadlines",
      arguments: {
        event_date: "2025-02-29",
        deadlines: [{ amount: 10, unit: "days" }],
      },
    });
    expect(badDateCall.status).toBe(200);
    expect(badDateCall.body.result?.isError).toBe(true);

    const dossierCall = await mcpPost("tools/call", {
      name: "greffe_parse_number",
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
    expect(palaisListStructured.count).toBe(2);

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
    expect(palaisGetStructured.palais?.fax).toBe("514 873-4760");
    expect(palaisGetStructured.palais?.opening_hours).toBeTruthy();
    expect(palaisGetStructured.palais?.contacts.length).toBeGreaterThan(0);

    const palaisGetXor = await mcpPost("tools/call", {
      name: "palais_get",
      arguments: { greffe_number: "500", palais: "Montréal" },
    });
    expect(palaisGetXor.status).toBe(200);
    expect(palaisGetXor.body.result?.isError).toBe(true);
    expect(palaisGetXor.body.result?.structuredContent).toBeUndefined();
  });

  it("renvoie isError: true (jamais HTTP 500 ni -32602 fatal) si un binding D1 est absent ou si une clé inconnue est fournie", async () => {
    for (const [toolName, args] of [
      ["registre_search", { query: "Québec" }],
      ["registre_get_entity", { neq: "1170123456" }],
      ["adresse_verify", { address: "1 rue Notre-Dame Est, Montréal" }],
      ["terminologie_lookup", { query: "hypothèque" }],
      ["termino_attestations", { term: "hypothec", lang: "en" }],
      ["terminologie_scan", { text: "A mortgage on land.", lang: "en" }],
      ["taux_boc_rates", { category: "fx", currency: "USD", date: "2026-11-20" }],
    ] as const) {
      const missingRes = await mcpPost("tools/call", { name: toolName, arguments: args });
      expect(missingRes.status).toBe(200);
      expect(missingRes.body.error).toBeUndefined();
      expect(missingRes.body.result?.isError).toBe(true);
    }

    const extraKeyRes = await mcpPost("tools/call", {
      name: "terminologie_lookup",
      arguments: { query: "hypothèque", cle_inconnue_interdite: true },
    });
    expect(extraKeyRes.status).toBe(200);
    expect(extraKeyRes.body.error).toBeUndefined();
    expect(extraKeyRes.body.result?.isError).toBe(true);
  });

  it("exécute de bout en bout les 6 outils D1 en lecture seule via /mcp et valide leurs schémas de sortie", async () => {
    const termHarness = createSqliteD1Harness({
      seedSql: [
        readFileSync(resolve(process.cwd(), "pipeline/terminologie/schema.sql"), "utf-8"),
        readFileSync(resolve(process.cwd(), "pipeline/terminologie/indexes.sql"), "utf-8"),
        `
          INSERT INTO meta_sources VALUES ('glossaire_curated', 'Glossaire curé', 1, 'Apache-2.0', '2026-11-15', 1);
          INSERT INTO meta_sources VALUES ('concordancier_legislatif', 'Concordancier', 2, 'Domaine public', '2026-11-15', 1);
          INSERT INTO fiches_terminologiques VALUES (
            1, 'hypotheque', 1, 'Glossaire bijuridique QC', 'Apache-2.0',
            'hypothèque', 'hypothec', 'hypotheque', 'hypothec', '[]', '[]',
            '[{"terme":"mortgage","langue":"en","origine":"common_law","motif":"Faux ami de common law"}]',
            'hypotheque hypothec mortgage',
            'droit_civil_qc', 'sûretés', 'Droit réel sur un bien affecté à l''exécution d''une obligation.', 'art. 2660 C.c.Q.', NULL, '2026-11-15'
          );
          INSERT INTO fiches_fts(rowid, terme_fr, terme_en, termes_recherche, domaine)
            SELECT id, terme_fr, terme_en, termes_recherche, domaine FROM fiches_terminologiques;
          INSERT INTO lois_bilingues VALUES ('ccq', 'qc', 'Code civil du Québec', 'Civil Code of Québec', 'RLRQ, c. CCQ-1991', 'CQLR, c. CCQ-1991', '2026-10-01', '2026-10-01');
          INSERT INTO articles_bilingues VALUES (1, 'ccq', '2660', 2660000, 'L''hypothèque est un droit réel.', 'A hypothec is a real right.');
          INSERT INTO articles_fr_fts(rowid, text_fr) VALUES (1, 'L''hypothèque est un droit réel.');
          INSERT INTO articles_en_fts(rowid, text_en) VALUES (1, 'A hypothec is a real right.');
          INSERT INTO regles_contamination VALUES (
            1, 'en-mortgage', 'en', 'mortgage', 'mortgage', 0, 'anglicisme_ou_common_law', 'hypothec',
            'En droit civil québécois, employer hypothec et non mortgage.', 'hypothec', 'art. 2660 C.c.Q.'
          );
        `,
      ],
    });

    const regHarness = createSqliteD1Harness({
      seedSql: [
        readFileSync(resolve(process.cwd(), "pipeline/registres/schema.sql"), "utf-8"),
        readFileSync(resolve(process.cwd(), "pipeline/registres/indexes.sql"), "utf-8"),
        `
          INSERT INTO meta_sources VALUES ('req', 'REQ', 'CC-BY-NC-SA-4.0', '2026-11-01', 1);
          INSERT INTO domaine_valeur VALUES ('STAT_IMMAT', 'IM', 'Immatriculée'), ('FORM_JURI', 'CIE', 'Société par actions');
          INSERT INTO entites VALUES (
            1, 'qc', '1170123456', NULL, 1, '9123-4567 QUÉBEC INC.', '91234567 constructions tremblay',
            '["Constructions Tremblay"]', 'CIE', 'IM', '2018-04-12', 'Montréal', 0, '{"im":"2018-04-12"}', NULL
          );
          INSERT INTO entites_fts(rowid, nom_officiel, nom_recherche)
            SELECT id, nom_officiel, nom_recherche FROM entites;
        `,
      ],
    });

    const adrHarness = createSqliteD1Harness({
      seedSql: [
        readFileSync(resolve(process.cwd(), "pipeline/adresses/schema.sql"), "utf-8"),
        readFileSync(resolve(process.cwd(), "pipeline/adresses/indexes.sql"), "utf-8"),
        `
          INSERT INTO meta_sources VALUES ('rqa', 'RQA', 'CC-BY-4.0', '2026-09-01', 1);
          INSERT INTO municipalites VALUES ('66023', 'Montréal', 'montreal', 'mtl', 'Montréal', 'Montréal');
          INSERT INTO odonymes VALUES (
            1, '66023', '10001', 'rue', NULL, 'Notre-Dame', 'Est',
            'rue Notre-Dame Est', 'rue Notre-Dame Est', 'notre dame', '${computeConsonantKey("Notre-Dame")}', ''
          );
          INSERT INTO adresses_civiques VALUES (1, 1, 1, '', '', NULL, 'H2Y1B6', 'C', 'Principal', '2359285', '9891-44-1234', 45.508841, -73.554012);
          INSERT INTO lots_cadastraux_index VALUES (2359285, 1);
          INSERT INTO odonymes_fts(rowid, specifique, odonyme_normal, renvois_recherche)
            SELECT id, specifique, odonyme_normal, renvois_recherche FROM odonymes;
          INSERT INTO odonymes_trigram(rowid, specifique_norm)
            SELECT id, specifique_norm FROM odonymes;
        `,
      ],
    });

    try {
      const boundEnv: Env = {
        DB_TERMINOLOGIE: termHarness.d1,
        DB_REGISTRES: regHarness.d1,
        DB_ADRESSES: adrHarness.d1,
      };

      const healthBound = await worker.fetch(
        new Request("https://outils.poirierlavoie.ca/healthz"),
        boundEnv,
        dummyCtx,
      );
      const hJson = (await healthBound.json()) as { databases: Record<string, boolean> };
      expect(hJson.databases).toEqual({
        terminologie: true,
        registres: true,
        adresses: true,
        economie: false,
      });

      const rSearch = await mcpPost(
        "tools/call",
        { name: "registre_search", arguments: { query: "9123 4567" } },
        10,
        "https://outils.poirierlavoie.ca/mcp",
        boundEnv,
      );
      expect(rSearch.body.result?.isError).not.toBe(true);
      expect(
        RegistreSearchEntitiesOutputSchema.parse(rSearch.body.result?.structuredContent).count,
      ).toBe(1);

      const rGet = await mcpPost(
        "tools/call",
        { name: "registre_get_entity", arguments: { neq: "1170123456" } },
        11,
        "https://outils.poirierlavoie.ca/mcp",
        boundEnv,
      );
      expect(rGet.body.result?.isError).not.toBe(true);
      const rGetParsed = RegistreGetEntityOutputSchema.parse(rGet.body.result?.structuredContent);
      expect(rGetParsed.quebec?.neq).toBe("1170123456");
      expect(rGetParsed.gleif).toBeNull();
      expect(rGetParsed.portails_officiels.req?.url).toContain("registreentreprises.gouv.qc.ca");

      // Requête par LEI sur registre sans lignes GLEIF + erreur 4-XOR / format LEI invalide (isError: true, jamais -32602)
      for (const badRegArgs of [
        { neq: "1170123456", lei: "549300QC912345670001" },
        { lei: "NOT_VALID" },
      ]) {
        const badRegRes = await mcpPost(
          "tools/call",
          { name: "registre_get_entity", arguments: badRegArgs },
          111,
          "https://outils.poirierlavoie.ca/mcp",
          boundEnv,
        );
        expect(badRegRes.status).toBe(200);
        expect(badRegRes.body.error).toBeUndefined();
        expect(badRegRes.body.result?.isError).toBe(true);
      }

      const aVer = await mcpPost(
        "tools/call",
        { name: "adresse_verify", arguments: { address: "1, rue Notre-Dame Est, Montréal" } },
        12,
        "https://outils.poirierlavoie.ca/mcp",
        boundEnv,
      );
      expect(aVer.body.result?.isError).not.toBe(true);
      expect(AdresseVerifyOutputSchema.parse(aVer.body.result?.structuredContent).status).toBe(
        "exact_civic",
      );

      const aRevLot = await mcpPost(
        "tools/call",
        { name: "adresse_verify", arguments: { lot_number: "2 359 285" } },
        121,
        "https://outils.poirierlavoie.ca/mcp",
        boundEnv,
      );
      expect(aRevLot.body.result?.isError).not.toBe(true);
      const revLotParsed = AdresseVerifyOutputSchema.parse(aRevLot.body.result?.structuredContent);
      expect(revLotParsed.status).toBe("exact_civic");
      expect(revLotParsed.candidates[0]?.lot_source).toBe("rqa_immeuble_parent");

      const aRevMat = await mcpPost(
        "tools/call",
        { name: "adresse_verify", arguments: { matricule: "9891441234" } },
        122,
        "https://outils.poirierlavoie.ca/mcp",
        boundEnv,
      );
      expect(aRevMat.body.result?.isError).not.toBe(true);
      expect(AdresseVerifyOutputSchema.parse(aRevMat.body.result?.structuredContent).status).toBe(
        "exact_civic",
      );

      for (const badArgs of [
        { lot_number: "2359285", matricule: "9891-44-1234" },
        { lot_number: "invalide" },
      ]) {
        const badRes = await mcpPost(
          "tools/call",
          { name: "adresse_verify", arguments: badArgs },
          123,
          "https://outils.poirierlavoie.ca/mcp",
          boundEnv,
        );
        expect(badRes.status).toBe(200);
        expect(badRes.body.error).toBeUndefined();
        expect(badRes.body.result?.isError).toBe(true);
      }

      const tLook = await mcpPost(
        "tools/call",
        { name: "terminologie_lookup", arguments: { query: "mortgage" } },
        13,
        "https://outils.poirierlavoie.ca/mcp",
        boundEnv,
      );
      expect(tLook.body.result?.isError).not.toBe(true);
      expect(TerminologieLookupOutputSchema.parse(tLook.body.result?.structuredContent).count).toBe(
        1,
      );

      const tAtt = await mcpPost(
        "tools/call",
        { name: "termino_attestations", arguments: { term: "hypothec", lang: "en" } },
        14,
        "https://outils.poirierlavoie.ca/mcp",
        boundEnv,
      );
      expect(tAtt.body.result?.isError).not.toBe(true);
      expect(
        TerminologieAttestationsOutputSchema.parse(tAtt.body.result?.structuredContent)
          .total_matching_articles,
      ).toBe(1);

      const tScan = await mcpPost(
        "tools/call",
        {
          name: "terminologie_scan",
          arguments: { text: "The debtor grants a mortgage on the immovable.", lang: "en" },
        },
        15,
        "https://outils.poirierlavoie.ca/mcp",
        boundEnv,
      );
      expect(tScan.body.result?.isError).not.toBe(true);
      expect(
        TerminologieScanTextOutputSchema.parse(tScan.body.result?.structuredContent).flagged_count,
      ).toBe(1);
    } finally {
      termHarness.close();
      regHarness.close();
      adrHarness.close();
    }
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

  it("gère le prévol CORS OPTIONS (204), le plafond 64 Kio (413) et le rejet des lots/id structurés (-32600)", async () => {
    const preflightOk = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/mcp", {
        method: "OPTIONS",
        headers: {
          Host: "outils.poirierlavoie.ca",
          Origin: "https://claude.ai",
          "Access-Control-Request-Method": "POST",
        },
      }),
      {},
      dummyCtx,
    );
    expect(preflightOk.status).toBe(204);
    expect(preflightOk.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflightOk.headers.get("access-control-allow-methods")).toContain("POST, OPTIONS");

    const preflightBadHost = await worker.fetch(
      new Request("https://evil.example.com/mcp", {
        method: "OPTIONS",
        headers: {
          Host: "evil.example.com",
          Origin: "https://claude.ai",
        },
      }),
      {},
      dummyCtx,
    );
    expect(preflightBadHost.status).toBe(403);

    const oversized = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/mcp", {
        method: "POST",
        headers: {
          Host: "outils.poirierlavoie.ca",
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: `{"jsonrpc":"2.0","id":1,"method":"tools/list","padding":"${"A".repeat(70_000)}"}`,
      }),
      {},
      dummyCtx,
    );
    expect(oversized.status).toBe(413);

    const batchReq = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/mcp", {
        method: "POST",
        headers: {
          Host: "outils.poirierlavoie.ca",
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
        ]),
      }),
      {},
      dummyCtx,
    );
    expect(batchReq.status).toBe(400);
    const batchJson = (await batchReq.json()) as JsonRpcResponseBody;
    expect(batchJson.error?.code).toBe(-32600);

    for (const badId of [{ bad: "object" }, ["bad", "array"]]) {
      const badIdReq = await worker.fetch(
        new Request("https://outils.poirierlavoie.ca/mcp", {
          method: "POST",
          headers: {
            Host: "outils.poirierlavoie.ca",
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: badId, method: "initialize" }),
        }),
        {},
        dummyCtx,
      );
      expect(badIdReq.status).toBe(400);
      const badIdJson = (await badIdReq.json()) as JsonRpcResponseBody;
      expect(badIdJson.error?.code).toBe(-32600);
    }
  });

  it("A-N5, A-N6, B-N14 : messages Zod en français, format taux LAF < 5 %, bannière surcharge, note d'arrondi et omission > 10 tranches", async () => {
    // 1) Erreur Zod localisée en français
    const badZod = await mcpPost("tools/call", {
      name: "calendrier_holidays",
      arguments: { year: 1800 },
    });
    expect(badZod.status).toBe(200);
    expect(badZod.body.result?.isError).toBe(true);
    const badText =
      (badZod.body.result?.content as Array<{ text: string }> | undefined)?.[0]?.text ?? "";
    expect(badText).toMatch(/Trop petit/i);

    // 2) Taux LAF surchargé < 5 % (400 bps sur 2027-Q1) : note surcharge + libellé exact + arrondi
    const lowLaf = await mcpPost("tools/call", {
      name: "interets_1619",
      arguments: {
        end_date: "2027-03-31",
        rate_overrides: [{ quarter: "2027-Q1", laf_rate_bps: 400 }],
        tranches: [{ principal_cents: 100_000, start_date: "2026-12-31" }],
      },
    });
    const lowText =
      (lowLaf.body.result?.content as Array<{ text: string }> | undefined)?.[0]?.text ?? "";
    expect(lowText).toContain("[TAUX L.A.F. SURCHARGÉS PAR L'APPELANT");
    expect(lowText).toContain("taux légal min. 5,00 % ; L.A.F. 4,00 % < 5,00 %");
    expect(lowText).toContain("[surcharge]");
    expect(lowText).toContain("arrondi au cent UNE fois par tranche");

    // 3) Plus de 10 tranches : ventilation détaillée omise du résumé texte mais présente dans structuredContent
    const manyTranches = Array.from({ length: 11 }, (_, i) => ({
      label: `Facture #${i + 1}`,
      principal_cents: 100_000,
      start_date: "2026-01-01",
    }));
    const manyRes = await mcpPost("tools/call", {
      name: "interets_1619",
      arguments: {
        end_date: "2026-06-30",
        tranches: manyTranches,
      },
    });
    const manyText =
      (manyRes.body.result?.content as Array<{ text: string }> | undefined)?.[0]?.text ?? "";
    expect(manyText).toContain(
      "Ventilation détaillée par période omise du résumé texte pour > 10 tranches",
    );
    expect(manyText).not.toContain("| Période | Dates (incluses)");
    const sc = manyRes.body.result?.structuredContent as {
      tranches: Array<{ periods: unknown[] }>;
    };
    expect(sc.tranches).toHaveLength(11);
    expect(sc.tranches[0]!.periods.length).toBeGreaterThan(0);
  });

  it("PR 2 GLEIF : exécute registre_search et registre_get_entity par LEI via /mcp en lecture seule (PRAGMA query_only = ON)", async () => {
    const gleifHarness = createSqliteD1Harness({
      seedSql: [
        readFileSync(resolve(process.cwd(), "pipeline/registres/schema.sql"), "utf-8"),
        readFileSync(resolve(process.cwd(), "pipeline/registres/indexes.sql"), "utf-8"),
        `
          INSERT INTO meta_sources VALUES
            ('corp_ca', 'Corporations Canada', 'OGL-Canada', '2026-11-15', 1),
            ('gleif', 'GLEIF Golden Copy', 'CC0-1.0', '2026-11-25', 3);
          INSERT INTO entites VALUES
            (1, 'ca', '8284083', '801423500', 1, 'TECHNOLOGIES NORDIQUES INC.', 'nordic tech', NULL, 'LCSA', 'Actif', '2012-09-01', 'Montréal', 0, '{"rl":"LCSA"}', '549300CA828408300002'),
            (2, 'lei', '549300CABANKROYALE06', NULL, 1, 'BANQUE ÉCHANTILLON CANADA', 'sample bank canada', NULL, 'GENERAL', 'LAPSED', NULL, 'Montréal', 0, '{"jur":"CA"}', '549300CABANKROYALE06');
          INSERT INTO entites_fts(rowid, nom_officiel, nom_recherche)
            SELECT id, nom_officiel, nom_recherche FROM entites;
          INSERT INTO gleif_entites VALUES
            ('549300CA828408300002', 1, 'TECHNOLOGIES NORDIQUES INC.', 'CA', 'GENERAL', 'ACTIVE', 'T15C', 'ISSUED', '2018-09-01T00:00:00Z', '2027-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '5493001KJTIIGC8Y1R12', 'FULLY_CORROBORATED', 'RA000072', '828408-3', NULL, '8284083', 'CA', 'CA-QC', 'Montréal', 'H3B 4W5', NULL),
            ('549300USULTIMATE0004', 0, 'NORDIC GLOBAL HOLDINGS LLC', 'US-DE', 'GENERAL', 'ACTIVE', 'H435', 'ISSUED', '2015-03-01T00:00:00Z', '2027-03-01T00:00:00Z', '2026-03-01T00:00:00Z', '5493001KJTIIGC8Y1R12', 'FULLY_CORROBORATED', 'RA000602', 'DE-5511990', NULL, NULL, 'US', 'US-DE', 'Wilmington', '19801', NULL),
            ('549300CABANKROYALE06', 1, 'BANQUE ÉCHANTILLON CANADA', 'CA', 'GENERAL', 'ACTIVE', 'T15C', 'LAPSED', '2014-06-01T00:00:00Z', '2025-06-01T00:00:00Z', '2024-06-01T00:00:00Z', '5493001KJTIIGC8Y1R12', 'ENTITY_SUPPLIED_ONLY', 'RA000831', 'BS-0012', NULL, NULL, 'CA', 'CA-QC', 'Montréal', 'H3B 5G2', NULL);
          INSERT INTO gleif_liens VALUES
            (1, '549300CA828408300002', '549300USULTIMATE0004', 'IS_ULTIMATELY_CONSOLIDATED_BY', 'ACTIVE', 'IFRS', NULL, NULL, '2025-01-01', '2025-12-31', 'FULLY_CORROBORATED');
          INSERT INTO gleif_exceptions VALUES
            ('549300CABANKROYALE06', 'DIRECT_ACCOUNTING_CONSOLIDATION_PARENT', '["NO_LEI"]', NULL);
        `,
      ],
      enforceQueryOnly: true,
    });

    try {
      const boundEnv: Env = { DB_REGISTRES: gleifHarness.d1 };

      const bankSearch = await mcpPost(
        "tools/call",
        {
          name: "registre_search",
          arguments: { query: "Banque Échantillon", jurisdiction: "gleif" },
        },
        201,
        "https://outils.poirierlavoie.ca/mcp",
        boundEnv,
      );
      expect(bankSearch.body.result?.isError).not.toBe(true);
      const bankParsed = RegistreSearchEntitiesOutputSchema.parse(
        bankSearch.body.result?.structuredContent,
      );
      expect(bankParsed.count).toBe(1);
      expect(bankParsed.entities[0]?.jurisdiction).toBe("gleif");
      expect(bankParsed.entities[0]?.has_lei).toBe(true);
      expect(bankParsed.entities[0]?.lei).toBe("549300CABANKROYALE06");

      const getByLei = await mcpPost(
        "tools/call",
        { name: "registre_get_entity", arguments: { lei: "549300ca828408300002" } },
        202,
        "https://outils.poirierlavoie.ca/mcp",
        boundEnv,
      );
      expect(getByLei.body.result?.isError).not.toBe(true);
      const getParsed = RegistreGetEntityOutputSchema.parse(
        getByLei.body.result?.structuredContent,
      );
      expect(getParsed.lookup_by).toBe("lei");
      expect(getParsed.federal?.corporation_number).toBe("8284083");
      expect(getParsed.gleif?.parent_ultime?.nom_legal).toBe("NORDIC GLOBAL HOLDINGS LLC");
      expect(getParsed.gleif?.parent_ultime?.pays).toBe("US");
      expect(getParsed.gardes.map((g) => g.code)).toContain(
        "REGISTRE_GLEIF_DECLARATIF_CONSOLIDATION",
      );
      expect(getParsed.portails_officiels.corporations_canada?.url).toContain("corpId=8284083");
      expect(getParsed.portails_officiels.isc_pisc?.url).toContain(
        "particuliers-ayant-controle-important",
      );
      expect(getParsed.portails_officiels.gleif?.url).toBe(
        "https://search.gleif.org/#/record/549300CA828408300002",
      );
    } finally {
      gleifHarness.close();
    }
  });

  it("PR 3 DB_ECONOMIE & prime_plus_margin : exécute taux_boc_rates et interets_1619 via /mcp (PRAGMA query_only = ON)", async () => {
    const ecoHarness = createSqliteD1Harness({
      seedSql: [
        readFileSync(resolve(process.cwd(), "pipeline/economie/schema.sql"), "utf-8"),
        readFileSync(resolve(process.cwd(), "pipeline/economie/indexes.sql"), "utf-8"),
        `
          INSERT INTO meta_sources VALUES
            ('boc_fx_daily', 'BdC FX Daily', 'BoC Terms', '2026-11-23', 2),
            ('boc_legacy_noon', 'BdC Noon', 'BoC Terms', '2017-04-28', 1),
            ('boc_interest_rates', 'BdC Rates', 'BoC Terms', '2026-11-23', 3);
          INSERT INTO fx_currencies VALUES
            (1, 'USD', 'US dollar', 'Dollar américain', 1, 20010102, 20261123);
          INSERT INTO fx_rates VALUES
            (1, 20170428, 1, 1365200),
            (1, 20261120, 2, 1395500),
            (1, 20261123, 2, 1398200);
          INSERT INTO boc_rates VALUES
            ('V39079', 20261123, 250),
            ('V122530', 20261001, 275),
            ('V80691311', 20261118, 470);
        `,
      ],
      enforceQueryOnly: true,
    });

    try {
      const boundEnv: Env = { DB_ECONOMIE: ecoHarness.d1 };

      const healthRes = await worker.fetch(
        new Request("https://outils.poirierlavoie.ca/healthz"),
        boundEnv,
        dummyCtx,
      );
      const hJson = (await healthRes.json()) as { databases: Record<string, boolean> };
      expect(hJson.databases.economie).toBe(true);

      const fxCall = await mcpPost(
        "tools/call",
        {
          name: "taux_boc_rates",
          arguments: {
            category: "fx",
            currency: "USD",
            date: "2026-11-22",
            amount: "1000.00",
          },
        },
        301,
        "https://outils.poirierlavoie.ca/mcp",
        boundEnv,
      );
      expect(fxCall.body.result?.isError).not.toBe(true);
      const fxParsed = TauxBocRatesOutputSchema.parse(fxCall.body.result?.structuredContent);
      expect(fxParsed.fx_observations[0]?.effective_observation_date).toBe("2026-11-20");
      expect(fxParsed.fx_observations[0]?.rolled_back).toBe(true);
      expect(fxParsed.conversion?.converted_cents).toBe(139550);

      const primeCall = await mcpPost(
        "tools/call",
        {
          name: "interets_1619",
          arguments: {
            mode: "prime_plus_margin",
            end_date: "2027-02-01",
            spread_bps: 150,
            tranches: [{ principal_cents: 1_000_000, start_date: "2026-11-10" }],
          },
        },
        302,
        "https://outils.poirierlavoie.ca/mcp",
        boundEnv,
      );
      expect(primeCall.body.result?.isError).not.toBe(true);
      const pText =
        ((primeCall.body.result?.content as Array<{ text?: string }>) ?? [])[0]?.text ?? "";
      expect(pText).toContain("TAUX PRÉFÉRENTIEL BDC NON VÉRIFIÉ AU-DELÀ");
      expect(pText).toContain("préf. 4,70 % + 1,50 %");
    } finally {
      ecoHarness.close();
    }
  });
});
