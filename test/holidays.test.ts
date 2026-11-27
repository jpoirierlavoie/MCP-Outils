import { describe, expect, it } from "vitest";
import {
  computeEasterSunday,
  ListHolidaysOutputSchema,
  listHolidays,
} from "../src/core/holidays.js";

describe("calendrier_holidays", () => {
  it("calcule Pâques selon l'algorithme grégorien pour des années connues", () => {
    expect(computeEasterSunday(2024)).toBe("2024-03-31");
    expect(computeEasterSunday(2025)).toBe("2025-04-20");
    expect(computeEasterSunday(2026)).toBe("2026-04-05");
    expect(computeEasterSunday(2027)).toBe("2027-03-28");
  });

  it("produit le calendrier qc_cpc complet avec 2 janv., 26 déc., et samedis/dimanches", () => {
    const out = ListHolidaysOutputSchema.parse(listHolidays({ year: 2026, regime: "qc_cpc" }));

    const dates = out.holidays.map((h) => h.date);
    expect(out.weekly_non_juridical_days).toEqual(["saturday", "sunday"]);
    expect(out.saturday_triggers_deadline_rollover).toBe(true);
    expect(dates).toContain("2026-01-01");
    expect(dates).toContain("2026-01-02");
    expect(dates).toContain("2026-04-03");
    expect(dates).toContain("2026-04-06");
    expect(dates).toContain("2026-05-18");
    expect(dates).toContain("2026-06-24");
    expect(dates).toContain("2026-07-01");
    expect(dates).toContain("2026-09-07");
    expect(dates).toContain("2026-10-12");
    expect(dates).toContain("2026-12-25");
    expect(dates).toContain("2026-12-26");
    expect(dates).not.toContain("2026-09-30");
    expect(dates).not.toContain("2026-11-11");
    expect(out.count).toBe(11);
  });

  it("distingue qc_li de qc_cpc en excluant le 2 janvier et le 26 décembre et en fixant saturday_triggers_deadline_rollover=false", () => {
    const out = ListHolidaysOutputSchema.parse(listHolidays({ year: 2026, regime: "qc_li" }));

    const dates = out.holidays.map((h) => h.date);
    expect(out.weekly_non_juridical_days).toEqual(["sunday"]);
    expect(out.saturday_triggers_deadline_rollover).toBe(false);
    expect(dates).not.toContain("2026-01-02");
    expect(dates).not.toContain("2026-12-26");
    expect(dates).toContain("2026-06-24");
    expect(out.gardes.map((g) => g.code)).toContain("SAMEDI_CONGE_LOI_INTERPRETATION_QC");
  });

  it("supporte qc_prescription (art. 2879 al. 2 C.c.Q.) avec report du samedi sans 2 janv. ni 26 déc.", () => {
    const out = ListHolidaysOutputSchema.parse(
      listHolidays({ year: 2026, regime: "qc_prescription" }),
    );
    const dates = out.holidays.map((h) => h.date);
    expect(out.weekly_non_juridical_days).toEqual(["sunday"]);
    expect(out.saturday_triggers_deadline_rollover).toBe(true);
    expect(dates).not.toContain("2026-01-02");
    expect(dates).not.toContain("2026-12-26");
    expect(dates).toContain("2026-06-24");
    expect(out.count).toBe(9);
  });

  it("produit ca_li avec le 30 septembre (à compter de 2021) et le 11 novembre, et inclut le 24 juin seulement si province='QC'", () => {
    const out2026 = ListHolidaysOutputSchema.parse(listHolidays({ year: 2026, regime: "ca_li" }));
    const dates2026 = out2026.holidays.map((h) => h.date);
    expect(dates2026).toContain("2026-09-30");
    expect(dates2026).toContain("2026-11-11");
    expect(dates2026).not.toContain("2026-06-24");
    expect(dates2026).not.toContain("2026-01-02");
    expect(dates2026).not.toContain("2026-12-26");

    const outCaQc = ListHolidaysOutputSchema.parse(
      listHolidays({ year: 2026, regime: "ca_li", province: "QC" }),
    );
    expect(outCaQc.province).toBe("QC");
    expect(outCaQc.holidays.map((h) => h.date)).toContain("2026-06-24");
    const june24 = outCaQc.holidays.find((h) => h.date === "2026-06-24");
    expect(june24?.legal_basis).toContain("art. 35(1) al. a)");

    const outCaOn = ListHolidaysOutputSchema.parse(
      listHolidays({ year: 2026, regime: "ca_li", province: "ON" }),
    );
    expect(outCaOn.holidays.map((h) => h.date)).not.toContain("2026-06-24");

    expect(() => listHolidays({ year: 2026, regime: "qc_cpc", province: "ON" })).toThrow(/ca_li/);

    const out2020 = ListHolidaysOutputSchema.parse(listHolidays({ year: 2020, regime: "ca_li" }));
    expect(out2020.holidays.map((h) => h.date)).not.toContain("2020-09-30");
  });

  it("reporte l'observance du 1er juillet au 2 juillet lorsque le 1er juillet est un dimanche (2029)", () => {
    for (const regime of ["qc_cpc", "qc_prescription", "qc_li", "ca_li"] as const) {
      const out = listHolidays({ year: 2029, regime });
      const dates = out.holidays.map((h) => h.date);
      expect(dates).not.toContain("2029-07-01");
      expect(dates).toContain("2029-07-02");
    }
  });

  it("B-N12 & B-N14 : émet SAMEDI_CONGE_LOI_INTERPRETATION_CA sous ca_li et accepte les années jusqu'à 2300", () => {
    const outCa = ListHolidaysOutputSchema.parse(listHolidays({ year: 2026, regime: "ca_li" }));
    expect(outCa.gardes.map((g) => g.code)).toContain("SAMEDI_CONGE_LOI_INTERPRETATION_CA");

    const futureOut = ListHolidaysOutputSchema.parse(
      listHolidays({ year: 2250, regime: "qc_cpc" }),
    );
    expect(futureOut.year).toBe(2250);
    expect(futureOut.count).toBeGreaterThan(0);
  });
});
