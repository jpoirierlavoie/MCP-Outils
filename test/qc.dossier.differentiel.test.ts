import { describe, expect, it } from "vitest";

import { analyserNumeroDossier } from "../src/qc/dossier.js";
import cas from "./fixtures/dossier-athena.json" with { type: "json" };

function aplatir(entree: string) {
  const r = analyserNumeroDossier(entree);
  return {
    greffe_number: r.greffe_number,
    juridiction_number: r.juridiction_number,
    palais_de_justice: r.greffe?.palais_de_justice ?? null,
    district_judiciaire: r.greffe?.district_judiciaire ?? null,
    point_de_service: r.greffe?.point_de_service ?? null,
    tribunal: r.juridiction?.tribunal || r.forum?.name || null,
    competence: r.juridiction?.competence ?? null,
    greffe_type: r.juridiction?.greffe_type ?? null,
    is_administrative: r.is_administrative,
    parse_error: r.parse_error,
  };
}

describe("port fidèle du parseur d'Athéna", () => {
  it("couvre les 27 juridictions, les 57 greffes et les préfixes de forum", () => {
    expect(cas.length).toBeGreaterThanOrEqual(127);
  });

  for (const { entree, attendu } of cas) {
    it(`concorde sur « ${entree} »`, () => {
      expect(aplatir(entree)).toEqual(attendu);
    });
  }
});
