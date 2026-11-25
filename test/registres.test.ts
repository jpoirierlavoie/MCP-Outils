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
        ('corp_ca', 'Corporations Canada — Sociétés fédérales', 'OGL-Canada', '2026-11-15', 2),
        ('gleif', 'GLEIF — Golden Copy L1/L2/REPEX', 'CC0-1.0', '2026-11-25', 7);

      INSERT INTO domaine_valeur VALUES
        ('STAT_IMMAT', 'IM', 'Immatriculée'),
        ('STAT_IMMAT', 'NI', 'Non immatriculée'),
        ('STAT_IMMAT', 'RO', 'Radiée d''office'),
        ('FORM_JURI', 'CIE', 'Société par actions ou compagnie'),
        ('FORM_JURI', 'PM', 'Personne morale sans but lucratif'),
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

      -- 1) Société à numéro québécoise active avec RBQ + OPC + RENA + LEI
      INSERT INTO entites VALUES (
        1, 'qc', '1170123456', NULL, 1,
        '9123-4567 QUÉBEC INC.',
        '91234567 constructions tremblay grand nord',
        '["Constructions Tremblay Grand-Nord"]',
        'CIE', 'IM', '2018-04-12', 'Montréal', 7,
        '{"im":"2018-04-12","ds":"2018-04-12","rj":"094","rc":"094","lc":"Montréal","ap":"2026","cu":1,"tr":"B","ad":"500 boul. René-Lévesque Ouest, Montréal (Québec)","cp":"H2Z1W7","ac":[["4214","Travaux d''excavation"]],"nm":[["Constructions Tremblay Grand-Nord",null,"V","A","2019-01-10",null],["Ancienne Excavation 9123 Inc.",null,"A","N","2018-04-12","2019-01-10"]],"et":[["0001","Atelier Laval",1,"1200 boul. Industriel, Laval (Québec)","H7S2P1","Entreposage"]],"fs":[["FO","1160001111","Excavations Boréales Inc.","2021-01-01","Montréal"]],"ct":[["CONTN","094","Québec","2020-06-01"]]}',
        '549300QC912345670001'
      );

      -- 2) S.E.N.C.R.L. québécoise avec dispense d'adresse + LEI
      INSERT INTO entites VALUES (
        2, 'qc', '3340987654', NULL, 1,
        'CABINET BÉLANGER & ASSOCIÉS S.E.N.C.R.L.',
        'belanger associes llp',
        '["Bélanger & Associates LLP"]',
        'SENCRL', 'IM', '2015-09-01', 'Québec', 0,
        '{"im":"2015-09-01","da":1,"ad":"Adresse confidentielle à ne pas exposer","cp":"G1R0A0"}',
        '549300BELANGERDA1007'
      );

      -- 3) Société québécoise radiée d'office (sans LEI)
      INSERT INTO entites VALUES (
        3, 'qc', '1140030355', NULL, 0,
        'GESTION VIEUX-PORT LTÉE',
        '',
        NULL,
        'CIE', 'RO', '1994-01-05', 'Saint-Laurent', 8,
        '{"im":"1994-01-18","ds":"1997-07-17","rj":"024"}',
        NULL
      );

      -- 4) Société fédérale LCSA active avec NE à 9 chiffres + LEI
      INSERT INTO entites VALUES (
        4, 'ca', '8284083', '801423500', 1,
        'TECHNOLOGIES NORDIQUES SAINT-LAURENT INC.',
        'st lawrence nordic technologies',
        '["ST. LAWRENCE NORDIC TECHNOLOGIES INC."]',
        'LCSA', 'Actif', '2012-09-01', 'Montréal', 0,
        '{"n2":["ST. LAWRENCE NORDIC TECHNOLOGIES INC."],"rl":"Loi canadienne sur les sociétés par actions","ds":"Actif","an":"2025","ag":"2025-05-14","ad":"1000 rue De La Gauchetière Ouest","pr":"QC","py":"CA","cp":"H3B 4W5","dmin":1,"dmax":10}',
        '549300CA828408300002'
      );

      -- 5) Société québécoise à initiales d'un caractère (A & W) et ligne d'étage en ville brute
      INSERT INTO entites VALUES (
        5, 'qc', '1145648763', NULL, 1,
        'A & W QUÉBEC INC.',
        'services alimentaires a w',
        NULL,
        'CIE', 'IM', '2001-05-01', '20 IÈME ÉTAGE', 0,
        '{"im":"2001-05-01","ad":"75, BOUL. RENÉ-LÉVESQUE OUEST, 20 IÈME ÉTAGE, MONTRÉAL QC","cp":"H2Z1A4"}',
        NULL
      );

      -- 6) Maison d'hébergement avec dispense d'adresse LPLE (da=1) ayant aussi un établissement et volets annexes
      INSERT INTO entites VALUES (
        6, 'qc', '1144118263', NULL, 1,
        'L''AUBERGE DE L''AMITIÉ ROBERVAL INC.',
        '',
        NULL,
        'CIE', 'IM', '1990-06-15', 'Roberval', 6,
        '{"im":"1990-06-15","da":1,"ad":"374 rue Brassard, Roberval (Québec)","cp":"G8H2E1","et":[["0001","Maison d''hébergement",1,"374 rue Brassard, Roberval (Québec)","G8H2E1","Hébergement"]],"fs":[["FO","1140009999","Ancien Refuge Inc.","2010-01-01","374 rue Brassard, Roberval"]]}',
        NULL
      );

      -- 7) Fondation comportant une ligature française « Œ » dans sa dénomination officielle (sans LEI)
      INSERT INTO entites VALUES (
        7, 'qc', '1165554444', NULL, 1,
        'FONDATION SŒURS DE NOTRE-DAME AUXILIATRICE',
        '',
        NULL,
        'CIE', 'IM', '2008-03-20', 'Montréal', 0,
        '{"im":"2008-03-20","ad":"200 rue Sherbrooke Est, Montréal (Québec)","cp":"H2X1C8"}',
        NULL
      );

      -- 8) Personne morale constituée par loi spéciale (statut REQ « Non immatriculée » / is_active=0)
      INSERT INTO entites VALUES (
        8, 'qc', '8814180145', NULL, 0,
        'BARREAU DU QUÉBEC',
        '',
        NULL,
        'PM', 'NI', '1849-05-30', 'Montréal', 0,
        '{"im":"2000-03-12","ad":"445 BOUL. Saint-Laurent, Montréal (Québec)","cp":"H2Y3T8"}',
        NULL
      );

      -- 9) Entité canadienne autonome titulaire d'un LEI (banque sans fiche REQ/CorpCan locale)
      INSERT INTO entites VALUES (
        9, 'lei', '549300CABANKROYALE06', NULL, 1,
        'BANQUE ROYALE DU NORD TEST',
        'royal bank of north test',
        '["Royal Bank of North Test"]',
        'GENERAL', 'LAPSED', NULL, 'Montréal', 0,
        '{"jur":"CA","reg":"LAPSED","ren":"2025-06-01T00:00:00Z"}',
        '549300CABANKROYALE06'
      );

      -- 10) Filiale canadienne autonome titulaire d'un LEI
      INSERT INTO entites VALUES (
        10, 'lei', '549300CASUBSIDIARY05', NULL, 1,
        'FILIALE QUÉBEC NORDIQUE INC.',
        'filiale quebec nordique',
        NULL,
        'GENERAL', 'ISSUED', NULL, 'Québec', 0,
        '{"jur":"CA-QC","reg":"ISSUED","ren":"2027-06-10T00:00:00Z"}',
        '549300CASUBSIDIARY05'
      );

      -- 11) Entité duale REQ (da=1) + CorpCan liée au même LEI pour tester le masquage transversal LPLE
      INSERT INTO entites VALUES (
        11, 'ca', '9990001', '900111222', 1,
        '9990001 CANADA INC.',
        '9990001 canada',
        NULL,
        'LCSA', 'Actif', '2016-01-01', 'Québec', 0,
        '{"rl":"Loi canadienne sur les sociétés par actions","ad":"999 rue Secrète Confidentielle","pr":"QC","py":"CA","cp":"G1R 9Z9"}',
        '549300BELANGERDA1007'
      );

      INSERT INTO rbq_licences VALUES (
        '1170123456', '5789-1234-01',
        '{"statut":"Active","type_licence":"Entrepreneur","categorie":"Generale","sous_categories":["1.2","1.3","16"],"restriction":false,"date_delivrance":"2019-03-01","date_paiement_annuel":"2027-03-01","cautionnement_montant":"40000"}'
      );

      INSERT INTO opc_permis VALUES
        (1, '1170123456', '700912',
          '{"categorie_permis":"Commerçant itinérant","nom_commercant":"9123-4567 QUÉBEC INC.","adresse_etablissement":"500 boul. René-Lévesque Ouest","ville_etablissement":"Montréal","code_postal":"H2Z 1W7","autres_noms":"Constructions Tremblay Grand-Nord"}'),
        (2, '1144118263', '799999',
          '{"categorie_permis":"Collecte","nom_commercant":"L''AUBERGE DE L''AMITIÉ","adresse_etablissement":"374 rue Brassard","ville_etablissement":"Roberval","code_postal":"G8H 2E1","autres_noms":null}');

      INSERT INTO rena_inscriptions VALUES
        (1, '1170123456', '9123-4567 QUÉBEC INC.', '9123 4567 quebec inc',
          '{"categorie":"Personnes morales","adresse":"500 boul. René-Lévesque Ouest, Montréal","date_debut":"2024-06-01","date_fin":"2029-06-01","infraction":"Loi sur les contrats des organismes publics, art. 21.1","decision_amp":"Inscription au RENA (5 ans)"}'),
        (2, '1144118263', 'L''AUBERGE DE L''AMITIÉ ROBERVAL INC.', 'l auberge de l amitie roberval inc',
          '{"categorie":"Personnes morales","adresse":"374 rue Brassard, Roberval","date_debut":"2020-01-01","date_fin":"2021-01-01","infraction":"Test","decision_amp":"Test"}');

      INSERT INTO gleif_entites VALUES
        ('549300QC912345670001', 1, '9123-4567 QUÉBEC INC.', 'CA-QC', 'GENERAL', 'ACTIVE', 'T15C', 'ISSUED', '2020-04-12T00:00:00Z', '2027-04-12T00:00:00Z', '2026-04-12T00:00:00Z', '5493001KJTIIGC8Y1R12', 'FULLY_CORROBORATED', 'RA000081', '1170123456', '1170123456', NULL, 'CA', 'CA-QC', 'Montréal', 'H2Z 1W7', '{"autres_noms":["Constructions Tremblay Grand-Nord"]}'),
        ('549300CA828408300002', 1, 'TECHNOLOGIES NORDIQUES SAINT-LAURENT INC.', 'CA', 'GENERAL', 'ACTIVE', 'T15C', 'ISSUED', '2018-09-01T00:00:00Z', '2027-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '5493001KJTIIGC8Y1R12', 'FULLY_CORROBORATED', 'RA000072', '828408-3', NULL, '8284083', 'CA', 'CA-QC', 'Montréal', 'H3B 4W5', '{"autres_noms":["ST. LAWRENCE NORDIC TECHNOLOGIES INC."]}'),
        ('549300CAPARENT000003', 1, 'HOLDING SAINT-LAURENT LTÉE', 'CA-QC', 'GENERAL', 'ACTIVE', 'T15C', 'ISSUED', '2017-01-15T00:00:00Z', '2027-01-15T00:00:00Z', '2026-01-15T00:00:00Z', '5493001KJTIIGC8Y1R12', 'FULLY_CORROBORATED', 'RA000079', 'ON-9901234', NULL, NULL, 'CA', 'CA-ON', 'Toronto', 'M5H 2N2', NULL),
        ('549300USULTIMATE0004', 0, 'NORDIC GLOBAL HOLDINGS LLC', 'US-DE', 'GENERAL', 'ACTIVE', 'H435', 'ISSUED', '2015-03-01T00:00:00Z', '2027-03-01T00:00:00Z', '2026-03-01T00:00:00Z', '5493001KJTIIGC8Y1R12', 'FULLY_CORROBORATED', 'RA000602', 'DE-5511990', NULL, NULL, 'US', 'US-DE', 'Wilmington', '19801', NULL),
        ('549300CASUBSIDIARY05', 1, 'FILIALE QUÉBEC NORDIQUE INC.', 'CA-QC', 'GENERAL', 'ACTIVE', 'T15C', 'ISSUED', '2021-06-10T00:00:00Z', '2027-06-10T00:00:00Z', '2026-06-10T00:00:00Z', '5493001KJTIIGC8Y1R12', 'FULLY_CORROBORATED', 'RA000081', '1179998888', NULL, NULL, 'CA', 'CA-QC', 'Québec', 'G1R 4P5', NULL),
        ('549300CABANKROYALE06', 1, 'BANQUE ROYALE DU NORD TEST', 'CA', 'GENERAL', 'ACTIVE', 'T15C', 'LAPSED', '2014-06-01T00:00:00Z', '2025-06-01T00:00:00Z', '2024-06-01T00:00:00Z', '5493001KJTIIGC8Y1R12', 'ENTITY_SUPPLIED_ONLY', 'RA000831', 'BS-0012', NULL, NULL, 'CA', 'CA-QC', 'Montréal', 'H3B 5G2', '{"autres_noms":["Royal Bank of North Test"]}'),
        ('549300BELANGERDA1007', 1, 'CABINET BÉLANGER & ASSOCIÉS S.E.N.C.R.L.', 'CA-QC', 'GENERAL', 'ACTIVE', 'T15C', 'ISSUED', '2016-05-01T00:00:00Z', '2027-05-01T00:00:00Z', '2026-05-01T00:00:00Z', '5493001KJTIIGC8Y1R12', 'FULLY_CORROBORATED', 'RA000081', '3340987654', '3340987654', '9990001', 'CA', 'CA-QC', 'Québec Confidentiel', 'G1R 0A0', NULL);

      INSERT INTO gleif_liens VALUES
        (1, '549300CA828408300002', '549300CAPARENT000003', 'IS_DIRECTLY_CONSOLIDATED_BY', 'ACTIVE', 'IFRS', 100.0, 'PERCENTAGE', '2025-01-01', '2025-12-31', 'FULLY_CORROBORATED'),
        (2, '549300CA828408300002', '549300USULTIMATE0004', 'IS_ULTIMATELY_CONSOLIDATED_BY', 'ACTIVE', 'IFRS', NULL, NULL, '2025-01-01', '2025-12-31', 'FULLY_CORROBORATED'),
        (3, '549300CASUBSIDIARY05', '549300CA828408300002', 'IS_DIRECTLY_CONSOLIDATED_BY', 'ACTIVE', 'IFRS', 100.0, 'PERCENTAGE', '2025-01-01', '2025-12-31', 'FULLY_CORROBORATED'),
        (4, '549300CASUBSIDIARY05', '549300USULTIMATE0004', 'IS_ULTIMATELY_CONSOLIDATED_BY', 'ACTIVE', 'IFRS', NULL, NULL, '2025-01-01', '2025-12-31', 'FULLY_CORROBORATED');

      INSERT INTO gleif_exceptions VALUES
        ('549300QC912345670001', 'DIRECT_ACCOUNTING_CONSOLIDATION_PARENT', '["NO_LEI"]', NULL),
        ('549300QC912345670001', 'ULTIMATE_ACCOUNTING_CONSOLIDATION_PARENT', '["NATURAL_PERSONS"]', NULL),
        ('549300CABANKROYALE06', 'DIRECT_ACCOUNTING_CONSOLIDATION_PARENT', '["NON_CONSOLIDATING"]', NULL);
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

  it("registre_search normalise accents, suffixes juridiques (inc./ltée/S.E.N.C.R.L.) et sociétés à numéro sans tiret", async () => {
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

    // Dispense d'adresse au REQ : ni l'adresse, ni la ville, ni le code postal ne doivent être exposés
    const disp = await registreGetEntity(harness.d1, { neq: "3340987654" });
    expect(disp.ok).toBe(true);
    if (disp.ok) {
      expect(disp.structured.quebec?.domicile_declare.dispense_adresse).toBe(true);
      expect(disp.structured.quebec?.domicile_declare.adresse).toBeNull();
      expect(disp.structured.quebec?.domicile_declare.ville).toBeNull();
      expect(disp.structured.quebec?.domicile_declare.code_postal).toBeNull();
    }

    // Fiche fédérale par numéro de société (incluant format avec tirets) et par NE (BN)
    const fedByHyphen = await registreGetEntity(harness.d1, { corporation_number: "828-408-3" });
    expect(fedByHyphen.ok).toBe(true);
    if (fedByHyphen.ok) {
      expect(fedByHyphen.structured.federal?.corporation_number).toBe("8284083");
    }

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

  it("gère les dénominations à initiales courtes ('A&W'), masque la ville sous dispense et redresse une ligne d'étage en municipalité", async () => {
    const aw = await registreSearchEntities(harness.d1, { query: "A&W" });
    expect(aw.structured.count).toBe(1);
    expect(aw.structured.entities[0]?.neq).toBe("1145648763");
    expect(aw.structured.entities[0]?.ville).toBe("MONTRÉAL");

    const awFiche = await registreGetEntity(harness.d1, { neq: "1145648763" });
    expect(awFiche.ok).toBe(true);
    if (awFiche.ok) {
      expect(awFiche.structured.quebec?.domicile_declare.ville).toBe("MONTRÉAL");
    }

    const dispSearch = await registreSearchEntities(harness.d1, { query: "Cabinet Belanger" });
    expect(dispSearch.structured.entities[0]?.ville).toBeNull();
  });

  it("occulte intégralement toute adresse sous dispense LPLE (établissements/fusions/OPC/RENA), résout les ligatures 'Sœurs'/'Soeurs' et évite le balayage complet de domaine_valeur", async () => {
    // 1) Maison d'hébergement avec da=1 : aucune fuite d'adresse ni dans les établissements ni dans les volets annexes
    const shelter = await registreGetEntity(harness.d1, { neq: "1144118263" });
    expect(shelter.ok).toBe(true);
    if (shelter.ok) {
      expect(shelter.structured.quebec?.domicile_declare.dispense_adresse).toBe(true);
      expect(shelter.structured.quebec?.domicile_declare.adresse).toBeNull();
      expect(shelter.structured.quebec?.domicile_declare.ville).toBeNull();
      expect(shelter.structured.quebec?.domicile_declare.code_postal).toBeNull();
      expect(shelter.structured.quebec?.etablissements[0]?.adresse).toBeNull();
      expect(shelter.structured.quebec?.etablissements[0]?.code_postal).toBeNull();
      expect(shelter.structured.quebec?.fusions_scissions[0]?.adresse).toBeNull();
      expect(shelter.structured.quebec?.opc_permis[0]?.adresse_etablissement).toBeNull();
      expect(shelter.structured.quebec?.opc_permis[0]?.ville_etablissement).toBeNull();
      expect(shelter.structured.quebec?.opc_permis[0]?.code_postal).toBeNull();
      expect(shelter.structured.quebec?.rena_inscriptions[0]?.adresse).toBeNull();
      const dumped = JSON.stringify(shelter);
      expect(dumped).not.toContain("Brassard");
      expect(dumped).not.toContain("G8H");
    }

    // 2) Recherche bidirectionnelle avec ou sans ligature « œ »
    const withLigature = await registreSearchEntities(harness.d1, {
      query: "Fondation Sœurs de Notre-Dame",
    });
    const withoutLigature = await registreSearchEntities(harness.d1, {
      query: "Fondation Soeurs de Notre-Dame",
    });
    expect(withLigature.structured.count).toBe(1);
    expect(withoutLigature.structured.count).toBe(1);
    expect(withLigature.structured.entities[0]?.neq).toBe("1165554444");
    expect(withoutLigature.structured.entities[0]?.neq).toBe("1165554444");

    // 3) Aucune requête sur domaine_valeur en périmètre fédéral pur, et requête indexée ciblée en périmètre québécois
    const sqlSeen: string[] = [];
    const spyD1: D1Database = {
      prepare(query: string) {
        sqlSeen.push(query);
        return harness.d1.prepare(query);
      },
      batch(statements) {
        return harness.d1.batch(statements);
      },
      exec(query: string) {
        return harness.d1.exec(query);
      },
      withSession(constraintOrBookmark?: string) {
        return harness.d1.withSession(constraintOrBookmark);
      },
      dump() {
        return harness.d1.dump();
      },
    };

    await registreSearchEntities(spyD1, {
      query: "Technologies Nordiques",
      jurisdiction: "ca",
    });
    expect(sqlSeen.some((s) => s.includes("domaine_valeur"))).toBe(false);

    sqlSeen.length = 0;
    await registreGetEntity(spyD1, { neq: "1165554444" });
    const dvQueries = sqlSeen.filter((s) => s.includes("domaine_valeur"));
    expect(dvQueries).toHaveLength(1);
    expect(dvQueries[0]).toContain("WHERE (typ_dom_val = ? AND cod_dom_val = ?)");
  });

  it("distingue exact_match_found=true d'une correspondance partielle ou absente avec note sur les lois constitutives spéciales", async () => {
    const exact = RegistreSearchEntitiesOutputSchema.parse(
      (await registreSearchEntities(harness.d1, { query: "9123-4567 QUÉBEC INC." })).structured,
    );
    expect(exact.exact_match_found).toBe(true);

    const partial = await registreSearchEntities(harness.d1, { query: "Excavations Hydro" });
    const parsedPartial = RegistreSearchEntitiesOutputSchema.parse(partial.structured);
    expect(parsedPartial.exact_match_found).toBe(false);
    expect(partial.text).toContain("constituées par loi spéciale");
    expect(partial.text).toContain("Hydro-Québec");
  });

  it("D27 & B-N13 : une entité radiée homonyme ou nom commercial sur une société d'État n'active jamais exact_match_found", async () => {
    // 'GESTION VIEUX-PORT LTÉE' est radiée (is_active = 0) dans le jeu de test
    const inactiveMatch = RegistreSearchEntitiesOutputSchema.parse(
      (await registreSearchEntities(harness.d1, { query: "GESTION VIEUX-PORT LTÉE" })).structured,
    );
    expect(inactiveMatch.entities.length).toBeGreaterThanOrEqual(1);
    expect(inactiveMatch.exact_match_found).toBe(false);

    // Une société par loi spéciale (Hydro-Québec) homonyme d'une fiche non corporative ou inactive reste à exact_match_found = false
    const hydroRes = RegistreSearchEntitiesOutputSchema.parse(
      (await registreSearchEntities(harness.d1, { query: "Hydro-Québec" })).structured,
    );
    expect(hydroRes.exact_match_found).toBe(false);

    // Une personne morale constituée par loi spéciale au statut REQ « Non immatriculée » active exact_match_found = true
    const barreauRes = RegistreSearchEntitiesOutputSchema.parse(
      (await registreSearchEntities(harness.d1, { query: "Barreau du Québec" })).structured,
    );
    expect(barreauRes.exact_match_found).toBe(true);
    expect(barreauRes.entities[0]?.neq).toBe("8814180145");
  });

  it("GLEIF PR 2 : expose has_lei, recherche par LEI et entités canadiennes autonomes sans polluer par les mères étrangères", async () => {
    const byName = RegistreSearchEntitiesOutputSchema.parse(
      (await registreSearchEntities(harness.d1, { query: "Technologies Nordiques" })).structured,
    );
    expect(byName.entities[0]?.has_lei).toBe(true);
    expect(byName.entities[0]?.lei).toBe("549300CA828408300002");
    expect(byName.gardes.map((g) => g.code)).toContain("REGISTRE_GLEIF_DECLARATIF_CONSOLIDATION");

    const noLei = RegistreSearchEntitiesOutputSchema.parse(
      (await registreSearchEntities(harness.d1, { query: "Gestion Vieux-Port" })).structured,
    );
    expect(noLei.entities[0]?.has_lei).toBe(false);
    expect(noLei.entities[0]?.lei).toBeNull();
    expect(noLei.gardes.map((g) => g.code)).not.toContain(
      "REGISTRE_GLEIF_DECLARATIF_CONSOLIDATION",
    );

    // Entité canadienne autonome (banque sans fiche REQ/CorpCan) sous jurisdiction='all' et 'gleif'
    const bankAll = RegistreSearchEntitiesOutputSchema.parse(
      (await registreSearchEntities(harness.d1, { query: "Banque Royale du Nord" })).structured,
    );
    expect(bankAll.count).toBe(1);
    expect(bankAll.entities[0]?.jurisdiction).toBe("gleif");
    expect(bankAll.entities[0]?.neq).toBeNull();
    expect(bankAll.entities[0]?.corporation_number).toBeNull();
    expect(bankAll.entities[0]?.has_lei).toBe(true);
    expect(bankAll.entities[0]?.lei).toBe("549300CABANKROYALE06");

    // Recherche directe par LEI à 20 caractères (insensible à la casse)
    const directLei = RegistreSearchEntitiesOutputSchema.parse(
      (
        await registreSearchEntities(harness.d1, {
          query: "549300qc912345670001",
          jurisdiction: "gleif",
        })
      ).structured,
    );
    expect(directLei.count).toBe(1);
    expect(directLei.exact_match_found).toBe(true);
    expect(directLei.entities[0]?.neq).toBe("1170123456");

    // La société mère étrangère (is_canadian = 0) ne pollue pas registre_search
    const foreign = RegistreSearchEntitiesOutputSchema.parse(
      (await registreSearchEntities(harness.d1, { query: "Nordic Global Holdings" })).structured,
    );
    expect(foreign.count).toBe(0);
  });

  it("GLEIF PR 2 : valide le XOR à 4 clés, la normalisation LEI, la hiérarchie Level 2, REPEX, filiales, portails officiels et masquage LPLE da=1", async () => {
    // XOR 4 clés + format LEI invalide -> erreurs françaises (ok=false)
    const xorErr = await registreGetEntity(harness.d1, {
      neq: "1170123456",
      lei: "549300QC912345670001",
    });
    expect(xorErr.ok).toBe(false);
    if (!xorErr.ok) {
      expect(xorErr.text).toContain("quatre identifiants");
    }

    const badLei = await registreGetEntity(harness.d1, { lei: "INVALID_LEI_123" });
    expect(badLei.ok).toBe(false);
    if (!badLei.ok) {
      expect(badLei.text).toContain("Format de LEI invalide");
    }

    // Lookup par LEI (minuscules + tirets) sur société fédérale avec mère directe canadienne, mère ultime étrangère et filiale canadienne
    const fedByLei = await registreGetEntity(harness.d1, { lei: "549300ca-828408300002" });
    expect(fedByLei.ok).toBe(true);
    if (fedByLei.ok) {
      const parsed = RegistreGetEntityOutputSchema.parse(fedByLei.structured);
      expect(parsed.lookup_by).toBe("lei");
      expect(parsed.lookup_value).toBe("549300CA828408300002");
      expect(parsed.federal?.corporation_number).toBe("8284083");
      expect(parsed.gleif?.registration_status).toBe("ISSUED");
      expect(parsed.gleif?.next_renewal_date).toBe("2027-09-01T00:00:00Z");
      expect(parsed.gleif?.parent_direct?.lei).toBe("549300CAPARENT000003");
      expect(parsed.gleif?.parent_direct?.in_canadian_snapshot).toBe(true);
      expect(parsed.gleif?.parent_ultime?.lei).toBe("549300USULTIMATE0004");
      expect(parsed.gleif?.parent_ultime?.nom_legal).toBe("NORDIC GLOBAL HOLDINGS LLC");
      expect(parsed.gleif?.parent_ultime?.pays).toBe("US");
      expect(parsed.gleif?.parent_ultime?.legal_jurisdiction).toBe("US-DE");
      expect(parsed.gleif?.parent_ultime?.in_canadian_snapshot).toBe(false);
      expect(parsed.gleif?.filiales_canadiennes_total).toBe(1);
      expect(parsed.gleif?.filiales_canadiennes[0]?.lei).toBe("549300CASUBSIDIARY05");
      expect(parsed.gleif?.filiales_canadiennes[0]?.type_lien).toBe("direct");
      expect(parsed.gardes.map((g) => g.code)).toContain("REGISTRE_GLEIF_DECLARATIF_CONSOLIDATION");
      expect(parsed.portails_officiels.req).toBeNull();
      expect(parsed.portails_officiels.corporations_canada?.url).toBe(
        "https://ised-isde.canada.ca/cc/lgcy/fdrlCrpDtls.html?corpId=8284083&lang=fra",
      );
      expect(parsed.portails_officiels.isc_pisc?.url).toBe(
        "https://ised-isde.canada.ca/site/corporations-canada/fr/particuliers-ayant-controle-important",
      );
      expect(parsed.portails_officiels.gleif?.url).toBe(
        "https://search.gleif.org/#/record/549300CA828408300002",
      );
      expect(parsed.provenance.source).toContain("GLEIF");
    }

    // Exceptions REPEX (NO_LEI + NATURAL_PERSONS) et portail REQ sur entité québécoise
    const qcWithRepex = await registreGetEntity(harness.d1, { neq: "1170123456" });
    expect(qcWithRepex.ok).toBe(true);
    if (qcWithRepex.ok) {
      const parsed = RegistreGetEntityOutputSchema.parse(qcWithRepex.structured);
      expect(parsed.gleif?.lei).toBe("549300QC912345670001");
      expect(parsed.gleif?.exceptions_declaration).toHaveLength(2);
      expect(parsed.gleif?.exceptions_declaration.flatMap((e) => e.raisons)).toEqual(
        expect.arrayContaining(["NO_LEI", "NATURAL_PERSONS"]),
      );
      expect(parsed.portails_officiels.req?.url).toBe(
        "https://www.registreentreprises.gouv.qc.ca/REQNA/GR/GR03/GR03A71.RechercheRegistre.MVC/GR03A71/RechercheParNeq",
      );
      expect(parsed.portails_officiels.req?.portal_info_url).toBe(
        "https://www.quebec.ca/entreprises-et-travailleurs-autonomes/obtenir-renseignements-entreprise/recherche-registre-entreprises/acceder-registre-entreprises",
      );
    }

    // Garde conditionnelle omise lorsqu'aucun LEI n'est associé
    const noGleif = await registreGetEntity(harness.d1, { neq: "1165554444" });
    expect(noGleif.ok).toBe(true);
    if (noGleif.ok) {
      expect(noGleif.structured.gleif).toBeNull();
      expect(noGleif.structured.gardes.map((g) => g.code)).not.toContain(
        "REGISTRE_GLEIF_DECLARATIF_CONSOLIDATION",
      );
    }

    // Masquage LPLE da=1 transversal : requête par NEQ et par LEI masque QC + CorpCan + GLEIF
    for (const queryArgs of [{ neq: "3340987654" }, { lei: "549300BELANGERDA1007" }] as const) {
      const masked = await registreGetEntity(harness.d1, queryArgs);
      expect(masked.ok).toBe(true);
      if (masked.ok) {
        const parsed = RegistreGetEntityOutputSchema.parse(masked.structured);
        expect(parsed.quebec?.domicile_declare.dispense_adresse).toBe(true);
        expect(parsed.quebec?.domicile_declare.adresse).toBeNull();
        expect(parsed.quebec?.domicile_declare.ville).toBeNull();
        expect(parsed.gleif?.adresse_legale).toBeNull();
        expect(parsed.federal?.adresse_siege).toEqual({
          rue: null,
          ville: null,
          province: null,
          pays: null,
          code_postal: null,
        });
        const dumped = JSON.stringify(masked);
        expect(dumped).not.toContain("Confidentielle");
        expect(dumped).not.toContain("G1R 0A0");
        expect(dumped).not.toContain("G1R 9Z9");
      }
    }
  });
});
