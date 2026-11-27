import { describe, expect, it } from "vitest";

import { analyserNumeroDossier } from "../src/qc/dossier.js";

describe("numéro judiciaire bien formé", () => {
  it("résout le greffe ET la juridiction", () => {
    const r = analyserNumeroDossier("500-05-123456-241");
    expect(r.greffe_number).toBe("500");
    expect(r.juridiction_number).toBe("05");
    expect(r.greffe?.palais_de_justice).toBe("Montréal");
    expect(r.greffe?.district_judiciaire).toBe("Montréal");
    expect(r.juridiction?.tribunal).toBe("Cour supérieure");
    expect(r.juridiction?.competence).toBe("Division générale");
    expect(r.juridiction?.greffe_type).toBe("GC");
    expect(r.is_administrative).toBe(false);
    expect(r.parse_error).toBeNull();
  });

  it("n'exige PAS les segments de séquence et de contrôle", () => {
    const r = analyserNumeroDossier("500-05");
    expect(r.parse_error).toBeNull();
    expect(r.greffe?.district_judiciaire).toBe("Montréal");
  });

  it("n'analyse ni ne valide les positions 7 et suivantes", () => {
    const r = analyserNumeroDossier("500-05-zzzzzz-!!!");
    expect(r.parse_error).toBeNull();
    expect(r.greffe_number).toBe("500");
  });
});

describe("préfixe alphabétique — le préfixe EST le tribunal", () => {
  it("TAL résout son tribunal, sans erreur", () => {
    const r = analyserNumeroDossier("TAL-594531");
    expect(r.forum?.name).toBe("Tribunal administratif du logement");
    expect(r.is_administrative).toBe(true);
    expect(r.parse_error).toBeNull();
    expect(r.greffe_number).toBeNull();
  });

  it("une cour fédérale N'EST PAS un tribunal administratif", () => {
    for (const n of ["C.F.-T-1234-26", "CF-T-1234-26"]) {
      const r = analyserNumeroDossier(n);
      expect(r.forum?.name, n).toBe("Cour fédérale");
      expect(r.is_administrative, n).toBe(false);
      expect(r.parse_error, n).toBeNull();
    }
  });

  it("un préfixe INCONNU reste prudent : jamais d'erreur, jamais de nom deviné", () => {
    const r = analyserNumeroDossier("XYZ-9999");
    expect(r.is_administrative).toBe(true);
    expect(r.forum).toBeNull();
    expect(r.parse_error).toBeNull();
  });

  it("un préfixe alphabétique n'est JAMAIS une erreur de format", () => {
    const r = analyserNumeroDossier("n'importe quoi");
    expect(r.parse_error).toBeNull();
    expect(r.is_administrative).toBe(true);
  });
});

describe("entrées refusées", () => {
  it("vide ou blanche", () => {
    for (const n of ["", "   "]) {
      expect(analyserNumeroDossier(n).parse_error).toBe("Numéro de dossier judiciaire requis.");
    }
  });

  it("sans tiret", () => {
    const r = analyserNumeroDossier("500");
    expect(r.parse_error).toContain("Format invalide");
    expect(r.parse_error).toContain("NNN-NN-NNNNNN-NNN");
    expect(r.parse_error).not.toMatch(/NNN-NN-NNNNNN-NN$/);
  });

  it("greffe qui n'a pas 3 chiffres", () => {
    expect(analyserNumeroDossier("50-05-123456").parse_error).toBe(
      "Le numéro de greffe « 50 » doit être composé de 3 chiffres.",
    );
  });

  it("juridiction qui n'a pas 2 chiffres", () => {
    expect(analyserNumeroDossier("500-5-123456").parse_error).toBe(
      "Le numéro de juridiction « 5 » doit être composé de 2 chiffres.",
    );
  });

  it("les espaces internes ne sont PAS tolérés", () => {
    expect(analyserNumeroDossier("500 - 05 - 123456").parse_error).toContain("greffe");
  });

  it("mais les espaces de bordure le sont", () => {
    expect(analyserNumeroDossier("  500-05-123456-241  ").greffe_number).toBe("500");
  });
});

describe("codes inconnus — on nomme, on ne devine pas", () => {
  it("greffe absent : le numéro est tout de même renseigné", () => {
    const r = analyserNumeroDossier("999-05-123456");
    expect(r.greffe_number).toBe("999");
    expect(r.greffe).toBeNull();
    expect(r.juridiction?.tribunal).toBe("Cour supérieure");
    expect(r.parse_error).toBe("Greffe « 999 » introuvable dans les données de référence.");
  });

  it("juridiction absente : idem", () => {
    const r = analyserNumeroDossier("500-99-123456");
    expect(r.juridiction_number).toBe("99");
    expect(r.juridiction).toBeNull();
    expect(r.greffe?.palais_de_justice).toBe("Montréal");
    expect(r.parse_error).toBe("Juridiction « 99 » introuvable dans les données de référence.");
  });

  it("les deux absents : DEUX messages, séparés par une seule espace", () => {
    const r = analyserNumeroDossier("999-99-123456");
    expect(r.parse_error).toBe(
      "Greffe « 999 » introuvable dans les données de référence. " +
        "Juridiction « 99 » introuvable dans les données de référence.",
    );
  });
});

describe("greffes particuliers", () => {
  it("un greffe itinérant s'analyse, sans adresse", () => {
    const r = analyserNumeroDossier("614-05-123456");
    expect(r.greffe?.palais_de_justice).toBe("Chisasibi");
    expect(r.greffe?.point_de_service).toBe(true);
    expect(r.greffe?.palais_key).toBeNull();
    expect(r.parse_error).toBeNull();
  });

  it("le tiret cadratin de la juridiction 46 remonte tel quel", () => {
    expect(analyserNumeroDossier("500-46-1").juridiction?.tribunal).toBe("—");
  });

  it("émet parse_warning sur un numéro judiciaire incomplet ('500-17-12') sans bloquer l'analyse ni le numéro complet", () => {
    const incomplete = analyserNumeroDossier("500-17-12");
    expect(incomplete.parse_error).toBeNull();
    expect(incomplete.greffe_number).toBe("500");
    expect(incomplete.juridiction_number).toBe("17");
    expect(incomplete.parse_warning).toContain("NNN-NN-NNNNNN-NNN");

    const complet = analyserNumeroDossier("500-05-123456-241");
    expect(complet.parse_error).toBeNull();
    expect(complet.parse_warning).toBeNull();
  });

  it("A-N9 & B-N7 : normalise les tirets typographiques (en-dash) avec parse_warning mais refuse toujours les espaces internes", () => {
    const enDash = analyserNumeroDossier("500\u201305\u2013123456\u2013241");
    expect(enDash.parse_error).toBeNull();
    expect(enDash.greffe_number).toBe("500");
    expect(enDash.juridiction_number).toBe("05");
    expect(enDash.parse_warning).toContain("Tiret(s) typographique(s) normalisé(s)");

    const spaced = analyserNumeroDossier("500 17 123456 241");
    expect(spaced.parse_error).not.toBeNull();
  });
});
