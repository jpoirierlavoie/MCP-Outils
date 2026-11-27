export function expandLigatures(raw: string): string {
  return raw
    .replace(/Œ/g, "OE")
    .replace(/œ/g, "oe")
    .replace(/Æ/g, "AE")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss");
}

export function expandLigatureFtsTokenVariants(tok: string): string[] {
  const out = new Set<string>([tok]);
  const lower = tok.toLowerCase();
  if (lower.includes("oe")) out.add(lower.replace(/oe/g, "œ"));
  if (lower.includes("ae")) out.add(lower.replace(/ae/g, "æ"));
  if (lower.includes("œ")) out.add(lower.replace(/œ/g, "oe"));
  if (lower.includes("æ")) out.add(lower.replace(/æ/g, "ae"));
  return Array.from(out);
}

export function foldLatinDiacritics(raw: string): string {
  return expandLigatures(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u02bc]/g, " ")
    .toLowerCase();
}

export function foldAsciiAlnum(raw: string): string {
  return foldLatinDiacritics(raw)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
