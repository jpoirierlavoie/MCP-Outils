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

    // Difference sur le 2 janvier en semaine (mardi 2024-01-02) : férié en qc_cpc, ouvrable en qc_li
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
      event_date: "2026-07-03", // vendredi avant 17h
      event_time: "16:59",
      notification_mode: "technological",
      deadlines: [{ label: "Avant 17h00", amount: 30, unit: "days" }],
    });
    expect(before17.results[0]!.anchor_shifted_art_111).toBe(false);
    expect(before17.results[0]!.effective_anchor_date).toBe("2026-07-03");
    expect(before17.results[0]!.effective_date).toBe("2026-08-03"); // 2 août dimanche -> lundi 3 août

    // 17:00 sans secondes sur jour ouvrable -> NE bascule PAS, émet la garde de seconde exacte
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

    // 17:00:00 avec secondes explicites -> NE bascule PAS
    const atExact17Sec = computeDeadlines({
      event_date: "2026-07-03",
      event_time: "17:00:00",
      notification_mode: "technological",
      deadlines: [{ label: "Exact 17h00:00", amount: 30, unit: "days" }],
    });
    expect(atExact17Sec.results[0]!.anchor_shifted_art_111).toBe(false);
    expect(atExact17Sec.results[0]!.effective_anchor_date).toBe("2026-07-03");

    // 17:00:01 avec secondes explicites -> BASCULE au lundi 2026-07-06
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
      event_date: "2026-07-03", // vendredi 17:40 -> réputé lundi 2026-07-06
      event_time: "17:40",
      notification_mode: "technological",
      deadlines: [{ label: "Après 17h00", amount: 30, unit: "days" }],
    });
    expect(after17.results[0]!.anchor_shifted_art_111).toBe(true);
    expect(after17.results[0]!.effective_anchor_date).toBe("2026-07-06");
    expect(after17.results[0]!.effective_date).toBe("2026-08-05");
    expect(after17.gardes.map((g) => g.code)).toContain("NOTIFICATION_TECHNOLOGIQUE_APRES_17H");

    const onHolidayMorning = computeDeadlines({
      event_date: "2026-06-24", // mercredi férié à 10:00
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
        event_date: "2026-05-11", // lundi
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

    expect(out.results[1]!.raw_date).toBe("2026-05-02"); // samedi
    expect(out.results[1]!.preceding_business_day).toBe("2026-05-01"); // vendredi
    expect(out.results[1]!.effective_date).toBe("2026-05-01");
    expect(out.results[1]!.rolled_over).toBe(true);

    expect(out.results[2]!.raw_date).toBe("2026-12-25");
    expect(out.results[2]!.preceding_business_day).toBe("2026-12-24");
    expect(out.gardes.map((g) => g.code)).toContain("DELAI_A_REBOURS_VERIFIER_TEXTE");
    expect(out.gardes.map((g) => g.code)).toContain("JOUR_NON_SEANCE_ART_82_AL_2");
  });

  it("chaîne les étapes par depends_on_index et respecte rollover_saturday=false sous qc_li", () => {
    const out = computeDeadlines({
      event_date: "2026-06-15",
      regime: "qc_li",
      rollover_saturday: false,
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
    expect(out.results[1]!.raw_date).toBe("2026-07-12");
    expect(out.results[1]!.effective_date).toBe("2026-07-13");
  });

  it("rejette les dates calendaires impossibles (p. ex. 29 février non bissextile)", () => {
    expect(() =>
      computeDeadlines({
        event_date: "2025-02-29",
        deadlines: [{ amount: 10, unit: "days" }],
      }),
    ).toThrow(/Jour invalide/);
  });
});
