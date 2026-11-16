/**
 * Formatage français, pliage d'accents et gardes verbatim portés de
 * MCP-Jurisprudence pour les outils hors ligne `greffe_*` et `palais_*`.
 *
 * ⚠ NE JAMAIS REFORMULER les constantes `SANS_PLUMITIF`, `GARDE_PALAIS`,
 *   `GARDE_SANS_ADRESSE` ni `GARDE_DOSSIER` (contrat de vérité).
 */

/** Espace insécable fine, employée dans les milliers. */
const NBSP = "\u00a0";

/** Plie les diacritiques et ramène aux minuscules pour l'appariement de districts et noms. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Sépare les milliers par une espace insécable : « 1 843 ». */
export function nombreFr(n: number): string {
  return n.toLocaleString("fr-CA").replace(/\u202f|\s/g, NBSP);
}

/** « 1 localité » / « 3 localités » — accord du pluriel. */
export function pluriel(n: number, singulier: string, pluriel_: string): string {
  return `${nombreFr(n)} ${n <= 1 ? singulier : pluriel_}`;
}

/** Joint des fragments non vides par un séparateur. */
export function joindre(parts: ReadonlyArray<string | null | undefined>, sep = " · "): string {
  return parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0).join(sep);
}

/** Numérote un bloc et indente ses lignes de continuation. */
export function numeroter(index: number, bloc: string): string {
  const lignes = bloc.split("\n");
  const tete = `${index}. ${lignes[0] ?? ""}`;
  const suite = lignes.slice(1).map((l) => (l.length > 0 ? `   ${l}` : l));
  return [tete, ...suite].join("\n");
}

/** Assemble un document : titre, blocs numérotés, pied de mise en garde. */
export function document(
  entete: string,
  blocs: readonly string[],
  pied?: string | null | undefined,
): string {
  const corps = blocs.map((b, i) => numeroter(i + 1, b)).join("\n\n");
  return [entete, corps, pied ?? ""].filter((s) => s.trim().length > 0).join("\n\n");
}

/** `greffe_parse_number` — pied du numéro judiciaire. */
export const SANS_PLUMITIF =
  "Ce connecteur ne consulte AUCUN registre de dossiers : il n'a pas accès au plumitif.";

export const GARDE_PALAIS =
  "Adresses relevées auprès du ministère de la Justice du Québec le 2026-07-15.\n" +
  "Les palais de justice déménagent : VÉRIFIER la liste officielle du Ministère\n" +
  "avant toute signification ou tout dépôt.";

/**
 * Réserve sur l'ABSENCE d'adresse d'un greffe.
 *
 * Six greffes n'ont pas de `palais_key` (quatre cours itinérantes, deux qui n'en ont
 * tout simplement pas dans la source). Écrire « aucune adresse » sans autre forme de
 * procès fait croire qu'aucun greffe physique n'existe ; la réserve dit ce qui est vrai
 * — on ne l'a pas relevée — et renvoie à la source qui sait.
 */
export const GARDE_SANS_ADRESSE =
  "Cela n'établit PAS qu'il n'en existe aucune : ce greffe siège en cour itinérante,\n" +
  "ou son adresse n'a pas été relevée. La demander au ministère de la Justice.";

/** `greffe_parse_number` — pied, toute issue. */
export const GARDE_DOSSIER =
  "Cet outil lit une NOMENCLATURE : il n'établit pas que ce dossier existe, ni qu'il\n" +
  "est actif. Les positions 7 et suivantes (séquence et contrôle) ne sont pas\n" +
  "analysées — aucune somme de contrôle n'est vérifiée.";
