import { describe, expect, it } from "vitest";
import {
  ComputeInterest1619OutputSchema,
  computeInterest1619,
  EXACT_EXACT_COMMON_DENOMINATOR,
  roundHalfAwayFromZero,
} from "../src/core/interest1619.js";
import bocPrimeRatesJson from "../src/data/boc_prime_rates.json" with { type: "json" };
import lafRatesJson from "../src/data/laf_art28_rates.json" with { type: "json" };

describe("interets_1619", () => {
  it("contient une table art. 28 L.A.F. contiguë complète de 2001-Q1 à 2026-Q4", () => {
    const keys = Object.keys(lafRatesJson.quarters);
    expect(keys.length).toBe(26 * 4);
    expect(keys[0]).toBe(lafRatesJson.metadata.first_quarter);
    expect(keys[keys.length - 1]).toBe(lafRatesJson.metadata.last_quarter);
    expect(lafRatesJson.metadata.last_quarter).toBe("2026-Q4");
    for (let y = 2001; y <= 2026; y++) {
      for (let q = 1; q <= 4; q++) {
        const bps = (lafRatesJson.quarters as Record<string, number>)[`${y}-Q${q}`];
        expect(Number.isInteger(bps)).toBe(true);
        expect(bps).toBeGreaterThanOrEqual(500);
      }
    }
  });

  it("calcule une année civile complète (2025) au cent exact sans perte de jours aux bornes de trimestres", () => {
    // 2024-12-31 exclu -> 2025-12-31 inclus : 365 jours en 2025 (90 + 91 + 92 + 92)
    const legalOnly = ComputeInterest1619OutputSchema.parse(
      computeInterest1619({
        mode: "legal_only",
        end_date: "2025-12-31",
        tranches: [{ principal_cents: 10_000_000, start_date: "2024-12-31" }],
      }),
    );
    expect(legalOnly.tranches[0]!.accrued_days).toBe(365);
    expect(legalOnly.total_legal_interest_cents).toBe(500_000); // 5 000,00 $ exact
    expect(legalOnly.total_additional_indemnity_cents).toBe(0);
    expect(legalOnly.total_contractual_interest_cents).toBe(0);

    // En mode legal_plus_1619 sur 2025 : T1=900 bps (400 add), T2-T4=800 bps (300 add)
    // Add = 10_000_000 * (90*400 + 275*300) / (365 * 10000) = 1000 * 118500 / 365 = 324_657.5342... -> 324_658 cents
    const with1619 = ComputeInterest1619OutputSchema.parse(
      computeInterest1619({
        mode: "legal_plus_1619",
        end_date: "2025-12-31",
        tranches: [{ principal_cents: 10_000_000, start_date: "2024-12-31" }],
      }),
    );
    expect(with1619.tranches[0]!.periods.map((p) => p.days)).toEqual([90, 91, 92, 92]);
    expect(with1619.total_legal_interest_cents).toBe(500_000);
    expect(with1619.total_additional_indemnity_cents).toBe(324_658);
    expect(with1619.total_interest_cents).toBe(824_658);
    expect(with1619.grand_total_cents).toBe(10_824_658);
    expect(with1619.gardes.map((g) => g.code)).toContain("INTERET_SIMPLE_ART_1620_CCQ");
  });

  it("utilise 366 jours pour l'année bissextile 2024 et découpe correctement le passage 2024 -> 2025", () => {
    // 2023-12-31 exclu -> 2024-12-31 inclus : 366 jours en 2024 (tous à 1000 bps -> 5% légal + 5% add.)
    const fullLeap = computeInterest1619({
      mode: "legal_plus_1619",
      end_date: "2024-12-31",
      tranches: [{ principal_cents: 10_000_000, start_date: "2023-12-31" }],
    });
    expect(fullLeap.tranches[0]!.accrued_days).toBe(366);
    expect(fullLeap.total_legal_interest_cents).toBe(500_000);
    expect(fullLeap.total_additional_indemnity_cents).toBe(500_000);
    expect(fullLeap.total_interest_cents).toBe(1_000_000);

    // 2024-01-01 exclu -> 2025-01-01 inclus : 365 jours en 2024 (/366) + 1 jour en 2025 (/365)
    const crossNewYear = computeInterest1619({
      mode: "legal_plus_1619",
      end_date: "2025-01-01",
      tranches: [{ principal_cents: 10_000_000, start_date: "2024-01-01" }],
    });
    const periods = crossNewYear.tranches[0]!.periods;
    expect(periods.reduce((acc, p) => acc + p.days, 0)).toBe(366);
    expect(periods[0]!.days).toBe(90); // 2 janv..31 mars 2024 (bissextile)
    expect(periods[0]!.year_days).toBe(366);
    expect(periods[4]!.period_label).toBe("2025-Q1");
    expect(periods[4]!.days).toBe(1);
    expect(periods[4]!.year_days).toBe(365);
  });

  it("arrondit half-away-from-zero sans débordement BigInt sur de forts montants", () => {
    expect(roundHalfAwayFromZero(5n, 2n)).toBe(3n);
    expect(roundHalfAwayFromZero(4n, 2n)).toBe(2n);
    expect(roundHalfAwayFromZero(-5n, 2n)).toBe(-3n);

    // 100 000 000,00 $ (= 10_000_000_000 cents) sur 366 jours en 2024 à 5% légal exact -> 5 000 000,00 $
    const huge = computeInterest1619({
      mode: "legal_only",
      end_date: "2024-12-31",
      tranches: [{ principal_cents: 10_000_000_000, start_date: "2023-12-31" }],
    });
    expect(huge.total_legal_interest_cents).toBe(500_000_000);
    expect(huge.total_legal_interest_cad).toBe("5000000.00");
  });

  it("gère le mode contractuel séparément des intérêts légaux et les tranches multiples", () => {
    const out = ComputeInterest1619OutputSchema.parse(
      computeInterest1619({
        mode: "contractual",
        end_date: "2025-12-31",
        rate_bps: 1200,
        tranches: [
          { label: "Facture 1", principal_cents: 5_000_000, start_date: "2024-12-31" },
          {
            label: "Facture 2",
            principal_cents: 2_500_000,
            start_date: "2024-12-31",
            rate_bps: 1000,
          },
        ],
      }),
    );
    expect(out.total_legal_interest_cents).toBe(0);
    expect(out.total_additional_indemnity_cents).toBe(0);
    // 50 000 * 12% + 25 000 * 10% = 6 000 + 2 500 = 8 500 $
    expect(out.total_contractual_interest_cents).toBe(850_000);
    expect(out.total_interest_cents).toBe(850_000);
    expect(out.grand_total_cents).toBe(8_350_000);
  });

  it("tronque sans extrapoler lorsqu'un trimestre LAF futur est manquant et permet rate_overrides", () => {
    const truncated = ComputeInterest1619OutputSchema.parse(
      computeInterest1619({
        mode: "legal_plus_1619",
        end_date: "2027-06-30",
        tranches: [{ principal_cents: 1_000_000, start_date: "2026-09-30" }],
      }),
    );
    expect(truncated.truncated_any).toBe(true);
    expect(truncated.tranches[0]!.truncated).toBe(true);
    expect(truncated.tranches[0]!.missing_quarter).toBe("2027-Q1");
    expect(truncated.tranches[0]!.effective_end_date).toBe("2026-12-31");
    expect(truncated.gardes.map((g) => g.code)).toContain("TAUX_LAF_TRIMESTRE_MANQUANT");

    const overridden = ComputeInterest1619OutputSchema.parse(
      computeInterest1619({
        mode: "legal_plus_1619",
        end_date: "2027-06-30",
        rate_overrides: [
          { quarter: "2027-Q1", laf_rate_bps: 700 },
          { quarter: "2027-Q2", laf_rate_bps: 700 },
        ],
        tranches: [{ principal_cents: 1_000_000, start_date: "2026-09-30" }],
      }),
    );
    expect(overridden.truncated_any).toBe(false);
    expect(overridden.tranches[0]!.effective_end_date).toBe("2027-06-30");
    expect(overridden.gardes.map((g) => g.code)).not.toContain("TAUX_LAF_TRIMESTRE_MANQUANT");
    expect(overridden.gardes.map((g) => g.code)).toContain("TAUX_LAF_SURCHARGE_APPELANT");
    expect(overridden.provenance.source).toContain("rate_overrides");
    const periods = overridden.tranches[0]!.periods;
    expect(periods.find((p) => p.period_label === "2026-Q4")?.overridden).toBe(false);
    expect(periods.find((p) => p.period_label === "2027-Q1")?.overridden).toBe(true);

    // A-N1 : rate_overrides interdit sur un trimestre déjà publié dans la table embarquée
    expect(() =>
      computeInterest1619({
        mode: "legal_plus_1619",
        end_date: "2025-12-31",
        rate_overrides: [{ quarter: "2025-Q1", laf_rate_bps: 700 }],
        tranches: [{ principal_cents: 1_000_000, start_date: "2025-01-01" }],
      }),
    ).toThrow(/Surcharge interdite pour le trimestre 2025-Q1/);
  });

  it("retourne 0 pour une période nulle (end_date === start_date) et 0 d'indemnité quand LAF = 5%", () => {
    const sameDay = computeInterest1619({
      end_date: "2025-05-01",
      tranches: [{ principal_cents: 1_000_000, start_date: "2025-05-01" }],
    });
    expect(sameDay.total_interest_cents).toBe(0);

    // 2021 avait LAF = 500 bps toute l'année -> indemnité additionnelle = 0
    const year2021 = computeInterest1619({
      end_date: "2021-12-31",
      tranches: [{ principal_cents: 10_000_000, start_date: "2020-12-31" }],
    });
    expect(year2021.total_legal_interest_cents).toBe(500_000);
    expect(year2021.total_additional_indemnity_cents).toBe(0);
  });

  it("contient boc_prime_rates.json cohérent et sans trous pour V80691311, V39079 et V122530", () => {
    expect(bocPrimeRatesJson.metadata.first_date).toBe("2001-01-01");
    expect(bocPrimeRatesJson.metadata.last_verified_date).toBe(
      bocPrimeRatesJson.series.V80691311.last_date,
    );
    expect(bocPrimeRatesJson.series.V80691311.first_date).toBe("2001-01-01");
    expect(bocPrimeRatesJson.series.V80691311.changes[0]).toEqual({
      effective_from: "2001-01-01",
      rate_bps: 750,
    });
    expect(bocPrimeRatesJson.series.V39079.first_date).toBe("2009-04-21");
    expect(bocPrimeRatesJson.series.V39079.changes[0]).toEqual({
      effective_from: "2009-04-21",
      rate_bps: 25,
    });
    expect(bocPrimeRatesJson.series.V122530.first_date).toBe("2001-01-01");
    expect(bocPrimeRatesJson.series.V122530.changes[0]).toEqual({
      effective_from: "2001-01-01",
      rate_bps: 575,
    });

    for (const s of Object.values(bocPrimeRatesJson.series)) {
      expect(s.changes.length).toBeGreaterThan(10);
      expect(s.changes[0]!.effective_from).toBe(s.first_date);
      for (let i = 0; i < s.changes.length; i++) {
        const entry = s.changes[i]!;
        expect(Number.isInteger(entry.rate_bps)).toBe(true);
        expect(entry.rate_bps).toBeGreaterThanOrEqual(0);
        if (i > 0) {
          expect(entry.effective_from > s.changes[i - 1]!.effective_from).toBe(true);
        }
      }
    }
  });

  it("calcule le mode prime_plus_margin exact BigInt à travers des variations de taux et le passage 2024 -> 2025", () => {
    const out = ComputeInterest1619OutputSchema.parse(
      computeInterest1619({
        mode: "prime_plus_margin",
        end_date: "2025-02-10",
        spread_bps: 200,
        tranches: [{ label: "Marge +2%", principal_cents: 10_000_000, start_date: "2024-05-31" }],
      }),
    );

    expect(out.total_legal_interest_cents).toBe(0);
    expect(out.total_additional_indemnity_cents).toBe(0);
    expect(out.tranches[0]!.accrued_days).toBe(255);
    expect(out.tranches[0]!.periods.map((p) => p.days)).toEqual([11, 49, 42, 49, 49, 14, 35, 6]);
    expect(out.tranches[0]!.periods[0]!.year_days).toBe(366);
    expect(out.tranches[0]!.periods[6]!.year_days).toBe(365);
    expect(out.tranches[0]!.periods[0]!.prime_rate_bps).toBe(720);
    expect(out.tranches[0]!.periods[0]!.spread_bps).toBe(200);
    expect(out.tranches[0]!.periods[0]!.effective_rate_bps).toBe(920);
    expect(out.gardes.map((g) => g.code)).toContain("TAUX_BOC_PRIME_INDICATIF_BANCAIRE");

    const num2024 =
      10_000_000n *
      (11n * 920n + 49n * 895n + 42n * 870n + 49n * 845n + 49n * 795n + 14n * 745n) *
      365n;
    const num2025 = 10_000_000n * (35n * 745n + 6n * 720n) * 366n;
    const expectedCents = Number(
      roundHalfAwayFromZero(num2024 + num2025, EXACT_EXACT_COMMON_DENOMINATOR),
    );
    expect(out.total_contractual_interest_cents).toBe(expectedCents);
    expect(out.total_interest_cents).toBe(expectedCents);

    // Couverture dès le 2001-01-01 grâce à la graine 2000-12-27 = 750 bps
    const jan2001 = computeInterest1619({
      mode: "prime_plus_margin",
      end_date: "2001-01-05",
      tranches: [{ principal_cents: 10_000_000, start_date: "2000-12-31" }],
    });
    expect(jan2001.tranches[0]!.accrued_days).toBe(5);
    expect(jan2001.tranches[0]!.periods[0]!.prime_rate_bps).toBe(750);
    expect(jan2001.tranches[0]!.periods[0]!.spread_bps).toBe(0);

    // Marge négative supérieure au taux préférentiel -> plancher à 0 bps effectif
    const negativeFloor = computeInterest1619({
      mode: "prime_plus_margin",
      end_date: "2026-11-18",
      spread_bps: -600,
      tranches: [{ principal_cents: 10_000_000, start_date: "2026-11-10" }],
    });
    expect(negativeFloor.tranches[0]!.periods[0]!.effective_rate_bps).toBe(0);
    expect(negativeFloor.total_contractual_interest_cents).toBe(0);
  });

  it("tronque prime_plus_margin à last_verified_date sans extrapolation et rejette les mélanges invalides", () => {
    const lastVerified = bocPrimeRatesJson.metadata.last_verified_date;

    const partialTrunc = ComputeInterest1619OutputSchema.parse(
      computeInterest1619({
        mode: "prime_plus_margin",
        end_date: "2027-03-01",
        spread_bps: 100,
        tranches: [{ principal_cents: 1_000_000, start_date: "2026-11-10" }],
      }),
    );
    expect(partialTrunc.truncated_any).toBe(true);
    expect(partialTrunc.tranches[0]!.truncated).toBe(true);
    expect(partialTrunc.tranches[0]!.effective_end_date).toBe(lastVerified);
    expect(partialTrunc.gardes.map((g) => g.code)).toContain("TAUX_BOC_PRIME_DATE_MANQUANTE");
    expect(partialTrunc.gardes.map((g) => g.code)).toContain("TAUX_BOC_PRIME_INDICATIF_BANCAIRE");

    const zeroDayTrunc = computeInterest1619({
      mode: "prime_plus_margin",
      end_date: "2027-03-01",
      tranches: [{ principal_cents: 1_000_000, start_date: lastVerified }],
    });
    expect(zeroDayTrunc.truncated_any).toBe(true);
    expect(zeroDayTrunc.tranches[0]!.accrued_days).toBe(0);
    expect(zeroDayTrunc.tranches[0]!.effective_end_date).toBe(lastVerified);
    expect(zeroDayTrunc.total_interest_cents).toBe(0);

    expect(() =>
      computeInterest1619({
        mode: "prime_plus_margin",
        end_date: "2001-01-10",
        tranches: [{ principal_cents: 1_000_000, start_date: "2000-12-30" }],
      }),
    ).toThrow(/2001-01-01/);

    expect(() =>
      computeInterest1619({
        mode: "legal_plus_1619",
        end_date: "2025-12-31",
        spread_bps: 100,
        tranches: [{ principal_cents: 1_000_000, start_date: "2025-01-01" }],
      }),
    ).toThrow(/spread_bps/);

    expect(() =>
      computeInterest1619({
        mode: "prime_plus_margin",
        end_date: "2027-03-01",
        rate_overrides: [{ quarter: "2027-Q1", laf_rate_bps: 700 }],
        tranches: [{ principal_cents: 1_000_000, start_date: "2026-11-10" }],
      }),
    ).toThrow(/rate_overrides/);
  });

  it("rejette rate_overrides dans les modes legal_only et contractual (trimestres publiés ou non)", () => {
    for (const invalidMode of ["legal_only", "contractual"] as const) {
      for (const quarter of ["2025-Q1", "2027-Q1"]) {
        expect(() =>
          computeInterest1619({
            mode: invalidMode,
            end_date: "2027-03-01",
            ...(invalidMode === "contractual" ? { rate_bps: 800 } : {}),
            rate_overrides: [{ quarter, laf_rate_bps: 700 }],
            tranches: [{ principal_cents: 1_000_000, start_date: "2025-01-01" }],
          }),
        ).toThrow(/rate_overrides/);
      }
    }
  });
});
