import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdresseVerifyOutputSchema,
  adresseVerify,
  computeConsonantKey,
  parseQuebecAddress,
} from "../src/core/adresses.js";
import { createSqliteD1Harness, type SqliteD1Harness } from "./helpers/sqliteD1.js";

describe("Domaine C — Vérification et normalisation d'adresses au RQA", () => {
  let harness: SqliteD1Harness;

  beforeAll(() => {
    const schemaSql = readFileSync(resolve(process.cwd(), "pipeline/adresses/schema.sql"), "utf-8");
    const indexesSql = readFileSync(
      resolve(process.cwd(), "pipeline/adresses/indexes.sql"),
      "utf-8",
    );

    const seedDataSql = `
      INSERT INTO meta_sources VALUES
        ('rqa', 'Référentiel québécois des adresses (RQA)', 'CC-BY-4.0', '2026-09-01', 5),
        ('odonymes_renvois', 'Odonymes et renvois (MRNF)', 'CC-BY-4.0', '2026-09-01', 2);

      INSERT INTO municipalites VALUES
        ('66023', 'Montréal', 'montreal', 'mtl mtrl ville marie verdun saint laurent st laurent outremont', 'Montréal', 'Montréal'),
        ('23027', 'Québec', 'quebec', 'qc ville de quebec sainte foy ste foy beauport charlesbourg', 'Québec', 'Capitale-Nationale');

      INSERT INTO odonymes VALUES
        (1, '66023', '10001', 'rue', NULL, 'Notre-Dame', 'Est', 'rue Notre-Dame Est', 'rue Notre-Dame Est', 'notre dame', '${computeConsonantKey("Notre-Dame")}', ''),
        (2, '66023', '10002', 'boulevard', NULL, 'René-Lévesque', 'Ouest', 'boul. René-Lévesque Ouest', 'boulevard René-Lévesque Ouest', 'rene levesque', '${computeConsonantKey("René-Lévesque")}', 'boulevard dorchester ouest dorchester'),
        (3, '23027', '20001', 'boulevard', NULL, 'Jean-Lesage', NULL, 'boul. Jean-Lesage', 'boulevard Jean-Lesage', 'jean lesage', '${computeConsonantKey("Jean-Lesage")}', '');

      INSERT INTO adresses_civiques VALUES
        -- Palais de justice de Montréal (lots multiples séparés par virgule)
        (1, 1, 1, '', '', NULL, 'H2Y1B6', 'C', 'Principal', '2359285,2359286,2359287', '9891-44-1234', 45.508841, -73.554012),
        -- Autre adresse sur Notre-Dame Est pour définir la plage civique (1 à 500)
        (2, 1, 500, '', '', NULL, 'H2Y1C9', 'C', 'Principal', '2359900', '9891-50-0001', 45.512111, -73.548999),
        -- Copropriété sur René-Lévesque Ouest avec unité 402 inscrite au RQA
        (3, 2, 1200, '', '', NULL, 'H3B4W8', 'C', 'Principal', '1850100', '9888-10-0001', 45.497201, -73.571102),
        (4, 2, 1200, '', '402', 'Appartement', 'H3B4W8', 'C', 'Subdivision', '1850402', '9888-10-0402', 45.497201, -73.571102),
        -- Palais de justice de Québec
        (5, 3, 300, '', '', NULL, 'G1K8K6', 'C', 'Principal', '1214555', '4851-82-9911', 46.817412, -71.213805);

      INSERT INTO odonymes_fts(rowid, specifique, odonyme_normal, renvois_recherche)
        SELECT id, specifique, odonyme_normal, renvois_recherche FROM odonymes;

      INSERT INTO odonymes_trigram(rowid, specifique_norm)
        SELECT id, specifique_norm FROM odonymes;
    `;

    harness = createSqliteD1Harness({
      seedSql: [schemaSql, indexesSql, seedDataSql],
    });
  });

  afterAll(() => {
    harness?.close();
  });

  it("valide une adresse civique exacte avec lots multiples, district judiciaire probable et gardes strictes", async () => {
    const res = await adresseVerify(harness.d1, {
      address: "1, rue Notre-Dame Est, Montréal H2Y 1B6",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const parsed = AdresseVerifyOutputSchema.safeParse(res.structured);
    expect(parsed.success).toBe(true);

    expect(res.structured.status).toBe("exact_civic");
    expect(res.structured.adresse_normalisee).toBe(
      "1, rue Notre-Dame Est, Montréal (Québec) H2Y 1B6",
    );

    const cand = res.structured.candidates[0]!;
    expect(cand.etat_rqa).toBe("Certifiée");
    expect(cand.lots_cadastraux).toEqual(["2359285", "2359286", "2359287"]);
    expect(cand.matricule_evaluation).toBe("9891-44-1234");
    expect(cand.district_judiciaire_probable?.district).toBe("Montréal");
    expect(cand.district_judiciaire_probable?.greffes).toContain("500");
    expect(cand.district_judiciaire_probable?.reserve).toContain(
      "Loi sur la division territoriale",
    );

    const codes = res.structured.gardes.map((g) => g.code);
    expect(codes).toContain("ADRESSE_EXISTENCE_CIVIQUE_NON_DOMICILE");
    expect(codes).toContain("ADRESSE_LOT_ET_MATRICULE_SANS_VALEUR_LEGALE");
    expect(codes).not.toContain("ADRESSE_CORRESPONDANCE_APPROXIMATIVE");
  });

  it("corrige une faute de frappe + abréviation municipale + bureau non subdivisé ('1 Notr-Dame E, bureau 200, Mtl')", async () => {
    const res = await adresseVerify(harness.d1, {
      address: "1 Notr-Dame E, bureau 200, Mtl",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.structured.status).toBe("fuzzy_street_exact_civic");
    expect(res.structured.adresse_normalisee).toBe(
      "1, rue Notre-Dame Est, bureau 200, Montréal (Québec) H2Y 1B6",
    );
    expect(res.structured.corrections_appliquees.some((c) => c.includes("H2Y 1B6"))).toBe(true);
    expect(res.structured.corrections_appliquees.some((c) => c.includes("unité '200'"))).toBe(true);
    expect(res.structured.gardes.map((g) => g.code)).toContain(
      "ADRESSE_CORRESPONDANCE_APPROXIMATIVE",
    );
  });

  it("rattrape une inversion de consonnes ('1 Norte-Dame Est, Montréal') via trigrammes FTS5", async () => {
    const res = await adresseVerify(harness.d1, {
      address: "1 Norte-Dame Est, Montréal",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.structured.status).toBe("fuzzy_street_exact_civic");
    expect(res.structured.candidates[0]?.composantes.specifique_odonyme).toBe("Notre-Dame");
  });

  it("distingue une unité de copropriété confirmée au RQA d'une unité non répertoriée et résout un ancien odonyme (Dorchester -> René-Lévesque)", async () => {
    // 1) Unité 402 inscrite au RQA -> exact_civic
    const confirmed = await adresseVerify(harness.d1, {
      address: "1200, boul. René-Lévesque Ouest, app. 402, Montréal",
    });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.structured.status).toBe("exact_civic");
      expect(confirmed.structured.candidates[0]?.composantes.unite).toBe("402");
      expect(confirmed.structured.candidates[0]?.lots_cadastraux).toEqual(["1850402"]);
    }

    // 2) Unité 999 non inscrite au RQA sur un immeuble existant -> exact_civic_unit_unconfirmed
    const unconfirmed = await adresseVerify(harness.d1, {
      address: "1200, boul. René-Lévesque Ouest, bureau 999, Montréal",
    });
    expect(unconfirmed.ok).toBe(true);
    if (unconfirmed.ok) {
      expect(unconfirmed.structured.status).toBe("exact_civic_unit_unconfirmed");
      expect(unconfirmed.structured.gardes.map((g) => g.code)).toContain(
        "ADRESSE_CORRESPONDANCE_APPROXIMATIVE",
      );
    }

    // 3) Ancien nom « Dorchester » via renvois_recherche
    const renvoi = await adresseVerify(harness.d1, {
      address: "1200 boul. Dorchester Ouest, Montréal",
    });
    expect(renvoi.ok).toBe(true);
    if (renvoi.ok) {
      expect(renvoi.structured.status).toBe("fuzzy_street_exact_civic");
      expect(renvoi.structured.candidates[0]?.composantes.specifique_odonyme).toBe("René-Lévesque");
    }
  });

  it("conserve la ville de Québec même avec numéro de bureau et virgule civique française", async () => {
    const parsed = parseQuebecAddress({
      address: "300, boul. Jean-Lesage, bureau 101, Québec",
    });
    expect(parsed.municipalityNorm).toBe("quebec");
    expect(parsed.civicNumber).toBe(300);
    expect(parsed.unitNumber).toBe("101");

    const res = await adresseVerify(harness.d1, {
      address: "300, boul. Jean-Lesage, bureau 101, Québec",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.structured.status).toBe("exact_civic_unit_unconfirmed");
    expect(res.structured.candidates[0]?.composantes.municipalite).toBe("Québec");
    expect(res.structured.candidates[0]?.composantes.code_postal).toBe("G1K 8K6");
  });

  it("retourne street_only_no_civic_match avec la plage civique de la rue lorsque le numéro civique est omis ou inexistant", async () => {
    const noCivic = await adresseVerify(harness.d1, {
      street: "rue Notre-Dame Est",
      municipality: "Montréal",
    });
    expect(noCivic.ok).toBe(true);
    if (noCivic.ok) {
      expect(noCivic.structured.status).toBe("street_only_no_civic_match");
      expect(noCivic.structured.adresse_normalisee).toBeNull();
      expect(noCivic.structured.candidates[0]?.plage_civique_rue).toEqual({
        min: 1,
        max: 500,
      });
    }

    const badCivic = await adresseVerify(harness.d1, {
      address: "99999, rue Notre-Dame Est, Montréal",
    });
    expect(badCivic.ok).toBe(true);
    if (badCivic.ok) {
      expect(badCivic.structured.status).toBe("street_only_no_civic_match");
      expect(badCivic.structured.candidates[0]?.plage_civique_rue).toEqual({
        min: 1,
        max: 500,
      });
    }
  });

  it("rejette proprement les paramètres insuffisants et retourne not_found sur une rue fictive", async () => {
    const empty = await adresseVerify(harness.d1, {});
    expect(empty.ok).toBe(false);

    const unknown = await adresseVerify(harness.d1, {
      address: "42, avenue Inexistante-Du-Cosmos, Montréal",
    });
    expect(unknown.ok).toBe(true);
    if (unknown.ok) {
      expect(unknown.structured.status).toBe("not_found");
      expect(unknown.structured.candidates).toEqual([]);
    }
  });
});
