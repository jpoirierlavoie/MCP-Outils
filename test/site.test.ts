import { describe, expect, it } from "vitest";
import lafRatesJson from "../src/data/laf_art28_rates.json" with { type: "json" };
import worker from "../src/index.js";
import { listToolDescriptors, SERVER_NAME, SERVER_VERSION } from "../src/mcp/server.js";
import { analyserNumeroDossier } from "../src/qc/dossier.js";
import { GARDE_DOSSIER, GARDE_PALAIS, GARDE_SANS_ADRESSE } from "../src/qc/format.js";
import { GREFFES } from "../src/qc/greffes.js";
import { JURIDICTIONS } from "../src/qc/juridictions.js";
import { MJQ_MAJ } from "../src/qc/lieux.js";
import { listerDistricts } from "../src/qc/lookup.js";
import { RELEVE_LE } from "../src/qc/palais.js";
import { esc, pagePubliqueHtml, SECTIONS } from "../src/site.js";
import { OUTILS_EN } from "../src/site.i18n.js";

const dummyCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

const ALLOWED_URL_PREFIXES = [
  "https://outils.poirierlavoie.ca",
  "https://github.com/jpoirierlavoie/pratique-civile-outils",
  "https://github.com/jpoirierlavoie/pratique-civile-quebecoise",
  "https://www.justice.gouv.qc.ca",
  "mailto:jason@poirierlavoie.ca",
] as const;

describe("page publique GET /", () => {
  it("sert du HTML sécurisé sans CORS ni dépendance tierce", async () => {
    const res = await worker.fetch(new Request("https://outils.poirierlavoie.ca/"), {}, dummyCtx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");

    const html = await res.text();
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/<img[^>]+http/i);
  });

  it("n'a aucune couleur en dur hors des deux jeux de variables :root et html.t-dark", () => {
    const html = pagePubliqueHtml();
    const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(html);
    expect(styleMatch).not.toBeNull();
    const css = styleMatch![1]!;

    const clairMatch = /:root\{([^}]+)\}/.exec(css);
    const sombreMatch = /html\.t-dark\{([^}]+)\}/.exec(css);
    expect(clairMatch).not.toBeNull();
    expect(sombreMatch).not.toBeNull();

    const varsOf = (block: string) =>
      block
        .split(";")
        .map((pair) => pair.split(":")[0]?.trim())
        .filter((k): k is string => Boolean(k && k.startsWith("--")))
        .sort();
    expect(varsOf(clairMatch![1]!)).toEqual(varsOf(sombreMatch![1]!));

    const sansVars = css
      .replace(/:root\{[^}]+\}/g, "")
      .replace(/html\.t-light\{[^}]+\}/g, "")
      .replace(/html\.t-dark\{[^}]+\}/g, "");
    expect(sansVars).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sansVars).not.toMatch(/\brgba?\(/i);
    expect(sansVars).not.toMatch(/\bhsla?\(/i);
  });

  it("toutes les URLs externes appartiennent à la liste blanche et aucune fuite CanLII", () => {
    const html = pagePubliqueHtml();
    expect(html).not.toContain("api.canlii.org");
    expect(html).not.toContain("jurisprudence.poirierlavoie.ca");

    const urls = html.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
    for (const u of urls) {
      expect(
        ALLOWED_URL_PREFIXES.some((prefix) => u.startsWith(prefix)),
        `URL non autorisée : ${u}`,
      ).toBe(true);
    }

    const mailtos = html.match(/mailto:[^\s"'<>)]+/g) ?? [];
    for (const m of mailtos) {
      expect(ALLOWED_URL_PREFIXES).toContain(m);
    }
  });

  it("couvre 1:1 les outils du serveur, les traductions anglaises et les sections", () => {
    const html = pagePubliqueHtml();
    const descripteurs = listToolDescriptors();
    expect(descripteurs).toHaveLength(6);

    expect(Object.keys(OUTILS_EN).sort()).toEqual(descripteurs.map((d) => d.name).sort());

    for (const s of SECTIONS) {
      expect(html).toContain(`href="#${s.id}"`);
      expect(html).toContain(`<h2 id="${s.id}">`);
    }

    expect(html).toContain(SERVER_NAME);
    expect(html).toContain(SERVER_VERSION);
    for (const d of descripteurs) {
      expect(html).toContain(`<code>${d.name}</code>`);
      expect(html).toContain(esc(OUTILS_EN[d.name]!.titre));
    }
    expect(html).toContain("deadlines[].amount");
    expect(html).toContain("tranches[].principal_cents");
    expect(html).toContain("rate_overrides[].quarter");
    expect(html).toContain("openWorldHint: false");
  });

  it("dérive les issues du parseur, les juridictions, les 56 greffes, 36 districts et les gardes", () => {
    const html = pagePubliqueHtml();
    expect(html).toContain(analyserNumeroDossier("500-05-123456-241").greffe!.palais_de_justice);
    for (const code of Object.keys(JURIDICTIONS)) {
      expect(html).toContain(`<code>${code}</code>`);
    }
    for (const numero of Object.keys(GREFFES)) {
      expect(html).toContain(`<code>${numero}</code>`);
    }
    for (const district of listerDistricts()) {
      expect(html).toContain(`value="${district}"`);
    }
    expect(html).toContain(RELEVE_LE);
    expect(html).toContain(MJQ_MAJ);
    expect(html).toContain(lafRatesJson.metadata.last_quarter);
    expect(html).toContain(esc(GARDE_DOSSIER.split("\n")[0]!));
    expect(html).toContain(esc(GARDE_PALAIS.split("\n")[0]!));
    expect(html).toContain(esc(GARDE_SANS_ADRESSE.split("\n")[0]!));
    expect(html).toContain("\\u0300-\\u036f");
    expect(html).not.toContain("min-width:LARGEUR");
    expect(html).toContain("min-width:78rem");
  });
});
