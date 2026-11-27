#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { argv } from "node:process";

const source = argv[2];
if (!source) {
  console.error("usage : node scripts/extraire-lieux-mjq.mjs <page.html>");
  process.exit(2);
}

const html = readFileSync(source, "utf8");

const dechiffrer = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/[\s ]+/g, " ")
    .trim();

const tableau = html.match(/<table[\s\S]*?<\/table>/i);
if (!tableau) {
  console.error("Aucun <table> dans cette page : est-ce bien la bonne ?");
  process.exit(2);
}

const lignes = [...tableau[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].slice(1);
const parGreffe = new Map();
let lus = 0;

for (const [, ligne] of lignes) {
  const cases = [...ligne.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
    dechiffrer(m[1]),
  );
  if (cases.length < 3) continue;
  const [nomBrut, numBrut] = cases;
  const numero = numBrut.match(/\d{3}/)?.[0];
  if (!numero) continue;

  const itinerant = nomBrut.includes("*");
  const nom = nomBrut.replace(/\*/g, "").trim();
  if (!parGreffe.has(numero)) parGreffe.set(numero, []);
  parGreffe.get(numero).push({ nom, itinerant });
  lus++;
}

const maj = dechiffrer(html).match(/Derni[^:]*jour\s*:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? "?";
if (maj === "?") {
  console.error("⚠ Date de mise à jour introuvable sur la page — à reporter à la main.");
}

const q = (v) => JSON.stringify(v);
const corps = [...parGreffe.keys()]
  .sort()
  .map(
    (n) =>
      `  ${q(n)}: [` +
      parGreffe
        .get(n)
        .map((l) => `{ nom: ${q(l.nom)}, itinerant: ${l.itinerant} }`)
        .join(", ") +
      `],`,
  )
  .join("\n");

const sortie = `export interface LieuMjq {
  readonly nom: string;
  readonly itinerant: boolean;
}

export const MJQ_MAJ = ${q(maj)};

export const LIEUX_PAR_GREFFE: Readonly<Record<string, readonly LieuMjq[]>> = {
${corps}
};
`;

writeFileSync("src/qc/lieux.ts", sortie, "utf8");

console.log(`src/qc/lieux.ts régénéré.`);
console.log(`  ${parGreffe.size} greffes · ${lus} lieux · mise à jour du ${maj}`);
console.log("");
console.log("Relire le diff : ce script n'écrit QUE lieux.ts. Tout écart avec");
console.log("src/qc/greffes.ts se reporte à la main, après lecture — jamais en série.");
