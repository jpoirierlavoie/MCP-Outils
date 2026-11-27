const NBSP = "\u00a0";

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

export function nombreFr(n: number): string {
  return n.toLocaleString("fr-CA").replace(/\u202f|\s/g, NBSP);
}

export function pluriel(n: number, singulier: string, pluriel_: string): string {
  return `${nombreFr(n)} ${n <= 1 ? singulier : pluriel_}`;
}

export function joindre(parts: ReadonlyArray<string | null | undefined>, sep = " · "): string {
  return parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0).join(sep);
}

function numeroter(index: number, bloc: string): string {
  const lignes = bloc.split("\n");
  const tete = `${index}. ${lignes[0] ?? ""}`;
  const suite = lignes.slice(1).map((l) => (l.length > 0 ? `   ${l}` : l));
  return [tete, ...suite].join("\n");
}

export function document(
  entete: string,
  blocs: readonly string[],
  pied?: string | null | undefined,
): string {
  const corps = blocs.map((b, i) => numeroter(i + 1, b)).join("\n\n");
  return [entete, corps, pied ?? ""].filter((s) => s.trim().length > 0).join("\n\n");
}

export const SANS_PLUMITIF =
  "Ce connecteur ne consulte AUCUN registre de dossiers : il n'a pas accès au plumitif.";

export const GARDE_PALAIS =
  "Adresses relevées auprès du ministère de la Justice du Québec le 2026-11-17.\n" +
  "Les palais de justice déménagent : VÉRIFIER la liste officielle du Ministère\n" +
  "avant toute signification ou tout dépôt.";

export const GARDE_SANS_ADRESSE =
  "Cela n'établit PAS qu'il n'en existe aucune : ce greffe siège en cour itinérante,\n" +
  "ou son adresse n'a pas été relevée. La demander au ministère de la Justice.";

export const GARDE_DOSSIER =
  "Cet outil lit une NOMENCLATURE : il n'établit pas que ce dossier existe, ni qu'il\n" +
  "est actif. Les positions 7 et suivantes (séquence et contrôle) ne sont pas\n" +
  "analysées — aucune somme de contrôle n'est vérifiée.";
