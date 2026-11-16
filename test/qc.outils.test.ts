import { describe, expect, it } from "vitest";
import {
  PalaisGetOutputSchema,
  PalaisListOutputSchema,
  ParseCourtFileOutputSchema,
} from "../src/core/qcTools.js";
import worker from "../src/index.js";
import { GREFFES } from "../src/qc/greffes.js";
import { RELEVE_LE } from "../src/qc/palais.js";

const dummyCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

interface CallToolRpcResponse {
  result?: {
    content?: Array<{ type: string; text: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

async function callToolRaw(
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolRpcResponse> {
  const req = new Request("https://outils.poirierlavoie.ca/mcp", {
    method: "POST",
    headers: {
      Host: "outils.poirierlavoie.ca",
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const res = await worker.fetch(req, {}, dummyCtx);
  expect(res.status).toBe(200);
  const ct = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  if (ct.includes("application/json")) {
    return JSON.parse(raw) as CallToolRpcResponse;
  }
  const dataLine = raw.split(/\r?\n/).find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`Réponse SSE inattendue : ${raw}`);
  return JSON.parse(dataLine.slice(6)) as CallToolRpcResponse;
}

async function callToolText(name: string, args: Record<string, unknown>) {
  const rpc = await callToolRaw(name, args);
  if (rpc.error) {
    throw new Error(`Erreur JSON-RPC inattendue (${rpc.error.code}) : ${rpc.error.message}`);
  }
  const text = rpc.result?.content?.[0]?.text ?? "";
  return { rpc, result: rpc.result!, text };
}

function isInputRejected(rpc: CallToolRpcResponse): boolean {
  return Boolean(rpc.error) || rpc.result?.isError === true;
}

const FORMULATIONS_INTERDITES = [
  "n'existe pas",
  "n'a jamais existé",
  "a été infirmée",
  "toujours en vigueur",
  "fait autorité",
  "citation valide",
] as const;

describe("greffe_parse_number", () => {
  it("résout greffe, juridiction, adresse et structuredContent avec gardes", async () => {
    const { result, text } = await callToolText("greffe_parse_number", {
      court_file_number: "500-05-123456-241",
    });
    expect(result.isError).not.toBe(true);
    expect(text).toContain("Greffe 500");
    expect(text).toContain("district judiciaire de Montréal");
    expect(text).toContain("Cour supérieure");
    expect(text).toContain("Division générale");
    expect(text).toContain("greffe civil");
    expect(text).toContain("1, rue Notre-Dame Est");
    expect(text).toContain("n'établit pas que ce dossier existe");

    const parsed = ParseCourtFileOutputSchema.parse(result.structuredContent);
    expect(parsed.outcome).toBe("judicial");
    expect(parsed.greffe?.adresse?.key).toBe("montreal");
    expect(parsed.provenance.verified_at).toBe(RELEVE_LE);
    expect(parsed.gardes.map((g) => g.code)).toContain("DOSSIER_NOMENCLATURE_SEULEMENT");
    expect(parsed.gardes.map((g) => g.code)).toContain("GREFFE_SANS_PLUMITIF");
  });

  it("un préfixe TAL résout son tribunal et n'est PAS une erreur", async () => {
    const { result, text } = await callToolText("greffe_parse_number", {
      court_file_number: "TAL-594531",
    });
    expect(result.isError).not.toBe(true);
    expect(text).toContain("Tribunal administratif du logement");
    const parsed = ParseCourtFileOutputSchema.parse(result.structuredContent);
    expect(parsed.outcome).toBe("forum");
    expect(parsed.is_administrative).toBe(true);
    expect(parsed.forum?.key).toBe("tal");
  });

  it("une cour fédérale est annoncée comme telle et pointe vers « Jurisprudence »", async () => {
    const { result, text } = await callToolText("greffe_parse_number", {
      court_file_number: "C.F.-T-1234-26",
    });
    expect(result.isError).not.toBe(true);
    expect(text).toContain("Cour fédérale");
    expect(text).toContain("Cours et tribunaux fédéraux");
    expect(text).toContain("n'est PAS un tribunal administratif");
    expect(text).toContain("« Jurisprudence »");
    expect(text).toContain("verify_citations");
    const parsed = ParseCourtFileOutputSchema.parse(result.structuredContent);
    expect(parsed.is_administrative).toBe(false);
  });

  it("un préfixe inconnu ne devine AUCUN nom de tribunal", async () => {
    const { result, text } = await callToolText("greffe_parse_number", {
      court_file_number: "XYZ-9999",
    });
    expect(result.isError).not.toBe(true);
    expect(text).toContain("NON répertorié");
    expect(text).toContain("ne devine PAS");
    const parsed = ParseCourtFileOutputSchema.parse(result.structuredContent);
    expect(parsed.outcome).toBe("unknown_alpha_prefix");
  });

  it("un greffe itinérant : pas d'adresse, et l'inconnu n'est pas une inexistence", async () => {
    const { result, text } = await callToolText("greffe_parse_number", {
      court_file_number: "614-05-000001-200",
    });
    expect(text).toContain("Chisasibi");
    expect(text).toContain("Aucune adresse publiée");
    expect(text).toContain("n'établit PAS qu'il n'en existe aucune");
    expect(text).toContain("Mistissini");
    const parsed = ParseCourtFileOutputSchema.parse(result.structuredContent);
    expect(parsed.greffe?.adresse).toBeNull();
    expect(parsed.gardes.map((g) => g.code)).toContain("GREFFE_SANS_ADRESSE_PUBLIEE");
  });

  it("un code inconnu est NOMMÉ, pas deviné", async () => {
    const { result, text } = await callToolText("greffe_parse_number", {
      court_file_number: "999-05-000001",
    });
    expect(text).toContain("999");
    expect(text).toContain("INCONNU");
    const parsed = ParseCourtFileOutputSchema.parse(result.structuredContent);
    expect(parsed.outcome).toBe("judicial");
    expect(parsed.greffe).toBeNull();
  });

  it("refuse une entrée vide, blanche ou une propriété inconnue par le schéma fermé", async () => {
    expect(
      isInputRejected(await callToolRaw("greffe_parse_number", { court_file_number: "" })),
    ).toBe(true);
    expect(
      isInputRejected(await callToolRaw("greffe_parse_number", { court_file_number: "   " })),
    ).toBe(true);
    expect(
      isInputRejected(
        await callToolRaw("greffe_parse_number", {
          court_file_number: "500-05-123456-241",
          extra: true,
        }),
      ),
    ).toBe(true);
  });
});

describe("palais_list", () => {
  it("rend les 51 lieux, sans appel, avec la réserve de péremption", async () => {
    const { result, text } = await callToolText("palais_list", {});
    expect(result.isError).not.toBe(true);
    expect(text).toContain("51 lieux");
    expect(text).toContain("2026-07-15");
    expect(text).toContain("VÉRIFIER");
    const parsed = PalaisListOutputSchema.parse(result.structuredContent);
    expect(parsed.count).toBe(51);
    expect(parsed.gardes.map((g) => g.code)).toContain("PALAIS_RELEVE_MJQ_DATE");
  });

  it("filtre par district", async () => {
    const { text } = await callToolText("palais_list", { district: "Montréal" });
    expect(text).toContain("Montréal");
    expect(text).toContain("Greffe 500");
    expect(text).not.toContain("Sherbrooke");
  });

  it("filtre par type et compte les points de service du MJQ", async () => {
    const { result, text } = await callToolText("palais_list", { type: "point_de_service" });
    expect(text).toContain("8 lieux");
    expect(text).toContain("point de service de justice");
    const parsed = PalaisListOutputSchema.parse(result.structuredContent);
    expect(parsed.count).toBe(8);
  });

  it("une liste vide n'est PAS un constat d'absence ni une erreur", async () => {
    const { result, text } = await callToolText("palais_list", { district: "Vaudreuil" });
    expect(result.isError).not.toBe(true);
    expect(text).toContain("ne vaut pas constat d'absence");
    expect(text).toContain("Terrebonne");
    const parsed = PalaisListOutputSchema.parse(result.structuredContent);
    expect(parsed.count).toBe(0);
    expect(parsed.known_districts).toContain("Terrebonne");
  });

  it("trouve un palais par sa VILLE, qui n'est pas son nom", async () => {
    const { text } = await callToolText("palais_list", { query: "Saguenay" });
    expect(text).toContain("Chicoutimi");
    expect(text).toContain("Saguenay");
  });

  it("rejette les propriétés inconnues sur tous les outils", async () => {
    expect(isInputRejected(await callToolRaw("palais_list", { extra: "nope" }))).toBe(true);
    expect(
      isInputRejected(await callToolRaw("calendrier_holidays", { year: 2026, extra: 1 })),
    ).toBe(true);
    expect(
      isInputRejected(
        await callToolRaw("calendrier_deadlines", {
          event_date: "2026-07-03",
          deadlines: [{ amount: 10, extra: 1 }],
        }),
      ),
    ).toBe(true);
    expect(
      isInputRejected(
        await callToolRaw("interets_1619", {
          mode: "legal_only",
          end_date: "2026-01-10",
          tranches: [{ principal_cents: 1000, start_date: "2026-01-01", extra: 1 }],
        }),
      ),
    ).toBe(true);
  });
});

describe("palais_get", () => {
  it("par numéro de greffe : adresse, district, réserve", async () => {
    const { result, text } = await callToolText("palais_get", { greffe_number: "500" });
    expect(result.isError).not.toBe(true);
    expect(text).toContain("Greffe 500");
    expect(text).toContain("1, rue Notre-Dame Est");
    expect(text).toContain("Montréal (Québec) H2Y 1B6");
    expect(text).toContain("2026-07-15");
    const parsed = PalaisGetOutputSchema.parse(result.structuredContent);
    expect(parsed.lookup_by).toBe("greffe_number");
    expect(parsed.palais?.key).toBe("montreal");
  });

  it("par nom de palais : les greffes qui y siègent", async () => {
    const { result, text } = await callToolText("palais_get", { palais: "Montréal" });
    expect(text).toContain("Palais de justice de Montréal");
    expect(text).toContain("Greffes qui y siègent");
    expect(text).toContain("500");
    const parsed = PalaisGetOutputSchema.parse(result.structuredContent);
    expect(parsed.lookup_by).toBe("palais");
    expect(parsed.greffes_at_palais.map((g) => g.numero)).toContain("500");
  });

  it("annonce l'ABSENCE de coordonnées plutôt que de la laisser découvrir", async () => {
    const { result, text } = await callToolText("palais_get", { greffe_number: "500" });
    expect(text).toContain("n'en porte AUCUNE");
    expect(text).toContain("ministère de la Justice");
    const parsed = PalaisGetOutputSchema.parse(result.structuredContent);
    expect(parsed.gardes.map((g) => g.code)).toContain("PALAIS_COORDONNEES_NON_PUBLIEES");
  });

  it("rend l'adresse postale distincte quand il y en a une", async () => {
    const { text } = await callToolText("palais_get", { greffe_number: "110" });
    expect(text).toContain("Adresse postale : Case postale 188");
  });

  it("greffe itinérant : localités desservies, et l'inconnu reste inconnu", async () => {
    const { result, text } = await callToolText("palais_get", { greffe_number: "652" });
    expect(text).toContain("ITINÉRANTE");
    expect(text).toContain("Fermont");
    expect(text).toContain("n'établit PAS qu'il n'en existe aucune");
    const parsed = PalaisGetOutputSchema.parse(result.structuredContent);
    expect(parsed.gardes.map((g) => g.code)).toContain("GREFFE_SANS_ADRESSE_PUBLIEE");
  });

  it("Kuujjuaq est rattaché au greffe 635 PAR LE MJQ, non par déduction", async () => {
    const { text } = await callToolText("palais_get", { palais: "Kuujjuaq" });
    expect(text).toContain("Kuujjuaq");
    expect(text).toContain("Greffes qui y siègent");
    expect(text).toContain("635");
  });

  it("le greffe 635 rend enfin une adresse, et dit d'où elle vient", async () => {
    const { text } = await callToolText("palais_get", { greffe_number: "635" });
    expect(text).toContain("Siège fixe : Kuujjuaq");
    expect(text).toContain("non par déduction");
    expect(text).toContain("151, rue Siuralikuut");
  });

  it("un greffe absent de la table n'est pas déclaré inexistant (isError, sans structuredContent)", async () => {
    const { result, text } = await callToolText("palais_get", { greffe_number: "999" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(text).toContain("NON un registre exhaustif");
    expect(text).toContain("peut désigner un greffe réel");
    expect(text).toContain("Explications possibles");
  });

  it("un palais ambigu liste les candidats avec isError: true sans structuredContent", async () => {
    const { result, text } = await callToolText("palais_get", { palais: "Saint" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(text).toContain("désigne");
    expect(text).toContain("Préciser la clef");
  });

  it("exige EXACTEMENT une des deux formes", async () => {
    const deux = await callToolText("palais_get", {
      greffe_number: "500",
      palais: "Montréal",
    });
    expect(deux.result.isError).toBe(true);
    expect(deux.result.structuredContent).toBeUndefined();
    expect(deux.text).toContain("EXACTEMENT");

    const vide = await callToolText("palais_get", {});
    expect(vide.result.isError).toBe(true);
    expect(vide.result.structuredContent).toBeUndefined();
  });
});

describe("contrat de vérité — formulations interdites", () => {
  it("aucune sortie des 3 outils QC ne contient de formulation de fausse certitude", async () => {
    const appels: Array<[string, Record<string, unknown>]> = [
      ["greffe_parse_number", { court_file_number: "500-05-123456-241" }],
      ["greffe_parse_number", { court_file_number: "TAL-594531" }],
      ["greffe_parse_number", { court_file_number: "C.F.-T-1234-26" }],
      ["greffe_parse_number", { court_file_number: "XYZ-9999" }],
      ["greffe_parse_number", { court_file_number: "614-05-000001-200" }],
      ["greffe_parse_number", { court_file_number: "999-05-000001" }],
      ["palais_list", {}],
      ["palais_list", { district: "Inconnu" }],
      ["palais_get", { greffe_number: "500" }],
      ["palais_get", { greffe_number: "652" }],
      ["palais_get", { greffe_number: "999" }],
      ["palais_get", { palais: "InexistantXYZ" }],
      ["palais_get", { palais: "Saint" }],
    ];

    for (const [nom, args] of appels) {
      const { text } = await callToolText(nom, args);
      const bas = text.toLowerCase();
      for (const interdite of FORMULATIONS_INTERDITES) {
        expect(bas, `${nom} (${JSON.stringify(args)})`).not.toContain(interdite);
      }
    }
    expect(Object.keys(GREFFES).length).toBeGreaterThan(50);
  });
});
