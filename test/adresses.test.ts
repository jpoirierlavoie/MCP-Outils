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
        (3, '23027', '20001', 'boulevard', NULL, 'Jean-Lesage', NULL, 'boul. Jean-Lesage', 'boulevard Jean-Lesage', 'jean lesage', '${computeConsonantKey("Jean-Lesage")}', ''),
        (4, '66023', '10003', 'boulevard', NULL, 'Saint-Laurent', NULL, 'boul. Saint-Laurent', 'boulevard Saint-Laurent', 'saint laurent', '${computeConsonantKey("Saint-Laurent")}', ''),
        (5, '66023', '10004', 'rue', 'de l''', 'Église', NULL, 'rue de l''Église', 'rue de l''Église', 'eglise', '${computeConsonantKey("Église")}', ''),
        (6, '23027', '20002', 'Avenue', NULL, '3e', NULL, '3e Avenue', '3e Avenue', '3e', '${computeConsonantKey("3e")}', ''),
        (7, '23027', '20003', 'Avenue', NULL, '1re', NULL, '1re Avenue', '1re Avenue', '1re', '${computeConsonantKey("1re")}', '');

      INSERT INTO adresses_civiques VALUES
        -- Palais de justice de Montréal (lots multiples séparés par virgule)
        (1, 1, 1, '', '', NULL, 'H2Y1B6', 'C', 'Principal', '2359285,2359286,2359287', '9891-44-1234', 45.508841, -73.554012),
        -- Autre adresse sur Notre-Dame Est pour définir la plage civique (1 à 500)
        (2, 1, 500, '', '', NULL, 'H2Y1C9', 'C', 'Principal', '2359900', '9891-50-0001', 45.512111, -73.548999),
        -- Copropriété sur René-Lévesque Ouest avec unité 402 inscrite au RQA
        (3, 2, 1200, '', '', NULL, 'H3B4W8', 'C', 'Principal', '1850100', '9888-10-0001', 45.497201, -73.571102),
        (4, 2, 1200, '', '402', 'Appartement', 'H3B4W8', 'C', 'Subdivision', '1850402', '9888-10-0402', 45.497201, -73.571102),
        -- Palais de justice de Québec
        (5, 3, 300, '', '', NULL, 'G1K8K6', 'C', 'Principal', '1214555', '4851-82-9911', 46.817412, -71.213805),
        -- Odonymes supplémentaires (Saint-Laurent, de l'Église, 3e Avenue, 1re Avenue)
        (6, 4, 3500, '', '', NULL, 'H2X2V2', 'C', 'Principal', '2100100', '9810-00-3500', 45.5131, -73.5709),
        (7, 5, 4000, '', '', NULL, 'H4G1M4', 'C', 'Principal', '2200400', '9820-00-4000', 45.4621, -73.5671),
        (8, 6, 500, '', '', NULL, 'G1L2W3', 'C', 'Principal', '1300500', '4852-00-0500', 46.8241, -71.2275),
        (9, 7, 500, '', '', NULL, 'G1L3J9', 'C', 'Principal', '1300501', '4852-00-0501', 46.8235, -71.2291),
        -- Tour à bureaux 1250 René-Lévesque Ouest (> 80 unités SIG 'Étalement Vertical')
        (10, 2, 1250, '', '', NULL, 'H3B4W8', 'C', 'SERV', '1851407', '9939-27-9608', 45.497272, -73.570425),
        ${Array.from(
          { length: 85 },
          (_, i) =>
            `(${11 + i}, 2, 1250, '', '${100 + i}', 'Étalement Vertical', 'H3B4W8', 'C', 'SERV', '1851407', '9939-27-9608', 45.497272, -73.570425)`,
        ).join(",\n        ")},
        (200, 2, 1250, '', '2500', 'Étalement Vertical', 'H3B4Y1', 'C', 'SERV', '1851407', '9939-27-9608', 45.497272, -73.570425);

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

  it("ne détache pas un spécifique d'odonyme homonyme d'un arrondissement sans virgule et extrait la particule 'de l\\''", async () => {
    const stLaurent = await adresseVerify(harness.d1, {
      address: "3500 boulevard Saint-Laurent",
    });
    expect(stLaurent.ok).toBe(true);
    if (stLaurent.ok) {
      expect(stLaurent.structured.status).toBe("exact_civic");
      expect(stLaurent.structured.adresse_normalisee).toBe(
        "3500, boulevard Saint-Laurent, Montréal (Québec) H2X 2V2",
      );
    }

    const eglise = await adresseVerify(harness.d1, {
      address: "4000 rue de l'Église, Verdun",
    });
    expect(eglise.ok).toBe(true);
    if (eglise.ok) {
      expect(eglise.structured.status).toBe("exact_civic");
      expect(eglise.structured.adresse_normalisee).toBe(
        "4000, rue de l'Église, Montréal (Québec) H4G 1M4",
      );
    }
  });

  it("reconnaît les odonymes ordinaux québécois ('3e Avenue', '1ère Avenue' -> '1re Avenue') en exact_civic", async () => {
    const av3 = await adresseVerify(harness.d1, {
      address: "500, 3e Avenue, Québec",
    });
    expect(av3.ok).toBe(true);
    if (av3.ok) {
      expect(av3.structured.status).toBe("exact_civic");
      expect(av3.structured.adresse_normalisee).toBe("500, 3e Avenue, Québec (Québec) G1L 2W3");
    }

    const av1 = await adresseVerify(harness.d1, {
      address: "500, 1ère Avenue, Québec",
    });
    expect(av1.ok).toBe(true);
    if (av1.ok) {
      expect(av1.structured.status).toBe("exact_civic");
      expect(av1.structured.adresse_normalisee).toBe("500, 1re Avenue, Québec (Québec) G1L 3J9");
    }
  });

  it("assainit le type SIG 'Étalement Vertical' du RQA et retrouve une unité située au-delà de 80 subdivisions", async () => {
    const suite2500 = await adresseVerify(harness.d1, {
      address: "1250 boul. René-Lévesque Ouest, bureau 2500, Montréal (Québec) H3B 4W8",
    });
    expect(suite2500.ok).toBe(true);
    if (suite2500.ok) {
      expect(suite2500.structured.status).toBe("exact_civic");
      expect(suite2500.structured.adresse_normalisee).toBe(
        "1250, boulevard René-Lévesque Ouest, bureau 2500, Montréal (Québec) H3B 4Y1",
      );
      expect(suite2500.structured.adresse_normalisee).not.toContain("étalement vertical");
      expect(suite2500.structured.candidates[0]?.composantes.type_unite).toBe("bureau");
    }

    const towerBase = await adresseVerify(harness.d1, {
      address: "1250 boul. René-Lévesque Ouest, Montréal",
    });
    expect(towerBase.ok).toBe(true);
    if (towerBase.ok) {
      expect(towerBase.structured.status).toBe("exact_civic");
      expect(towerBase.structured.adresse_normalisee).toBe(
        "1250, boulevard René-Lévesque Ouest, Montréal (Québec) H3B 4W8",
      );
      expect(towerBase.structured.candidates).toHaveLength(1);
    }
  });

  it("résout les patronymes à particule intégrée ('De La Gauchetière' + faute de frappe) et les ligatures ('Sœurs-Grises')", async () => {
    const schemaSql = readFileSync(resolve(process.cwd(), "pipeline/adresses/schema.sql"), "utf-8");
    const indexesSql = readFileSync(
      resolve(process.cwd(), "pipeline/adresses/indexes.sql"),
      "utf-8",
    );
    const subHarness = createSqliteD1Harness({
      seedSql: [
        schemaSql,
        indexesSql,
        `
        INSERT INTO meta_sources VALUES ('rqa', 'RQA', 'CC-BY-4.0', '2026-09-01', 4);
        INSERT INTO municipalites VALUES
          ('66023', 'Montréal', 'montreal', 'mtl', 'Montréal', 'Montréal'),
          ('03005', 'Gaspé', 'gaspe', '', 'La Côte-de-Gaspé', 'Gaspésie'),
          ('53052', 'Shawinigan', 'shawinigan', '', 'Shawinigan', 'Mauricie');
        INSERT INTO odonymes VALUES
          (1, '66023', '1', 'rue', NULL, 'De La Gauchetière', 'Ouest', 'rue De La Gauchetière Ouest', 'rue De La Gauchetière Ouest', 'de la gauchetiere', '${computeConsonantKey("De La Gauchetière")}', ''),
          (2, '66023', '2', 'rue', 'des', 'Sœurs-Grises', NULL, 'rue des Sœurs-Grises', 'rue des Sœurs-Grises', 'soeurs grises', '${computeConsonantKey("Sœurs-Grises")}', ''),
          (3, '66023', '3', 'boulevard', NULL, 'De Maisonneuve', 'Est', 'boul. De Maisonneuve Est', 'boulevard De Maisonneuve Est', 'de maisonneuve', '${computeConsonantKey("De Maisonneuve")}', ''),
          (4, '66023', '4', 'boulevard', NULL, 'De Maisonneuve', 'Ouest', 'boul. De Maisonneuve Ouest', 'boulevard De Maisonneuve Ouest', 'de maisonneuve', '${computeConsonantKey("De Maisonneuve")}', ''),
          (5, '66023', '5', 'avenue', 'du', 'Parc', NULL, 'av. du Parc', 'avenue du Parc', 'parc', '${computeConsonantKey("Parc")}', ''),
          (6, '03005', '6', 'rue', 'de la', 'Cathédrale', NULL, 'rue de la Cathédrale', 'rue de la Cathédrale', 'cathedrale', '${computeConsonantKey("Cathédrale")}', ''),
          (7, '53052', '7', NULL, NULL, '6e rue de la Pointe', NULL, '6e rue de la Pointe', '6e rue de la Pointe', '6e rue de la pointe', '${computeConsonantKey("6e rue de la Pointe")}', '');
        INSERT INTO adresses_civiques VALUES
          (1, 1, 1000, '', '', NULL, 'H3B5H4', 'C', 'Principal', '1000001', '9000-00-0001', 45.498, -73.566),
          (2, 2, 100, '', '', NULL, 'H3C2A1', 'C', 'Principal', '1000002', '9000-00-0002', 45.497, -73.555),
          (3, 3, 1250, '', '', NULL, 'H2L1Z9', 'C', 'Principal', '1000003', '9000-00-0003', 45.518, -73.558),
          (4, 4, 1000, '', '', NULL, 'H3A3C8', 'C', 'Principal', '1000004', '9000-00-0004', 45.502, -73.573),
          (5, 5, 3500, '', '', NULL, 'H2X2H7', 'C', 'Principal', '1000005', '9000-00-0005', 45.511, -73.572),
          (6, 6, 11, '101', '', NULL, 'G4X2V9', 'C', 'Principal', '1000006', '1000-00-0006', 48.831, -64.482),
          (7, 6, 123, '1/2', '', NULL, 'G4X1A1', 'C', 'Principal', '1000007', '1000-00-0007', 48.832, -64.483),
          (8, 6, 10, '', '', NULL, 'G4X1A2', 'C', 'Principal', '1000008', '1000-00-0008', 48.833, -64.484),
          (9, 7, 212, '', '', NULL, 'G9N8B6', 'C', 'Principal', '1000009', '2000-00-0009', 46.539, -72.748);
        INSERT INTO odonymes_fts(rowid, specifique, odonyme_normal, renvois_recherche)
          SELECT id, specifique, odonyme_normal, renvois_recherche FROM odonymes;
        INSERT INTO odonymes_trigram(rowid, specifique_norm)
          SELECT id, specifique_norm FROM odonymes;
        `,
      ],
      enforceQueryOnly: true,
    });

    try {
      // 1) Patronyme à particule exact + faute de frappe + ligature œ
      const exactGauch = await adresseVerify(subHarness.d1, {
        address: "1000, rue De La Gauchetière Ouest, Montréal",
      });
      expect(exactGauch.ok).toBe(true);
      if (exactGauch.ok) {
        expect(exactGauch.structured.status).toBe("exact_civic");
        expect(exactGauch.structured.adresse_normalisee).toBe(
          "1000, rue De La Gauchetière Ouest, Montréal (Québec) H3B 5H4",
        );
      }

      const typoGauch = await adresseVerify(subHarness.d1, {
        address: "1000 rue De La Gauchetierre O, Mtl",
      });
      expect(typoGauch.ok).toBe(true);
      if (typoGauch.ok) {
        expect(typoGauch.structured.status).toBe("fuzzy_street_exact_civic");
        expect(typoGauch.structured.adresse_normalisee).toBe(
          "1000, rue De La Gauchetière Ouest, Montréal (Québec) H3B 5H4",
        );
      }

      const soeurs = await adresseVerify(subHarness.d1, {
        address: "100, rue des Sœurs-Grises, Montréal",
      });
      expect(soeurs.ok).toBe(true);
      if (soeurs.ok) {
        expect(soeurs.structured.status).toBe("exact_civic");
        expect(soeurs.structured.adresse_normalisee).toBe(
          "100, rue des Sœurs-Grises, Montréal (Québec) H3C 2A1",
        );
      }

      // 2) Suffixe numérique d'unité RQA (Gaspé 11, suffixe '101' -> pas de collage '11101'), fraction '1/2', suffixe '10-B' non confirmé
      const gaspe = await adresseVerify(subHarness.d1, {
        address: "11, rue de la Cathédrale, bureau 101, Gaspé G4X 2V9",
      });
      expect(gaspe.ok).toBe(true);
      if (gaspe.ok) {
        expect(gaspe.structured.status).toBe("exact_civic");
        expect(gaspe.structured.adresse_normalisee).toBe(
          "11, rue de la Cathédrale, bureau 101, Gaspé (Québec) G4X 2V9",
        );
      }

      const frac = await adresseVerify(subHarness.d1, {
        address: "123 1/2, rue de la Cathédrale, Gaspé",
      });
      expect(frac.ok).toBe(true);
      if (frac.ok) {
        expect(frac.structured.status).toBe("exact_civic");
        expect(frac.structured.adresse_normalisee).toBe(
          "123 1/2, rue de la Cathédrale, Gaspé (Québec) G4X 1A1",
        );
      }

      const unconfSuffix = await adresseVerify(subHarness.d1, {
        address: "10-B, rue de la Cathédrale, Gaspé",
      });
      expect(unconfSuffix.ok).toBe(true);
      if (unconfSuffix.ok) {
        expect(unconfSuffix.structured.status).toBe("exact_civic_unit_unconfirmed");
        expect(unconfSuffix.structured.adresse_normalisee).toBe(
          "10B, rue de la Cathédrale, Gaspé (Québec) G4X 1A2",
        );
        expect(unconfSuffix.structured.gardes.map((g) => g.code)).toContain(
          "ADRESSE_CORRESPONDANCE_APPROXIMATIVE",
        );
      }

      // 3) Odonyme ordinal composé ('6e rue de la Pointe'), mention d'étage ('1er étage') et bureau décimal ('bureau 1.32')
      const shawinigan = await adresseVerify(subHarness.d1, {
        address: "212, 6e rue de la Pointe, 1er étage, Shawinigan G9N 8B6",
      });
      expect(shawinigan.ok).toBe(true);
      if (shawinigan.ok) {
        expect(shawinigan.structured.status).toBe("exact_civic");
        expect(shawinigan.structured.adresse_normalisee).toBe(
          "212, 6e rue de la Pointe, Shawinigan (Québec) G9N 8B6",
        );
      }

      const dottedUnit = await adresseVerify(subHarness.d1, {
        address: "1000, rue De La Gauchetière Ouest, bureau 1.32, Montréal",
      });
      expect(dottedUnit.ok).toBe(true);
      if (dottedUnit.ok) {
        expect(dottedUnit.structured.status).toBe("exact_civic_unit_unconfirmed");
        expect(dottedUnit.structured.adresse_normalisee).toBe(
          "1000, rue De La Gauchetière Ouest, bureau 1.32, Montréal (Québec) H3B 5H4",
        );
      }

      // 4) Divergence de cardinal ('Ouest' -> 'Est') ou de générique ('rue' -> 'avenue') : jamais exact_civic silencieux
      const cardMismatch = await adresseVerify(subHarness.d1, {
        address: "1250, boulevard De Maisonneuve Ouest, Montréal",
      });
      expect(cardMismatch.ok).toBe(true);
      if (cardMismatch.ok) {
        expect(cardMismatch.structured.status).toBe("fuzzy_street_exact_civic");
        expect(
          cardMismatch.structured.corrections_appliquees.some((c) =>
            c.includes("Point cardinal divergent"),
          ),
        ).toBe(true);
        expect(cardMismatch.structured.gardes.map((g) => g.code)).toContain(
          "ADRESSE_CORRESPONDANCE_APPROXIMATIVE",
        );
      }

      const genMismatch = await adresseVerify(subHarness.d1, {
        address: "3500, rue du Parc, Montréal",
      });
      expect(genMismatch.ok).toBe(true);
      if (genMismatch.ok) {
        expect(genMismatch.structured.status).toBe("fuzzy_street_exact_civic");
        expect(
          genMismatch.structured.corrections_appliquees.some((c) =>
            c.includes("Générique d'odonyme rectifié"),
          ),
        ).toBe(true);
        expect(genMismatch.structured.gardes.map((g) => g.code)).toContain(
          "ADRESSE_CORRESPONDANCE_APPROXIMATIVE",
        );
      }
    } finally {
      subHarness.close();
    }
  });
});
