import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IndiceIpcOutputSchema, indiceIpc } from "../src/core/ipc.js";
import { createSqliteD1Harness } from "./helpers/sqliteD1.js";

function createTestIpcDb() {
  return createSqliteD1Harness({
    seedSql: [
      readFileSync(resolve(process.cwd(), "pipeline/economie/schema.sql"), "utf-8"),
      readFileSync(resolve(process.cwd(), "pipeline/economie/indexes.sql"), "utf-8"),
      `
        INSERT INTO meta_sources VALUES
          ('statcan_cpi_monthly', 'StatCan 18-10-0004-01', 'OGL-Canada', '2026-10-01', 6),
          ('statcan_cpi_annual', 'StatCan 18-10-0005-01', 'OGL-Canada', '2025-01-01', 4);
        INSERT INTO cpi_series VALUES
          (1, 18100004, 'M', 'quebec', 'Quebec', 'Québec', 'all_items', 'All-items', 'Ensemble', '11.2.0.0.0.0.0.0.0.0', 41691783, '2002=100', 202410, 202610),
          (2, 18100004, 'M', 'quebec', 'Quebec', 'Québec', 'all_items', 'All-items (1992=100)', 'Ensemble (1992=100)', '11.309.0.0.0.0.0.0.0.0', 41713412, '1992=100', 201712, 201812),
          (3, 18100005, 'A', 'quebec', 'Quebec', 'Québec', 'all_items', 'All-items', 'Ensemble', '11.2.0.0.0.0.0.0.0.0', 41694081, '2002=100', 2022, 2025),
          (4, 18100004, 'M', 'montreal_rmr', 'Montréal, Quebec', 'Montréal, Québec', 'rented_accommodation', 'Rented accommodation', 'Logement locatif', '13.80.0.0.0.0.0.0.0.0', 41692878, '2002=100', 202510, 202610);
        INSERT INTO cpi_observations VALUES
          (1, 202410, 164300),
          (1, 202510, 168400),
          (1, 202610, 171200),
          (2, 201712, 152100),
          (2, 201812, 154600),
          (3, 2022, 147000),
          (3, 2023, 153600),
          (3, 2024, 157200),
          (3, 2025, 161000),
          (4, 202510, 152000),
          (4, 202610, 158000);
      `,
    ],
    enforceQueryOnly: true,
  });
}

describe("indice_ipc (DB_ECONOMIE en lecture seule)", () => {
  it("retourne les niveaux IPC mensuels/annuels et calcule la variation annuelle exacte", async () => {
    const harness = createTestIpcDb();
    try {
      const mRes = await indiceIpc(harness.d1, {
        geo: "quebec",
        product: "all_items",
        period: "2026-10",
      });
      expect(mRes.ok).toBe(true);
      if (!mRes.ok) return;
      const mParsed = IndiceIpcOutputSchema.parse(mRes.structured);
      expect(mParsed.vector_id).toBe("v41691783");
      expect(mParsed.observations[0]?.value_decimal).toBe("171.2");
      expect(mParsed.observations[0]?.value_milli).toBe(171_200);
      // (171.2 - 168.4) / 168.4 = 1.6627...% -> 166 bps
      expect(mParsed.observations[0]?.yoy_bps).toBe(166);
      expect(mParsed.observations[0]?.yoy_percent).toBe("+1.66 %");
      expect(mParsed.gardes.map((g) => g.code)).toEqual(["IPC_INSTANTANE_HORS_LIGNE"]);

      const aRes = await indiceIpc(harness.d1, {
        geo: "quebec",
        product: "all_items",
        period: "2025",
      });
      expect(aRes.ok).toBe(true);
      if (!aRes.ok) return;
      // (161.0 - 157.2) / 157.2 = 2.4173...% -> 242 bps
      expect(aRes.structured.observations[0]?.yoy_bps).toBe(242);
    } finally {
      harness.close();
    }
  });

  it("effectue l'indexation contractuelle en BigInt avec floor_bps, cap_bps et arrondi half_up vs half_away_from_zero", async () => {
    const harness = createTestIpcDb();
    try {
      // Brut : 1000.00 * 171200 / 168400 = 1016.627078... -> 101663 cents (1016.63 $)
      const rawEsc = await indiceIpc(harness.d1, {
        geo: "quebec",
        product: "all_items",
        start_period: "2025-10",
        end_period: "2026-10",
        amount: "1000.00",
      });
      expect(rawEsc.ok).toBe(true);
      if (!rawEsc.ok) return;
      expect(rawEsc.structured.escalation?.applied_bound).toBe("none");
      expect(rawEsc.structured.escalation?.raw_change_bps).toBe(166);
      expect(rawEsc.structured.escalation?.escalated_cents).toBe(101_663);
      expect(rawEsc.structured.escalation?.escalated_amount_2dec).toBe("1016.63");
      expect(rawEsc.structured.gardes.map((g) => g.code)).toContain(
        "IPC_BASE_REINDEXATION_ATTENTION",
      );
      expect(rawEsc.structured.gardes.map((g) => g.code)).toContain(
        "IPC_INDEXATION_CONTRACTUELLE_NON_NORMATIVE",
      );

      // Plancher floor_bps=200 (+2.00 %) > brut (+1.6627 %) -> 1020.00 $
      const floored = await indiceIpc(harness.d1, {
        geo: "quebec",
        product: "all_items",
        start_period: "2025-10",
        end_period: "2026-10",
        amount: "1000.00",
        floor_bps: 200,
        cap_bps: 500,
      });
      expect(floored.ok).toBe(true);
      if (!floored.ok) return;
      expect(floored.structured.escalation?.applied_bound).toBe("floor");
      expect(floored.structured.escalation?.escalated_cents).toBe(102_000);

      // Plafond cap_bps=150 (+1.50 %) < brut (+1.6627 %) -> 1015.00 $
      const capped = await indiceIpc(harness.d1, {
        geo: "quebec",
        product: "all_items",
        start_period: "2025-10",
        end_period: "2026-10",
        amount: "1000.00",
        floor_bps: 0,
        cap_bps: 150,
      });
      expect(capped.ok).toBe(true);
      if (!capped.ok) return;
      expect(capped.structured.escalation?.applied_bound).toBe("cap");
      expect(capped.structured.escalation?.escalated_cents).toBe(101_500);

      // Exact half-cent boundary : 100.005 $ avec floor 0 bps -> 10001 cents
      const halfUpRes = await indiceIpc(harness.d1, {
        geo: "quebec",
        product: "all_items",
        start_period: "2025-10",
        end_period: "2026-10",
        amount: "100.005",
        floor_bps: 0,
        cap_bps: 0,
        rounding: "half_up",
      });
      expect(halfUpRes.ok).toBe(true);
      if (!halfUpRes.ok) return;
      expect(halfUpRes.structured.escalation?.escalated_cents).toBe(10_001);
    } finally {
      harness.close();
    }
  });

  it("rejette les sous-indices RMR absents, bloque toute extrapolation et échoue en sécurité sur divergence d'année de base (1992=100 vs 2002=100)", async () => {
    const harness = createTestIpcDb();
    try {
      const rmrRent = await indiceIpc(harness.d1, {
        geo: "montreal_rmr",
        product: "rent",
        period: "2026-10",
      });
      expect(rmrRent.ok).toBe(false);
      if (!rmrRent.ok) {
        expect(rmrRent.text).toContain("vectorId=0");
      }

      const rmrHealth = await indiceIpc(harness.d1, {
        geo: "quebec_rmr",
        product: "health_care_services",
        period: "2025",
      });
      expect(rmrHealth.ok).toBe(false);

      // RMR rented_accommodation fonctionne
      const rmrRented = await indiceIpc(harness.d1, {
        geo: "montreal_rmr",
        product: "rented_accommodation",
        period: "2026-10",
      });
      expect(rmrRented.ok).toBe(true);

      // Pas d'extrapolation au-delà de 2026-10
      const future = await indiceIpc(harness.d1, {
        geo: "quebec",
        product: "all_items",
        period: "2027-01",
      });
      expect(future.ok).toBe(false);

      // Divergence 1992=100 -> 2002=100 sur indexation : DOIT échouer de manière sécuritaire !
      const uomMismatch = await indiceIpc(harness.d1, {
        geo: "quebec",
        product: "all_items",
        uom: "1992=100",
        end_uom: "2002=100",
        start_period: "2018-12",
        end_period: "2026-10",
        amount: "1000",
      });
      expect(uomMismatch.ok).toBe(false);
      if (!uomMismatch.ok) {
        expect(uomMismatch.text).toContain("IPC_BASE_REINDEXATION_ATTENTION");
      }

      // Série 1992=100 seule : inclut IPC_BASE_REINDEXATION_ATTENTION
      const oldBase = await indiceIpc(harness.d1, {
        geo: "quebec",
        product: "all_items",
        uom: "1992=100",
        period: "2018-12",
      });
      expect(oldBase.ok).toBe(true);
      if (!oldBase.ok) return;
      expect(oldBase.structured.uom).toBe("1992=100");
      expect(oldBase.structured.gardes.map((g) => g.code)).toContain(
        "IPC_BASE_REINDEXATION_ATTENTION",
      );

      // Plage multi-UOM sans amount : pas de cumulative_change_bps et garde émise
      const multiUomRange = await indiceIpc(harness.d1, {
        geo: "quebec",
        product: "all_items",
        uom: "1992=100",
        end_uom: "2002=100",
        start_period: "2018-12",
        end_period: "2025-10",
      });
      expect(multiUomRange.ok).toBe(true);
      if (!multiUomRange.ok) return;
      expect(multiUomRange.structured.cumulative_change_bps).toBeNull();
      expect(multiUomRange.structured.gardes.map((g) => g.code)).toContain(
        "IPC_BASE_REINDEXATION_ATTENTION",
      );
    } finally {
      harness.close();
    }
  });

  it("rejette proprement les combinaisons de paramètres invalides", async () => {
    const harness = createTestIpcDb();
    try {
      for (const bad of [
        { period: "2026-13" },
        { period: "2026-10", start_period: "2025-10", end_period: "2026-10" },
        { start_period: "2026-10", end_period: "2025-10" },
        { start_period: "2025-10", end_period: "2026" },
        { period: "2026-10", amount: "100" },
        { start_period: "2025-10", end_period: "2026-10", amount: "0" },
        {
          start_period: "2025-10",
          end_period: "2026-10",
          amount: "100",
          floor_bps: 400,
          cap_bps: 200,
        },
        { period: "2026-10", floor_bps: 100 },
        { period: "2026-10", end_uom: "1992=100" as const },
      ]) {
        const res = await indiceIpc(harness.d1, bad);
        expect(res.ok).toBe(false);
      }
    } finally {
      harness.close();
    }
  });

  it("calcule cumulative_change_bps sur toute la plage même quand limit tronque observations et rejette les bornes hors instantané en mode multi-UOM", async () => {
    const harness = createSqliteD1Harness({
      seedSql: [
        readFileSync(resolve(process.cwd(), "pipeline/economie/schema.sql"), "utf-8"),
        readFileSync(resolve(process.cwd(), "pipeline/economie/indexes.sql"), "utf-8"),
        `
          INSERT INTO meta_sources VALUES
            ('statcan_cpi_monthly', 'StatCan 18-10-0004-01', 'OGL-Canada', '2026-10-01', 7);
          INSERT INTO cpi_series VALUES
            (1, 18100004, 'M', 'quebec', 'Quebec', 'Québec', 'all_items', 'All-items', 'Ensemble', '11.2.0.0.0.0.0.0.0.0', 41691783, '2002=100', 202401, 202405),
            (2, 18100004, 'M', 'quebec', 'Quebec', 'Québec', 'all_items', 'All-items (1992=100)', 'Ensemble (1992=100)', '11.309.0.0.0.0.0.0.0.0', 41713412, '1992=100', 201712, 201812);
          INSERT INTO cpi_observations VALUES
            (1, 202401, 150000),
            (1, 202402, 151000),
            (1, 202403, 152000),
            (1, 202404, 153000),
            (1, 202405, 165000),
            (2, 201712, 152100),
            (2, 201812, 154600);
        `,
      ],
      enforceQueryOnly: true,
    });
    try {
      // limit=3 sur 5 mois (2024-01..2024-05) : +10.00 % (1000 bps) sur la plage complète, pas +1.33 % (133 bps)
      const truncatedWithAmount = await indiceIpc(harness.d1, {
        geo: "quebec",
        product: "all_items",
        start_period: "2024-01",
        end_period: "2024-05",
        amount: "1000.00",
        limit: 3,
      });
      expect(truncatedWithAmount.ok).toBe(true);
      if (!truncatedWithAmount.ok) return;
      expect(truncatedWithAmount.structured.count).toBe(3);
      expect(truncatedWithAmount.structured.total_observations).toBe(5);
      expect(truncatedWithAmount.structured.observations_truncated).toBe(true);
      expect(truncatedWithAmount.structured.cumulative_change_bps).toBe(1000);
      expect(truncatedWithAmount.structured.escalation?.raw_change_bps).toBe(1000);
      expect(truncatedWithAmount.text).toContain("3 observations sur 5");

      // Sans amount également : cumulative_change_bps reflète toute la plage [2024-01, 2024-05]
      const truncatedRangeOnly = await indiceIpc(harness.d1, {
        geo: "quebec",
        product: "all_items",
        start_period: "2024-01",
        end_period: "2024-05",
        limit: 3,
      });
      expect(truncatedRangeOnly.ok).toBe(true);
      if (!truncatedRangeOnly.ok) return;
      expect(truncatedRangeOnly.structured.cumulative_change_bps).toBe(1000);
      expect(truncatedRangeOnly.structured.observations_truncated).toBe(true);

      // Multi-UOM sans amount : end_period futur hors instantané DOIT échouer (pas d'extrapolation)
      const multiUomFuture = await indiceIpc(harness.d1, {
        geo: "quebec",
        product: "all_items",
        uom: "1992=100",
        end_uom: "2002=100",
        start_period: "2018-12",
        end_period: "2099-01",
      });
      expect(multiUomFuture.ok).toBe(false);
      if (!multiUomFuture.ok) {
        expect(multiUomFuture.text).toContain("extrapolation");
      }

      // Multi-UOM sans amount : start_period antérieur à startSeries.first_period DOIT échouer
      const multiUomPast = await indiceIpc(harness.d1, {
        geo: "quebec",
        product: "all_items",
        uom: "1992=100",
        end_uom: "2002=100",
        start_period: "1990-01",
        end_period: "2024-05",
      });
      expect(multiUomPast.ok).toBe(false);
    } finally {
      harness.close();
    }
  });
});
