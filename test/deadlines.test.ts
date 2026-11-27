import { describe, expect, it } from "vitest";
import { ComputeDeadlinesOutputSchema, computeDeadlines } from "../src/core/deadlines.js";

describe("calendrier_deadlines", () => {
  it("enchaîne le report multi-jours (Noël, 26 décembre, dimanche) en qc_cpc vs qc_li", () => {
    const outCpc = ComputeDeadlinesOutputSchema.parse(
      computeDeadlines({
        event_date: "2026-12-15",
        regime: "qc_cpc",
        deadlines: [{ label: "Noël 10j", amount: 10, unit: "days" }],
      }),
    );

    const stepCpc = outCpc.results[0]!;
    expect(stepCpc.raw_date).toBe("2026-12-25");
    expect(stepCpc.effective_date).toBe("2026-12-28");
    expect(stepCpc.rolled_over).toBe(true);
    expect(stepCpc.rollover_hops.map((h) => h.date)).toEqual([
      "2026-12-25",
      "2026-12-26",
      "2026-12-27",
    ]);
    expect(stepCpc.in_non_sitting_period).toBe(true);
    expect(outCpc.gardes.map((g) => g.code)).toContain("JOUR_NON_SEANCE_ART_82_AL_2");

    const cpcJan2 = computeDeadlines({
      event_date: "2023-12-23",
      regime: "qc_cpc",
      deadlines: [{ amount: 10, unit: "days" }],
    });
    const liJan2 = computeDeadlines({
      event_date: "2023-12-23",
      regime: "qc_li",
      deadlines: [{ amount: 10, unit: "days" }],
    });
    expect(cpcJan2.results[0]!.effective_date).toBe("2024-01-03");
    expect(liJan2.results[0]!.effective_date).toBe("2024-01-02");
  });

  it("applique la règle de l'art. 111 al. 2 C.p.c. à 17:00 ou après ou un jour non juridique en mode technologique", () => {
    const before17 = computeDeadlines({
      event_date: "2026-07-03",
      event_time: "16:59",
      notification_mode: "technological",
      deadlines: [{ label: "Avant 17h00", amount: 30, unit: "days" }],
    });
    expect(before17.results[0]!.anchor_shifted_art_111).toBe(false);
    expect(before17.results[0]!.effective_anchor_date).toBe("2026-07-03");
    expect(before17.results[0]!.effective_date).toBe("2026-08-03");

    const atExact17 = computeDeadlines({
      event_date: "2026-07-03",
      event_time: "17:00",
      notification_mode: "technological",
      deadlines: [{ label: "Exact 17h00", amount: 30, unit: "days" }],
    });
    expect(atExact17.results[0]!.anchor_shifted_art_111).toBe(false);
    expect(atExact17.results[0]!.effective_anchor_date).toBe("2026-07-03");
    expect(atExact17.results[0]!.effective_date).toBe("2026-08-03");
    expect(atExact17.gardes.map((g) => g.code)).toContain(
      "NOTIFICATION_TECHNOLOGIQUE_17H_SECONDE_EXACTE",
    );

    const atExact17Sec = computeDeadlines({
      event_date: "2026-07-03",
      event_time: "17:00:00",
      notification_mode: "technological",
      deadlines: [{ label: "Exact 17h00:00", amount: 30, unit: "days" }],
    });
    expect(atExact17Sec.results[0]!.anchor_shifted_art_111).toBe(false);
    expect(atExact17Sec.results[0]!.effective_anchor_date).toBe("2026-07-03");

    const at170001 = computeDeadlines({
      event_date: "2026-07-03",
      event_time: "17:00:01",
      notification_mode: "technological",
      deadlines: [{ label: "17h00:01", amount: 30, unit: "days" }],
    });
    expect(at170001.results[0]!.anchor_shifted_art_111).toBe(true);
    expect(at170001.results[0]!.effective_anchor_date).toBe("2026-07-06");
    expect(at170001.results[0]!.effective_date).toBe("2026-08-05");
    expect(at170001.gardes.map((g) => g.code)).toContain("NOTIFICATION_TECHNOLOGIQUE_APRES_17H");

    const after17 = computeDeadlines({
      event_date: "2026-07-03",
      event_time: "17:40",
      notification_mode: "technological",
      deadlines: [{ label: "Après 17h00", amount: 30, unit: "days" }],
    });
    expect(after17.results[0]!.anchor_shifted_art_111).toBe(true);
    expect(after17.results[0]!.effective_anchor_date).toBe("2026-07-06");
    expect(after17.results[0]!.effective_date).toBe("2026-08-05");
    expect(after17.gardes.map((g) => g.code)).toContain("NOTIFICATION_TECHNOLOGIQUE_APRES_17H");

    const onHolidayMorning = computeDeadlines({
      event_date: "2026-06-24",
      event_time: "10:00",
      notification_mode: "technological",
      deadlines: [{ amount: 15, unit: "days" }],
    });
    expect(onHolidayMorning.results[0]!.anchor_shifted_art_111).toBe(true);
    expect(onHolidayMorning.results[0]!.effective_anchor_date).toBe("2026-06-25");
  });

  it("gère le quantième mensuel (28/29 février) et les mois + report samedi/dimanche", () => {
    const out = computeDeadlines({
      event_date: "2024-01-31",
      regime: "qc_cpc",
      deadlines: [
        { label: "Bissextile +1 mois", amount: 1, unit: "months" },
        {
          label: "2026-01-31 +1 mois (samedi 28 -> lundi 2 mars)",
          amount: 1,
          unit: "months",
          anchor_date: "2026-01-31",
        },
      ],
    });
    expect(out.results[0]!.effective_date).toBe("2024-02-29");
    expect(out.results[1]!.raw_date).toBe("2026-02-28");
    expect(out.results[1]!.effective_date).toBe("2026-03-02");
  });

  it("calcule les délais à rebours en reculant au jour ouvrable précédent et émet le garde approprié", () => {
    const out = ComputeDeadlinesOutputSchema.parse(
      computeDeadlines({
        event_date: "2026-05-11",
        regime: "qc_cpc",
        deadlines: [
          { label: "10j ouvrables avant", amount: 10, unit: "days", direction: "backward" },
          {
            label: "9j tombe samedi -> recule vendredi",
            amount: 9,
            unit: "days",
            direction: "backward",
          },
          {
            label: "3j tombe 25 déc. sur audience 28 déc.",
            amount: 3,
            unit: "days",
            direction: "backward",
            anchor_date: "2026-12-28",
          },
        ],
      }),
    );

    expect(out.results[0]!.raw_date).toBe("2026-05-01");
    expect(out.results[0]!.preceding_business_day).toBe("2026-05-01");
    expect(out.results[0]!.rolled_over).toBe(false);

    expect(out.results[1]!.raw_date).toBe("2026-05-02");
    expect(out.results[1]!.preceding_business_day).toBe("2026-05-01");
    expect(out.results[1]!.effective_date).toBe("2026-05-01");
    expect(out.results[1]!.rolled_over).toBe(true);

    expect(out.results[2]!.raw_date).toBe("2026-12-25");
    expect(out.results[2]!.preceding_business_day).toBe("2026-12-24");
    expect(out.gardes.map((g) => g.code)).toContain("DELAI_A_REBOURS_VERIFIER_TEXTE");
    expect(out.gardes.map((g) => g.code)).toContain("JOUR_NON_SEANCE_ART_82_AL_2");
  });

  it("chaîne les étapes par depends_on_index et n'applique pas le report du samedi par défaut sous qc_li", () => {
    const out = computeDeadlines({
      event_date: "2026-06-15",
      regime: "qc_li",
      deadlines: [
        { label: "Étape 1 (tombe samedi 27 juin)", amount: 12, unit: "days" },
        {
          label: "Étape 2 (+15 jours depuis étape 1)",
          amount: 15,
          unit: "days",
          depends_on_index: 0,
        },
      ],
    });
    expect(out.results[0]!.effective_date).toBe("2026-06-27");
    expect(out.results[0]!.rolled_over).toBe(false);
    expect(out.results[1]!.raw_date).toBe("2026-07-12");
    expect(out.results[1]!.effective_date).toBe("2026-07-13");

    const outBpd = computeDeadlines({
      event_date: "2026-06-15",
      regime: "qc_li",
      rollover_saturday: true,
      deadlines: [{ label: "Publicité des droits", amount: 12, unit: "days" }],
    });
    expect(outBpd.results[0]!.effective_date).toBe("2026-06-29");
    expect(outBpd.results[0]!.rollover_hops[0]!.reason).toContain("art. 52 al. 2 L.I. QC");
  });

  it("gère qc_prescription (report du samedi selon art. 2879 al. 2 C.c.Q., sans 2 janv. ni 26 déc.)", () => {
    const out = ComputeDeadlinesOutputSchema.parse(
      computeDeadlines({
        event_date: "2023-06-27",
        regime: "qc_prescription",
        deadlines: [{ label: "Prescription 3 ans (tombe samedi)", amount: 3, unit: "years" }],
      }),
    );
    expect(out.results[0]!.raw_date).toBe("2026-06-27");
    expect(out.results[0]!.effective_date).toBe("2026-06-29");
    expect(out.results[0]!.rolled_over).toBe(true);
    expect(out.results[0]!.rollover_hops[0]!.reason).toBe("samedi (art. 2879 al. 2 C.c.Q.)");

    const jan2 = computeDeadlines({
      event_date: "2023-12-23",
      regime: "qc_prescription",
      deadlines: [{ label: "2 janvier ouvrable", amount: 10, unit: "days" }],
    });
    expect(jan2.results[0]!.effective_date).toBe("2024-01-02");
  });

  it("reporte le 24 juin sous ca_li uniquement lorsque province='QC'", () => {
    const caQc = ComputeDeadlinesOutputSchema.parse(
      computeDeadlines({
        event_date: "2026-06-14",
        regime: "ca_li",
        province: "QC",
        deadlines: [{ label: "Échéance le 24 juin (CA/QC)", amount: 10, unit: "days" }],
      }),
    );
    expect(caQc.province).toBe("QC");
    expect(caQc.results[0]!.raw_date).toBe("2026-06-24");
    expect(caQc.results[0]!.effective_date).toBe("2026-06-25");
    expect(caQc.results[0]!.rolled_over).toBe(true);

    const caOn = ComputeDeadlinesOutputSchema.parse(
      computeDeadlines({
        event_date: "2026-06-14",
        regime: "ca_li",
        province: "ON",
        deadlines: [{ label: "Échéance le 24 juin (CA/ON)", amount: 10, unit: "days" }],
      }),
    );
    expect(caOn.results[0]!.effective_date).toBe("2026-06-24");
    expect(caOn.results[0]!.rolled_over).toBe(false);
  });

  it("rejette les dates calendaires impossibles (p. ex. 29 février non bissextile)", () => {
    expect(() =>
      computeDeadlines({
        event_date: "2025-02-29",
        deadlines: [{ amount: 10, unit: "days" }],
      }),
    ).toThrow(/Jour invalide/);
  });

  it("B-N12 & B-N14 : ca_li ne reporte pas le samedi par défaut (art. 26 L.I. CA) et refuse depends_on_index à l'étape 0", () => {
    const satDefault = ComputeDeadlinesOutputSchema.parse(
      computeDeadlines({
        event_date: "2026-06-13",
        regime: "ca_li",
        deadlines: [{ label: "Échéance samedi CA", amount: 7, unit: "days" }],
      }),
    );
    expect(satDefault.results[0]!.raw_date).toBe("2026-06-20");
    expect(satDefault.results[0]!.effective_date).toBe("2026-06-20");
    expect(satDefault.results[0]!.rolled_over).toBe(false);
    expect(satDefault.gardes.map((g) => g.code)).toContain("SAMEDI_CONGE_LOI_INTERPRETATION_CA");

    const satExplicit = ComputeDeadlinesOutputSchema.parse(
      computeDeadlines({
        event_date: "2026-06-13",
        regime: "ca_li",
        rollover_saturday: true,
        deadlines: [{ label: "Échéance samedi CA forcé", amount: 7, unit: "days" }],
      }),
    );
    expect(satExplicit.results[0]!.effective_date).toBe("2026-06-22");
    expect(satExplicit.results[0]!.rolled_over).toBe(true);

    const techNoTime = ComputeDeadlinesOutputSchema.parse(
      computeDeadlines({
        event_date: "2026-05-04",
        notification_mode: "technological",
        deadlines: [{ amount: 15, unit: "days" }],
      }),
    );
    expect(techNoTime.results[0]!.effective_date).toBe("2026-05-19");
    expect(techNoTime.gardes.map((g) => g.code)).toContain("NOTIFICATION_TECHNOLOGIQUE_SANS_HEURE");

    expect(() =>
      computeDeadlines({
        event_date: "2026-06-01",
        deadlines: [{ amount: 10, unit: "days", depends_on_index: 0 }],
      }),
    ).toThrow(/ne peut pas être utilisé sur la première étape/);
  });
});
