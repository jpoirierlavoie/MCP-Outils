import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RegistreGetEntityOutputSchema,
  RegistreSearchEntitiesOutputSchema,
  registreGetEntity,
  registreSearchEntities,
} from "../src/core/registres.js";
import { createSqliteD1Harness, type SqliteD1Harness } from "./helpers/sqliteD1.js";

describe("Domaine B — Registres d'entreprises du Québec et du Canada", () => {
  let harness: SqliteD1Harness;

  beforeAll(() => {
    const schemaSql = readFileSync(
      resolve(process.cwd(), "pipeline/registres/schema.sql"),
      "utf-8",
    );
    const indexesSql = readFileSync(
      resolve(process.cwd(), "pipeline/registres/indexes.sql"),
      "utf-8",
    );

    const seedDataSql = `
      INSERT INTO meta_sources VALUES
        ('req', 'Registraire des entreprises du Québec (fichier ouvert)', 'CC-BY-NC-SA-4.0', '2026-11-01', 3),
        ('rbq', 'Régie du bâtiment du Québec — Licences actives', 'CC-BY-4.0', '2026-11-15', 1),
        ('opc', 'Office de la protection du consommateur — Permis actifs', 'CC-BY-4.0', '2026-11-15', 1),
        ('rena', 'Autorité des marchés publics — RENA', 'CC-BY-4.0', '2026-11-15', 1),
        ('corp_ca', 'Corporations Canada — Sociétés fédérales', 'OGL-Canada', '2026-11-15', 2);

      INSERT INTO domaine_valeur VALUES
        ('STAT_IMMAT', 'IM', 'Immatriculée'),
        ('STAT_IMMAT', 'RO', 'Radiée d''office'),
        ('FORM_JURI', 'CIE', 'Société par actions ou compagnie'),
        ('FORM_JURI', 'SENCRL', 'Société en nom collectif à responsabilité limitée'),
        ('REGIM_JURI', '094', 'Loi sur les sociétés par actions (RLRQ, c. S-31.1)'),
        ('REGIM_JURI', '024', 'Loi sur les compagnies (RLRQ, c. C-38)'),
        ('STAT_NOM', 'V', 'En vigueur'),
        ('STAT_NOM', 'A', 'Antérieur'),
        ('TYP_NOM', 'N', 'Nom de l''assujetti'),
        ('TYP_NOM', 'A', 'Autre nom utilisé au Québec'),
        ('RELA_ASSUJ', 'FO', 'Fusion ordinaire'),
        ('TYP_CHANG', 'CONTN', 'Continuation'),
        ('INTVAL_EMPLO_QUE', 'B', 'De 6 à 10 salariés');

      -- 1) Société à numéro québécoise active avec RBQ + OPC + RENA
      INSERT INTO entites VALUES (
        1, 'qc', '1170123456', NULL, 1,
        '9123-4567 QUÉBEC INC.',
        '91234567 constructions tremblay grand nord',
        '["Constructions Tremblay Grand-Nord"]',
        'CIE', 'IM', '2018-04-12', 'Montréal', 7,
        '{"im":"2018-04-12","ds":"2018-04-12","rj":"094","rc":"094","lc":"Montréal","ap":"2026","cu":1,"tr":"B","ad":"500 boul. René-Lévesque Ouest, Montréal (Québec)","cp":"H2Z1W7","ac":[["4214","Travaux d''excavation"]],"nm":[["Constructions Tremblay Grand-Nord",null,"V","A","2019-01-10",null],["Ancienne Excavation 9123 Inc.",null,"A","N","2018-04-12","2019-01-10"]],"et":[["0001","Atelier Laval",1,"1200 boul. Industriel, Laval (Québec)","H7S2P1","Entreposage"]],"fs":[["FO","1160001111","Excavations Boréales Inc.","2021-01-01","Montréal"]],"ct":[["CONTN","094","Québec","2020-06-01"]]}'
      );

      -- 2) S.E.N.C.R.L. québécoise avec dispense d'adresse
      INSERT INTO entites VALUES (
        2, 'qc', '3340987654', NULL, 1,
        'CABINET BÉLANGER & ASSOCIÉS S.E.N.C.R.L.',
        'belanger associes llp',
        '["Bélanger & Associates LLP"]',
        'SENCRL', 'IM', '2015-09-01', 'Québec', 0,
        '{"im":"2015-09-01","da":1,"ad":"Adresse confidentielle à ne pas exposer","cp":"G1R0A0"}'
      );

      -- 3) Société québécoise radiée d'office
      INSERT INTO entites VALUES (
        3, 'qc', '1140030355', NULL, 0,
        'GESTION VIEUX-PORT LTÉE',
        '',
        NULL,
        'CIE', 'RO', '1994-01-05', 'Saint-Laurent', 8,
        '{"im":"1994-01-18","ds":"1997-07-17","rj":"024"}'
      );

      -- 4) Société fédérale LCSA active avec NE à 9 chiffres
      INSERT INTO entites VALUES (
        4, 'ca', '8284083', '801423500', 1,
        'TECHNOLOGIES NORDIQUES SAINT-LAURENT INC.',
        'st lawrence nordic technologies',
        '["ST. LAWRENCE NORDIC TECHNOLOGIES INC."]',
        'LCSA', 'Actif', '2012-09-01', 'Montréal', 0,
        '{"n2":["ST. LAWRENCE NORDIC TECHNOLOGIES INC."],"rl":"Loi canadienne sur les sociétés par actions","ds":"Actif","an":"2025","ag":"2025-05-14","ad":"1000 rue De La Gauchetière Ouest","pr":"QC","py":"CA","cp":"H3B 4W5","dmin":1,"dmax":10}'
      );

      INSERT INTO rbq_licences VALUES (
        '1170123456', '5789-1234-01',
        '{"statut":"Active","type_licence":"Entrepreneur","categorie":"Generale","sous_categories":["1.2","1.3","16"],"restriction":false,"date_delivrance":"2019-03-01","date_paiement_annuel":"2027-03-01","cautionnement_montant":"40000"}'
      );

      INSERT INTO opc_permis VALUES (
        1, '1170123456', '700912',
        '{"categorie_permis":"Commerçant itinérant","nom_commercant":"9123-4567 QUÉBEC INC.","adresse_etablissement":"500 boul. René-Lévesque Ouest","ville_etablissement":"Montréal","code_postal":"H2Z 1W7","autres_noms":"Constructions Tremblay Grand-Nord"}'
      );

      INSERT INTO rena_inscriptions VALUES (
        1, '1170123456', '9123-4567 QUÉBEC INC.', '9123 4567 quebec inc',
        '{"categorie":"Personnes morales","adresse":"500 boul. René-Lévesque Ouest, Montréal","date_debut":"2024-06-01","date_fin":"2029-06-01","infraction":"Loi sur les contrats des organismes publics, art. 21.1","decision_amp":"Inscription au RENA (5 ans)"}'
      );
    `;

    const ftsPopulateSql = `
      INSERT INTO entites_fts(rowid, nom_officiel, nom_recherche)
        SELECT id, nom_officiel, nom_recherche FROM entites;
    `;

    harness = createSqliteD1Harness({
      seedSql: [schemaSql, seedDataSql, indexesSql, ftsPopulateSql],
      enforceQueryOnly: true,
    });
  });

  afterAll(() => {
    harness?.close();
  });

  it("registre_search_entities normalise accents, suffixes juridiques (inc./ltée/S.E.N.C.R.L.) et sociétés à numéro sans tiret", async () => {
    // Recherche d'une société à numéro sans tiret et avec « Ltée » au lieu de « Inc. »
    const numSearch = await registreSearchEntities(harness.d1, {
      query: "91234567 Quebec Ltee",
    });
    const parsed = RegistreSearchEntitiesOutputSchema.parse(numSearch.structured);
    expect(parsed.count).toBe(1);
    expect(parsed.entities[0]!.neq).toBe("1170123456");
    expect(parsed.entities[0]!.has_rbq_licence).toBe(true);
    expect(parsed.entities[0]!.has_opc_permit).toBe(true);
    expect(parsed.entities[0]!.in_rena).toBe(true);
    expect(parsed.gardes.map((g) => g.code)).toEqual(
      expect.arrayContaining([
        "REGISTRE_ABSENCE_PERSONNES_PHYSIQUES",
        "REGISTRE_FRAICHEUR_ET_OPPOSABILITE_LPLE",
        "REGISTRE_ABSENCE_NON_PROBANTE_ANCILLAIRES",
        "LICENCE_DONNEES_OUVERTES_NC_SA",
      ]),
    );

    // Recherche par autre nom utilisé au Québec
    const altSearch = await registreSearchEntities(harness.d1, {
      query: "Constructions Tremblay Grand Nord",
      jurisdiction: "qc",
    });
    expect(altSearch.structured.entities[0]!.neq).toBe("1170123456");

    // Recherche S.E.N.C.R.L. sans points ni accents
    const sencrl = await registreSearchEntities(harness.d1, {
      query: "Cabinet Belanger sencrl",
    });
    expect(sencrl.structured.entities[0]!.neq).toBe("3340987654");
    expect(sencrl.structured.entities[0]!.forme_juridique).toBe(
      "Société en nom collectif à responsabilité limitée",
    );

    // Filtre active_only: true exclut la société radiée d'office
    const radieeExcluded = await registreSearchEntities(harness.d1, {
      query: "Gestion Vieux-Port",
      active_only: true,
    });
    expect(radieeExcluded.structured.count).toBe(0);

    const radieeIncluded = await registreSearchEntities(harness.d1, {
      query: "Gestion Vieux-Port",
      active_only: false,
    });
    expect(radieeIncluded.structured.count).toBe(1);
    expect(radieeIncluded.structured.entities[0]!.statut).toBe("Radiée d'office");
    expect(radieeIncluded.structured.entities[0]!.faillite_declaree).toBe(true);

    // Recherche fédérale par NE à 9 chiffres
    const fedByBn = await registreSearchEntities(harness.d1, {
      query: "801423500",
      jurisdiction: "ca",
    });
    expect(fedByBn.structured.count).toBe(1);
    expect(fedByBn.structured.entities[0]!.corporation_number).toBe("8284083");
  });

  it("registre_get_entity décode DomaineValeur, joint RBQ/OPC/RENA, protège la dispense d'adresse et valide le XOR", async () => {
    const xorBoth = await registreGetEntity(harness.d1, {
      neq: "1170123456",
      bn_ne: "801423500",
    });
    expect(xorBoth.ok).toBe(false);

    const xorNone = await registreGetEntity(harness.d1, {});
    expect(xorNone.ok).toBe(false);

    const badNeq = await registreGetEntity(harness.d1, { neq: "12345" });
    expect(badNeq.ok).toBe(false);

    const fullQc = await registreGetEntity(harness.d1, { neq: "1170123456" });
    expect(fullQc.ok).toBe(true);
    if (fullQc.ok) {
      const parsed = RegistreGetEntityOutputSchema.parse(fullQc.structured);
      expect(parsed.quebec?.statut_immatriculation.libelle).toBe("Immatriculée");
      expect(parsed.quebec?.forme_juridique.libelle).toBe("Société par actions ou compagnie");
      expect(parsed.quebec?.indicateurs.convention_unanime_actionnaires).toBe(true);
      expect(parsed.quebec?.autres_noms).toHaveLength(2);
      expect(parsed.quebec?.etablissements).toHaveLength(1);
      expect(parsed.quebec?.fusions_scissions[0]?.relation).toBe("Fusion ordinaire");
      expect(parsed.quebec?.continuations_transformations[0]?.type_changement).toBe("Continuation");
      expect(parsed.quebec?.rbq_licences[0]?.sous_categories).toEqual(["1.2", "1.3", "16"]);
      expect(parsed.quebec?.opc_permis[0]?.categorie_permis).toBe("Commerçant itinérant");
      expect(parsed.quebec?.rena_inscriptions[0]?.date_fin).toBe("2029-06-01");
      expect(fullQc.text).toContain("REGISTRE_ABSENCE_PERSONNES_PHYSIQUES");
    }

    // Dispense d'adresse au REQ : l'adresse ne doit jamais être exposée même si présente en brut
    const disp = await registreGetEntity(harness.d1, { neq: "3340987654" });
    expect(disp.ok).toBe(true);
    if (disp.ok) {
      expect(disp.structured.quebec?.domicile_declare.dispense_adresse).toBe(true);
      expect(disp.structured.quebec?.domicile_declare.adresse).toBeNull();
      expect(disp.structured.quebec?.domicile_declare.code_postal).toBeNull();
    }

    // Fiche fédérale par numéro de société et par NE (BN)
    const fed = await registreGetEntity(harness.d1, { bn_ne: "801423500" });
    expect(fed.ok).toBe(true);
    if (fed.ok) {
      expect(fed.structured.federal?.corporation_number).toBe("8284083");
      expect(fed.structured.federal?.administrateurs).toEqual({ min: 1, max: 10 });
      expect(fed.structured.federal?.autres_denominations).toContain(
        "ST. LAWRENCE NORDIC TECHNOLOGIES INC.",
      );
    }
  });
});
