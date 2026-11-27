import { fold } from "./format.js";
import { FORUMS, type Forum } from "./forums.js";
import { GREFFES, type Greffe } from "./greffes.js";
import { JURIDICTIONS, type Juridiction } from "./juridictions.js";
import { LIEUX_PAR_GREFFE, type LieuMjq } from "./lieux.js";
import { PALAIS, type Palais, type TypeLieu } from "./palais.js";

export function getGreffe(numero: string): Greffe | null {
  return GREFFES[numero] ?? null;
}

export function getJuridiction(numero: string): Juridiction | null {
  return JURIDICTIONS[numero] ?? null;
}

export function getForum(clef: string): Forum | null {
  return FORUMS[clef] ?? null;
}

function lieuxDuGreffe(numero: string): readonly LieuMjq[] {
  return LIEUX_PAR_GREFFE[numero] ?? [];
}

export function localitesItinerantes(numero: string): string[] {
  const chef = GREFFES[numero]?.palais_de_justice;
  return lieuxDuGreffe(numero)
    .filter((l) => l.itinerant && l.nom !== chef)
    .map((l) => l.nom);
}

export function siegeFixe(numero: string): { clef: string; palais: Palais } | null {
  for (const lieu of lieuxDuGreffe(numero)) {
    if (lieu.itinerant) continue;
    for (const [clef, palais] of Object.entries(PALAIS)) {
      if (palais.name === lieu.nom) return { clef, palais };
    }
  }
  return null;
}

export function adresseDuGreffe(numero: string): Palais | null {
  const g = GREFFES[numero];
  if (!g) return null;
  if (g.palais_key) return PALAIS[g.palais_key] ?? null;

  return siegeFixe(numero)?.palais ?? null;
}

export function listerDistricts(): string[] {
  const vus = new Set<string>();
  for (const g of Object.values(GREFFES)) vus.add(g.district_judiciaire);
  return [...vus].sort((a, b) => a.localeCompare(b, "fr"));
}

interface FiltrePalais {
  district?: string | undefined;

  query?: string | undefined;
  type?: TypeLieu | undefined;
}

export interface PalaisResolu {
  readonly clef: string;
  readonly palais: Palais;
  readonly greffes: ReadonlyArray<{ numero: string; greffe: Greffe }>;
}

export function greffesDuPalais(clef: string): Array<{ numero: string; greffe: Greffe }> {
  const nom = PALAIS[clef]?.name;
  return Object.entries(GREFFES)
    .filter(([numero, g]) => {
      if (g.palais_key === clef) return true;

      return nom !== undefined && lieuxDuGreffe(numero).some((l) => l.nom === nom);
    })
    .map(([numero, greffe]) => ({ numero, greffe }))
    .sort((a, b) => a.numero.localeCompare(b.numero));
}

export function resoudrePalais(clef: string): PalaisResolu | null {
  const direct = PALAIS[clef];
  if (direct) return { clef, palais: direct, greffes: greffesDuPalais(clef) };

  const cible = fold(clef);
  if (!cible) return null;
  const exactMatches = Object.entries(PALAIS).filter(
    ([k, p]) => fold(k) === cible || fold(p.name) === cible,
  );
  if (exactMatches.length === 1) {
    const [matchedKey, matchedPalais] = exactMatches[0]!;
    return { clef: matchedKey, palais: matchedPalais, greffes: greffesDuPalais(matchedKey) };
  }
  return null;
}

export function listerPalais(filtre: FiltrePalais = {}): PalaisResolu[] {
  const district = filtre.district ? fold(filtre.district) : null;
  const query = filtre.query ? fold(filtre.query) : null;

  const sortie: PalaisResolu[] = [];
  for (const [clef, palais] of Object.entries(PALAIS)) {
    if (filtre.type && palais.location_type !== filtre.type) continue;
    const greffes = greffesDuPalais(clef);

    if (district) {
      const appariable = greffes.some((g) => fold(g.greffe.district_judiciaire) === district);
      if (!appariable) continue;
    }
    if (query) {
      const champs = [
        palais.name,
        palais.city,
        ...greffes.map((g) => g.greffe.district_judiciaire),
        ...greffes.map((g) => g.numero),
      ];
      if (!champs.some((c) => fold(c).includes(query))) continue;
    }
    sortie.push({ clef, palais, greffes });
  }
  return sortie.sort((a, b) => a.palais.name.localeCompare(b.palais.name, "fr"));
}

export function palaisOrphelins(): string[] {
  return Object.keys(PALAIS)
    .filter((clef) => greffesDuPalais(clef).length === 0)
    .sort();
}
