import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LoyerTalOutputSchema, loyerTal } from "../src/core/tal.js";
import { createSqliteD1Harness } from "./helpers/sqliteD1.js";

function createTestCmhcDb() {
  return createSqliteD1Harness({
    seedSql: [
      readFileSync(resolve(process.cwd(), "pipeline/economie/schema.sql"), "utf-8"),
      readFileSync(resolve(process.cwd(), "pipeline/economie/indexes.sql"), "utf-8"),
      `
        INSERT INTO meta_sources VALUES
          ('statcan_cmhc_rents', 'StatCan 34-10-0133-01', 'OGL-Canada', '2025-12-17', 10);
        INSERT INTO cmhc_centres VALUES
          (36, 'hawkesbury-partie-quebecoise-qc', 'Hawkesbury, Quebec part, Ontario/Quebec', 'Hawkesbury, partie québécoise, Ontario/Québec', 'hawkesbury partie quebecoise', 'QC', 1, 'Dollars', 1987, 2025),
          (37, 'ottawa-gatineau-partie-quebecoise-qc', 'Ottawa-Gatineau, Quebec part, Ontario/Quebec', 'Ottawa-Gatineau, partie québécoise, Ontario/Québec', 'ottawa gatineau partie quebecoise', 'QC', 1, 'Dollars', 1987, 2025),
          (46, 'montreal-qc', 'Montréal, Quebec', 'Montréal, Québec', 'montreal', 'QC', 1, 'Dollars', 1987, 2025),
          (48, 'quebec-qc', 'Québec, Quebec', 'Québec, Québec', 'quebec', 'QC', 1, 'Dollars', 1987, 2025),
          (86, 'hawkesbury-partie-ontarienne-on', 'Hawkesbury, Ontario part, Ontario/Quebec', 'Hawkesbury, partie ontarienne, Ontario/Québec', 'hawkesbury partie ontarienne', 'ON', 0, 'Dollars', 1987, 2025),
          (105, 'ottawa-gatineau-on-qc', 'Ottawa-Gatineau, Ontario/Quebec', 'Ottawa-Gatineau, Ontario/Québec', 'ottawa gatineau', 'ON/QC', 0, 'Dollars', 1987, 2025),
          (106, 'ottawa-gatineau-partie-ontarienne-on', 'Ottawa-Gatineau, Ontario part, Ontario/Quebec', 'Ottawa-Gatineau, partie ontarienne, Ontario/Québec', 'ottawa gatineau partie ontarienne', 'ON', 0, 'Dollars', 1987, 2025),
          (203, 'saint-lin-laurentides-qc', 'Saint-Lin--Laurentides, Quebec', 'Saint-Lin--Laurentides, Québec', 'saint lin laurentides', 'QC', 1, 'Dollars', 1987, 2016),
          (219, 'sainte-sophie-qc', 'Sainte- Sophie, Quebec', 'Sainte- Sophie, Québec', 'sainte sophie', 'QC', 1, 'Dollars', 1987, 2025);
        INSERT INTO cmhc_rents VALUES
          (36, 3, 3, 2025, 1100),
          (46, 3, 2, 2025, 1131),
          (46, 3, 3, 2025, 1346),
          (46, 3, 4, 2025, 1625),
          (48, 3, 3, 2025, 1276),
          (37, 3, 3, 2025, 1452),
          (86, 3, 3, 2025, 1150),
          (105, 3, 3, 2025, 1740),
          (106, 3, 3, 2025, 1790),
          (203, 3, 3, 2016, 780),
          (219, 3, 3, 2025, 1180);
      `,
    ],
    enforceQueryOnly: true,
  });
}

describe("loyer_tal (RLRQ, c. T-15.01, r. 2 & SCHL 34-10-0133-01)", () => {
  it("reproduit à la cent près et au dollar près les 8 scénarios vérifiés du calculateur TAL 2026", async () => {
    // Scénario 1 : Logement standard 1 000 $, 2026-07-01 -> +31,00 $ -> 1 031 $
    const s1 = await loyerTal(null, {
      mode: "calcul_2026",
      notice_date: "2026-03-15",
      lease_renewal_date: "2026-07-01",
      current_rent_cents: 100_000,
    });
    expect(s1.ok).toBe(true);
    if (!s1.ok) return;
    const p1 = LoyerTalOutputSchema.parse(s1.structured);
    expect(p1.calculation?.adj_base_cents).toBe(3_100);
    expect(p1.calculation?.new_rent_dollars).toBe(1_031);

    // Scénario 2 : RPA 2 000 $ (1 500 $ + 500 $ services personnels) -> 46,50 + 33,50 = 80,00 $ -> 2 080 $
    const s2 = await loyerTal(null, {
      mode: "calcul_2026",
      lease_renewal_date: "2026-07-01",
      current_rent_cents: 200_000,
      is_rpa: true,
      rpa_personal_services_cents: 50_000,
    });
    expect(s2.ok).toBe(true);
    if (!s2.ok) return;
    expect(s2.structured.calculation?.adj_base_normal_cents).toBe(4_650);
    expect(s2.structured.calculation?.adj_base_rpa_cents).toBe(3_350);
    expect(s2.structured.calculation?.adj_base_cents).toBe(8_000);
    expect(s2.structured.calculation?.new_rent_dollars).toBe(2_080);

    // Scénario 3 : Taxes mun. > 3,1 % (+7 %), scol. (+2 %) & assur. (+2,5 %) <= 3,1 % -> 1 243,70 $ -> 1 244 $
    const s3 = await loyerTal(null, {
      mode: "calcul_2026",
      lease_renewal_date: "2026-07-01",
      current_rent_cents: 120_000,
      building_residential_rents_cents: 480_000,
      municipal_taxes_prev_cents: 800_000,
      municipal_taxes_curr_cents: 856_000,
      school_taxes_prev_cents: 120_000,
      school_taxes_curr_cents: 122_400,
      insurance_prev_cents: 320_000,
      insurance_curr_cents: 328_000,
    });
    expect(s3.ok).toBe(true);
    if (!s3.ok) return;
    expect(s3.structured.calculation?.adj_base_cents).toBe(3_720);
    expect(s3.structured.calculation?.adj_municipal_taxes_cents).toBe(650);
    expect(s3.structured.calculation?.adj_school_taxes_cents).toBe(0);
    expect(s3.structured.calculation?.adj_insurance_cents).toBe(0);
    expect(s3.structured.calculation?.total_adjustment_cents).toBe(4_370);
    expect(s3.structured.calculation?.new_rent_dollars).toBe(1_244);

    // Scénario 4 : Baisse réelle des taxes municipales (-3,0 %) -> report intégral -5,00 $ -> 1 232 $
    const s4 = await loyerTal(null, {
      mode: "calcul_2026",
      lease_renewal_date: "2026-07-01",
      current_rent_cents: 120_000,
      building_residential_rents_cents: 480_000,
      municipal_taxes_prev_cents: 800_000,
      municipal_taxes_curr_cents: 776_000,
      insurance_prev_cents: 320_000,
      insurance_curr_cents: 328_000,
    });
    expect(s4.ok).toBe(true);
    if (!s4.ok) return;
    expect(s4.structured.calculation?.adj_municipal_taxes_cents).toBe(-500);
    expect(s4.structured.calculation?.total_adjustment_cents).toBe(3_220);
    expect(s4.structured.calculation?.new_rent_dollars).toBe(1_232);

    // Scénario 5 : Travaux majeurs 5 % avec subvention & prêt à intérêt réduit -> 41,73 + 20,83 = 62,56 $ -> 1 409 $
    const s5 = await loyerTal(null, {
      mode: "calcul_2026",
      lease_renewal_date: "2026-07-01",
      current_rent_cents: 134_600,
      building_residential_rents_cents: 538_400,
      capital_works: [
        {
          label: "Toiture",
          gross_amount_cents: 2_800_000,
          grant_cents: 400_000,
          reduced_interest_loan_cents: 2_000_000,
          annual_loan_repayment_cents: 80_000,
        },
      ],
    });
    expect(s5.ok).toBe(true);
    if (!s5.ok) return;
    expect(s5.structured.calculation?.adj_base_cents).toBe(4_173);
    expect(s5.structured.calculation?.adj_capital_works_cents).toBe(2_083);
    expect(s5.structured.calculation?.total_adjustment_cents).toBe(6_256);
    expect(s5.structured.calculation?.new_rent_dollars).toBe(1_409);

    // Scénario 6 : Identique au scénario 5 sans prêt -> adj_immo = 25,00 $ -> 1 413 $
    const s6 = await loyerTal(null, {
      mode: "calcul_2026",
      lease_renewal_date: "2026-07-01",
      current_rent_cents: 134_600,
      building_residential_rents_cents: 538_400,
      capital_works: [
        {
          label: "Toiture",
          gross_amount_cents: 2_800_000,
          grant_cents: 400_000,
        },
      ],
    });
    expect(s6.ok).toBe(true);
    if (!s6.ok) return;
    expect(s6.structured.calculation?.adj_capital_works_cents).toBe(2_500);
    expect(s6.structured.calculation?.new_rent_dollars).toBe(1_413);

    // Scénario 7 : Bail renouvelé le 2026-03-01 (terme 2026-02-28 -> réf. 2024 -> 4,5 %) -> 992,75 $ -> 993 $
    const s7 = await loyerTal(null, {
      mode: "calcul_2026",
      notice_date: "2026-01-15",
      lease_renewal_date: "2026-03-01",
      current_rent_cents: 95_000,
    });
    expect(s7.ok).toBe(true);
    if (!s7.ok) return;
    expect(s7.structured.calculation?.reference_year).toBe(2024);
    expect(s7.structured.calculation?.base_rent_bps).toBe(450);
    expect(s7.structured.calculation?.adj_base_cents).toBe(4_275);
    expect(s7.structured.calculation?.new_rent_dollars).toBe(993);

    // Scénario 8 : Immeuble mixte (rés. 3 000 $ + comm. 1 000 $), nouveau service résidentiel 1 200 $/an -> 1 074,75 $ -> 1 075 $
    const s8 = await loyerTal(null, {
      mode: "calcul_2026",
      lease_renewal_date: "2026-07-01",
      current_rent_cents: 100_000,
      building_residential_rents_cents: 300_000,
      building_non_residential_rents_cents: 100_000,
      municipal_taxes_prev_cents: 1_000_000,
      municipal_taxes_curr_cents: 1_081_000,
      new_expenses: [
        {
          label: "Service résidentiel",
          annual_amount_cents: 120_000,
          beneficiary_scope: "residential_only",
        },
      ],
    });
    expect(s8.ok).toBe(true);
    if (!s8.ok) return;
    expect(s8.structured.calculation?.adj_base_cents).toBe(3_100);
    expect(s8.structured.calculation?.adj_municipal_taxes_cents).toBe(1_042);
    expect(s8.structured.calculation?.adj_new_expenses_cents).toBe(3_333);
    expect(s8.structured.calculation?.total_adjustment_cents).toBe(7_475);
    expect(s8.structured.calculation?.new_rent_dollars).toBe(1_075);

    // Frontière art. 15.1 : 1 074,49 $ -> 1 074 $
    const boundary = await loyerTal(null, {
      mode: "calcul_2026",
      lease_renewal_date: "2026-07-01",
      current_rent_cents: 100_000,
      building_residential_rents_cents: 300_000,
      capital_works: [{ gross_amount_cents: 3_131_280, beneficiary_scope: "residential_only" }],
    });
    expect(boundary.ok).toBe(true);
    if (!boundary.ok) return;
    expect(boundary.structured.calculation?.unrounded_new_rent_cents).toBe(107_449);
    expect(boundary.structured.calculation?.new_rent_dollars).toBe(1_074);
  });

  it("gère les cas transitoires/d'exemption (Cas T1, Cas T2), les barèmes 2015–2027 et les cas particuliers (autre_revenu, déneigement, pas d'extrapolation)", async () => {
    // Cas T1 : Avis < 2026-01-01 -> regime pre_2026_transitoire + garde obligatoire
    const t1 = await loyerTal(null, {
      mode: "calcul_2026",
      notice_date: "2025-12-20",
      lease_renewal_date: "2026-07-01",
      current_rent_cents: 100_000,
    });
    expect(t1.ok).toBe(true);
    if (!t1.ok) return;
    expect(t1.structured.regime).toBe("pre_2026_transitoire");
    expect(t1.structured.calculation).toBeNull();
    expect(t1.structured.gardes.map((g) => g.code)).toContain("TAL_REGIME_TRANSITOIRE_PRE_2026");

    // Cas T2 : Exemption 5 ans art. 1955 C.c.Q. (Section F)
    const t2 = await loyerTal(null, {
      mode: "calcul_2026",
      notice_date: "2026-03-01",
      lease_renewal_date: "2026-07-01",
      section_f_exemption_5_ans: true,
      current_rent_cents: 180_000,
    });
    expect(t2.ok).toBe(true);
    if (!t2.ok) return;
    expect(t2.structured.regime).toBe("exemption_art_1955_ccq");
    expect(t2.structured.calculation).toBeNull();
    expect(t2.structured.gardes.map((g) => g.code)).toContain(
      "TAL_EXEMPTION_CINQ_ANS_ART_1955_CCQ",
    );

    // Barème 2024 : Mazout -10,0 % (-1000 bps) ; Barème 2023 : RPA null
    const b2024 = await loyerTal(null, { mode: "bareme", year: 2024 });
    expect(b2024.ok).toBe(true);
    if (!b2024.ok) return;
    expect(b2024.structured.bareme_pre_2026[0]?.oil_other_bps).toBe(-1_000);
    expect(b2024.structured.bareme_pre_2026[0]?.rpa_personal_services_bps).toBe(660);

    const b2023 = await loyerTal(null, { mode: "bareme", year: 2023 });
    expect(b2023.ok).toBe(true);
    if (!b2023.ok) return;
    expect(b2023.structured.bareme_pre_2026[0]?.rpa_personal_services_bps).toBeNull();

    // Particularité autre_revenu_annuel > 0 sans local commercial : poid_loyer sur taxes vs poid_loyer_plf sur assurance
    const otherRev = await loyerTal(null, {
      mode: "calcul_2026",
      lease_renewal_date: "2026-07-01",
      current_rent_cents: 100_000,
      building_residential_rents_cents: 200_000,
      other_annual_revenue_cents: 2_400_000,
      municipal_taxes_prev_cents: 1_000_000,
      municipal_taxes_curr_cents: 1_091_000, // +9.1 % -> +6.0 % net * 1/2 / 12 = 2500 cents
      insurance_prev_cents: 400_000,
      insurance_curr_cents: 436_400, // +9.1 % -> +6.0 % net * (1.2M / 4.8M = 1/4) / 12 = 500 cents
    });
    expect(otherRev.ok).toBe(true);
    if (!otherRev.ok) return;
    expect(otherRev.structured.calculation?.adj_municipal_taxes_cents).toBe(2_500);
    expect(otherRev.structured.calculation?.adj_insurance_cents).toBe(500);
    expect(otherRev.structured.gardes[0]?.message).toContain("poid_loyer");

    // Refus d'extrapolation au-delà du 2027-04-01
    const futureLease = await loyerTal(null, {
      mode: "calcul_2026",
      lease_renewal_date: "2027-07-01",
      current_rent_cents: 100_000,
    });
    expect(futureLease.ok).toBe(false);
  });

  it("interroge les loyers moyens SCHL en lecture seule et signale les cellules supprimées", async () => {
    const harness = createTestCmhcDb();
    try {
      const mtl = await loyerTal(harness.d1, {
        mode: "schl",
        cmhc_geo: "Montréal",
        year: 2025,
      });
      expect(mtl.ok).toBe(true);
      if (!mtl.ok) return;
      const parsed = LoyerTalOutputSchema.parse(mtl.structured);
      expect(parsed.cmhc_results).toHaveLength(1);
      expect(parsed.cmhc_results[0]?.geo_member_id).toBe(46);
      const cells = parsed.cmhc_results[0]!.cells;
      // bachelor absent/supprimé pour 46.3.1 en 2025 dans le jeu de test
      expect(cells.find((c) => c.unit_type === "bachelor")).toEqual({
        unit_type: "bachelor",
        unit_label_fr: "Studio",
        rent_dollars: null,
        suppressed: true,
      });
      expect(cells.find((c) => c.unit_type === "two_bedroom")).toEqual({
        unit_type: "two_bedroom",
        unit_label_fr: "2 chambres",
        rent_dollars: 1346,
        suppressed: false,
      });
      expect(parsed.gardes.map((g) => g.code)).toContain("SCHL_LOYER_MOYEN_INDICATIF");

      // Gatineau résout Ottawa-Gatineau partie québécoise (is_quebec = true)
      const gat = await loyerTal(harness.d1, {
        mode: "schl",
        cmhc_geo: "Gatineau",
        unit_type: "two_bedroom",
      });
      expect(gat.ok).toBe(true);
      if (!gat.ok) return;
      expect(gat.structured.cmhc_results[0]?.geo_member_id).toBe(37);
      expect(gat.structured.cmhc_results[0]?.is_quebec).toBe(true);

      // Québec sans ambiguïté sur "Québec"
      const qc = await loyerTal(harness.d1, {
        mode: "schl",
        cmhc_geo: "Québec",
        unit_type: "two_bedroom",
      });
      expect(qc.ok).toBe(true);
      if (!qc.ok) return;
      expect(qc.structured.cmhc_results[0]?.geo_member_id).toBe(48);

      // Pas d'extrapolation au-delà de 2025
      const futureCmhc = await loyerTal(harness.d1, {
        mode: "schl",
        cmhc_geo: "Montréal",
        year: 2027,
      });
      expect(futureCmhc.ok).toBe(false);

      // Régression : variantes « Québec, Québec », « Quebec, QC », « Quebec part », « Ontario/Québec » et tirets/espaces StatCan
      const expectedIds: Array<[string, number]> = [
        ["Québec, Québec", 48],
        ["Québec, Quebec", 48],
        ["Quebec, QC", 48],
        ["Ottawa-Gatineau, Quebec part", 37],
        ["Ottawa-Gatineau, Quebec part, Ontario/Quebec", 37],
        ["Ottawa-Gatineau, partie québécoise, Ontario/Québec", 37],
        ["Hawkesbury, partie québécoise, Ontario/Québec", 36],
        ["Ottawa-Gatineau", 105],
        ["Ottawa-Gatineau, Ontario part", 106],
        ["Sainte-Sophie", 219],
        ["Sainte- Sophie, Québec", 219],
        ["Saint-Lin-Laurentides", 203],
        ["Saint-Lin--Laurentides, Québec", 203],
      ];
      for (const [label, expectedId] of expectedIds) {
        const res = await loyerTal(harness.d1, {
          mode: "schl",
          cmhc_geo: label,
          unit_type: "two_bedroom",
        });
        expect(res.ok, `Expected SCHL lookup to succeed for ${label}`).toBe(true);
        if (res.ok) {
          expect(res.structured.cmhc_results).toHaveLength(1);
          expect(res.structured.cmhc_results[0]?.geo_member_id).toBe(expectedId);
        }
      }

      // Les jokers SQL seuls ne doivent jamais correspondre à tous les centres
      const wildcardOnly = await loyerTal(harness.d1, {
        mode: "schl",
        cmhc_geo: "%%%",
      });
      expect(wildcardOnly.ok).toBe(false);
    } finally {
      harness.close();
    }
  });

  it("émet à la fois TAL_REGIME_TRANSITOIRE_PRE_2026 et TAL_EXEMPTION_CINQ_ANS_ART_1955_CCQ si Cas T1 et Cas T2 sont combinés", async () => {
    const combined = await loyerTal(null, {
      mode: "calcul_2026",
      notice_date: "2025-12-20",
      lease_renewal_date: "2026-07-01",
      section_f_exemption_5_ans: true,
      current_rent_cents: 100_000,
    });
    expect(combined.ok).toBe(true);
    if (!combined.ok) return;
    expect(combined.structured.regime).toBe("pre_2026_transitoire");
    const codes = combined.structured.gardes.map((g) => g.code);
    expect(codes).toContain("TAL_REGIME_TRANSITOIRE_PRE_2026");
    expect(codes).toContain("TAL_EXEMPTION_CINQ_ANS_ART_1955_CCQ");
    expect(codes).toContain("TAL_POUVOIR_DISCRETIONNAIRE_FIXATION");
    expect(combined.text).toContain("1455-2025");
    expect(combined.text).toContain("1955 C.c.Q.");
  });
});
