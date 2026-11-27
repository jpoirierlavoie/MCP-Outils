import type { Forum } from "./forums.js";
import { INDEX_PREFIXE_FORUM } from "./forums.js";
import type { Greffe } from "./greffes.js";
import type { Juridiction } from "./juridictions.js";
import { getForum, getGreffe, getJuridiction } from "./lookup.js";

interface DossierAnalyse {
  greffe_number: string | null;
  juridiction_number: string | null;
  greffe: Greffe | null;
  juridiction: Juridiction | null;

  forum: Forum | null;
  forum_key: string | null;
  is_administrative: boolean;
  parse_error: string | null;
  parse_warning?: string | null;
}

function vide(): DossierAnalyse {
  return {
    greffe_number: null,
    juridiction_number: null,
    greffe: null,
    juridiction: null,
    forum: null,
    forum_key: null,
    is_administrative: false,
    parse_error: null,
    parse_warning: null,
  };
}

const LETTRE = /\p{L}/u;

const TROIS_CHIFFRES = /^\d{3}$/;
const DEUX_CHIFFRES = /^\d{2}$/;

export function analyserNumeroDossier(brut: string): DossierAnalyse {
  const r = vide();

  if (!brut?.trim()) {
    r.parse_error = "Numéro de dossier judiciaire requis.";
    return r;
  }

  const propre = brut.trim();

  if (LETTRE.test(propre[0]!)) {
    let prefixe = "";
    for (const ch of propre) {
      if (LETTRE.test(ch) || ch === ".") prefixe += ch;
      else break;
    }
    const clef = INDEX_PREFIXE_FORUM[prefixe.toUpperCase().replaceAll(".", "")];
    if (clef) {
      r.forum = getForum(clef);
      r.forum_key = clef;
      r.is_administrative = r.forum?.category === "administratif";
    } else {
      r.is_administrative = true;
    }
    return r;
  }

  const propreTirets = propre.replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-");
  const dashNormalized = propreTirets !== propre;
  const parts = propreTirets.split("-");
  if (parts.length < 2) {
    r.parse_error = "Format invalide. Attendu : NNN-NN-NNNNNN-NNN (ex. : 500-05-123456-241)";
    return r;
  }

  const greffeStr = parts[0]!;
  const juridictionStr = parts[1]!;

  if (!TROIS_CHIFFRES.test(greffeStr)) {
    r.parse_error = `Le numéro de greffe « ${greffeStr} » doit être composé de 3 chiffres.`;
    return r;
  }
  if (!DEUX_CHIFFRES.test(juridictionStr)) {
    r.parse_error = `Le numéro de juridiction « ${juridictionStr} » doit être composé de 2 chiffres.`;
    return r;
  }

  r.greffe_number = greffeStr;
  r.juridiction_number = juridictionStr;
  r.greffe = getGreffe(greffeStr);
  r.juridiction = getJuridiction(juridictionStr);

  if (!r.greffe) {
    r.parse_error = `Greffe « ${greffeStr} » introuvable dans les données de référence.`;
  }
  if (!r.juridiction) {
    const deja = r.parse_error ?? "";
    const sep = deja ? " " : "";
    r.parse_error = `${deja}${sep}Juridiction « ${juridictionStr} » introuvable dans les données de référence.`;
  }

  const seqStr = parts[2] ?? "";
  const ctrlStr = parts[3] ?? "";
  const warnings: string[] = [];
  if (dashNormalized) {
    warnings.push("Tiret(s) typographique(s) normalisé(s) en tiret ASCII '-'.");
  }
  if (parts.length !== 4 || !/^\d{6}$/.test(seqStr) || !/^\d{3}$/.test(ctrlStr)) {
    warnings.push(
      "Numéro incomplet ou atypique au regard du gabarit complet NNN-NN-NNNNNN-NNN " +
        "(séquence à 6 chiffres et/ou contrôle à 3 chiffres absents ou non numériques) ; " +
        "seuls les segments greffe et juridiction ont été analysés.",
    );
  }
  if (warnings.length > 0) {
    r.parse_warning = warnings.join(" ");
  }

  return r;
}
