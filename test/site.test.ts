import { describe, expect, it } from "vitest";
import lafRatesJson from "../src/data/laf_art28_rates.json" with { type: "json" };
import worker, { type Env } from "../src/index.js";
import { listToolDescriptors, SERVER_NAME, SERVER_VERSION } from "../src/mcp/server.js";
import { analyserNumeroDossier } from "../src/qc/dossier.js";
import { GARDE_DOSSIER, GARDE_PALAIS, GARDE_SANS_ADRESSE } from "../src/qc/format.js";
import { GREFFES } from "../src/qc/greffes.js";
import { JURIDICTIONS } from "../src/qc/juridictions.js";
import { MJQ_MAJ } from "../src/qc/lieux.js";
import { listerDistricts } from "../src/qc/lookup.js";
import { RELEVE_LE } from "../src/qc/palais.js";
import { OUTILS_EN } from "../src/site.i18n.js";
import {
  CHEMINS_DECOUVERTE_PUBLIQUE,
  esc,
  pagePubliqueHtml,
  RESUME_OUTILS_FR,
  SECTIONS,
} from "../src/site.js";

const dummyCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

const ALLOWED_URL_PREFIXES = [
  "https://outils.poirierlavoie.ca",
  "https://acces.poirierlavoie.ca",
  "https://legislation.poirierlavoie.ca",
  "https://jurisprudence.poirierlavoie.ca",
  "https://github.com/jpoirierlavoie/MCP-Outils",
  "https://github.com/jpoirierlavoie/droit-civil-quebecois",
  "https://www.justice.gouv.qc.ca",
  "https://schema.org",
  "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  "https://www.apache.org/licenses/LICENSE-2.0",
  "mailto:jason@poirierlavoie.ca",
] as const;

describe("page publique GET / et fichiers de découverte", () => {
  it("sert du HTML sécurisé et les fichiers de découverte avant le limiteur de débit /mcp", async () => {
    let appelsLimiteur = 0;
    const envBloque: Env = {
      RATE_LIMITER: {
        limit: async () => {
          appelsLimiteur += 1;
          return { success: false };
        },
      },
    };

    const res = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/"),
      envBloque,
      dummyCtx,
    );
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

    for (const dec of CHEMINS_DECOUVERTE_PUBLIQUE) {
      const rDec = await worker.fetch(
        new Request(`https://outils.poirierlavoie.ca${dec}`),
        envBloque,
        dummyCtx,
      );
      expect(rDec.status, dec).toBe(200);
      expect(rDec.headers.get("access-control-allow-origin"), dec).toBeNull();

      const rHead = await worker.fetch(
        new Request(`https://outils.poirierlavoie.ca${dec}`, { method: "HEAD" }),
        envBloque,
        dummyCtx,
      );
      expect(rHead.status, `${dec} HEAD`).toBe(200);
      expect(await rHead.text()).toBe("");

      const rPost = await worker.fetch(
        new Request(`https://outils.poirierlavoie.ca${dec}`, { method: "POST" }),
        envBloque,
        dummyCtx,
      );
      expect(rPost.status, `${dec} POST`).toBe(405);
    }
    expect(appelsLimiteur).toBe(0);
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

  it("couvre 1:1 les outils du serveur, les traductions anglaises, la navigation de suite, les id uniques et le JSON-LD", () => {
    const html = pagePubliqueHtml();
    const descripteurs = listToolDescriptors();
    expect(descripteurs).toHaveLength(12);
    expect(new Set(descripteurs.map((d) => d.family))).toEqual(
      new Set(["calcul", "greffe", "registre", "adresse", "terminologie"]),
    );

    expect(Object.keys(OUTILS_EN).sort()).toEqual(descripteurs.map((d) => d.name).sort());
    expect(Object.keys(RESUME_OUTILS_FR).sort()).toEqual(descripteurs.map((d) => d.name).sort());
    for (const [nom, frLines] of Object.entries(RESUME_OUTILS_FR)) {
      expect(frLines.length, `${nom} resume FR`).toBeGreaterThanOrEqual(1);
      expect(OUTILS_EN[nom]!.resume.length, `${nom} resume EN`).toBe(frLines.length);
    }

    for (const s of SECTIONS) {
      expect(html).toContain(`href="#${s.id}"`);
      expect(html).toContain(`<section id="${s.id}">`);
    }

    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!);
    expect(new Set(ids).size).toBe(ids.length);

    const fr = (html.match(/data-l="fr"/g) ?? []).length;
    const en = (html.match(/data-l="en"/g) ?? []).length;
    expect(fr).toBe(en);

    expect(html).toContain('<nav class="suite"');
    expect(html).toContain('href="/" aria-current="page"');
    expect(html).toContain('href="https://acces.poirierlavoie.ca/"');
    expect(html).toContain('href="https://legislation.poirierlavoie.ca/"');
    expect(html).toContain('href="https://jurisprudence.poirierlavoie.ca/"');
    expect(html).toContain('href="#contenu-principal"');
    expect(html).toContain('<h3 id="sc-calendrier_holidays">');
    const titleMatch = /<title data-fr="[^"]+" data-en="[^"]+">([^<]+)<\/title>/.exec(html);
    expect(titleMatch).not.toBeNull();
    expect(titleMatch![1]!.length).toBeLessThanOrEqual(65);
    const descMatch = /<meta name="description" content="([^"]+)">/.exec(html);
    expect(descMatch).not.toBeNull();
    expect(descMatch![1]!.replace(/&#39;/g, "'").length).toBeLessThanOrEqual(160);

    const ldMatch = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    expect(ldMatch).not.toBeNull();
    expect((JSON.parse(ldMatch![1]!) as Record<string, unknown>)["@context"]).toBe(
      "https://schema.org",
    );

    expect(html).toContain(SERVER_NAME);
    expect(html).toContain(SERVER_VERSION);
    for (const d of descripteurs) {
      expect(html).toContain(`<code>${d.name}</code>`);
      expect(html).toContain(esc(OUTILS_EN[d.name]!.titre));
    }
    expect(html).toContain("deadlines[].amount");
    expect(html).toContain("tranches[].principal_cents");
    expect(html).toContain("rate_overrides[].quarter");
    expect(html).toContain("<code>lei</code>");
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
