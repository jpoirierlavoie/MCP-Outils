import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TauxBocRatesOutputSchema, tauxBocRates } from "../src/core/economie.js";
import { createSqliteD1Harness } from "./helpers/sqliteD1.js";

function createTestEconomieDb() {
  return createSqliteD1Harness({
    seedSql: [
      readFileSync(resolve(process.cwd(), "pipeline/economie/schema.sql"), "utf-8"),
      readFileSync(resolve(process.cwd(), "pipeline/economie/indexes.sql"), "utf-8"),
      `
        INSERT INTO meta_sources VALUES
          ('boc_fx_daily', 'BdC Valet FX_RATES_DAILY', 'BoC Terms', '2026-11-23', 7),
          ('boc_legacy_noon', 'BdC Valet LEGACY_NOON_RATES', 'BoC Terms', '2017-04-28', 4),
          ('statcan_10100008', 'StatCan 10-10-0008-01', 'OGL-Canada', '2007-04-30', 2),
          ('boc_interest_rates', 'BdC Valet V39079/V122530/V80691311', 'BoC Terms', '2026-11-23', 6);
        INSERT INTO fx_currencies VALUES
          (1, 'USD', 'United States dollar', 'Dollar américain', 1, 20010102, 20261123),
          (2, 'JPY', 'Japanese yen', 'Yen japonais', 1, 20010102, 20261123),
          (3, 'COP', 'Colombian peso', 'Peso colombien', 0, 20070501, 20170428),
          (4, 'RUB', 'Russian ruble', 'Rouble russe', 1, 20170103, 20260430),
          (5, 'FRF', 'French franc', 'Franc français (pré-euro)', 0, 20010102, 20011231);
        INSERT INTO fx_rates VALUES
          (1, 20010102, 1, 1496300),
          (1, 20170103, 1, 1343800),
          (1, 20170103, 2, 1343500),
          (1, 20170428, 1, 1365200),
          (1, 20170428, 2, 1366200),
          (1, 20170501, 2, 1367000),
          (1, 20261120, 2, 1395500),
          (1, 20261123, 2, 1398200),
          (2, 20010102, 1, 13040),
          (2, 20261120, 2, 9145),
          (3, 20170428, 1, 463),
          (4, 20260430, 2, 16500),
          (5, 20010102, 1, 214500);
        INSERT INTO boc_rates VALUES
          ('V39079', 20090421, 25),
          ('V39079', 20261123, 250),
          ('V122530', 20010101, 575),
          ('V122530', 20261101, 275),
          ('V80691311', 20001227, 750),
          ('V80691311', 20261118, 470);
      `,
    ],
    enforceQueryOnly: true,
  });
}

describe("taux_boc_rates (DB_ECONOMIE en lecture seule)", () => {
  it("distingue le régime au comptant de midi (pré-2017-05-01) de la moyenne 16 h 30 HE et rejette les devises héritées après mai 2017", async () => {
    const harness = createTestEconomieDb();
    try {
      // Sur le chevauchement 2017-01-03 (< 2017-05-01), regime=1 (1.3438) doit être retenu
      const preRes = await tauxBocRates(harness.d1, {
        category: "fx",
        currency: "FXUSDCAD",
        date: "2017-01-03",
      });
      expect(preRes.ok).toBe(true);
      if (!preRes.ok) return;
      const pre = TauxBocRatesOutputSchema.parse(preRes.structured);
      expect(pre.fx_observations[0]!.rate_methodology).toBe("noon_spot_pre_2017_05_01");
      expect(pre.fx_observations[0]!.cad_per_foreign_unit).toBe("1.343800");
      expect(pre.gardes.map((g) => g.code)).toContain("TAUX_BOC_NOON_HISTORIQUE_PRE_2017");

      // À compter du 2017-05-01, regime=2 (1.3670) doit être retenu sans garde pré-2017
      const postRes = await tauxBocRates(harness.d1, {
        category: "fx",
        currency: "usd",
        date: "2017-05-01",
      });
      expect(postRes.ok).toBe(true);
      if (!postRes.ok) return;
      expect(postRes.structured.fx_observations[0]!.rate_methodology).toBe("daily_average_1630_et");
      expect(postRes.structured.gardes.map((g) => g.code)).not.toContain(
        "TAUX_BOC_NOON_HISTORIQUE_PRE_2017",
      );

      // COP (héritée jusqu'au 2017-04-28 uniquement) interrogée au 2017-05-02 ne doit pas fuir à travers la bascule
      const legacyAfter = await tauxBocRates(harness.d1, {
        category: "fx",
        currency: "COP",
        date: "2017-05-02",
      });
      expect(legacyAfter.ok).toBe(false);

      // StatCan 2001-01-02 (FRF)
      const frfRes = await tauxBocRates(harness.d1, {
        category: "fx",
        currency: "FRF",
        date: "2001-01-02",
      });
      expect(frfRes.ok).toBe(true);
      if (!frfRes.ok) return;
      expect(frfRes.structured.fx_observations[0]!.cad_per_foreign_unit).toBe("0.214500");
    } finally {
      harness.close();
    }
  });

  it("gère le report au jour ouvrable précédent et bloque l'extrapolation ou les séries interrompues", async () => {
    const harness = createTestEconomieDb();
    try {
      // Dimanche 2026-11-22 -> vendredi 2026-11-20 (rollback_days=2)
      const weekend = await tauxBocRates(harness.d1, {
        category: "fx",
        currency: "USD",
        date: "2026-11-22",
      });
      expect(weekend.ok).toBe(true);
      if (!weekend.ok) return;
      expect(weekend.structured.fx_observations[0]!.effective_observation_date).toBe("2026-11-20");
      expect(weekend.structured.fx_observations[0]!.rolled_back).toBe(true);
      expect(weekend.structured.fx_observations[0]!.rollback_days).toBe(2);
      expect(weekend.structured.gardes.map((g) => g.code)).toContain(
        "TAUX_BOC_REPORT_JOUR_OUVRABLE_PRECEDENT",
      );

      // Date future au-delà de l'instantané -> refus sans extrapolation
      const future = await tauxBocRates(harness.d1, {
        category: "fx",
        currency: "USD",
        date: "2026-12-15",
      });
      expect(future.ok).toBe(false);

      // RUB interrompue le 2026-04-30 interrogée en juin 2026 -> refus (hors fenêtre de 10 jours)
      const discontinued = await tauxBocRates(harness.d1, {
        category: "fx",
        currency: "RUB",
        date: "2026-06-01",
      });
      expect(discontinued.ok).toBe(false);
    } finally {
      harness.close();
    }
  });

  it("effectue une conversion BigInt exacte (art. 12 Loi sur la monnaie) dans les deux sens", async () => {
    const harness = createTestEconomieDb();
    try {
      // 100 000 JPY à 0.009145 CAD/JPY (2026-11-20) = 914.50 CAD (91450 cents)
      const jpyToCad = await tauxBocRates(harness.d1, {
        category: "fx",
        currency: "JPY",
        date: "2026-11-20",
        amount: "100000",
        direction: "foreign_to_cad",
      });
      expect(jpyToCad.ok).toBe(true);
      if (!jpyToCad.ok) return;
      expect(jpyToCad.structured.conversion?.converted_cents).toBe(91_450);
      expect(jpyToCad.structured.conversion?.converted_amount_2dec).toBe("914.50");
      expect(jpyToCad.structured.conversion?.converted_amount_exact_6dec).toBe("914.500000");
      expect(jpyToCad.structured.gardes.map((g) => g.code)).toContain(
        "TAUX_BOC_CONVERSION_LOI_MONNAIE",
      );

      // 1 000.00 CAD -> USD au 2026-11-23 (1.3982) : 1000 / 1.3982 = 715.20526391... -> 71521 cents
      const cadToUsd = await tauxBocRates(harness.d1, {
        category: "fx",
        currency: "USD",
        date: "2026-11-23",
        amount: "1000.00",
        direction: "cad_to_foreign",
      });
      expect(cadToUsd.ok).toBe(true);
      if (!cadToUsd.ok) return;
      expect(cadToUsd.structured.conversion?.converted_currency).toBe("USD");
      expect(cadToUsd.structured.conversion?.converted_cents).toBe(71_521);
      expect(cadToUsd.structured.conversion?.converted_amount_2dec).toBe("715.21");
      expect(cadToUsd.structured.conversion?.converted_amount_exact_6dec).toBe("715.205264");
    } finally {
      harness.close();
    }
  });

  it("interroge une plage FX traversant mai 2017 et les séries V39079 / V122530 / V80691311", async () => {
    const harness = createTestEconomieDb();
    try {
      const rangeFx = await tauxBocRates(harness.d1, {
        category: "fx",
        currency: "USD",
        start_date: "2017-04-28",
        end_date: "2017-05-01",
      });
      expect(rangeFx.ok).toBe(true);
      if (!rangeFx.ok) return;
      expect(rangeFx.structured.fx_observations.map((o) => o.rate_methodology)).toEqual([
        "noon_spot_pre_2017_05_01",
        "daily_average_1630_et",
      ]);
      expect(rangeFx.structured.fx_observations.map((o) => o.cad_per_foreign_unit)).toEqual([
        "1.365200",
        "1.367000",
      ]);

      // Taux préférentiel au 2001-01-01 -> report sur la graine 2000-12-27 (750 bps)
      const prime2001 = await tauxBocRates(harness.d1, {
        category: "prime",
        date: "2001-01-01",
      });
      expect(prime2001.ok).toBe(true);
      if (!prime2001.ok) return;
      expect(prime2001.structured.interest_observations[0]!.rate_bps).toBe(750);
      expect(prime2001.structured.interest_observations[0]!.effective_observation_date).toBe(
        "2000-12-27",
      );

      // all_rates en novembre 2026 retourne les 3 séries
      const allNov = await tauxBocRates(harness.d1, {
        category: "all_rates",
        date: "2026-11-23",
      });
      expect(allNov.ok).toBe(true);
      if (!allNov.ok) return;
      expect(allNov.structured.interest_observations.map((i) => i.series_id)).toEqual([
        "V39079",
        "V122530",
        "V80691311",
      ]);

      // policy (V39079) avant 2009-04-21 refusée proprement
      const prePolicy = await tauxBocRates(harness.d1, {
        category: "policy",
        date: "2008-06-01",
      });
      expect(prePolicy.ok).toBe(false);
    } finally {
      harness.close();
    }
  });

  it("rejette proprement les combinaisons invalides sans lever d'exception", async () => {
    const harness = createTestEconomieDb();
    try {
      for (const bad of [
        { category: "fx" as const, currency: "CAD", date: "2026-11-20" },
        { category: "fx" as const, currency: "USD", date: "2025-02-29" },
        {
          category: "fx" as const,
          currency: "USD",
          date: "2026-11-20",
          start_date: "2026-11-01",
          end_date: "2026-11-20",
        },
        {
          category: "fx" as const,
          currency: "USD",
          start_date: "2026-11-23",
          end_date: "2026-11-20",
        },
        { category: "fx" as const, currency: "USD", date: "2026-11-20", amount: "0" },
        {
          category: "fx" as const,
          currency: "USD",
          start_date: "2026-11-20",
          end_date: "2026-11-23",
          amount: "100",
        },
        { category: "policy" as const, currency: "USD", date: "2026-11-23" },
      ]) {
        const res = await tauxBocRates(harness.d1, bad);
        expect(res.ok).toBe(false);
      }
    } finally {
      harness.close();
    }
  });
});
