import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TerminologieAttestationsOutputSchema,
  TerminologieLookupOutputSchema,
  TerminologieScanTextOutputSchema,
  terminologieAttestations,
  terminologieLookup,
  terminologieScanText,
} from "../src/core/terminologie.js";
import glossaireJson from "../src/data/glossaire_bijuridique_qc.json" with { type: "json" };
import { createSqliteD1Harness, type SqliteD1Harness } from "./helpers/sqliteD1.js";

function sqlStr(v: string | null): string {
  if (v === null) return "NULL";
  return `'${v.replace(/'/g, "''")}'`;
}

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

describe("Domaine A — Terminologie juridique bilingue et bijuridique", () => {
  let harness: SqliteD1Harness;

  beforeAll(() => {
    const schemaSql = readFileSync(
      resolve(process.cwd(), "pipeline/terminologie/schema.sql"),
      "utf-8",
    );
    const indexesSql = readFileSync(
      resolve(process.cwd(), "pipeline/terminologie/indexes.sql"),
      "utf-8",
    );

    const inserts: string[] = [
      `INSERT INTO meta_sources VALUES
        ('glossaire_qc', 'Glossaire curé QC', 1, 'CC-BY-NC-SA-4.0', '2026-11-15', ${glossaireJson.entries.length}),
        ('concordancier_legislatif', 'Concordancier législatif', 2, 'OGL-Canada', '2026-11-15', 5),
        ('termium_plus_droit', 'TERMIUM Plus', 3, 'OGL-Canada', '2026-11-15', 2),
        ('oqlf_droit', 'OQLF', 4, 'CC-BY-NC-SA-4.0', '2026-01-19', 1);`,
    ];

    let ficheId = 0;
    let regleId = 0;
    const seenRegles = new Set<string>();

    for (const entry of glossaireJson.entries) {
      ficheId += 1;
      const decCombined = [
        ...entry.termes_deconseilles_fr.map((d) => ({ ...d, langue: "fr" })),
        ...entry.termes_deconseilles_en.map((d) => ({ ...d, langue: "en" })),
      ];
      const searchBag = [
        entry.terme_fr,
        entry.terme_en,
        ...entry.synonymes_fr,
        ...entry.synonymes_en,
        ...decCombined.map((d) => d.terme),
        entry.base_legale,
      ].join(" | ");

      inserts.push(
        `INSERT INTO fiches_terminologiques VALUES (
          ${ficheId}, ${sqlStr(entry.id)}, 1,
          'Glossaire curé de pratique civile et commerciale québécoise', 'CC-BY-NC-SA-4.0',
          ${sqlStr(entry.terme_fr)}, ${sqlStr(entry.terme_en)},
          ${sqlStr(fold(entry.terme_fr))}, ${sqlStr(fold(entry.terme_en))},
          ${sqlStr(JSON.stringify(entry.synonymes_fr))},
          ${sqlStr(JSON.stringify(entry.synonymes_en))},
          ${sqlStr(JSON.stringify(decCombined))},
          ${sqlStr(searchBag)},
          ${sqlStr(entry.systeme_juridique)}, ${sqlStr(entry.domaine)},
          ${sqlStr(entry.note_explicative)}, ${sqlStr(entry.base_legale)},
          NULL, '2026-11-15'
        );`,
      );

      for (const dFr of entry.termes_deconseilles_fr) {
        const key = `fr:${fold(dFr.terme)}`;
        if (seenRegles.has(key)) continue;
        seenRegles.add(key);
        regleId += 1;
        const cat = dFr.origine.includes("francais")
          ? "francisme_france"
          : dFr.origine.includes("archa")
            ? "archaisme_qc"
            : "anglicisme_ou_common_law";
        const bij = dFr.terme.toLowerCase() === "mortgage" ? "hypothèque" : null;
        inserts.push(
          `INSERT INTO regles_contamination VALUES (
            ${regleId}, ${sqlStr(`r1-fr-${regleId}`)}, 'fr',
            ${sqlStr(dFr.terme)}, ${sqlStr(fold(dFr.terme))}, 0,
            ${sqlStr(cat)}, ${sqlStr(bij)},
            ${sqlStr(dFr.motif)}, ${sqlStr(entry.terme_fr)}, ${sqlStr(entry.base_legale)}
          );`,
        );
      }

      for (const dEn of entry.termes_deconseilles_en) {
        const key = `en:${fold(dEn.terme)}`;
        if (seenRegles.has(key)) continue;
        seenRegles.add(key);
        regleId += 1;
        const bij =
          dEn.terme.toLowerCase() === "mortgage"
            ? "hypothec"
            : dEn.terme.toLowerCase() === "joint and several"
              ? "solidar"
              : null;
        inserts.push(
          `INSERT INTO regles_contamination VALUES (
            ${regleId}, ${sqlStr(`r1-en-${regleId}`)}, 'en',
            ${sqlStr(dEn.terme)}, ${sqlStr(fold(dEn.terme))}, 0,
            'anglicisme_ou_common_law', ${sqlStr(bij)},
            ${sqlStr(dEn.motif)}, ${sqlStr(entry.terme_en)}, ${sqlStr(entry.base_legale)}
          );`,
        );
      }
    }

    // Règle additionnelle article 1240 Code civil français
    regleId += 1;
    inserts.push(
      `INSERT INTO regles_contamination VALUES (
        ${regleId}, 'fr-art-1240', 'fr', 'article 1240', 'article 1240', 0,
        'francisme_france', NULL,
        'Référence au Code civil français ; au Québec, la responsabilité extracontractuelle relève de l''art. 1457 C.c.Q.',
        'article 1457 C.c.Q.', 'Art. 1457 C.c.Q.'
      );`,
    );

    // Rang 3 (TERMIUM Plus — common law mortgage) et Rang 4 (OQLF — CC BY-NC-SA 4.0)
    ficheId += 1;
    inserts.push(
      `INSERT INTO fiches_terminologiques VALUES (
        ${ficheId}, NULL, 3, 'TERMIUM Plus® — Bureau de la traduction', 'OGL-Canada',
        'hypothèque de common law', 'mortgage', 'hypotheque de common law', 'mortgage',
        '[]', '[]', '[]', 'hypothèque de common law | mortgage',
        'common_law', 'Droit des biens (common law)',
        'Sûreté immobilière de common law transférant un titre grevé d''un droit de rachat.', NULL, NULL, '2026-11-15'
      );`,
    );

    ficheId += 1;
    inserts.push(
      `INSERT INTO fiches_terminologiques VALUES (
        ${ficheId}, NULL, 4, 'Office québécois de la langue française (OQLF)', 'CC-BY-NC-SA-4.0',
        'action collective', 'class action', 'action collective', 'class action',
        '["recours collectif"]', '[]', '[]', 'action collective | class action | recours collectif',
        'droit_civil_qc', 'droit > procédure civile',
        'Procédure permettant à un membre d''agir sans mandat pour tous les membres d''un groupe.',
        NULL, 'https://vitrinelinguistique.oqlf.gouv.qc.ca/fiche-gdt/fiche/8369244/action-collective', '2026-01-19'
      );`,
    );

    // Lois et articles bilingues (avec apostrophe typographique LégisQuébec \u2019)
    inserts.push(
      `INSERT INTO lois_bilingues VALUES
        ('ccq', 'qc', 'Code civil du Québec', 'Civil Code of Québec', 'RLRQ, c. CCQ-1991', NULL, '2026-04-07', '2026-04-07'),
        ('cpc', 'qc', 'Code de procédure civile', 'Code of Civil Procedure', 'RLRQ, c. C-25.01', NULL, '2026-04-07', '2026-04-07'),
        ('ca-b-3', 'ca', 'Loi sur la faillite et l’insolvabilité', 'Bankruptcy and Insolvency Act', 'L.R.C. (1985), ch. B-3', 'R.S.C., 1985, c. B-3', '2026-07-21', '2026-07-21');`,
    );

    inserts.push(
      `INSERT INTO articles_bilingues VALUES
        (1, 'ccq', '1401', 1401,
          'L’erreur d’une partie, provoquée par le dol de l’autre partie ou à la connaissance de celle-ci, vicie le consentement dans tous les cas où, sans cela, la partie n’aurait pas contracté ou aurait contracté à des conditions différentes.',
          'Error on the part of one party induced by fraud committed by the other party or with his knowledge vitiates consent whenever, but for that error, the party would not have contracted, or would have contracted on different terms.'),
        (2, 'ccq', '1619', 1619,
          'Il peut être ajouté aux dommages-intérêts accordés à quelque titre que ce soit, une indemnité fixée en appliquant à leur montant une somme de cent dollars.',
          'An indemnity may be added to the bodily, moral or material damages awarded to a person.'),
        (3, 'ccq', '2660', 2660,
          'L’hypothèque est un droit réel sur un bien, meuble ou immeuble, affecté à l’exécution d’une obligation.',
          'A hypothec is a real right on a movable or immovable property made liable for the performance of an obligation.'),
        (4, 'cpc', '141', 141,
          'La demande introductive d’instance est écrite, présentée par le demandeur ou son avocat et accompagnée d’un avis d’assignation.',
          'An originating application must be in writing and be presented by the plaintiff or the plaintiff’s lawyer, together with a summons.'),
        (5, 'ca-b-3', '2', 2,
          'créancier garanti Personne détenant un mortgage, une hypothèque, un nantissement ou un privilège sur des biens du débiteur.',
          'secured creditor means a person holding a mortgage on real property or hypothec on immovables, pledge, charge or lien on or against the property of the debtor.');`,
    );

    const populateFtsSql = `
      INSERT INTO fiches_fts(rowid, terme_fr, terme_en, termes_recherche, domaine)
        SELECT id, terme_fr, terme_en, termes_recherche, domaine FROM fiches_terminologiques;
      INSERT INTO articles_fr_fts(rowid, text_fr)
        SELECT id, text_fr FROM articles_bilingues;
      INSERT INTO articles_en_fts(rowid, text_en)
        SELECT id, text_en FROM articles_bilingues;
    `;

    harness = createSqliteD1Harness({
      seedSql: [schemaSql, ...inserts, indexesSql, populateFtsSql],
      enforceQueryOnly: true,
    });
  });

  afterAll(() => {
    harness?.close();
  });

  it("valide l'intégrité du glossaire curé de rang 1 (>= 80 entrées, zéro source protégée, cas incontournables présents)", () => {
    expect(glossaireJson.entries.length).toBeGreaterThanOrEqual(80);
    const serialized = JSON.stringify(glossaireJson).toLowerCase();
    expect(serialized).not.toContain("crépeau");
    expect(serialized).not.toContain("crepeau");
    expect(serialized).not.toContain("juriterm");
    expect(serialized).not.toContain("juridictionnaire");

    const requiredPairs: Array<[string, string]> = [
      ["hypothèque", "hypothec"],
      ["cautionnement", "suretyship"],
      ["obligation solidaire", "solidary obligation"],
      ["fiducie", "trust"],
      ["signification", "service"],
      ["notification", "notification"],
      ["demande introductive d'instance", "originating application"],
      ["prescription extinctive", "extinctive prescription"],
      ["faute lourde", "gross fault"],
      ["dol", "fraud"],
      ["emphytéose", "emphyteusis"],
      ["servitude", "servitude"],
      ["usufruit", "usufruct"],
      ["en liasse", "filed jointly"],
      ["sous toutes réserves", "without prejudice"],
    ];

    for (const [fr, en] of requiredPairs) {
      const hit = glossaireJson.entries.some(
        (e) => fold(e.terme_fr) === fold(fr) && fold(e.terme_en).includes(fold(en)),
      );
      expect(hit, `Entrée incontournable manquante : ${fr} ↔ ${en}`).toBe(true);
    }
  });

  it("terminologie_lookup classe par rang_source (1 -> 4), remonte le faux ami 'mortgage' vers 'hypothec' et réserve LICENCE_DONNEES_OUVERTES_NC_SA au rang 4", async () => {
    const hyp = await terminologieLookup(harness.d1, { query: "hypothèque" });
    const parsedHyp = TerminologieLookupOutputSchema.parse(hyp.structured);
    expect(parsedHyp.count).toBeGreaterThanOrEqual(1);
    expect(parsedHyp.fiches[0]!.rang_source).toBe(1);
    expect(parsedHyp.fiches[0]!.terme_en).toBe("hypothec");
    expect(parsedHyp.fiches.every((f) => f.rang_source !== 4)).toBe(true);
    expect(
      parsedHyp.gardes.some((g) => g.code === "TERMINOLOGIE_AIDE_REDACTION_NON_NORMATIVE"),
    ).toBe(true);
    expect(parsedHyp.gardes.some((g) => g.code === "LICENCE_DONNEES_OUVERTES_NC_SA")).toBe(false);
    expect(hyp.text).not.toContain("LICENCE_DONNEES_OUVERTES_NC_SA");

    // Faux ami anglais 'mortgage' : le rang 1 civiliste doit précéder le rang 3 common law, sans garde NC-SA
    const mort = await terminologieLookup(harness.d1, {
      query: "mortgage",
      source_lang: "en",
    });
    expect(mort.structured.fiches[0]!.rang_source).toBe(1);
    expect(mort.structured.fiches[0]!.terme_en).toBe("hypothec");
    expect(
      mort.structured.fiches[0]!.termes_deconseilles.some(
        (d) => d.terme.toLowerCase() === "mortgage",
      ),
    ).toBe(true);
    expect(mort.structured.fiches.some((f) => f.rang_source === 4)).toBe(false);
    expect(mort.structured.gardes.some((g) => g.code === "LICENCE_DONNEES_OUVERTES_NC_SA")).toBe(
      false,
    );

    // Rang 4 OQLF -> déclenche LICENCE_DONNEES_OUVERTES_NC_SA et expose URL_fiche
    const oqlf = await terminologieLookup(harness.d1, {
      query: "action collective",
      domain_filter: "procédure",
    });
    const hasRang4 = oqlf.structured.fiches.some((f) => f.rang_source === 4);
    expect(hasRang4).toBe(true);
    expect(oqlf.structured.gardes.some((g) => g.code === "LICENCE_DONNEES_OUVERTES_NC_SA")).toBe(
      true,
    );
    expect(oqlf.text).toContain("LICENCE_DONNEES_OUVERTES_NC_SA");
  });

  it("terminologie_attestations compte exactement les occurrences, gère l'apostrophe typographique et respecte les frontières de mot", async () => {
    const hypCcq = await terminologieAttestations(harness.d1, {
      term: "hypothec",
      lang: "en",
      law_filter: "ccq",
    });
    const parsed = TerminologieAttestationsOutputSchema.parse(hypCcq.structured);
    expect(parsed.total_matching_articles).toBe(1);
    expect(parsed.attestations[0]!.article_number).toBe("2660");
    expect(parsed.attestations[0]!.snippet_fr).toContain("hypothèque");

    const mortCcq = await terminologieAttestations(harness.d1, {
      term: "mortgage",
      lang: "en",
      law_filter: "ccq",
    });
    expect(mortCcq.structured.total_matching_articles).toBe(0);

    const mortFed = await terminologieAttestations(harness.d1, {
      term: "mortgage",
      lang: "en",
      law_filter: "ca-b-3",
    });
    expect(mortFed.structured.total_matching_articles).toBe(1);

    // Apostrophe droite en entrée vs apostrophe courbe dans LégisQuébec
    const dii = await terminologieAttestations(harness.d1, {
      term: "demande introductive d'instance",
      lang: "fr",
    });
    expect(dii.structured.total_matching_articles).toBe(1);
    expect(dii.structured.attestations[0]!.law_id).toBe("cpc");

    // Frontière de mot stricte : « dol » matche art. 1401, PAS « dollars » à l'art. 1619
    const dol = await terminologieAttestations(harness.d1, {
      term: "dol",
      lang: "fr",
      law_filter: "ccq",
    });
    expect(dol.structured.total_matching_articles).toBe(1);
    expect(dol.structured.attestations[0]!.article_number).toBe("1401");
  });

  it("terminologie_scan_text détecte les contaminations FR/EN, épargne 'avis d\\'assignation' et gère les doublets bijuridiques fédéraux", async () => {
    const frDraft =
      "Attendu que la demanderesse a fait signifier une demande introductive d'instance avec avis d'assignation. " +
      "Subsidiairement, l'assignation délivrée en référé invoque l'article 1240 pour une contrepartie de 1 $.";
    const frScan = await terminologieScanText(harness.d1, {
      text: frDraft,
      lang: "fr",
    });
    const parsedFr = TerminologieScanTextOutputSchema.parse(frScan.structured);
    expect(parsedFr.flagged_count).toBeGreaterThanOrEqual(2);
    // Le premier « avis d'assignation » (index ~86) ne doit PAS être signalé
    for (const occ of parsedFr.occurrences) {
      if (occ.matched_text.toLowerCase() === "assignation") {
        expect(occ.offset_start).toBeGreaterThan(105);
      }
    }
    expect(parsedFr.occurrences.some((o) => o.matched_text.toLowerCase() === "article 1240")).toBe(
      true,
    );

    // Anglais civiliste québécois : 'mortgage' et 'joint and several' sont signalés
    const enQc = await terminologieScanText(harness.d1, {
      text: "The debtors assume a joint and several obligation secured by a first-ranking mortgage.",
      lang: "en",
      context_system: "droit_civil_qc",
    });
    expect(enQc.structured.occurrences.map((o) => o.matched_text.toLowerCase())).toEqual(
      expect.arrayContaining(["joint and several", "mortgage"]),
    );

    // Contexte bijuridique fédéral : doublet complet toléré, terme isolé signalé en 'omission_bijuridique'
    const enFedOk = await terminologieScanText(harness.d1, {
      text: "Every person holding a mortgage on real property or hypothec on immovables is a secured creditor.",
      lang: "en",
      context_system: "bijuridique_federal",
    });
    expect(
      enFedOk.structured.occurrences.some((o) => o.matched_text.toLowerCase() === "mortgage"),
    ).toBe(false);

    const enFedLone = await terminologieScanText(harness.d1, {
      text: "Every person holding a mortgage on real property is a secured creditor across Canada.",
      lang: "en",
      context_system: "bijuridique_federal",
    });
    const loneMort = enFedLone.structured.occurrences.find(
      (o) => o.matched_text.toLowerCase() === "mortgage",
    );
    expect(loneMort?.risk_category).toBe("omission_bijuridique");
  });

  it("gère les formes plurielles dans terminologie_lookup et terminologie_scan_text sans faux positifs sur 'avis d\\'assignation' ou 'bref délai'", async () => {
    const mortPl = await terminologieLookup(harness.d1, {
      query: "mortgages",
      source_lang: "en",
    });
    expect(mortPl.structured.fiches[0]?.rang_source).toBe(1);
    expect(mortPl.structured.fiches[0]?.terme_en).toBe("hypothec");

    const easePl = await terminologieLookup(harness.d1, {
      query: "easements",
      source_lang: "en",
    });
    expect(easePl.structured.fiches[0]?.rang_source).toBe(1);
    expect(easePl.structured.fiches[0]?.terme_en).toBe("servitude");

    const fidPl = await terminologieLookup(harness.d1, {
      query: "fiducies",
      source_lang: "fr",
    });
    expect(fidPl.structured.fiches[0]?.rang_source).toBe(1);
    expect(fidPl.structured.fiches[0]?.terme_en).toBe("trust");

    const enPlScan = await terminologieScanText(harness.d1, {
      text: "The borrowers granted two mortgages and three easements, and are jointly and severally liable under the statutes of limitations.",
      lang: "en",
    });
    expect(enPlScan.structured.occurrences.map((o) => o.matched_text.toLowerCase())).toEqual([
      "mortgages",
      "easements",
      "jointly and severally",
      "statutes of limitations",
    ]);

    const frPlScan = await terminologieScanText(harness.d1, {
      text: "Signifié avec avis\n   d'assignation dans un bref délai. Toutefois, les deux assignations en référé et les brefs de saisie invoquent la Cour de cassation.",
      lang: "fr",
    });
    expect(frPlScan.structured.occurrences.map((o) => o.matched_text.toLowerCase())).toEqual([
      "assignations",
      "en référé",
      "brefs de saisie",
      "cour de cassation",
    ]);
  });

  it("terminologie_lookup pousse domain_filter dans FTS5 afin de ne jamais évincer une fiche OQLF de rang 4 derrière 80 résultats hors domaine", async () => {
    const schemaSql = readFileSync(
      resolve(process.cwd(), "pipeline/terminologie/schema.sql"),
      "utf-8",
    );
    const indexesSql = readFileSync(
      resolve(process.cwd(), "pipeline/terminologie/indexes.sql"),
      "utf-8",
    );

    const seedRows: string[] = [
      `INSERT INTO meta_sources VALUES ('oqlf_droit', 'OQLF', 4, 'CC-BY-NC-SA-4.0', '2026-01-19', 1);`,
    ];
    for (let i = 1; i <= 95; i += 1) {
      seedRows.push(
        `INSERT INTO fiches_terminologiques VALUES (
          ${i}, NULL, 3, 'TERMIUM Plus®', 'OGL-Canada',
          'bénéficiaire de régime ${i}', 'plan beneficiary ${i}',
          'beneficiaire de regime ${i}', 'plan beneficiary ${i}',
          '[]', '[]', '[]', 'bénéficiaire de régime ${i} | plan beneficiary ${i}',
          'bijuridique_federal', 'assurance et régimes de retraite',
          'Fiche administrative hors domaine juridique.', NULL, NULL, '2026-11-15'
        );`,
      );
    }
    seedRows.push(
      `INSERT INTO fiches_terminologiques VALUES (
        96, NULL, 4, 'Office québécois de la langue française (OQLF)', 'CC-BY-NC-SA-4.0',
        'bénéficiaire', 'beneficiary',
        'beneficiaire', 'beneficiary',
        '[]', '[]', '[]', 'bénéficiaire | beneficiary',
        'droit_civil_qc', 'droit > droit du travail',
        'Personne en faveur de qui une prestation est stipulée.',
        NULL, 'https://vitrinelinguistique.oqlf.gouv.qc.ca/fiche-gdt/fiche/83597/beneficiaire', '2026-01-19'
      );`,
    );

    const domHarness = createSqliteD1Harness({
      seedSql: [
        schemaSql,
        ...seedRows,
        indexesSql,
        `INSERT INTO fiches_fts(rowid, terme_fr, terme_en, termes_recherche, domaine)
          SELECT id, terme_fr, terme_en, termes_recherche, domaine FROM fiches_terminologiques;`,
      ],
      enforceQueryOnly: true,
    });
    try {
      // Requête préfixielle non exacte ("beneficiair") avec domain_filter : sans poussée FTS5 sur {domaine},
      // LIMIT 80 sur rang_source ASC évincerait la fiche de rang 4 derrière les 95 fiches de rang 3.
      const res = await terminologieLookup(domHarness.d1, {
        query: "beneficiair",
        domain_filter: "droit du travail",
      });
      expect(res.structured.count).toBe(1);
      expect(res.structured.fiches[0]!.rang_source).toBe(4);
      expect(res.structured.fiches[0]!.domaine).toBe("droit > droit du travail");
      expect(res.structured.gardes.some((g) => g.code === "LICENCE_DONNEES_OUVERTES_NC_SA")).toBe(
        true,
      );
    } finally {
      domHarness.close();
    }
  });

  it("terminologie_attestations pagine par curseur FTS5 (> 4 000 et === 4 000 candidats) sans perte ni doublon sur les totaux par loi", async () => {
    const schemaSql = readFileSync(
      resolve(process.cwd(), "pipeline/terminologie/schema.sql"),
      "utf-8",
    );
    const indexesSql = readFileSync(
      resolve(process.cwd(), "pipeline/terminologie/indexes.sql"),
      "utf-8",
    );

    const values: string[] = [];
    // Répartition : 1 500 ccq + 1 500 cpc + 550 ca-i-21 + 500 qc-s-31.1 = 4 050 vrais positifs
    // + 5 faux positifs FTS ("l. obligation") placés exactement à la frontière de page 3998..4002 = 4 055 candidats FTS
    let id = 0;
    let exact4kCount = 0;
    const lawPlan: Array<[string, number]> = [
      ["qc-s-31.1", 500],
      ["ca-i-21", 550],
      ["cpc", 1500],
      ["ccq", 1500],
    ];
    for (const [lawId, count] of lawPlan) {
      for (let n = 1; n <= count; n += 1) {
        id += 1;
        if (id === 3998) {
          for (let fp = 1; fp <= 5; fp += 1) {
            values.push(
              `(${id}, 'cpc', 'FP-${fp}', ${9000 + fp}, 'Renvoi à l. obligation accessoire.', 'Cross-reference.')`,
            );
            id += 1;
          }
        }
        exact4kCount += 1;
        const clauseTag = exact4kCount <= 4000 ? " et une clause pénale valide" : "";
        values.push(
          `(${id}, '${lawId}', '${n}', ${n}, 'Exécution de l’obligation principale${clauseTag}.', 'Performance of the principal obligation.')`,
        );
      }
    }

    const pageHarness = createSqliteD1Harness({
      seedSql: [
        schemaSql,
        `INSERT INTO meta_sources VALUES ('concordancier_legislatif', 'Concordancier législatif', 2, 'OGL-Canada', '2026-11-15', ${id});`,
        `INSERT INTO lois_bilingues VALUES
          ('ccq', 'qc', 'Code civil du Québec', 'Civil Code of Québec', 'RLRQ, c. CCQ-1991', NULL, '2026-04-07', '2026-04-07'),
          ('cpc', 'qc', 'Code de procédure civile', 'Code of Civil Procedure', 'RLRQ, c. C-25.01', NULL, '2026-04-07', '2026-04-07'),
          ('ca-i-21', 'ca', 'Loi d’interprétation', 'Interpretation Act', 'L.R.C. (1985), ch. I-21', 'R.S.C., 1985, c. I-21', '2026-07-21', '2026-07-21'),
          ('qc-s-31.1', 'qc', 'Loi sur les sociétés par actions', 'Business Corporations Act', 'RLRQ, c. S-31.1', NULL, '2026-04-07', '2026-04-07');`,
        `INSERT INTO articles_bilingues VALUES ${values.join(",\n")};`,
        indexesSql,
        `INSERT INTO articles_fr_fts(rowid, text_fr) SELECT id, text_fr FROM articles_bilingues;
         INSERT INTO articles_en_fts(rowid, text_en) SELECT id, text_en FROM articles_bilingues;`,
      ],
      enforceQueryOnly: true,
    });

    try {
      // 1) Franchissement multi-pages : 4 055 candidats FTS -> 4 050 articles vérifiés (5 faux positifs rejetés à la jonction 3998..4002)
      const multiPage = await terminologieAttestations(pageHarness.d1, {
        term: "l'obligation",
        lang: "fr",
        limit: 5,
      });
      const parsed = TerminologieAttestationsOutputSchema.parse(multiPage.structured);
      expect(parsed.total_matching_articles).toBe(4050);
      expect(parsed.by_law.map((l) => [l.law_id, l.article_count])).toEqual([
        ["ccq", 1500],
        ["cpc", 1500],
        ["ca-i-21", 550],
        ["qc-s-31.1", 500],
      ]);
      // Même si ccq a été inséré en fin de table (> 2 550), la priorité statutaire place ccq art. 1 en tête
      expect(parsed.attestations.length).toBe(5);
      expect(parsed.attestations[0]!.law_id).toBe("ccq");
      expect(parsed.attestations[0]!.article_number).toBe("1");

      // 2) Cas frontière exact d'un multiple plein de page (exactement 4 000 candidats FTS -> page 2 vide)
      const boundaryPage = await terminologieAttestations(pageHarness.d1, {
        term: "clause pénale",
        lang: "fr",
      });
      expect(boundaryPage.structured.total_matching_articles).toBe(4000);
    } finally {
      pageHarness.close();
    }
  });

  it("unifie les ligatures 'œ'/'oe', isole law_filter sans amalgame ('ccq'/'b-1'/'C-25.01'/'100%') et épargne les tournures statutaires québécoises", async () => {
    const schemaSql = readFileSync(
      resolve(process.cwd(), "pipeline/terminologie/schema.sql"),
      "utf-8",
    );
    const indexesSql = readFileSync(
      resolve(process.cwd(), "pipeline/terminologie/indexes.sql"),
      "utf-8",
    );

    const ligHarness = createSqliteD1Harness({
      seedSql: [
        schemaSql,
        `INSERT INTO meta_sources VALUES ('concordancier_legislatif', 'Concordancier', 2, 'OGL-Canada', '2026-11-15', 6);`,
        // Fiche dont terme_fr_norm imite un chargement antérieur ('mise en uvre') + terme_fr avec ligature 'œuvre'
        `INSERT INTO fiches_terminologiques VALUES (
          1, NULL, 3, 'TERMIUM Plus®', 'OGL-Canada',
          'mise en œuvre', 'implementation', 'mise en uvre', 'implementation',
          '[]', '[]', '[]', 'mise en œuvre | implementation',
          'bijuridique_federal', 'Droit général', 'Exécution effective.', NULL, NULL, '2026-11-15'
        );`,
        `INSERT INTO lois_bilingues VALUES
          ('ccq', 'qc', 'Code civil du Québec', 'Civil Code of Québec', 'RLRQ, c. CCQ-1991', NULL, '2026-04-07', '2026-04-07'),
          ('ccq-r.6', 'qc', 'Règlement sur le registre des droits personnels et réels mobiliers', 'Regulation respecting the register of personal and movable real rights', 'RLRQ, c. CCQ, r. 6', NULL, '2026-04-07', '2026-04-07'),
          ('cpc', 'qc', 'Code de procédure civile', 'Code of Civil Procedure', 'RLRQ, c. C-25.01', NULL, '2026-04-07', '2026-04-07'),
          ('c-25.01-r.9', 'qc', 'Règlement de la Cour du Québec', 'Regulation of the Court of Québec', 'RLRQ, c. C-25.01, r. 9', NULL, '2026-04-07', '2026-04-07'),
          ('b-1', 'qc', 'Loi sur le Barreau', 'Act respecting the Barreau du Québec', 'RLRQ, c. B-1', NULL, '2026-04-07', '2026-04-07'),
          ('b-1.1', 'qc', 'Loi sur le bâtiment', 'Building Act', 'RLRQ, c. B-1.1', NULL, '2026-04-07', '2026-04-07'),
          ('ca-i-21', 'ca', 'Loi d’interprétation', 'Interpretation Act', 'L.R.C. (1985), ch. I-21', 'R.S.C., 1985, c. I-21', '2026-07-21', '2026-07-21');`,
        `INSERT INTO articles_bilingues VALUES
          (1, 'ccq', '1458', 1458, 'La mise en oeuvre de la responsabilité contractuelle.', 'Contractual liability implementation.'),
          (2, 'ccq-r.6', '1', 1, 'Inscription d’une hypothèque mobilière au registre.', 'Registration of a movable hypothec.'),
          (3, 'cpc', '145', 145, 'Le défendeur doit répondre à l’assignation dans les 15 jours.', 'The defendant must answer the summons within 15 days.'),
          (4, 'c-25.01-r.9', '5', 5, 'Toute demande présentée en chambre de pratique.', 'Any application presented in practice division.'),
          (5, 'b-1', '128', 128, 'Sont du ressort exclusif de l’avocat en exercice.', 'Exclusive prerogative of the practising advocate.'),
          (6, 'b-1.1', '40', 40, 'L’entrepreneur représenté par avocat devant la Régie.', 'Contractor represented by advocate.'),
          (7, 'ca-i-21', '8.1', 8.1, 'La mise en œuvre du bijuridisme fédéral.', 'Implementation of federal bijuralism.');`,
        indexesSql,
        `INSERT INTO fiches_fts(rowid, terme_fr, terme_en, termes_recherche, domaine)
          SELECT id, terme_fr, terme_en, termes_recherche, domaine FROM fiches_terminologiques;
         INSERT INTO articles_fr_fts(rowid, text_fr) SELECT id, text_fr FROM articles_bilingues;
         INSERT INTO articles_en_fts(rowid, text_en) SELECT id, text_en FROM articles_bilingues;`,
      ],
      enforceQueryOnly: true,
    });

    try {
      // 1) Ligature œ <-> oe dans terminologie_lookup et terminologie_attestations
      const lookLig = await terminologieLookup(ligHarness.d1, { query: "mise en œuvre" });
      const lookAscii = await terminologieLookup(ligHarness.d1, { query: "mise en oeuvre" });
      expect(lookLig.structured.count).toBe(1);
      expect(lookAscii.structured.count).toBe(1);
      expect(lookLig.structured.fiches[0]?.terme_en).toBe("implementation");
      expect(lookAscii.structured.fiches[0]?.terme_en).toBe("implementation");

      const attLig = await terminologieAttestations(ligHarness.d1, {
        term: "mise en œuvre",
        lang: "fr",
      });
      const attAscii = await terminologieAttestations(ligHarness.d1, {
        term: "mise en oeuvre",
        lang: "fr",
      });
      expect(attLig.structured.total_matching_articles).toBe(2);
      expect(attAscii.structured.total_matching_articles).toBe(2);

      // 2) Isolation stricte de law_filter et échappement des jokers SQL LIKE
      const ccq = await terminologieAttestations(ligHarness.d1, {
        term: "hypothèque",
        lang: "fr",
        law_filter: "ccq",
      });
      expect(ccq.structured.total_matching_articles).toBe(0);

      const b1 = await terminologieAttestations(ligHarness.d1, {
        term: "avocat",
        lang: "fr",
        law_filter: "b-1",
      });
      expect(b1.structured.by_law.map((l) => l.law_id)).toEqual(["b-1"]);

      const c25 = await terminologieAttestations(ligHarness.d1, {
        term: "demande",
        lang: "fr",
        law_filter: "C-25.01",
      });
      expect(c25.structured.total_matching_articles).toBe(0);

      const wild = await terminologieAttestations(ligHarness.d1, {
        term: "avocat",
        lang: "fr",
        law_filter: "100%",
      });
      expect(wild.structured.total_matching_articles).toBe(0);
    } finally {
      ligHarness.close();
    }

    // 3) terminologie_scan_text : zéro faux positif sur les tournures statutaires du C.p.c. / C.c.Q.
    const cleanStatutesFr = await terminologieScanText(harness.d1, {
      text: "Le défendeur doit répondre à l’assignation dans le délai d'assignation devant les tribunaux judiciaires du Québec ou un autre tribunal judiciaire compétent.",
      lang: "fr",
    });
    expect(cleanStatutesFr.structured.flagged_count).toBe(0);

    const dirtyFranceFr = await terminologieScanText(harness.d1, {
      text: "La demanderesse entend saisir le tribunal judiciaire de Paris par l'assignation délivrée hier.",
      lang: "fr",
    });
    expect(dirtyFranceFr.structured.occurrences.map((o) => o.matched_text.toLowerCase())).toEqual([
      "tribunal judiciaire",
      "assignation",
    ]);

    const cleanCmhcEn = await terminologieScanText(harness.d1, {
      text: "Investments guaranteed by the Canada Mortgage and Housing Corporation are presumed sound under article 1339 C.C.Q.",
      lang: "en",
    });
    expect(cleanCmhcEn.structured.flagged_count).toBe(0);
  });
});
