import { describe, expect, it } from "vitest";
import { GARDE_CODES, makeGarde } from "../src/core/gardes.js";
import worker from "../src/index.js";
import { createSqliteD1Harness } from "./helpers/sqliteD1.js";

const dummyCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

describe("Socle D1 en lecture seule (node:sqlite DatabaseSync)", () => {
  it("exécute SELECT, bind, first, batch et FTS5 (unicode61 + trigram) et bloque toute écriture", async () => {
    const harness = createSqliteD1Harness({
      seedSql: `
        CREATE TABLE items (
          id INTEGER PRIMARY KEY,
          term_fr TEXT NOT NULL,
          term_en TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE items_fts USING fts5(
          term_fr,
          term_en,
          tokenize='unicode61 remove_diacritics 2'
        );
        CREATE VIRTUAL TABLE odonymes_trigram USING fts5(
          nom,
          tokenize='trigram'
        );
        INSERT INTO items (id, term_fr, term_en) VALUES
          (1, 'hypothèque', 'hypothec'),
          (2, 'cautionnement', 'suretyship');
        INSERT INTO items_fts (rowid, term_fr, term_en) VALUES
          (1, 'hypothèque', 'hypothec'),
          (2, 'cautionnement', 'suretyship');
        INSERT INTO odonymes_trigram (rowid, nom) VALUES
          (10, 'notre dame');
      `,
      enforceQueryOnly: true,
    });

    try {
      const allRes = await harness.d1
        .prepare(
          "SELECT i.id, i.term_fr, i.term_en FROM items_fts f JOIN items i ON i.id = f.rowid WHERE items_fts MATCH ?",
        )
        .bind("hypotheque")
        .all<{ id: number; term_fr: string; term_en: string }>();
      expect(allRes.success).toBe(true);
      expect(allRes.results).toEqual([{ id: 1, term_fr: "hypothèque", term_en: "hypothec" }]);
      expect(Object.getPrototypeOf(allRes.results[0])).toBe(Object.prototype);

      const firstCol = await harness.d1
        .prepare("SELECT term_en FROM items WHERE id = ?")
        .bind(2)
        .first<string>("term_en");
      expect(firstCol).toBe("suretyship");

      const trigramRes = await harness.d1
        .prepare("SELECT rowid, nom FROM odonymes_trigram WHERE odonymes_trigram MATCH ?")
        .bind("notr")
        .all<{ rowid: number; nom: string }>();
      expect(trigramRes.results).toEqual([{ rowid: 10, nom: "notre dame" }]);

      const batchRes = await harness.d1.batch([
        harness.d1.prepare("SELECT COUNT(*) AS c FROM items"),
        harness.d1.prepare("SELECT term_fr FROM items WHERE id = ?").bind(1),
      ]);
      expect(batchRes).toHaveLength(2);
      expect(batchRes[0]!.results).toEqual([{ c: 2 }]);

      // Toute tentative d'écriture doit échouer grâce à PRAGMA query_only = ON
      await expect(
        harness.d1.prepare("INSERT INTO items (id, term_fr, term_en) VALUES (3, 'a', 'b')").run(),
      ).rejects.toThrow(/readonly|attempt to write/i);
    } finally {
      harness.close();
    }
  });

  it("expose l'état booléen des 4 bindings D1 sur GET /healthz et couvre les nouvelles gardes", async () => {
    const hEmpty = await worker.fetch(
      new Request("https://outils.poirierlavoie.ca/healthz"),
      {},
      dummyCtx,
    );
    const jEmpty = (await hEmpty.json()) as { databases: Record<string, boolean> };
    expect(jEmpty.databases).toEqual({
      terminologie: false,
      registres: false,
      adresses: false,
      economie: false,
    });

    const harness = createSqliteD1Harness();
    try {
      const hBound = await worker.fetch(
        new Request("https://outils.poirierlavoie.ca/healthz"),
        { DB_TERMINOLOGIE: harness.d1 },
        dummyCtx,
      );
      const jBound = (await hBound.json()) as { databases: Record<string, boolean> };
      expect(jBound.databases).toEqual({
        terminologie: true,
        registres: false,
        adresses: false,
        economie: false,
      });
    } finally {
      harness.close();
    }

    expect(GARDE_CODES).toContain("REGISTRE_ABSENCE_PERSONNES_PHYSIQUES");
    expect(GARDE_CODES).toContain("ADRESSE_LOT_ET_MATRICULE_SANS_VALEUR_LEGALE");
    expect(GARDE_CODES).toContain("TERMINOLOGIE_AIDE_REDACTION_NON_NORMATIVE");
    expect(GARDE_CODES).toContain("TAUX_BOC_PRIME_DATE_MANQUANTE");
    expect(GARDE_CODES).toContain("TAUX_BOC_CONVERSION_LOI_MONNAIE");
    const g = makeGarde("LICENCE_DONNEES_OUVERTES_NC_SA");
    expect(g.message).toContain("CC BY-NC-SA 4.0");
  });
});
