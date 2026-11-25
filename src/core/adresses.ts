import { z } from "zod";
import { GREFFES } from "../qc/greffes.js";
import { LIEUX_PAR_GREFFE, MJQ_MAJ } from "../qc/lieux.js";
import { PALAIS } from "../qc/palais.js";
import { type Garde, GardeSchema, makeGarde, ProvenanceSchema } from "./gardes.js";

// ── Normalisation phonétique/orthographique québécoise ───────────────────────

export function foldAddressToken(raw: string): string {
  return raw
    .replace(/Œ/g, "OE")
    .replace(/œ/g, "oe")
    .replace(/Æ/g, "AE")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u02bc']/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function computeConsonantKey(raw: string): string {
  const folded = foldAddressToken(raw).replace(/\s+/g, "");
  // Conserver les chiffres (p. ex. 1re, 3e avenue) et les consonnes sans répétition consécutive
  const rawConsonants = folded.replace(/[aeiouy]/g, "");
  let out = "";
  for (const ch of rawConsonants) {
    if (out[out.length - 1] !== ch) {
      out += ch;
    }
  }
  return out || folded;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

// ── Table des abréviations municipales et anciennes villes fusionnées du Québec ──

const MUNICIPALITY_ALIASES: Readonly<Record<string, string>> = {
  mtl: "Montréal",
  mtrl: "Montréal",
  "montreal nord": "Montréal",
  "ville marie": "Montréal",
  "saint laurent": "Montréal",
  "st laurent": "Montréal",
  verdun: "Montréal",
  lasalle: "Montréal",
  lachine: "Montréal",
  anjou: "Montréal",
  outremont: "Montréal",
  "saint leonard": "Montréal",
  "st leonard": "Montréal",
  pierrefonds: "Montréal",
  roxboro: "Montréal",
  "pointe aux trembles": "Montréal",
  "riviere des prairies": "Montréal",
  rosemont: "Montréal",
  villeray: "Montréal",
  ahuntsic: "Montréal",
  "cote des neiges": "Montréal",
  "notre dame de grace": "Montréal",
  ndg: "Montréal",
  qc: "Québec",
  "ville de quebec": "Québec",
  "sainte foy": "Québec",
  "ste foy": "Québec",
  beauport: "Québec",
  charlesbourg: "Québec",
  sillery: "Québec",
  "cap rouge": "Québec",
  loretteville: "Québec",
  "val belair": "Québec",
  vanier: "Québec",
  limoilou: "Québec",
  chomedey: "Laval",
  vimont: "Laval",
  duvernay: "Laval",
  fabreville: "Laval",
  auteuil: "Laval",
  "pont viau": "Laval",
  "sainte dorothee": "Laval",
  "ste dorothee": "Laval",
  "sainte rose": "Laval",
  "ste rose": "Laval",
  "laval des rapides": "Laval",
  "saint hubert": "Longueuil",
  "st hubert": "Longueuil",
  "greenfield park": "Longueuil",
  "vieux longueuil": "Longueuil",
  hull: "Gatineau",
  aylmer: "Gatineau",
  buckingham: "Gatineau",
  "masson angers": "Gatineau",
  chicoutimi: "Saguenay",
  jonquiere: "Saguenay",
  "la baie": "Saguenay",
  tr: "Trois-Rivières",
  "3 rivieres": "Trois-Rivières",
  "cap de la madeleine": "Trois-Rivières",
  "trois rivieres ouest": "Trois-Rivières",
  fleurimont: "Sherbrooke",
  lennoxville: "Sherbrooke",
  "rock forest": "Sherbrooke",
  "saint nicolas": "Lévis",
  "st nicolas": "Lévis",
  charny: "Lévis",
  lauzon: "Lévis",
  "saint romuald": "Lévis",
  "st romuald": "Lévis",
};

const GENERIC_MAP: Readonly<Record<string, string>> = {
  r: "rue",
  rue: "rue",
  street: "rue",
  boul: "boulevard",
  bd: "boulevard",
  blvd: "boulevard",
  boulevard: "boulevard",
  av: "avenue",
  ave: "avenue",
  avenue: "avenue",
  ch: "chemin",
  chem: "chemin",
  chemin: "chemin",
  rd: "chemin",
  road: "chemin",
  rte: "route",
  rt: "route",
  route: "route",
  rg: "rang",
  rang: "rang",
  pl: "place",
  place: "place",
  aut: "autoroute",
  autoroute: "autoroute",
  imp: "impasse",
  impasse: "impasse",
  allee: "allée",
  cote: "côte",
  montee: "montée",
  crois: "croissant",
  croissant: "croissant",
  carre: "carré",
  terr: "terrasse",
  terrasse: "terrasse",
  prom: "promenade",
  promenade: "promenade",
};

const CARDINAL_MAP: Readonly<Record<string, string>> = {
  e: "Est",
  est: "Est",
  east: "Est",
  o: "Ouest",
  w: "Ouest",
  ouest: "Ouest",
  west: "Ouest",
  n: "Nord",
  nord: "Nord",
  north: "Nord",
  s: "Sud",
  sud: "Sud",
  south: "Sud",
};

const PARTICLES = ["de la", "de l", "des", "du", "de", "d", "l", "a", "au", "aux"] as const;
const PARTICLE_SET = new Set<string>(PARTICLES);

const MAJOR_CITIES_WITHOUT_COMMA = new Set([
  "montreal",
  "quebec",
  "laval",
  "longueuil",
  "gatineau",
  "sherbrooke",
  "levis",
  "saguenay",
  "trois rivieres",
]);

function hasSubstantiveStreetTokens(words: string[], hasExplicitCivic: boolean): boolean {
  const work = [...words];
  if (!hasExplicitCivic && work.length > 0 && /^\d+(?:1\/2|[a-z])?$/i.test(work[0]!)) {
    work.shift();
    if (work[0] === "1/2") work.shift();
  }
  const substantive = work.filter((w) => {
    const f = foldAddressToken(w);
    if (!f) return false;
    if (GENERIC_MAP[f]) return false;
    if (CARDINAL_MAP[f]) return false;
    if (PARTICLE_SET.has(f)) return false;
    return true;
  });
  return substantive.length > 0;
}

function isGisStackingUnitType(raw: string | null | undefined): boolean {
  if (!raw) return true;
  const f = foldAddressToken(raw);
  return !f || f.startsWith("etalement ");
}

// ── Rattachement prudent au district judiciaire via `src/qc/lieux.ts` ────────

interface DistrictRattachement {
  district: string;
  greffes: string[];
  reserve: string;
}

const DISTRICT_RESERVE_MSG =
  `Rattachement purement indicatif par nom de municipalité au relevé MJQ des lieux de séance (lieux.ts, màj ${MJQ_MAJ}). ` +
  "Les limites exactes des districts judiciaires relèvent de la Loi sur la division territoriale (RLRQ, c. D-11) et certaines rues limitrophes ou municipalités périphériques peuvent relever d'un autre district.";

let cachedCityToDistrict: Map<string, { district: string; greffes: Set<string> }> | null = null;

function resolveProbableDistrict(nomMunicipalite: string): DistrictRattachement | null {
  if (!cachedCityToDistrict) {
    cachedCityToDistrict = new Map();
    const registerCity = (rawName: string, greffeNo: string) => {
      const g = GREFFES[greffeNo];
      if (!g) return;
      const baseName =
        rawName
          .split(" - ")[0]
          ?.replace(/\s*\([^)]*\)/g, "")
          .trim() ?? rawName;
      const key = foldAddressToken(baseName);
      if (!key) return;
      const existing = cachedCityToDistrict!.get(key);
      if (existing) {
        existing.greffes.add(greffeNo);
      } else {
        cachedCityToDistrict!.set(key, {
          district: g.district_judiciaire,
          greffes: new Set([greffeNo]),
        });
      }
    };

    for (const [numero, lieux] of Object.entries(LIEUX_PAR_GREFFE)) {
      for (const l of lieux) {
        registerCity(l.nom, numero);
      }
    }
    for (const [clef, palais] of Object.entries(PALAIS)) {
      for (const [numero, g] of Object.entries(GREFFES)) {
        if (g.palais_key === clef) {
          registerCity(palais.city, numero);
        }
      }
    }
  }

  const hit = cachedCityToDistrict.get(foldAddressToken(nomMunicipalite));
  if (!hit) return null;
  return {
    district: hit.district,
    greffes: Array.from(hit.greffes).sort(),
    reserve: DISTRICT_RESERVE_MSG,
  };
}

// ── Décomposition et normalisation d'une adresse québécoise ──────────────────

export interface ParsedQuebecAddress {
  civicNumber: number | null;
  civicSuffix: string;
  unitNumber: string;
  unitTypeLabel: string | null;
  generique: string | null;
  cardinal: string | null;
  rawStreetSpecific: string;
  specifiqueNorm: string;
  specifiqueWithParticleNorm: string;
  consonantKey: string;
  consonantKeyWithParticle: string;
  municipalityNorm: string | null;
  municipalityOriginal: string | null;
  postalCodeCompact: string | null;
  corrections: string[];
}

function stripQuebecProvinceFromMunicipality(rawMun: string): string {
  const withoutCanada = rawMun
    .trim()
    .replace(/,\s*canada\s*$/i, "")
    .trim();
  const stripped = withoutCanada
    .replace(/\(\s*(?:québec|quebec|qc)\s*\)\s*$/gi, "")
    .replace(/(?:,\s*(?:québec|quebec|qc)|\s+\bqc\b)\s*$/gi, "")
    .trim();
  return stripped || withoutCanada;
}

function normalizeMunicipalityInput(rawMun: string, corrections: string[]): string {
  const cleanedMun = stripQuebecProvinceFromMunicipality(rawMun);
  const munFolded = foldAddressToken(cleanedMun);
  const aliasTarget = MUNICIPALITY_ALIASES[munFolded];
  if (aliasTarget) {
    if (foldAddressToken(aliasTarget) !== munFolded) {
      corrections.push(
        `Municipalité ou arrondissement '${cleanedMun}' rattaché à '${aliasTarget}'`,
      );
    }
    return foldAddressToken(aliasTarget);
  }
  const expanded = expandSaintAbbreviations(cleanedMun, corrections);
  return foldAddressToken(expanded);
}

function expandSaintAbbreviations(text: string, corrections: string[]): string {
  let out = text;
  if (/\bste[-\s]+(?=[a-zà-ÿ])/i.test(out)) {
    out = out.replace(/\bste[-\s]+(?=[a-zà-ÿ])/gi, "Sainte-");
    corrections.push("Abréviation 'Ste' normalisée en 'Sainte-'");
  }
  if (/\bst[-\s]+(?=[a-zà-ÿ])/i.test(out)) {
    out = out.replace(/\bst[-\s]+(?=[a-zà-ÿ])/gi, "Saint-");
    corrections.push("Abréviation 'St' normalisée en 'Saint-'");
  }
  return out;
}

export function parseQuebecAddress(input: AdresseVerifyInput): ParsedQuebecAddress {
  const corrections: string[] = [];
  let freeLine = (input.address ?? "").trim();

  // 0) Virgule française après le numéro civique initial (p. ex. « 1, rue Notre-Dame Est », « 10-B, boul. Sainte-Anne »)
  if (freeLine && !input.civic_number && !input.street) {
    freeLine = freeLine.replace(
      /^\s*(\d+\s*(?:1\/2|-\s*[A-Za-z]|[A-Za-z])?)\s*,\s*(?=[A-Za-zÀ-ÿ0-9])/,
      "$1 ",
    );
  }

  // 1) Code postal
  let postalCompact: string | null = null;
  if (input.postal_code) {
    const m = /([A-Za-z]\d[A-Za-z])\s*-?\s*(\d[A-Za-z]\d)/.exec(input.postal_code);
    if (m) postalCompact = `${m[1]}${m[2]}`.toUpperCase();
  }
  if (freeLine) {
    freeLine = freeLine.replace(
      /\b([A-Za-z]\d[A-Za-z])\s*-?\s*(\d[A-Za-z]\d)\b/g,
      (_full, a: string, b: string) => {
        if (!postalCompact) postalCompact = `${a}${b}`.toUpperCase();
        return " ";
      },
    );
  }

  // 2) Unité (bureau, app., suite, local, # ou préfixe 200-1) et mention d'étage — avant retrait de la province
  let unitNumber = "";
  let unitTypeLabel: string | null = null;

  if (input.unit) {
    const um =
      /^\s*(bureau|bur\.?|suite|ste\.?|appartement|app\.?|apt\.?|unité|unite|local|loc\.?|salle|#)?\s*([A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)\s*$/i.exec(
        input.unit,
      );
    if (um) {
      unitTypeLabel = um[1] ? normalizeUnitLabel(um[1]) : "unité";
      unitNumber = um[2]!.toUpperCase();
    } else {
      unitNumber = input.unit.trim().toUpperCase();
      unitTypeLabel = "unité";
    }
  }

  if (freeLine) {
    const unitKwRe =
      /(?:,\s*|\s+)\b(bureau|bur\.?|suite|appartement|app\.?|apt\.?|unité|unite|local|loc\.?|salle)\s+([A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)\b/i;
    const kwMatch = unitKwRe.exec(freeLine);
    if (kwMatch) {
      if (!unitNumber) {
        unitTypeLabel = normalizeUnitLabel(kwMatch[1]!);
        unitNumber = kwMatch[2]!.toUpperCase();
      }
      freeLine = `${freeLine.slice(0, kwMatch.index)} ${freeLine.slice(kwMatch.index + kwMatch[0].length)}`;
    } else {
      const hashRe = /(?:,\s*|\s+)#\s*([A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)\b/;
      const hm = hashRe.exec(freeLine);
      if (hm) {
        if (!unitNumber) {
          unitTypeLabel = "unité";
          unitNumber = hm[1]!.toUpperCase();
        }
        freeLine = `${freeLine.slice(0, hm.index)} ${freeLine.slice(hm.index + hm[0].length)}`;
      }
    }

    // Retirer une indication d'étage (« 1er étage », « 20 ième étage », « rez-de-chaussée ») absente de la clé civique RQA
    const floorRe =
      /(?:,\s*|\s+)\b(\d+\s*(?:er|re|e|ère|ere|ième|ieme|ème|eme)\s+étage|\d+\s*(?:er|re|e|ère|ere|ième|ieme|ème|eme)\s+etage|étage\s+[A-Za-z0-9.-]+|etage\s+[A-Za-z0-9.-]+|rez-de-chaussée|rez-de-chaussee)(?=\s*,|\s|$)/iu;
    const flMatch = floorRe.exec(freeLine);
    if (flMatch) {
      corrections.push(
        `Indication d'étage '${flMatch[1]!.trim()}' non indexée individuellement au RQA`,
      );
      freeLine = `${freeLine.slice(0, flMatch.index)} ${freeLine.slice(flMatch.index + flMatch[0].length)}`;
    }

    // Format postal canadien « 200-1 rue Notre-Dame » -> unité 200, civique 1
    const prefixUnitRe = /^\s*(\d+[A-Za-z]?)\s*-\s*(\d+)\s*([A-Za-z]?)\b(?=\s+[A-Za-zÀ-ÿ])/;
    const pm = prefixUnitRe.exec(freeLine);
    if (pm && !input.civic_number) {
      if (!unitNumber) {
        unitNumber = pm[1]!.toUpperCase();
        unitTypeLabel = "unité";
      }
      freeLine = `${pm[2]}${pm[3] ?? ""} ${freeLine.slice(pm[0].length)}`;
    }

    // Retirer province entre parenthèses et pays final explicite
    freeLine = freeLine
      .replace(/\(\s*(?:québec|quebec|qc)\s*\)/gi, " ")
      .replace(/,\s*canada\s*$/i, " ")
      .replace(/(?:,\s*|\s+)\bqc\b\s*$/i, " ");
  }

  // 3) Séparation rue / municipalité
  let rawMun: string | null = input.municipality?.trim() ?? null;
  let streetWork = input.street?.trim() ?? "";

  if (!streetWork && freeLine) {
    const segments = freeLine
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Retirer un dernier segment résiduel « QC » / « Québec » s'il y a déjà une ville avant
    if (segments.length >= 3 && /^(?:qc|quebec|québec)$/i.test(segments[segments.length - 1]!)) {
      segments.pop();
    }

    if (!rawMun && segments.length >= 2) {
      rawMun = segments.pop()!;
      streetWork = segments.join(" ");
    } else {
      streetWork = segments.join(" ");
      // Si aucune virgule, détecter un alias municipal en fin de chaîne (p. ex. « 1 Notr-Dame E Mtl »)
      // uniquement s'il subsiste au moins un jeton d'odonyme spécifique avant la municipalité.
      if (!rawMun) {
        const words = streetWork.split(/\s+/);
        const hasExplicitCivic = Boolean(input.civic_number);
        if (words.length >= 3) {
          const last1 = foldAddressToken(words[words.length - 1]!);
          const last2 =
            words.length >= 4
              ? foldAddressToken(`${words[words.length - 2]} ${words[words.length - 1]}`)
              : "";
          if (
            last2 &&
            (MUNICIPALITY_ALIASES[last2] || MAJOR_CITIES_WITHOUT_COMMA.has(last2)) &&
            hasSubstantiveStreetTokens(words.slice(0, -2), hasExplicitCivic)
          ) {
            rawMun = `${words[words.length - 2]} ${words[words.length - 1]}`;
            streetWork = words.slice(0, -2).join(" ");
          } else if (
            (MUNICIPALITY_ALIASES[last1] || MAJOR_CITIES_WITHOUT_COMMA.has(last1)) &&
            hasSubstantiveStreetTokens(words.slice(0, -1), hasExplicitCivic)
          ) {
            rawMun = words[words.length - 1]!;
            streetWork = words.slice(0, -1).join(" ");
          }
        }
      }
    }
  }

  // Normalisation de la municipalité
  const municipalityNorm = rawMun ? normalizeMunicipalityInput(rawMun, corrections) : null;

  // 4) Numéro civique + suffixe
  let civicNumber: number | null = null;
  let civicSuffix = "";

  if (input.civic_number) {
    const cm = /^\s*(\d+)\s*(?:-\s*([A-Za-z])|(1\/2|[A-Za-z]))?\s*$/.exec(input.civic_number);
    if (cm) {
      civicNumber = Number.parseInt(cm[1]!, 10);
      civicSuffix = (cm[2] ?? cm[3] ?? "").toUpperCase();
    }
  } else if (streetWork) {
    const leadCivic =
      /^\s*(\d+)\s*(?:-\s*([A-Za-z])|(1\/2|re|er|ère|ere|ième|ieme|ème|eme|[A-Za-z]))?(?=\s|,|$)\s*,?\s*/iu.exec(
        streetWork,
      );
    if (leadCivic) {
      const rawLeadSuffix = leadCivic[2] ?? leadCivic[3] ?? "";
      const restAfter = streetWork.slice(leadCivic[0].length).trim();
      // Ne pas confondre un odonyme ordinal sans numéro civique (« 1re Avenue », « 3e Rue », « 4e Rang ») avec un numéro civique
      const restFirstFold = foldAddressToken(restAfter.split(/\s+/)[0] ?? "");
      const isOrdinalStreet =
        !leadCivic[2] &&
        Boolean(rawLeadSuffix) &&
        /^(?:re|er|e|ere|ère|iere|ière|eme|ème|ieme|ième)$/iu.test(rawLeadSuffix) &&
        Boolean(GENERIC_MAP[restFirstFold]);
      if (
        !isOrdinalStreet &&
        restAfter.length > 0 &&
        (!rawLeadSuffix || rawLeadSuffix === "1/2" || rawLeadSuffix.length === 1)
      ) {
        civicNumber = Number.parseInt(leadCivic[1]!, 10);
        civicSuffix = rawLeadSuffix.toUpperCase();
        streetWork = restAfter;
      }
    }
  }

  // 5) Décomposition de l'odonyme (générique, particule, spécifique, point cardinal)
  let cardinal: string | null = null;
  let generique: string | null = null;

  const cleanStreet = streetWork.replace(/[.,]+/g, " ").replace(/\s+/g, " ").trim();
  const stTokens = cleanStreet.split(" ").filter(Boolean);

  // Point cardinal final (p. ex. « E », « Est », « O », « Ouest »)
  if (stTokens.length >= 2) {
    const lastFold = foldAddressToken(stTokens[stTokens.length - 1]!);
    const mappedCard = CARDINAL_MAP[lastFold];
    if (mappedCard) {
      const rawLast = stTokens.pop()!;
      cardinal = mappedCard;
      if (rawLast.toLowerCase() !== mappedCard.toLowerCase()) {
        corrections.push(`Point cardinal '${rawLast}' normalisé en '${mappedCard}'`);
      }
    }
  }

  // Générique initial (« boul », « av », « rue », « ch ») ou postposé à un ordinal simple (« 1re Avenue », « 3e Rue », « 4e Rang »)
  if (stTokens.length >= 2) {
    const firstFold = foldAddressToken(stTokens[0]!);
    // Attention : « St » suivi d'un nom est « Saint- », pas « street »
    const isSaint = firstFold === "st" || firstFold === "ste";
    const mappedGen = !isSaint ? GENERIC_MAP[firstFold] : undefined;
    if (mappedGen) {
      const rawFirst = stTokens.shift()!;
      generique = mappedGen;
      if (foldAddressToken(rawFirst) !== foldAddressToken(mappedGen)) {
        corrections.push(`Générique d'odonyme '${rawFirst}' normalisé en '${mappedGen}'`);
      }
    } else if (stTokens.length === 2) {
      const ordMatch = /^(\d+)(re|er|e|ere|ère|iere|ière|ier|eme|ème|ieme|ième)$/iu.exec(
        stTokens[0]!,
      );
      const secondFold = foldAddressToken(stTokens[1]!);
      const postMappedGen = ordMatch ? GENERIC_MAP[secondFold] : undefined;
      if (ordMatch && postMappedGen) {
        const rawSecond = stTokens.splice(1, 1)[0]!;
        generique = postMappedGen;
        if (foldAddressToken(rawSecond) !== foldAddressToken(postMappedGen)) {
          corrections.push(`Générique d'odonyme '${rawSecond}' normalisé en '${postMappedGen}'`);
        }
        const num = Number.parseInt(ordMatch[1]!, 10);
        const sufLower = ordMatch[2]!.toLowerCase();
        const canonicalOrd = num === 1 ? (sufLower.endsWith("r") ? "1er" : "1re") : `${num}e`;
        if (stTokens[0]!.toLowerCase() !== canonicalOrd) {
          corrections.push(`Ordinal d'odonyme '${stTokens[0]}' normalisé en '${canonicalOrd}'`);
        }
        stTokens[0] = canonicalOrd;
      }
    }
  }

  let specificRaw = stTokens.join(" ");
  specificRaw = expandSaintAbbreviations(specificRaw, corrections);

  // Conserver aussi la forme complète avec particule pour les patronymes (« De La Gauchetière », « De Maisonneuve », « D'Iberville »)
  const rawFoldedFull = foldAddressToken(specificRaw);
  const specifiqueWithParticleNorm =
    GENERIC_MAP[rawFoldedFull] || PARTICLE_SET.has(rawFoldedFull) ? "" : rawFoldedFull;
  const consonantKeyWithParticle = specifiqueWithParticleNorm
    ? computeConsonantKey(specificRaw)
    : "";

  // Retirer une particule initiale (« de la », « de l' », « à la », « à l' », « du », « des », « de », « d' », « l' »)
  const particlePrefixRe =
    /^(?:de\s+la\s+|de\s+l\s*['\u2018\u2019\u02bc]\s*|à\s+la\s+|a\s+la\s+|à\s+l\s*['\u2018\u2019\u02bc]\s*|a\s+l\s*['\u2018\u2019\u02bc]\s*|des\s+|du\s+|de\s+|aux\s+|au\s+|à\s+|a\s+|d\s*['\u2018\u2019\u02bc]\s*|l\s*['\u2018\u2019\u02bc]\s*)(?=.{2,})/iu;
  const specificCore = specificRaw.replace(particlePrefixRe, "").trim() || specificRaw;

  const rawFoldedSpec = foldAddressToken(specificCore);
  const specifiqueNorm =
    GENERIC_MAP[rawFoldedSpec] || PARTICLE_SET.has(rawFoldedSpec) ? "" : rawFoldedSpec;
  const consonantKey = specifiqueNorm ? computeConsonantKey(specificCore) : "";

  return {
    civicNumber,
    civicSuffix,
    unitNumber,
    unitTypeLabel,
    generique,
    cardinal,
    rawStreetSpecific: specificRaw || specificCore || cleanStreet,
    specifiqueNorm,
    specifiqueWithParticleNorm,
    consonantKey,
    consonantKeyWithParticle,
    municipalityNorm,
    municipalityOriginal: rawMun,
    postalCodeCompact: postalCompact,
    corrections,
  };
}

function normalizeUnitLabel(raw: string): string {
  const f = foldAddressToken(raw);
  if (f.startsWith("bur") || f === "suite" || f === "ste") return "bureau";
  if (f.startsWith("app") || f.startsWith("apt")) return "app.";
  if (f.startsWith("loc")) return "local";
  if (f === "salle") return "salle";
  return "unité";
}

function formatPostalCode(compact: string | null): string | null {
  if (!compact) return null;
  const c = compact.replace(/\s+/g, "").toUpperCase();
  return c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
}

function expandEtatRqa(code: string): string {
  switch (code) {
    case "C":
      return "Certifiée";
    case "V":
      return "Validée";
    case "P":
      return "Provisoire";
    case "H":
      return "Historique";
    default:
      return code;
  }
}

// ── Schémas Zod d'entrée et de sortie ────────────────────────────────────────

export const AdresseVerifyInputSchema = z.strictObject({
  address: z
    .string()
    .trim()
    .min(2)
    .max(300)
    .optional()
    .describe(
      "Adresse québécoise complète sur une ligne (p. ex. '1 Notr-Dame E, bureau 200, Mtl' ou '300, boul. Jean-Lesage, Québec G1K 8K6').",
    ),
  civic_number: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .optional()
    .describe("Numéro civique municipal optionnel (p. ex. '1', '123A')."),
  street: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .optional()
    .describe("Nom de la rue / odonyme optionnel (p. ex. 'rue Notre-Dame Est')."),
  unit: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .optional()
    .describe("Numéro d'unité, de bureau ou d'appartement optionnel (p. ex. '200', 'bureau 200')."),
  municipality: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe(
      "Municipalité ou abréviation québécoise optionnelle (p. ex. 'Montréal', 'Mtl', 'Qc').",
    ),
  postal_code: z
    .string()
    .trim()
    .min(3)
    .max(10)
    .optional()
    .describe("Code postal canadien optionnel (p. ex. 'H2Y 1B6')."),
  lot_number: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .optional()
    .describe(
      "Numéro de lot cadastral du Québec pour recherche inversée (p. ex. '1 181 642' ou '1181642'). Incompatible avec les paramètres d'adresse directe et `matricule`.",
    ),
  matricule: z
    .string()
    .trim()
    .min(4)
    .max(30)
    .optional()
    .describe(
      "Matricule d'évaluation foncière municipal pour recherche inversée (p. ex. '9891-44-1234' ou '9891441234'). Incompatible avec les paramètres d'adresse directe et `lot_number`.",
    ),
  max_candidates: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe("Nombre maximal de candidats retournés (1 à 10, défaut 5)."),
});
export type AdresseVerifyInput = z.infer<typeof AdresseVerifyInputSchema>;

const OUTSIDE_QC_PROVINCE_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:ontario)$/i, "Ontario"],
  [/^(?:colombie[- ]britannique|british columbia)$/i, "Colombie-Britannique / BC"],
  [/^(?:alberta)$/i, "Alberta"],
  [/^(?:saskatchewan)$/i, "Saskatchewan"],
  [/^(?:manitoba)$/i, "Manitoba"],
  [/^(?:nouveau[- ]brunswick|new brunswick)$/i, "Nouveau-Brunswick / NB"],
  [/^(?:nouvelle[- ]ecosse|nova scotia)$/i, "Nouvelle-Écosse / NS"],
  [/^(?:ile[- ]du[- ]prince[- ]edouard|prince edward island)$/i, "Île-du-Prince-Édouard / PE"],
  [
    /^(?:terre[- ]neuve(?:-et-labrador)?|newfoundland(?: and labrador)?)$/i,
    "Terre-Neuve-et-Labrador / NL",
  ],
  [/^(?:yukon)$/i, "Yukon"],
  [/^(?:territoires du nord[- ]ouest|northwest territories)$/i, "Territoires du Nord-Ouest / NT"],
  [/^(?:nunavut)$/i, "Nunavut"],
];

const OUTSIDE_QC_PROV_CODES = new Set([
  "ON",
  "BC",
  "AB",
  "SK",
  "MB",
  "NB",
  "NS",
  "PE",
  "PEI",
  "NL",
  "YT",
  "NT",
  "NU",
]);

const OUTSIDE_QC_MAJOR_CITIES = new Set([
  "toronto",
  "ottawa",
  "mississauga",
  "brampton",
  "hamilton",
  "kitchener",
  "waterloo",
  "markham",
  "vaughan",
  "oakville",
  "burlington",
  "windsor",
  "kingston",
  "oshawa",
  "barrie",
  "sudbury",
  "thunder bay",
  "vancouver",
  "surrey",
  "burnaby",
  "victoria",
  "kelowna",
  "calgary",
  "edmonton",
  "red deer",
  "lethbridge",
  "regina",
  "saskatoon",
  "winnipeg",
  "brandon",
  "fredericton",
  "moncton",
  "saint john",
  "halifax",
  "dartmouth",
  "charlottetown",
  "st john s",
  "whitehorse",
  "yellowknife",
  "iqaluit",
]);

function matchProvinceToken(raw: string, requireUppercaseCode: boolean): string | null {
  const cleaned = raw.replace(/[.,]+$/g, "").trim();
  if (!cleaned) return null;
  if (requireUppercaseCode && OUTSIDE_QC_PROV_CODES.has(cleaned)) {
    return cleaned;
  }
  const folded = foldAddressToken(cleaned);
  for (const [re, label] of OUTSIDE_QC_PROVINCE_NAMES) {
    if (re.test(folded)) return label;
  }
  return null;
}

function detectOutsideQuebecIndicator(input: AdresseVerifyInput): string | null {
  const checkStr = (raw: string | undefined, isMunicipalityField: boolean): string | null => {
    if (!raw) return null;
    // Retirer code postal canadien et « Canada » en fin de chaîne pour inspecter le segment province
    let work = raw
      .replace(/\b[A-Za-z]\d[A-Za-z]\s*-?\s*\d[A-Za-z]\d\b/g, " ")
      .replace(/,\s*canada\s*$/i, " ")
      .trim();

    const parenRe = /\(\s*([^)]+)\s*\)/g;
    for (const pm of work.matchAll(parenRe)) {
      const hit = matchProvinceToken(pm[1]!, true);
      if (hit) return hit;
    }
    work = work.replace(parenRe, " ").replace(/\s+/g, " ").trim();

    const segments = work
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) return null;

    // Inspecter le dernier segment (et l'avant-dernier si le dernier est Canada)
    const startIdx = isMunicipalityField ? 0 : Math.max(0, segments.length - 1);
    for (let i = segments.length - 1; i >= startIdx; i--) {
      const seg = segments[i]!;
      const direct = matchProvinceToken(seg, true);
      if (direct && (isMunicipalityField || segments.length >= 2)) {
        return direct;
      }
      // « Toronto ON » ou « Calgary AB » ou « Ottawa Ontario »
      const tokens = seg.split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) {
        const lastTok = tokens[tokens.length - 1]!;
        const prevFold = foldAddressToken(tokens[tokens.length - 2]!);
        const notStreetPrev =
          !GENERIC_MAP[prevFold] &&
          !PARTICLE_SET.has(prevFold) &&
          prevFold !== "rue" &&
          prevFold !== "boul" &&
          prevFold !== "av";
        if (notStreetPrev) {
          const hit1 = matchProvinceToken(lastTok, true);
          if (hit1) return hit1;
          if (tokens.length >= 3) {
            const hit2 = matchProvinceToken(tokens.slice(-2).join(" "), true);
            if (hit2) return hit2;
          }
        }
      }
    }
    return null;
  };

  return checkStr(input.municipality, true) ?? checkStr(input.address, false);
}

export const MatchStatusSchema = z.enum([
  "exact_civic",
  "exact_civic_unit_unconfirmed",
  "fuzzy_street_exact_civic",
  "street_only_no_civic_match",
  "outside_quebec",
  "not_found",
]);
export type MatchStatus = z.infer<typeof MatchStatusSchema>;

export const LotSourceSchema = z
  .enum(["rqa_unite", "rqa_immeuble_parent", "absent"])
  .describe(
    "Provenance RQA des lots cadastraux : fiche de l'unité ('rqa_unite'), fiche du bâtiment principal / immeuble parent ('rqa_immeuble_parent') ou absent ('absent').",
  );
export type LotSource = z.infer<typeof LotSourceSchema>;

export const AmbiguiteCadastraleSchema = z
  .enum([
    "lots_multiples",
    "copropriete_divise_ou_multi_unites",
    "lot_partage_avec_immeuble_parent",
    "repli_lot_immeuble_parent",
    "repli_matricule_immeuble_parent",
    "lot_associe_a_plusieurs_adresses",
  ])
  .describe("Type d'ambiguïté cadastrale ou de copropriété relevé au RQA.");
export type AmbiguiteCadastrale = z.infer<typeof AmbiguiteCadastraleSchema>;

export const CandidatAdresseSchema = z.object({
  id_adresse: z.number().int().nullable(),
  seqodo: z.string().nullable(),
  adresse_normalisee: z.string(),
  composantes: z.object({
    numero_municipal: z.number().int().nullable(),
    suffixe: z.string().nullable(),
    unite: z.string().nullable(),
    type_unite: z.string().nullable(),
    generique_odonyme: z.string().nullable(),
    particule_odonyme: z.string().nullable(),
    specifique_odonyme: z.string(),
    point_cardinal: z.string().nullable(),
    odonyme_complet: z.string(),
    code_municipalite: z.string(),
    municipalite: z.string(),
    mrc: z.string().nullable(),
    region_administrative: z.string().nullable(),
    province: z.literal("Québec"),
    code_postal: z.string().nullable(),
  }),
  etat_rqa: z.string().nullable(),
  categorie_rqa: z.string().nullable(),
  plage_civique_rue: z
    .object({
      min: z.number().int(),
      max: z.number().int(),
    })
    .nullable(),
  district_judiciaire_probable: z
    .object({
      district: z.string(),
      greffes: z.array(z.string()),
      reserve: z.string(),
    })
    .nullable(),
  lots_cadastraux: z.array(z.string()),
  matricule_evaluation: z.string().nullable(),
  lot_source: LotSourceSchema,
  repli_immeuble_parent: z
    .boolean()
    .describe(
      "Vrai lorsque les lots cadastraux ou le matricule d'évaluation d'une unité demandée proviennent par repli de l'immeuble parent (numero_unite = '').",
    ),
  ambiguites_cadastrales: z
    .array(AmbiguiteCadastraleSchema)
    .describe("Drapeaux d'ambiguïté cadastrale ou de copropriété relevés au RQA."),
  coordonnees: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
    })
    .nullable(),
});

export const AdresseVerifyOutputSchema = z.object({
  status: MatchStatusSchema,
  adresse_normalisee: z.string().nullable(),
  corrections_appliquees: z.array(z.string()),
  candidates: z.array(CandidatAdresseSchema),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
export type AdresseVerifyOutput = z.infer<typeof AdresseVerifyOutputSchema>;

// ── Résolution SQL sur `DB_ADRESSES` ─────────────────────────────────────────

interface RawMunRow {
  code_municipalite: string;
  nom_municipalite: string;
  nom_normalise: string;
  mrc: string | null;
  region_administrative: string | null;
}

interface RawOdoRow {
  id: number;
  code_municipalite: string;
  seqodo: string;
  generique: string | null;
  particule: string | null;
  specifique: string;
  cardinal: string | null;
  odonyme_normal: string;
  odonyme_long: string;
  specifique_norm: string;
  cle_consonnes: string;
  renvois_recherche: string;
}

interface RawCivicRow {
  id: number;
  odo_id: number;
  numero_municipal: number;
  suffixe: string;
  numero_unite: string;
  type_unite: string | null;
  code_postal: string | null;
  etat: string;
  categorie: string | null;
  numero_lot: string | null;
  matricule: string | null;
  latitude: number | null;
  longitude: number | null;
}

function formatCivicWithSuffix(civic: number, suffix: string): string {
  const clean = suffix.trim();
  if (!clean) return String(civic);
  if (clean.includes("/")) return `${civic} ${clean}`;
  if (/^\d/.test(clean)) return `${civic}-${clean}`;
  return `${civic}${clean}`;
}

function formatNormalizedQuebecAddress(opts: {
  civic: number | null;
  suffix: string;
  odonymeLong: string;
  unitNumber: string;
  unitLabel: string | null;
  municipalite: string;
  postalCode: string | null;
}): string {
  const streetPart =
    opts.civic !== null
      ? `${formatCivicWithSuffix(opts.civic, opts.suffix)}, ${opts.odonymeLong}`
      : opts.odonymeLong;
  const unitPart = opts.unitNumber ? `, ${opts.unitLabel ?? "unité"} ${opts.unitNumber}` : "";
  const cpFormatted = formatPostalCode(opts.postalCode);
  const tail = `${opts.municipalite} (Québec)${cpFormatted ? ` ${cpFormatted}` : ""}`;
  return `${streetPart}${unitPart}, ${tail}`;
}

function splitLots(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function lotsIntersect(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const setB = new Set(b.map((x) => x.replace(/\s+/g, "")));
  return a.some((x) => setB.has(x.replace(/\s+/g, "")));
}

function normalizeLotNumber(
  raw: string,
): { ok: true; lotNum: number; display: string } | { ok: false; text: string } {
  const compact = raw.replace(/[\s\u00a0\u202f]+/g, "");
  if (!/^\d{5,9}$/.test(compact)) {
    return {
      ok: false,
      text: "Format de numéro de lot invalide : fournir un numéro de lot du Cadastre du Québec de 5 à 9 chiffres (p. ex. '1 181 642' ou '1181642'), sans tirets ni lettres (les anciens lots alphanumériques non rénovés ne sont pas indexés pour la recherche inversée).",
    };
  }
  const lotNum = Number.parseInt(compact, 10);
  if (!Number.isSafeInteger(lotNum) || lotNum <= 0) {
    return {
      ok: false,
      text: "Numéro de lot invalide : le numéro de lot cadastral doit être un entier positif.",
    };
  }
  const display =
    compact.length === 7 ? `${compact[0]} ${compact.slice(1, 4)} ${compact.slice(4)}` : compact;
  return { ok: true, lotNum, display };
}

function normalizeMatricule(
  raw: string,
): { ok: true; display: string; variants: string[] } | { ok: false; text: string } {
  const trimmed = raw.trim();
  const compact = trimmed.replace(/[\s-]+/g, "");
  if (!/^\d{10,18}$/.test(compact)) {
    return {
      ok: false,
      text: "Format de matricule invalide : fournir un matricule d'évaluation foncière numérique de 10 à 18 chiffres (p. ex. '9891-44-1234' ou '9891441234').",
    };
  }
  const variants = new Set<string>([trimmed, compact]);
  let display = trimmed;
  if (compact.length === 10) {
    const dashed = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 10)}`;
    variants.add(dashed);
    display = dashed;
  } else if (compact.length === 14) {
    const dashed = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 10)}-${compact.slice(10, 14)}`;
    variants.add(dashed);
    display = dashed;
  } else if (compact.length === 18) {
    const dashed = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 10)}-${compact.slice(10, 11)}-${compact.slice(11, 14)}-${compact.slice(14, 18)}`;
    variants.add(dashed);
    display = dashed;
  }
  return { ok: true, display, variants: Array.from(variants) };
}

interface RawReverseRow extends RawCivicRow {
  code_municipalite: string;
  seqodo: string;
  generique: string | null;
  particule: string | null;
  specifique: string;
  cardinal: string | null;
  odonyme_normal: string;
  odonyme_long: string;
  nom_municipalite: string;
  nom_normalise: string;
  mrc: string | null;
  region_administrative: string | null;
}

async function adresseVerifyReverse(
  db: D1Database,
  input: AdresseVerifyInput,
): Promise<
  { ok: true; structured: AdresseVerifyOutput; text: string } | { ok: false; text: string }
> {
  const maxCandidates = input.max_candidates ?? 5;
  const corrections: string[] = [];

  const lotNorm = input.lot_number ? normalizeLotNumber(input.lot_number) : null;
  if (lotNorm && !lotNorm.ok) return lotNorm;

  const matNorm = input.matricule ? normalizeMatricule(input.matricule) : null;
  if (matNorm && !matNorm.ok) return matNorm;

  const rawQuerySummary = lotNorm
    ? `lot ${lotNorm.display}`
    : `matricule ${matNorm ? matNorm.display : ""}`;

  const metaRow = await db
    .prepare("SELECT version_date FROM meta_sources WHERE source_key = 'rqa'")
    .first<{ version_date: string }>();
  const verifiedAt = metaRow?.version_date ?? "2026-11-01";

  const munCodes: string[] = [];
  if (input.municipality) {
    const outsideProvince = detectOutsideQuebecIndicator({ municipality: input.municipality });
    if (outsideProvince) {
      return buildFinalAdresseResult({
        status: "outside_quebec",
        candidates: [],
        corrections: [
          `Indicateur territorial hors Québec détecté (« ${outsideProvince} ») : recherche hors du champ de couverture du RQA (Québec uniquement).`,
        ],
        verifiedAt,
        rawQuerySummary,
        outsideProvinceLabel: outsideProvince,
      });
    }
    const munNorm = normalizeMunicipalityInput(input.municipality, corrections);
    const munRes = await db
      .prepare(
        `SELECT code_municipalite, nom_municipalite, nom_normalise, mrc, region_administrative
           FROM municipalites
          WHERE nom_normalise = ?
             OR (' ' || aliases_recherche || ' ') LIKE ?
          LIMIT 25`,
      )
      .bind(munNorm, `% ${munNorm} %`)
      .all<RawMunRow>();
    for (const m of munRes.results) {
      munCodes.push(m.code_municipalite);
    }
    if (munCodes.length === 0) {
      if (OUTSIDE_QC_MAJOR_CITIES.has(munNorm)) {
        return buildFinalAdresseResult({
          status: "outside_quebec",
          candidates: [],
          corrections: [
            `Indicateur hors Québec détecté (${input.municipality}) : recherche hors du champ de couverture du RQA (Québec uniquement).`,
          ],
          verifiedAt,
          rawQuerySummary,
          outsideProvinceLabel: input.municipality,
        });
      }
      corrections.push(
        `Municipalité '${input.municipality}' introuvable au RQA : filtre municipal strict appliqué, aucun résultat retenu.`,
      );
      return buildFinalAdresseResult({
        status: "not_found",
        candidates: [],
        corrections,
        verifiedAt,
        rawQuerySummary,
      });
    }
  }

  const munFilterClause =
    munCodes.length > 0 ? ` AND o.code_municipalite IN (${munCodes.map(() => "?").join(",")})` : "";

  const orderClause = `ORDER BY o.code_municipalite ASC, o.id ASC, c.numero_municipal ASC, c.suffixe ASC,
             CASE WHEN c.numero_unite = '' THEN 0 ELSE 1 END, c.numero_unite ASC`;

  const reverseRes = lotNorm
    ? await db
        .prepare(
          `SELECT c.id, c.odo_id, c.numero_municipal, c.suffixe, c.numero_unite, c.type_unite,
                  c.code_postal, c.etat, c.categorie, c.numero_lot, c.matricule, c.latitude, c.longitude,
                  o.code_municipalite, o.seqodo, o.generique, o.particule, o.specifique, o.cardinal,
                  o.odonyme_normal, o.odonyme_long,
                  m.nom_municipalite, m.nom_normalise, m.mrc, m.region_administrative
             FROM lots_cadastraux_index l
             JOIN adresses_civiques c ON c.id = l.civ_id
             JOIN odonymes o ON o.id = c.odo_id
             JOIN municipalites m ON m.code_municipalite = o.code_municipalite
            WHERE l.lot_num = ?${munFilterClause}
            ${orderClause}
            LIMIT ?`,
        )
        .bind(lotNorm.lotNum, ...munCodes, maxCandidates + 1)
        .all<RawReverseRow>()
    : await db
        .prepare(
          `SELECT c.id, c.odo_id, c.numero_municipal, c.suffixe, c.numero_unite, c.type_unite,
                  c.code_postal, c.etat, c.categorie, c.numero_lot, c.matricule, c.latitude, c.longitude,
                  o.code_municipalite, o.seqodo, o.generique, o.particule, o.specifique, o.cardinal,
                  o.odonyme_normal, o.odonyme_long,
                  m.nom_municipalite, m.nom_normalise, m.mrc, m.region_administrative
             FROM adresses_civiques c
             JOIN odonymes o ON o.id = c.odo_id
             JOIN municipalites m ON m.code_municipalite = o.code_municipalite
            WHERE c.matricule IN (${matNorm!.variants.map(() => "?").join(",")})
              AND c.matricule IS NOT NULL${munFilterClause}
            ${orderClause}
            LIMIT ?`,
        )
        .bind(...matNorm!.variants, ...munCodes, maxCandidates + 1)
        .all<RawReverseRow>();

  const rows = reverseRes.results;
  if (rows.length === 0) {
    return buildFinalAdresseResult({
      status: "not_found",
      candidates: [],
      corrections,
      verifiedAt,
      rawQuerySummary,
    });
  }

  const multipleAddresses = rows.length > 1;
  const truncated = rows.length > maxCandidates;
  if (truncated) {
    corrections.push(
      `Plus de ${maxCandidates} adresses civiques correspondent à ce ${lotNorm ? "numéro de lot" : "matricule"} au RQA : affichage limité aux ${maxCandidates} premiers résultats.`,
    );
  }

  const sliced = rows.slice(0, maxCandidates);
  const unitBuildingsInResult = new Set<string>();
  for (const r of rows) {
    if (r.numero_unite !== "") {
      unitBuildingsInResult.add(`${r.odo_id}:${r.numero_municipal}:${r.suffixe.toUpperCase()}`);
    }
  }

  const candidates: z.infer<typeof CandidatAdresseSchema>[] = sliced.map((r) => {
    const lots = splitLots(r.numero_lot);
    const hasUnit = r.numero_unite !== "";
    const lotSource: LotSource =
      lots.length === 0 ? "absent" : hasUnit ? "rqa_unite" : "rqa_immeuble_parent";
    const buildingKey = `${r.odo_id}:${r.numero_municipal}:${r.suffixe.toUpperCase()}`;
    const ambiguites: AmbiguiteCadastrale[] = [];
    if (lots.length > 1) {
      ambiguites.push("lots_multiples");
    }
    if (hasUnit || unitBuildingsInResult.has(buildingKey)) {
      ambiguites.push("copropriete_divise_ou_multi_unites");
    }
    if (multipleAddresses) {
      ambiguites.push("lot_associe_a_plusieurs_adresses");
    }

    const rqaPostalType = isGisStackingUnitType(r.type_unite)
      ? null
      : normalizeUnitLabel(r.type_unite!);
    const effectiveUnitLabel = hasUnit ? (rqaPostalType ?? "unité") : null;
    const effectiveComponentUnitType = hasUnit
      ? isGisStackingUnitType(r.type_unite)
        ? "unité"
        : (r.type_unite ?? null)
      : null;

    return {
      id_adresse: Number(r.id),
      seqodo: r.seqodo,
      adresse_normalisee: formatNormalizedQuebecAddress({
        civic: r.numero_municipal,
        suffix: r.suffixe,
        odonymeLong: r.odonyme_long,
        unitNumber: r.numero_unite,
        unitLabel: effectiveUnitLabel,
        municipalite: r.nom_municipalite,
        postalCode: r.code_postal,
      }),
      composantes: {
        numero_municipal: r.numero_municipal,
        suffixe: r.suffixe || null,
        unite: r.numero_unite || null,
        type_unite: effectiveComponentUnitType,
        generique_odonyme: r.generique ?? null,
        particule_odonyme: r.particule ?? null,
        specifique_odonyme: r.specifique,
        point_cardinal: r.cardinal ?? null,
        odonyme_complet: r.odonyme_normal,
        code_municipalite: r.code_municipalite,
        municipalite: r.nom_municipalite,
        mrc: r.mrc ?? null,
        region_administrative: r.region_administrative ?? null,
        province: "Québec",
        code_postal: formatPostalCode(r.code_postal),
      },
      etat_rqa: expandEtatRqa(r.etat),
      categorie_rqa: r.categorie ?? null,
      plage_civique_rue: null,
      district_judiciaire_probable: resolveProbableDistrict(r.nom_municipalite),
      lots_cadastraux: lots,
      matricule_evaluation: r.matricule ?? null,
      lot_source: lotSource,
      repli_immeuble_parent: false,
      ambiguites_cadastrales: ambiguites,
      coordonnees:
        r.latitude !== null && r.longitude !== null
          ? { latitude: Number(r.latitude), longitude: Number(r.longitude) }
          : null,
    };
  });

  return buildFinalAdresseResult({
    status: "exact_civic",
    candidates,
    corrections,
    verifiedAt,
    rawQuerySummary,
  });
}

export async function adresseVerify(
  db: D1Database,
  input: AdresseVerifyInput,
): Promise<
  { ok: true; structured: AdresseVerifyOutput; text: string } | { ok: false; text: string }
> {
  const hasForward = Boolean(
    input.address || input.street || (input.postal_code && input.civic_number),
  );
  const hasAnyForwardField = Boolean(
    input.address || input.street || input.civic_number || input.unit || input.postal_code,
  );
  const hasLot = Boolean(input.lot_number);
  const hasMatricule = Boolean(input.matricule);
  const hasReverse = hasLot || hasMatricule;

  if (hasLot && hasMatricule) {
    return {
      ok: false,
      text: "Paramètres incompatibles : fournir soit `lot_number`, soit `matricule`, jamais les deux simultanément.",
    };
  }
  if (hasReverse && hasAnyForwardField) {
    return {
      ok: false,
      text: "Paramètres incompatibles : la recherche inversée par `lot_number` ou `matricule` ne peut pas être combinée avec `address`, `street`, `civic_number`, `unit` ou `postal_code` (seuls `municipality` et `max_candidates` sont admis).",
    };
  }
  if (!hasForward && !hasReverse) {
    return {
      ok: false,
      text: "Paramètres insuffisants : fournir soit `address` (adresse sur une ligne), soit `street` (odonyme), soit la paire `postal_code` + `civic_number`, soit `lot_number` ou `matricule` pour une recherche inversée.",
    };
  }

  if (hasReverse) {
    return adresseVerifyReverse(db, input);
  }

  const maxCandidates = input.max_candidates ?? 5;
  const parsed = parseQuebecAddress(input);
  const corrections = [...parsed.corrections];

  const metaRow = await db
    .prepare("SELECT version_date FROM meta_sources WHERE source_key = 'rqa'")
    .first<{ version_date: string }>();
  const verifiedAt = metaRow?.version_date ?? "2026-11-01";

  const outsideProvince = detectOutsideQuebecIndicator(input);
  if (outsideProvince) {
    return buildFinalAdresseResult({
      status: "outside_quebec",
      candidates: [],
      corrections: [
        `Indicateur territorial hors Québec détecté (« ${outsideProvince} ») : adresse hors du champ de couverture du RQA (Québec uniquement).`,
      ],
      verifiedAt,
      rawQuerySummary: input.address ?? input.street ?? "",
      outsideProvinceLabel: outsideProvince,
    });
  }

  // 1) Résoudre les municipalités candidates si fournies
  const munMap = new Map<string, RawMunRow>();
  if (parsed.municipalityNorm) {
    const munRes = await db
      .prepare(
        `SELECT code_municipalite, nom_municipalite, nom_normalise, mrc, region_administrative
           FROM municipalites
          WHERE nom_normalise = ?
             OR (' ' || aliases_recherche || ' ') LIKE ?
          LIMIT 25`,
      )
      .bind(parsed.municipalityNorm, `% ${parsed.municipalityNorm} %`)
      .all<RawMunRow>();
    for (const m of munRes.results) {
      munMap.set(m.code_municipalite, m);
    }
  }

  // Détecter aussi un code postal hors série G/H/J ou une grande ville canadienne hors QC lorsque aucune municipalité QC ne correspond
  if (munMap.size === 0) {
    const nonQcPostal =
      parsed.postalCodeCompact !== null && !/^[GHJ]/.test(parsed.postalCodeCompact);
    const nonQcCity =
      parsed.municipalityNorm !== null && OUTSIDE_QC_MAJOR_CITIES.has(parsed.municipalityNorm);
    if (nonQcPostal || nonQcCity) {
      const reason = nonQcCity
        ? `${parsed.municipalityOriginal ?? parsed.municipalityNorm}`
        : `code postal hors série G/H/J (${formatPostalCode(parsed.postalCodeCompact)})`;
      return buildFinalAdresseResult({
        status: "outside_quebec",
        candidates: [],
        corrections: [
          `Indicateur hors Québec détecté (${reason}) : adresse hors du champ de couverture du RQA (Québec uniquement).`,
        ],
        verifiedAt,
        rawQuerySummary: input.address ?? input.street ?? "",
        outsideProvinceLabel: reason,
      });
    }
  }

  const munCodes = Array.from(munMap.keys());
  const odoCandidates = new Map<number, { odo: RawOdoRow; isFuzzy: boolean; odoScore: number }>();

  const munFilterClause =
    munCodes.length > 0 ? ` AND code_municipalite IN (${munCodes.map(() => "?").join(",")})` : "";

  const specNormVariants = Array.from(
    new Set([parsed.specifiqueNorm, parsed.specifiqueWithParticleNorm].filter(Boolean)),
  );
  const specNormSet = new Set(specNormVariants);
  const consKeyVariants = Array.from(
    new Set([parsed.consonantKey, parsed.consonantKeyWithParticle].filter((k) => k.length >= 3)),
  );

  // Voie rapide par code postal + numéro civique lorsque présents
  if (parsed.postalCodeCompact && parsed.civicNumber !== null) {
    const cpRes = await db
      .prepare(
        `SELECT DISTINCT o.id, o.code_municipalite, o.seqodo, o.generique, o.particule,
                o.specifique, o.cardinal, o.odonyme_normal, o.odonyme_long,
                o.specifique_norm, o.cle_consonnes, o.renvois_recherche
           FROM adresses_civiques c
           JOIN odonymes o ON o.id = c.odo_id
          WHERE c.code_postal = ? AND c.numero_municipal = ?
          LIMIT 15`,
      )
      .bind(parsed.postalCodeCompact, parsed.civicNumber)
      .all<RawOdoRow>();
    for (const o of cpRes.results) {
      const exactSpec = specNormVariants.length === 0 || specNormSet.has(o.specifique_norm);
      const sim =
        specNormVariants.length > 0
          ? Math.max(...specNormVariants.map((v) => similarityRatio(v, o.specifique_norm)))
          : 1;
      if (exactSpec || sim >= 0.65) {
        odoCandidates.set(Number(o.id), {
          odo: o,
          isFuzzy: !exactSpec,
          odoScore: exactSpec ? 100 : 75 + sim * 15,
        });
      }
    }
  }

  if (specNormVariants.length > 0) {
    // 2A) Correspondance exacte sur `specifique_norm` (avec ou sans particule patronymique)
    const specInSql =
      specNormVariants.length === 1
        ? "specifique_norm = ?"
        : `specifique_norm IN (${specNormVariants.map(() => "?").join(",")})`;
    const exactOdoRes = await db
      .prepare(
        `SELECT id, code_municipalite, seqodo, generique, particule, specifique, cardinal,
                odonyme_normal, odonyme_long, specifique_norm, cle_consonnes, renvois_recherche
           FROM odonymes
          WHERE ${specInSql}${munFilterClause}
          ORDER BY CASE WHEN ? != '' AND LOWER(COALESCE(generique, '')) = LOWER(?) THEN 0 ELSE 1 END,
                   CASE WHEN code_municipalite IN ('66023', '23027', '65005', '58227', '81017', '43027', '25213', '94068', '37067') THEN 0 ELSE 1 END,
                   id ASC
          LIMIT 60`,
      )
      .bind(...specNormVariants, ...munCodes, parsed.generique ?? "", parsed.generique ?? "")
      .all<RawOdoRow>();

    for (const o of exactOdoRes.results) {
      let sc = 100;
      if (parsed.cardinal) {
        if (o.cardinal?.toLowerCase() === parsed.cardinal.toLowerCase()) sc += 15;
        else sc -= 20;
      } else if (!o.cardinal) {
        sc += 4;
      }
      if (parsed.generique && o.generique) {
        if (foldAddressToken(o.generique) === foldAddressToken(parsed.generique)) sc += 10;
        else sc -= 6;
      }
      odoCandidates.set(Number(o.id), { odo: o, isFuzzy: false, odoScore: sc });
    }

    // 2B) Recherche FTS5 (renvois historiques Odonymes_renvois.csv ou mots partiels)
    const ftsTokens = parsed.specifiqueNorm
      .split(" ")
      .filter((t) => t.length >= 2)
      .slice(0, 8);
    if (ftsTokens.length > 0 && odoCandidates.size < 10) {
      const ftsMatch = ftsTokens.map((t) => (t.length >= 4 ? `"${t}"*` : `"${t}"`)).join(" AND ");
      const ftsOdoRes = await db
        .prepare(
          `SELECT o.id, o.code_municipalite, o.seqodo, o.generique, o.particule, o.specifique,
                  o.cardinal, o.odonyme_normal, o.odonyme_long, o.specifique_norm,
                  o.cle_consonnes, o.renvois_recherche
             FROM odonymes_fts f
             JOIN odonymes o ON o.id = f.rowid
            WHERE odonymes_fts MATCH ?${munFilterClause.replace("code_municipalite", "o.code_municipalite")}
            LIMIT 40`,
        )
        .bind(ftsMatch, ...munCodes)
        .all<RawOdoRow>();

      for (const o of ftsOdoRes.results) {
        if (odoCandidates.has(Number(o.id))) continue;
        const foldedRenvois = foldAddressToken(o.renvois_recherche);
        const isRenvoiExact = specNormVariants.some((v) => foldedRenvois.includes(v));
        let sc = isRenvoiExact ? 88 : 80;
        if (parsed.cardinal) {
          if (o.cardinal?.toLowerCase() === parsed.cardinal.toLowerCase()) sc += 12;
          else sc -= 15;
        }
        if (parsed.generique && o.generique) {
          if (foldAddressToken(o.generique) === foldAddressToken(parsed.generique)) sc += 10;
          else sc -= 6;
        }
        odoCandidates.set(Number(o.id), {
          odo: o,
          isFuzzy: !specNormSet.has(o.specifique_norm),
          odoScore: sc,
        });
      }
    }

    // 2C) Tolérance aux fautes de frappe : squelette consonantique + trigrammes FTS5
    if (odoCandidates.size === 0) {
      const fuzzyRows: RawOdoRow[] = [];
      if (consKeyVariants.length > 0) {
        const consWhere =
          consKeyVariants.length === 1
            ? "cle_consonnes = ?"
            : `cle_consonnes IN (${consKeyVariants.map(() => "?").join(",")})`;
        const consRes = await db
          .prepare(
            `SELECT id, code_municipalite, seqodo, generique, particule, specifique, cardinal,
                    odonyme_normal, odonyme_long, specifique_norm, cle_consonnes, renvois_recherche
               FROM odonymes
              WHERE ${consWhere}${munFilterClause}
              LIMIT 50`,
          )
          .bind(...consKeyVariants, ...munCodes)
          .all<RawOdoRow>();
        fuzzyRows.push(...consRes.results);
      }

      if (fuzzyRows.length === 0) {
        const trigramSet = new Set<string>();
        for (const cleanSpec of specNormVariants) {
          if (cleanSpec.length < 4) continue;
          trigramSet.add(`"${cleanSpec.slice(0, 3)}"`);
          if (cleanSpec.length >= 5) {
            const mid = Math.floor((cleanSpec.length - 3) / 2);
            trigramSet.add(`"${cleanSpec.slice(mid, mid + 3)}"`);
          }
          if (cleanSpec.length >= 6) {
            trigramSet.add(`"${cleanSpec.slice(-3)}"`);
          }
        }
        if (trigramSet.size > 0) {
          const triQuery = Array.from(trigramSet).join(" OR ");
          const triRes = await db
            .prepare(
              `SELECT o.id, o.code_municipalite, o.seqodo, o.generique, o.particule, o.specifique,
                      o.cardinal, o.odonyme_normal, o.odonyme_long, o.specifique_norm,
                      o.cle_consonnes, o.renvois_recherche
                 FROM odonymes_trigram t
                 JOIN odonymes o ON o.id = t.rowid
                WHERE odonymes_trigram MATCH ?${munFilterClause.replace("code_municipalite", "o.code_municipalite")}
                ORDER BY bm25(odonymes_trigram)
                LIMIT 60`,
            )
            .bind(triQuery, ...munCodes)
            .all<RawOdoRow>();
          fuzzyRows.push(...triRes.results);
        }
      }

      for (const o of fuzzyRows) {
        if (odoCandidates.has(Number(o.id))) continue;
        const sim = Math.max(...specNormVariants.map((v) => similarityRatio(v, o.specifique_norm)));
        const dist = Math.min(
          ...specNormVariants.map((v) => levenshteinDistance(v, o.specifique_norm)),
        );
        if (sim < 0.72 && dist > 2) continue;

        let sc = 60 + sim * 25;
        if (parsed.cardinal) {
          if (o.cardinal?.toLowerCase() === parsed.cardinal.toLowerCase()) sc += 15;
          else sc -= 18;
        }
        if (parsed.generique && o.generique) {
          if (foldAddressToken(o.generique) === foldAddressToken(parsed.generique)) sc += 8;
        }
        odoCandidates.set(Number(o.id), { odo: o, isFuzzy: true, odoScore: sc });
      }
    }
  }

  // Charger les municipalités manquantes des odonymes retenus
  const missingMunCodes = Array.from(
    new Set(
      Array.from(odoCandidates.values())
        .map((c) => c.odo.code_municipalite)
        .filter((c) => !munMap.has(c)),
    ),
  );
  if (missingMunCodes.length > 0) {
    const mRes = await db
      .prepare(
        `SELECT code_municipalite, nom_municipalite, nom_normalise, mrc, region_administrative
           FROM municipalites
          WHERE code_municipalite IN (${missingMunCodes.map(() => "?").join(",")})`,
      )
      .bind(...missingMunCodes)
      .all<RawMunRow>();
    for (const m of mRes.results) {
      munMap.set(m.code_municipalite, m);
    }
  }

  const rankedOdos = Array.from(odoCandidates.values())
    .sort((a, b) => b.odoScore - a.odoScore)
    .slice(0, 20);

  if (rankedOdos.length === 0) {
    return buildFinalAdresseResult({
      status: "not_found",
      candidates: [],
      corrections,
      verifiedAt,
      rawQuerySummary: input.address ?? input.street ?? "",
    });
  }

  // 3) Cas sans numéro civique fourni -> `street_only_no_civic_match`
  if (parsed.civicNumber === null) {
    const streetCandidates: z.infer<typeof CandidatAdresseSchema>[] = [];
    for (const { odo } of rankedOdos.slice(0, maxCandidates)) {
      const mun = munMap.get(odo.code_municipalite);
      const munName = mun?.nom_municipalite ?? odo.code_municipalite;
      const rangeRow = await db
        .prepare(
          "SELECT MIN(numero_municipal) AS min_n, MAX(numero_municipal) AS max_n FROM adresses_civiques WHERE odo_id = ?",
        )
        .bind(odo.id)
        .first<{ min_n: number | null; max_n: number | null }>();

      streetCandidates.push({
        id_adresse: null,
        seqodo: odo.seqodo,
        adresse_normalisee: formatNormalizedQuebecAddress({
          civic: null,
          suffix: "",
          odonymeLong: odo.odonyme_long,
          unitNumber: "",
          unitLabel: null,
          municipalite: munName,
          postalCode: null,
        }),
        composantes: {
          numero_municipal: null,
          suffixe: null,
          unite: null,
          type_unite: null,
          generique_odonyme: odo.generique ?? null,
          particule_odonyme: odo.particule ?? null,
          specifique_odonyme: odo.specifique,
          point_cardinal: odo.cardinal ?? null,
          odonyme_complet: odo.odonyme_normal,
          code_municipalite: odo.code_municipalite,
          municipalite: munName,
          mrc: mun?.mrc ?? null,
          region_administrative: mun?.region_administrative ?? null,
          province: "Québec",
          code_postal: null,
        },
        etat_rqa: null,
        categorie_rqa: null,
        plage_civique_rue:
          rangeRow && rangeRow.min_n !== null && rangeRow.max_n !== null
            ? { min: Number(rangeRow.min_n), max: Number(rangeRow.max_n) }
            : null,
        district_judiciaire_probable: resolveProbableDistrict(munName),
        lots_cadastraux: [],
        matricule_evaluation: null,
        lot_source: "absent",
        repli_immeuble_parent: false,
        ambiguites_cadastrales: [],
        coordonnees: null,
      });
    }
    corrections.push(
      "Aucun numéro civique fourni : vérification limitée à l'existence de l'odonyme",
    );
    return buildFinalAdresseResult({
      status: "street_only_no_civic_match",
      candidates: streetCandidates,
      corrections,
      verifiedAt,
      rawQuerySummary: input.address ?? input.street ?? "",
    });
  }

  // 4) Vérifier le numéro civique (et l'unité éventuelle) dans `adresses_civiques`
  //    Prioriser explicitement l'unité demandée et le point bâtiment principal (`numero_unite = ''`)
  //    avant le plafond `LIMIT 80` pour ne jamais tronquer les tours à plus de 80 bureaux/logements.
  const odoIds = rankedOdos.map((r) => r.odo.id);
  const requestedUnitUpper = parsed.unitNumber.toUpperCase();
  const civRes = await db
    .prepare(
      `SELECT id, odo_id, numero_municipal, suffixe, numero_unite, type_unite,
              code_postal, etat, categorie, numero_lot, matricule, latitude, longitude
         FROM adresses_civiques
        WHERE odo_id IN (${odoIds.map(() => "?").join(",")})
          AND numero_municipal = ?
        ORDER BY CASE
                   WHEN ? != '' AND (UPPER(numero_unite) = ? OR (numero_unite = '' AND UPPER(suffixe) = ?)) THEN 0
                   WHEN numero_unite = '' THEN 1
                   ELSE 2
                 END,
                 suffixe ASC,
                 numero_unite ASC
        LIMIT 80`,
    )
    .bind(...odoIds, parsed.civicNumber, requestedUnitUpper, requestedUnitUpper, requestedUnitUpper)
    .all<RawCivicRow>();

  const odoMetaById = new Map(rankedOdos.map((r) => [r.odo.id, r]));

  if (civRes.results.length > 0) {
    interface ScoredCivic {
      civ: RawCivicRow;
      odo: RawOdoRow;
      isFuzzyStreet: boolean;
      unitConfirmed: boolean;
      totalScore: number;
    }
    const scoredCivics: ScoredCivic[] = [];

    for (const c of civRes.results) {
      const meta = odoMetaById.get(Number(c.odo_id));
      if (!meta) continue;

      // Si un suffixe civique explicite a été demandé (p. ex. 123A), pénaliser l'absence de suffixe
      let sc = meta.odoScore;
      if (parsed.civicSuffix) {
        if (c.suffixe.toUpperCase() === parsed.civicSuffix) sc += 25;
        else sc -= 20;
      } else if (!c.suffixe) {
        sc += 5;
      }

      let unitConfirmed = true;
      if (parsed.unitNumber) {
        if (c.numero_unite.toUpperCase() === parsed.unitNumber) {
          sc += 35;
          unitConfirmed = true;
        } else if (c.numero_unite === "" && c.suffixe.toUpperCase() === parsed.unitNumber) {
          // Certaines municipalités RQA encodent le numéro de local/bureau dans `suffixe` (p. ex. Gaspé 11, suffixe '101')
          sc += 30;
          unitConfirmed = true;
        } else if (c.numero_unite === "") {
          // Point bâtiment principal sans subdivision d'unité au RQA
          sc += 5;
          unitConfirmed = false;
        } else {
          // Autre unité du même immeuble -> ne pas retenir en priorité s'il existe l'unité ou le bâtiment
          sc -= 15;
          unitConfirmed = false;
        }
      } else if (c.numero_unite === "") {
        sc += 10;
      }

      if (parsed.postalCodeCompact && c.code_postal) {
        if (c.code_postal === parsed.postalCodeCompact) sc += 20;
        else sc -= 5;
      }

      scoredCivics.push({
        civ: c,
        odo: meta.odo,
        isFuzzyStreet: meta.isFuzzy,
        unitConfirmed,
        totalScore: sc,
      });
    }

    scoredCivics.sort((a, b) => b.totalScore - a.totalScore);

    // Dédupliquer si plusieurs unités non demandées coexistent sur le même immeuble
    const deduped: ScoredCivic[] = [];
    const seenKeys = new Set<string>();
    const confirmedBuildings = new Set<string>();
    for (const item of scoredCivics) {
      const buildingKey = `${item.odo.id}:${item.civ.suffixe.toUpperCase()}`;
      if (parsed.unitNumber) {
        if (item.unitConfirmed) {
          confirmedBuildings.add(buildingKey);
        } else if (confirmedBuildings.has(buildingKey)) {
          continue;
        }
      }
      const key = parsed.unitNumber
        ? `${item.odo.id}:${item.civ.suffixe.toUpperCase()}:${item.unitConfirmed ? item.civ.numero_unite.toUpperCase() || item.civ.suffixe.toUpperCase() : "UNCONF"}`
        : buildingKey;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      deduped.push(item);
      if (deduped.length >= maxCandidates) break;
    }

    const best = deduped[0]!;
    let status: MatchStatus = "exact_civic";
    if (best.isFuzzyStreet) {
      status = "fuzzy_street_exact_civic";
      corrections.push(
        `Odonyme corrigé par rapprochement orthographique : '${parsed.rawStreetSpecific}' → '${best.odo.odonyme_long}'`,
      );
    }
    if (
      parsed.cardinal &&
      (best.odo.cardinal ?? "").toLowerCase() !== parsed.cardinal.toLowerCase()
    ) {
      status = "fuzzy_street_exact_civic";
      corrections.push(
        `Point cardinal divergent : numéro civique ${best.civ.numero_municipal} introuvable sur le tronçon '${parsed.cardinal}', candidat retenu sur '${best.odo.odonyme_long}'`,
      );
    }
    if (
      parsed.generique &&
      best.odo.generique &&
      foldAddressToken(best.odo.generique) !== foldAddressToken(parsed.generique)
    ) {
      status = "fuzzy_street_exact_civic";
      corrections.push(
        `Générique d'odonyme rectifié selon le RQA : '${parsed.generique}' → '${best.odo.generique.toLowerCase()}' ('${best.odo.odonyme_long}')`,
      );
    }
    if (
      parsed.civicSuffix &&
      best.civ.suffixe.toUpperCase() !== parsed.civicSuffix &&
      best.civ.numero_unite.toUpperCase() !== parsed.civicSuffix
    ) {
      if (status === "exact_civic") {
        status = "exact_civic_unit_unconfirmed";
      }
      corrections.push(
        `Numéro civique ${best.civ.numero_municipal} confirmé au RQA, mais le suffixe '${parsed.civicSuffix}' n'y est pas inscrit individuellement`,
      );
    }
    if (parsed.unitNumber && !best.unitConfirmed) {
      if (status === "exact_civic") {
        status = "exact_civic_unit_unconfirmed";
      }
      corrections.push(
        `Numéro civique ${best.civ.numero_municipal} confirmé au RQA, mais l'unité '${parsed.unitNumber}' n'y est pas inscrite individuellement`,
      );
    }

    if (
      parsed.postalCodeCompact &&
      best.civ.code_postal &&
      parsed.postalCodeCompact !== best.civ.code_postal
    ) {
      corrections.push(
        `Code postal rectifié selon le RQA : '${formatPostalCode(parsed.postalCodeCompact)}' → '${formatPostalCode(best.civ.code_postal)}'`,
      );
    } else if (!parsed.postalCodeCompact && best.civ.code_postal) {
      corrections.push(
        `Code postal complété depuis le RQA : '${formatPostalCode(best.civ.code_postal)}'`,
      );
    }

    const parentByBuildingKey = new Map<string, RawCivicRow>();
    for (const c of civRes.results) {
      if (c.numero_unite === "") {
        const bKey = `${c.odo_id}:${c.numero_municipal}:${c.suffixe.toUpperCase()}`;
        if (!parentByBuildingKey.has(bKey)) {
          parentByBuildingKey.set(bKey, c);
        }
      }
    }

    const unitCountByBuildingKey = new Map<string, number>();
    for (const c of civRes.results) {
      if (c.numero_unite !== "") {
        const bKey = `${c.odo_id}:${c.numero_municipal}:${c.suffixe.toUpperCase()}`;
        unitCountByBuildingKey.set(bKey, (unitCountByBuildingKey.get(bKey) ?? 0) + 1);
      }
    }

    const formattedCandidates: z.infer<typeof CandidatAdresseSchema>[] = [];
    for (const item of deduped) {
      const mun = munMap.get(item.odo.code_municipalite);
      const munName = mun?.nom_municipalite ?? item.odo.code_municipalite;
      const suffixMatchesUnit =
        Boolean(parsed.unitNumber) &&
        item.unitConfirmed &&
        item.civ.numero_unite === "" &&
        item.civ.suffixe.toUpperCase() === parsed.unitNumber;
      const effectiveUnit = parsed.unitNumber
        ? item.unitConfirmed
          ? item.civ.numero_unite || parsed.unitNumber
          : parsed.unitNumber
        : "";
      const effectiveSuffix = suffixMatchesUnit
        ? ""
        : item.civ.suffixe || (parsed.civicSuffix && item === best ? parsed.civicSuffix : "");
      const rqaPostalType = isGisStackingUnitType(item.civ.type_unite)
        ? null
        : normalizeUnitLabel(item.civ.type_unite!);
      const effectiveUnitLabel = effectiveUnit
        ? item.unitConfirmed
          ? !parsed.unitTypeLabel || parsed.unitTypeLabel === "unité"
            ? (rqaPostalType ?? parsed.unitTypeLabel ?? "unité")
            : parsed.unitTypeLabel
          : (parsed.unitTypeLabel ?? "unité")
        : null;
      const effectiveComponentUnitType =
        effectiveUnit && item.unitConfirmed
          ? isGisStackingUnitType(item.civ.type_unite)
            ? (parsed.unitTypeLabel ?? "unité")
            : (item.civ.type_unite ?? null)
          : null;

      const buildingKey = `${item.civ.odo_id}:${item.civ.numero_municipal}:${item.civ.suffixe.toUpperCase()}`;
      const isUnitRow = item.civ.numero_unite !== "" || suffixMatchesUnit;
      const isUnrequestedOrUnconfirmedUnitRow =
        item.civ.numero_unite !== "" && (!parsed.unitNumber || !item.unitConfirmed);
      const ownLots = splitLots(item.civ.numero_lot);
      const ownMatricule = item.civ.matricule?.trim() || null;

      let parentRow =
        item.civ.numero_unite !== "" ? parentByBuildingKey.get(buildingKey) : undefined;
      if (
        item.civ.numero_unite !== "" &&
        parsed.unitNumber &&
        item.unitConfirmed &&
        !parentRow &&
        civRes.results.length === 80
      ) {
        const fetchedParent = await db
          .prepare(
            `SELECT id, odo_id, numero_municipal, suffixe, numero_unite, type_unite,
                    code_postal, etat, categorie, numero_lot, matricule, latitude, longitude
               FROM adresses_civiques
              WHERE odo_id = ? AND numero_municipal = ? AND UPPER(suffixe) = ? AND numero_unite = ''
              LIMIT 1`,
          )
          .bind(item.civ.odo_id, item.civ.numero_municipal, item.civ.suffixe.toUpperCase())
          .first<RawCivicRow>();
        if (fetchedParent) {
          parentByBuildingKey.set(buildingKey, fetchedParent);
          parentRow = fetchedParent;
        }
      }

      const parentLots = parentRow ? splitLots(parentRow.numero_lot) : [];
      const parentMatricule = parentRow?.matricule?.trim() || null;

      let lots: string[];
      let lotSource: LotSource;
      let matriculeEval: string | null;
      let repliImmeubleParent = false;
      const ambiguites: AmbiguiteCadastrale[] = [];

      if (isUnrequestedOrUnconfirmedUnitRow) {
        lots = [];
        lotSource = "absent";
        matriculeEval = null;
        repliImmeubleParent = false;
        ambiguites.push("copropriete_divise_ou_multi_unites");
        corrections.push(
          parsed.unitNumber
            ? `Aucune fiche bâtiment parent (numero_unite = '') au RQA pour ce numéro civique : le lot et le matricule d'une autre unité répertoriée ('${item.civ.numero_unite}') ne sont pas attribués à l'unité demandée '${effectiveUnit}'.`
            : `Immeuble multi-unités sans fiche bâtiment parent (numero_unite = '') au RQA : les lots et matricules des unités individuelles (p. ex. unité '${item.civ.numero_unite}') ne sont pas attribués à l'adresse globale sans précision d'unité.`,
        );
      } else if (isUnitRow) {
        if (ownLots.length > 0) {
          lots = ownLots;
          lotSource = "rqa_unite";
          if (parentLots.length > 0 && lotsIntersect(ownLots, parentLots)) {
            ambiguites.push("lot_partage_avec_immeuble_parent");
          }
        } else if (parentLots.length > 0) {
          lots = parentLots;
          lotSource = "rqa_immeuble_parent";
          repliImmeubleParent = true;
          ambiguites.push("repli_lot_immeuble_parent");
          corrections.push(
            `Unité '${effectiveUnit}' sans numéro de lot propre au RQA : lot(s) de l'immeuble parent (${parentLots.join(", ")}) affiché(s) à titre indicatif (ne constitue pas le lot privatif).`,
          );
        } else {
          lots = [];
          lotSource = "absent";
        }

        if (ownMatricule) {
          matriculeEval = ownMatricule;
        } else if (parentMatricule) {
          matriculeEval = parentMatricule;
          repliImmeubleParent = true;
          ambiguites.push("repli_matricule_immeuble_parent");
          corrections.push(
            `Unité '${effectiveUnit}' sans matricule propre au RQA : matricule de l'immeuble parent (${parentMatricule}) affiché à titre indicatif.`,
          );
        } else {
          matriculeEval = null;
        }
      } else {
        lots = ownLots;
        lotSource = ownLots.length > 0 ? "rqa_immeuble_parent" : "absent";
        matriculeEval = ownMatricule;

        if (
          parsed.unitNumber &&
          !item.unitConfirmed &&
          (lots.length > 0 || matriculeEval !== null)
        ) {
          repliImmeubleParent = true;
          if (lots.length > 0) ambiguites.push("repli_lot_immeuble_parent");
          if (matriculeEval !== null) ambiguites.push("repli_matricule_immeuble_parent");
        }
        if ((unitCountByBuildingKey.get(buildingKey) ?? 0) > 0) {
          ambiguites.push("copropriete_divise_ou_multi_unites");
        }
      }

      if (lots.length > 1) {
        ambiguites.push("lots_multiples");
      }

      formattedCandidates.push({
        id_adresse: Number(item.civ.id),
        seqodo: item.odo.seqodo,
        adresse_normalisee: formatNormalizedQuebecAddress({
          civic: item.civ.numero_municipal,
          suffix: effectiveSuffix,
          odonymeLong: item.odo.odonyme_long,
          unitNumber: effectiveUnit,
          unitLabel: effectiveUnitLabel,
          municipalite: munName,
          postalCode: item.civ.code_postal,
        }),
        composantes: {
          numero_municipal: item.civ.numero_municipal,
          suffixe: item.civ.suffixe || null,
          unite: effectiveUnit || null,
          type_unite: effectiveComponentUnitType,
          generique_odonyme: item.odo.generique ?? null,
          particule_odonyme: item.odo.particule ?? null,
          specifique_odonyme: item.odo.specifique,
          point_cardinal: item.odo.cardinal ?? null,
          odonyme_complet: item.odo.odonyme_normal,
          code_municipalite: item.odo.code_municipalite,
          municipalite: munName,
          mrc: mun?.mrc ?? null,
          region_administrative: mun?.region_administrative ?? null,
          province: "Québec",
          code_postal: formatPostalCode(item.civ.code_postal),
        },
        etat_rqa: expandEtatRqa(item.civ.etat),
        categorie_rqa: item.civ.categorie ?? null,
        plage_civique_rue: null,
        district_judiciaire_probable: resolveProbableDistrict(munName),
        lots_cadastraux: lots,
        matricule_evaluation: matriculeEval,
        lot_source: lotSource,
        repli_immeuble_parent: repliImmeubleParent,
        ambiguites_cadastrales: ambiguites,
        coordonnees:
          item.civ.latitude !== null && item.civ.longitude !== null
            ? { latitude: Number(item.civ.latitude), longitude: Number(item.civ.longitude) }
            : null,
      });
    }

    return buildFinalAdresseResult({
      status,
      candidates: formattedCandidates,
      corrections,
      verifiedAt,
      rawQuerySummary: input.address ?? `${parsed.civicNumber} ${input.street ?? ""}`,
    });
  }

  // 5) L'odonyme existe, mais CE numéro civique n'existe pas sur la rue -> `street_only_no_civic_match`
  const noCivicCandidates: z.infer<typeof CandidatAdresseSchema>[] = [];
  for (const { odo, isFuzzy } of rankedOdos.slice(0, maxCandidates)) {
    const mun = munMap.get(odo.code_municipalite);
    const munName = mun?.nom_municipalite ?? odo.code_municipalite;
    const rangeRow = await db
      .prepare(
        "SELECT MIN(numero_municipal) AS min_n, MAX(numero_municipal) AS max_n FROM adresses_civiques WHERE odo_id = ?",
      )
      .bind(odo.id)
      .first<{ min_n: number | null; max_n: number | null }>();

    if (isFuzzy && noCivicCandidates.length === 0) {
      corrections.push(
        `Odonyme rapproché : '${parsed.rawStreetSpecific}' → '${odo.odonyme_long}', mais le numéro civique ${parsed.civicNumber} est absent du RQA`,
      );
    } else if (noCivicCandidates.length === 0) {
      corrections.push(
        `L'odonyme '${odo.odonyme_long}' existe à ${munName}, mais le numéro civique ${parsed.civicNumber} n'est pas répertorié au RQA`,
      );
    }

    noCivicCandidates.push({
      id_adresse: null,
      seqodo: odo.seqodo,
      adresse_normalisee: formatNormalizedQuebecAddress({
        civic: null,
        suffix: "",
        odonymeLong: odo.odonyme_long,
        unitNumber: "",
        unitLabel: null,
        municipalite: munName,
        postalCode: null,
      }),
      composantes: {
        numero_municipal: null,
        suffixe: null,
        unite: null,
        type_unite: null,
        generique_odonyme: odo.generique ?? null,
        particule_odonyme: odo.particule ?? null,
        specifique_odonyme: odo.specifique,
        point_cardinal: odo.cardinal ?? null,
        odonyme_complet: odo.odonyme_normal,
        code_municipalite: odo.code_municipalite,
        municipalite: munName,
        mrc: mun?.mrc ?? null,
        region_administrative: mun?.region_administrative ?? null,
        province: "Québec",
        code_postal: null,
      },
      etat_rqa: null,
      categorie_rqa: null,
      plage_civique_rue:
        rangeRow && rangeRow.min_n !== null && rangeRow.max_n !== null
          ? { min: Number(rangeRow.min_n), max: Number(rangeRow.max_n) }
          : null,
      district_judiciaire_probable: resolveProbableDistrict(munName),
      lots_cadastraux: [],
      matricule_evaluation: null,
      lot_source: "absent",
      repli_immeuble_parent: false,
      ambiguites_cadastrales: [],
      coordonnees: null,
    });
  }

  return buildFinalAdresseResult({
    status: "street_only_no_civic_match",
    candidates: noCivicCandidates,
    corrections,
    verifiedAt,
    rawQuerySummary: input.address ?? `${parsed.civicNumber} ${input.street ?? ""}`,
  });
}

function buildFinalAdresseResult(opts: {
  status: MatchStatus;
  candidates: z.infer<typeof CandidatAdresseSchema>[];
  corrections: string[];
  verifiedAt: string;
  rawQuerySummary: string;
  outsideProvinceLabel?: string;
}): { ok: true; structured: AdresseVerifyOutput; text: string } {
  const gardes: Garde[] = [
    makeGarde("ADRESSE_EXISTENCE_CIVIQUE_NON_DOMICILE"),
    makeGarde("ADRESSE_LOT_ET_MATRICULE_SANS_VALEUR_LEGALE"),
  ];
  if (
    opts.status !== "exact_civic" &&
    opts.status !== "outside_quebec" &&
    opts.status !== "not_found"
  ) {
    gardes.push(makeGarde("ADRESSE_CORRESPONDANCE_APPROXIMATIVE"));
  }
  const hasMultiOrCoownership = opts.candidates.some((c) =>
    c.ambiguites_cadastrales.some(
      (a) =>
        a === "lots_multiples" ||
        a === "copropriete_divise_ou_multi_unites" ||
        a === "lot_partage_avec_immeuble_parent" ||
        a === "lot_associe_a_plusieurs_adresses",
    ),
  );
  if (hasMultiOrCoownership) {
    gardes.push(makeGarde("ADRESSE_LOT_MULTI_OU_COPROPRIETE"));
  }
  if (opts.candidates.some((c) => c.repli_immeuble_parent)) {
    gardes.push(makeGarde("ADRESSE_LOT_OU_MATRICULE_IMMEUBLE_PARENT"));
  }

  const bestAddr =
    opts.status === "exact_civic" ||
    opts.status === "exact_civic_unit_unconfirmed" ||
    opts.status === "fuzzy_street_exact_civic"
      ? (opts.candidates[0]?.adresse_normalisee ?? null)
      : null;

  const structured: AdresseVerifyOutput = {
    status: opts.status,
    adresse_normalisee: bestAddr,
    corrections_appliquees: opts.corrections,
    candidates: opts.candidates,
    provenance: {
      source:
        "Référentiel québécois des adresses (RQA) et Odonymes et renvois — Ministère des Ressources naturelles et des Forêts (MRNF, CC BY 4.0)",
      verified_at: opts.verifiedAt,
    },
    gardes,
  };

  const labelCounts = new Map<string, number>();
  for (const c of opts.candidates) {
    labelCounts.set(c.adresse_normalisee, (labelCounts.get(c.adresse_normalisee) ?? 0) + 1);
  }

  const candLines = opts.candidates.map((c, idx) => {
    const duplicateLabel = (labelCounts.get(c.adresse_normalisee) ?? 0) > 1;
    const lotsStr =
      c.lots_cadastraux.length > 0
        ? ` | Lots RQA (indicatifs, source=${c.lot_source}) : ${c.lots_cadastraux.join(", ")}`
        : ` | Lots RQA : aucun (source=${c.lot_source})`;
    const ambStr =
      c.ambiguites_cadastrales.length > 0
        ? ` | Ambiguïtés cadastrales : ${c.ambiguites_cadastrales.join(", ")}`
        : "";
    const matStr = c.matricule_evaluation ? ` | Matricule : ${c.matricule_evaluation}` : "";
    const plageStr = c.plage_civique_rue
      ? ` | Plage civique répertoriée : ${c.plage_civique_rue.min} à ${c.plage_civique_rue.max}`
      : "";
    const diffAttrs: string[] = [];
    if (duplicateLabel) {
      if (c.id_adresse !== null) diffAttrs.push(`id_adresse=${c.id_adresse}`);
      if (c.seqodo) diffAttrs.push(`seqodo=${c.seqodo}`);
      diffAttrs.push(`code_mun=${c.composantes.code_municipalite}`);
      if (c.composantes.mrc) diffAttrs.push(`MRC=${c.composantes.mrc}`);
      if (c.composantes.region_administrative) {
        diffAttrs.push(`région=${c.composantes.region_administrative}`);
      }
      if (c.composantes.code_postal) diffAttrs.push(`code_postal=${c.composantes.code_postal}`);
      if (c.composantes.unite) diffAttrs.push(`unité=${c.composantes.unite}`);
      if (c.coordonnees) {
        diffAttrs.push(
          `coord=${c.coordonnees.latitude.toFixed(5)},${c.coordonnees.longitude.toFixed(5)}`,
        );
      }
    }
    const diffStr = diffAttrs.length > 0 ? ` | ${diffAttrs.join(", ")}` : "";
    const distStr = c.district_judiciaire_probable
      ? `\n  District judiciaire probable : ${c.district_judiciaire_probable.district} (greffes ${c.district_judiciaire_probable.greffes.join(", ")}) — sous réserve`
      : "";
    return `${idx + 1}. ${c.adresse_normalisee} [état=${c.etat_rqa ?? "rue seule"}, cat=${c.categorie_rqa ?? "n/d"}${plageStr}${lotsStr}${ambStr}${matStr}${diffStr}]${distStr}`;
  });

  const corrLines =
    opts.corrections.length > 0
      ? ["", "Normalisations et observations :", ...opts.corrections.map((c) => `- ${c}`)]
      : [];

  const emptyMsg =
    opts.status === "outside_quebec"
      ? `Adresse hors Québec (« ${opts.outsideProvinceLabel ?? "hors province"} ») — hors du champ de couverture du RQA (qui couvre exclusivement les municipalités du Québec).`
      : "Aucune adresse ni voie correspondante trouvée au RQA.";

  const text = [
    `Vérification d'adresse au RQA pour « ${opts.rawQuerySummary.trim()} » — statut : ${opts.status}`,
    ...(bestAddr ? [`Adresse normalisée retenue : ${bestAddr}`] : []),
    ...(candLines.length > 0 ? ["", "Candidats :", ...candLines] : [emptyMsg]),
    ...corrLines,
    "",
    "Gardes :",
    ...gardes.map((g) => `- [${g.code}] ${g.message}`),
    `\nSource : ${structured.provenance.source} (diffusion ${opts.verifiedAt})`,
  ].join("\n");

  return { ok: true, structured, text };
}
