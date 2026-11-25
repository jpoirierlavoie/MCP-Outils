import { z } from "zod";
import talCriteresJson from "../data/tal_criteres.json" with { type: "json" };
import { addDays, parseIsoDate } from "./dates.js";
import { GardeSchema, makeGarde, ProvenanceSchema } from "./gardes.js";
import { formatCentsToCad } from "./interest1619.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const TalModeSchema = z.enum(["calcul_2026", "bareme", "schl"]);
export type TalMode = z.infer<typeof TalModeSchema>;

export const BeneficiaryScopeSchema = z.enum(["all_units", "residential_only", "target_unit_only"]);
export type BeneficiaryScope = z.infer<typeof BeneficiaryScopeSchema>;

export const CmhcStructureTypeSchema = z.enum([
  "row_and_apartment_3_plus",
  "apartment_3_plus",
  "apartment_6_plus",
  "row_3_plus",
]);
export type CmhcStructureType = z.infer<typeof CmhcStructureTypeSchema>;

export const CmhcUnitTypeSchema = z.enum([
  "all",
  "bachelor",
  "one_bedroom",
  "two_bedroom",
  "three_bedroom",
]);
export type CmhcUnitType = z.infer<typeof CmhcUnitTypeSchema>;

export const CapitalWorkItemSchema = z.strictObject({
  label: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe("Libellé des travaux majeurs (p. ex. 'Réfection toiture')."),
  gross_amount_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .describe("Coût brut total des travaux d'immobilisation en cents."),
  grant_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .optional()
    .describe(
      "Subvention gouvernementale, municipale ou d'utilité publique en cents (art. 13 al. 2).",
    ),
  third_party_indemnity_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .optional()
    .describe("Indemnité d'assurance ou d'un tiers en cents (art. 13 al. 3)."),
  reduced_interest_loan_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .optional()
    .describe("Capital d'un prêt à intérêt réduit finançant la dépense en cents (art. 3 al. 4)."),
  annual_loan_repayment_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .optional()
    .describe(
      "Remboursement annuel en capital et intérêts du prêt réduit en cents (art. 3 al. 4).",
    ),
  target_unit_benefits: z
    .boolean()
    .optional()
    .describe("Indique si le logement visé bénéficie de ces travaux (défaut : true)."),
  beneficiary_scope: BeneficiaryScopeSchema.optional().describe(
    "Portée des unités bénéficiaires si beneficiary_rents_monthly_cents est omis : 'all_units' (défaut), 'residential_only' ou 'target_unit_only'.",
  ),
  beneficiary_rents_monthly_cents: z
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .optional()
    .describe(
      "Somme explicite des loyers mensuels des unités bénéficiaires en cents (art. 5 al. 2).",
    ),
});
export type CapitalWorkItem = z.infer<typeof CapitalWorkItemSchema>;

export const NewExpenseItemSchema = z.strictObject({
  label: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe("Libellé du nouveau service, accessoire ou dépendance (art. 3 par. 6°)."),
  annual_amount_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .describe("Dépense annuelle estimée pour une année complète en cents."),
  grant_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .optional()
    .describe("Aide publique annuelle déductible en cents (art. 13 al. 2)."),
  target_unit_benefits: z
    .boolean()
    .optional()
    .describe("Indique si le logement visé bénéficie de cette dépense (défaut : true)."),
  beneficiary_scope: BeneficiaryScopeSchema.optional().describe(
    "Portée des unités bénéficiaires si beneficiary_rents_monthly_cents est omis : 'all_units' (défaut), 'residential_only' ou 'target_unit_only'.",
  ),
  beneficiary_rents_monthly_cents: z
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .optional()
    .describe("Somme explicite des loyers mensuels des unités bénéficiaires en cents."),
});
export type NewExpenseItem = z.infer<typeof NewExpenseItemSchema>;

export const AidVariationItemSchema = z.strictObject({
  label: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe("Libellé de l'aide à un service offert aux locataires (art. 13 al. 4)."),
  previous_annual_aid_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .describe("Aide annuelle reçue pour la période précédente en cents."),
  current_annual_aid_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .describe("Aide annuelle reçue pour la période de référence en cents."),
  target_unit_benefits: z
    .boolean()
    .optional()
    .describe("Indique si le logement visé bénéficie de ce service (défaut : true)."),
  beneficiary_scope: BeneficiaryScopeSchema.optional().describe(
    "Portée des unités bénéficiaires : 'all_units' (défaut), 'residential_only' ou 'target_unit_only'.",
  ),
  beneficiary_rents_monthly_cents: z
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .optional()
    .describe("Somme explicite des loyers mensuels des unités bénéficiaires en cents."),
});
export type AidVariationItem = z.infer<typeof AidVariationItemSchema>;

export const LoyerTalInputSchema = z.strictObject({
  mode: TalModeSchema.describe(
    "Mode d'opération : 'calcul_2026' (calculateur post-1er janv. 2026 selon RLRQ, c. T-15.01, r. 2), 'bareme' (pourcentages publiés 2015–2027) ou 'schl' (loyers moyens du marché StatCan 34-10-0133-01).",
  ),
  year: z
    .number()
    .int()
    .min(1987)
    .max(2027)
    .optional()
    .describe(
      "Année ciblée pour 'bareme' (2015–2027) ou 'schl' (1987–2025+, défaut : plus récente).",
    ),
  notice_date: z
    .string()
    .regex(ISO_DATE_RE)
    .optional()
    .describe(
      "Date de l'avis de modification (art. 1942 C.c.Q.) au format YYYY-MM-DD : un avis < 2026-01-01 déclenche le régime transitoire pré-2026 (art. 6 Décret 1455-2025).",
    ),
  lease_renewal_date: z
    .string()
    .regex(ISO_DATE_RE)
    .optional()
    .describe(
      "Date de début du bail renouvelé (YYYY-MM-DD, requis en 'calcul_2026') déterminant le terme du bail (veille) et la période de référence (art. 1).",
    ),
  section_f_exemption_5_ans: z
    .boolean()
    .optional()
    .describe(
      "True si l'immeuble est visé par l'exemption de 5 ans inscrite à la Section F du bail (art. 1955 C.c.Q.).",
    ),
  current_rent_cents: z
    .number()
    .int()
    .min(1)
    .max(100_000_000)
    .optional()
    .describe("Loyer mensuel actuel du logement en cents entiers (requis en 'calcul_2026')."),
  is_rpa: z
    .boolean()
    .optional()
    .describe("True si le logement est situé dans une résidence privée pour aînés (art. 4.1)."),
  rpa_personal_services_cents: z
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .optional()
    .describe(
      "Part mensuelle du loyer afférente aux services rattachés à la personne en RPA en cents (art. 4.1 par. 2°).",
    ),
  building_residential_rents_cents: z
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .optional()
    .describe(
      "Somme des loyers mensuels résidentiels de l'immeuble (loués, inoccupés, locateur) en cents ; défaut : current_rent_cents.",
    ),
  building_non_residential_rents_cents: z
    .number()
    .int()
    .min(0)
    .max(1_000_000_000)
    .optional()
    .describe("Somme des loyers mensuels des locaux non résidentiels en cents (défaut : 0)."),
  other_annual_revenue_cents: z
    .number()
    .int()
    .min(0)
    .max(1_000_000_000)
    .optional()
    .describe(
      "Autres revenus annuels d'exploitation de l'immeuble en cents (stationnement, buanderie, etc. ; défaut : 0).",
    ),
  municipal_taxes_prev_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .optional()
    .describe(
      "Taxes foncières municipales et de services de la période de référence en cents (art. 4 al. 1 par. 1°).",
    ),
  municipal_taxes_curr_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .optional()
    .describe(
      "Taxes foncières municipales et de services de l'année suivante en cents (art. 4 al. 1 par. 1°).",
    ),
  school_taxes_prev_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .optional()
    .describe(
      "Taxes foncières scolaires de l'année précédant la période de référence en cents (art. 4 al. 1 par. 2°).",
    ),
  school_taxes_curr_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .optional()
    .describe(
      "Taxes foncières scolaires de la période de référence en cents (art. 4 al. 1 par. 2°).",
    ),
  insurance_prev_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .optional()
    .describe(
      "Primes d'assurance incendie et responsabilité (max 12 mois) de l'année précédant la période de référence en cents.",
    ),
  insurance_curr_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .optional()
    .describe(
      "Primes d'assurance incendie et responsabilité (max 12 mois) de la période de référence en cents.",
    ),
  snow_removal_prev_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .optional()
    .describe(
      "Frais de déneigement de l'année précédant la période de référence (parc de maisons mobiles, art. 12.1) en cents.",
    ),
  snow_removal_curr_cents: z
    .number()
    .int()
    .min(0)
    .max(10_000_000_000)
    .optional()
    .describe(
      "Frais de déneigement de la période de référence (parc de maisons mobiles, art. 12.1) en cents.",
    ),
  capital_works: z
    .array(CapitalWorkItemSchema)
    .max(30)
    .optional()
    .describe(
      "Dépenses d'immobilisation réalisées pendant la période de référence (taux fixe 5 %, art. 3 par. 5° et art. 13).",
    ),
  new_expenses: z
    .array(NewExpenseItemSchema)
    .max(30)
    .optional()
    .describe(
      "Nouvelles dépenses d'exploitation pour mise en place d'un service ou ajout d'accessoire (art. 3 par. 6°).",
    ),
  aid_variations: z
    .array(AidVariationItemSchema)
    .max(30)
    .optional()
    .describe(
      "Variations d'aide gouvernementale ou municipale à un service offert aux locataires (art. 13 al. 4).",
    ),
  cmhc_geo: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .optional()
    .describe(
      "Nom ou identifiant numérique StatCan du centre urbain SCHL (p. ex. 'Montréal', 'Québec', 'Gatineau', 'Sherbrooke' ; défaut en mode 'schl' : principaux centres du Québec).",
    ),
  structure_type: CmhcStructureTypeSchema.optional().describe(
    "Type de structure SCHL : 'row_and_apartment_3_plus' (défaut), 'apartment_3_plus', 'apartment_6_plus' ou 'row_3_plus'.",
  ),
  unit_type: CmhcUnitTypeSchema.optional().describe(
    "Type d'unité SCHL : 'all' (défaut), 'bachelor', 'one_bedroom', 'two_bedroom' ou 'three_bedroom'.",
  ),
});
export type LoyerTalInput = z.infer<typeof LoyerTalInputSchema>;

const Post2026EntrySchema = z.object({
  reference_year: z.number().int(),
  lease_renewal_start: z.string(),
  lease_renewal_end: z.string(),
  base_rent_bps: z.number().int(),
  rpa_personal_services_bps: z.number().int(),
  capital_expenditures_bps: z.number().int(),
  official_ref: z.string(),
});

const Pre2026EntrySchema = z.object({
  year: z.number().int(),
  electricity_bps: z.number().int(),
  gas_bps: z.number().int(),
  oil_other_bps: z.number().int(),
  maintenance_bps: z.number().int(),
  services_bps: z.number().int(),
  rpa_personal_services_bps: z.number().int().nullable(),
  management_bps: z.number().int(),
  net_income_bps: z.number().int(),
  capital_expenditures_bps: z.number().int(),
});

const TalCalculationSchema = z.object({
  lease_term_date: z.string(),
  lease_renewal_date: z.string(),
  reference_year: z.number().int(),
  base_rent_bps: z.number().int(),
  rpa_personal_services_bps: z.number().int(),
  capital_expenditures_bps: z.number().int(),
  current_rent_cents: z.number().int(),
  current_rent_cad: z.string(),
  adj_base_cents: z.number().int(),
  adj_base_normal_cents: z.number().int(),
  adj_base_rpa_cents: z.number().int(),
  adj_municipal_taxes_cents: z.number().int(),
  adj_school_taxes_cents: z.number().int(),
  adj_insurance_cents: z.number().int(),
  adj_taxes_and_insurance_cents: z.number().int(),
  adj_capital_works_cents: z.number().int(),
  adj_new_expenses_cents: z.number().int(),
  adj_aid_variations_cents: z.number().int(),
  adj_snow_removal_cents: z.number().int(),
  total_adjustment_cents: z.number().int(),
  total_adjustment_cad: z.string(),
  unrounded_new_rent_cents: z.number().int(),
  unrounded_new_rent_cad: z.string(),
  new_rent_cents: z.number().int(),
  new_rent_dollars: z.number().int(),
  new_rent_cad: z.string(),
  effective_increase_bps: z.number().int(),
});

const CmhcCellSchema = z.object({
  unit_type: z.enum(["bachelor", "one_bedroom", "two_bedroom", "three_bedroom"]),
  unit_label_fr: z.string(),
  rent_dollars: z.number().int().nullable(),
  suppressed: z.boolean(),
});

const CmhcCentreResultSchema = z.object({
  geo_member_id: z.number().int(),
  geo_key: z.string(),
  name_fr: z.string(),
  name_en: z.string(),
  province_code: z.string(),
  is_quebec: z.boolean(),
  year: z.number().int(),
  structure_type: CmhcStructureTypeSchema,
  structure_label_fr: z.string(),
  uom: z.string(),
  cells: z.array(CmhcCellSchema),
});

export const LoyerTalOutputSchema = z.object({
  mode: TalModeSchema,
  regime: z.enum([
    "post_2026_calcul",
    "pre_2026_transitoire",
    "exemption_art_1955_ccq",
    "bareme_officiel",
    "schl_marche",
  ]),
  calculation: TalCalculationSchema.nullable(),
  bareme_post_2026: z.array(Post2026EntrySchema),
  bareme_pre_2026: z.array(Pre2026EntrySchema),
  cmhc_results: z.array(CmhcCentreResultSchema),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
export type LoyerTalOutput = z.infer<typeof LoyerTalOutputSchema>;

interface Rational {
  num: bigint;
  den: bigint;
}

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0n ? 1n : x;
}

function makeRational(num: bigint, den: bigint): Rational {
  if (den <= 0n) throw new RangeError("Dénominateur rationnel invalide.");
  if (num === 0n) return { num: 0n, den: 1n };
  const g = gcdBig(num, den);
  return { num: num / g, den: den / g };
}

function addRational(a: Rational, b: Rational): Rational {
  if (a.num === 0n) return b;
  if (b.num === 0n) return a;
  return makeRational(a.num * b.den + b.num * a.den, a.den * b.den);
}

/**
 * Arrondi demi vers +infini conforme à `Math.round` du calculateur JS officiel TAL.
 */
function roundHalfUpSigned(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError("Le dénominateur doit être strictement positif.");
  if (num >= 0n) {
    return (num * 2n + den) / (2n * den);
  }
  const absNum = -num;
  const q = absNum / den;
  const r = absNum % den;
  const roundedAbs = r * 2n > den ? q + 1n : q;
  return roundedAbs === 0n ? 0n : -roundedAbs;
}

function roundArt151Dollar(totalCents: bigint): bigint {
  if (totalCents <= 0n) return 0n;
  return roundHalfUpSigned(totalCents, 100n) * 100n;
}

function assertSafeInt(val: bigint, label: string): number {
  if (val > BigInt(Number.MAX_SAFE_INTEGER) || val < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Dépassement de capacité entière sécuritaire : ${label}.`);
  }
  return Number(val);
}

function computeArt4Component(
  prev: bigint,
  curr: bigint,
  share: Rational,
  absBaseBps: bigint,
): bigint {
  if (prev === 0n && curr === 0n) return 0n;
  if (curr <= prev) {
    return roundHalfUpSigned((curr - prev) * share.num, 12n * share.den);
  }
  const diff = curr - prev;
  if (diff * 10_000n <= absBaseBps * prev) {
    return 0n;
  }
  return roundHalfUpSigned(
    (diff * 10_000n - absBaseBps * prev) * share.num,
    10_000n * 12n * share.den,
  );
}

function resolveBeneficiaryDenom(
  scope: BeneficiaryScope | undefined,
  explicitMonthlyCents: number | undefined,
  currentRent: bigint,
  resTotal: bigint,
  nonResTotal: bigint,
): { ok: true; denom: bigint } | { ok: false; text: string } {
  let denom: bigint;
  if (explicitMonthlyCents !== undefined) {
    denom = BigInt(explicitMonthlyCents);
  } else {
    const resolvedScope = scope ?? "all_units";
    if (resolvedScope === "target_unit_only") {
      denom = currentRent;
    } else if (resolvedScope === "residential_only") {
      denom = resTotal;
    } else {
      denom = resTotal + nonResTotal;
    }
  }
  if (denom < currentRent) {
    return {
      ok: false,
      text: `La somme des loyers bénéficiaires (${formatCentsToCad(denom)} $) ne peut pas être inférieure au loyer du logement visé (${formatCentsToCad(currentRent)} $).`,
    };
  }
  return { ok: true, denom };
}

function formatBpsComma(bps: number): string {
  const neg = bps < 0;
  const abs = Math.abs(bps);
  return `${neg ? "-" : ""}${(abs / 100).toFixed(1).replace(".", ",")} %`;
}

function normalizeSearch(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

function buildCmhcQueryTerms(raw: string): string[] {
  const qNorm = normalizeSearch(raw);
  if (!qNorm) return [];

  const terms: string[] = [];
  const push = (t: string) => {
    const cleaned = t.trim();
    if (cleaned && !terms.includes(cleaned)) {
      terms.push(cleaned);
    }
  };

  push(qNorm);

  // Retirer uniquement un suffixe provincial en fin de chaîne (jamais le jeton ville seul)
  const strippedProv = qNorm
    .replace(
      /\s+(?:(?:ontario|new brunswick|nouveau brunswick)\s+quebec|saskatchewan\s+alberta|saskachewan\s+alberta|quebec|qc|ontario|on|new brunswick|nouveau brunswick|nb|alberta|ab|british columbia|colombie britannique|bc|manitoba|mb|nova scotia|nouvelle ecosse|ns|newfoundland and labrador|terre neuve et labrador|nl|prince edward island|ile du prince edouard|pe|pei|yukon|yt|northwest territories|territoires du nord ouest|nt|nunavut|nu)$/,
      "",
    )
    .trim();

  const mappedParts = strippedProv
    .replace(/\bquebec part\b/g, "partie quebecoise")
    .replace(/\bontario part\b/g, "partie ontarienne")
    .replace(/\bnew brunswick part\b/g, "partie nouveau brunswick")
    .trim();

  push(mappedParts);
  push(strippedProv);

  return terms;
}

const STRUCTURE_META: Record<CmhcStructureType, { id: number; labelFr: string }> = {
  apartment_3_plus: { id: 1, labelFr: "Immeubles d'appartements de 3 logements et plus" },
  row_3_plus: { id: 2, labelFr: "Logements en bandes de 3 logements et plus" },
  row_and_apartment_3_plus: {
    id: 3,
    labelFr: "Logements en bandes et immeubles d'appartements de 3 logements et plus",
  },
  apartment_6_plus: { id: 4, labelFr: "Immeubles d'appartements de 6 logements et plus" },
};

const UNIT_META: ReadonlyArray<{
  key: "bachelor" | "one_bedroom" | "two_bedroom" | "three_bedroom";
  id: number;
  labelFr: string;
}> = [
  { key: "bachelor", id: 1, labelFr: "Studio" },
  { key: "one_bedroom", id: 2, labelFr: "1 chambre" },
  { key: "two_bedroom", id: 3, labelFr: "2 chambres" },
  { key: "three_bedroom", id: 4, labelFr: "3 chambres" },
];

interface CmhcCentreRow {
  geo_member_id: number;
  geo_key: string;
  name_en: string;
  name_fr: string;
  search_norm: string;
  province_code: string;
  is_quebec: number;
  uom: string;
  first_year: number;
  last_year: number;
}

interface CmhcRentRow {
  unit_id: number;
  rent_dollars: number;
}

interface MetaSourceRow {
  source_key: string;
  version_date: string;
}

function buildPre2026List(yearFilter?: number): Array<z.infer<typeof Pre2026EntrySchema>> {
  const entries = Object.entries(talCriteresJson.pre_2026)
    .map(([yrStr, row]) => ({
      year: Number(yrStr),
      ...row,
    }))
    .sort((a, b) => b.year - a.year);
  if (yearFilter !== undefined) {
    return entries.filter((e) => e.year === yearFilter);
  }
  return entries;
}

export async function loyerTal(
  db: D1Database | null,
  input: LoyerTalInput,
): Promise<{ ok: true; structured: LoyerTalOutput; text: string } | { ok: false; text: string }> {
  // ── Mode 1 : Consultation des barèmes officiels TAL (2015–2027) ───────────
  if (input.mode === "bareme") {
    if (input.year !== undefined && (input.year < 2015 || input.year > 2027)) {
      return {
        ok: false,
        text: `Année '${input.year}' hors couverture des barèmes TAL embarqués (2015 à 2027).`,
      };
    }
    const postList =
      input.year === undefined
        ? [...talCriteresJson.post_2026]
        : input.year === 2026
          ? [...talCriteresJson.post_2026]
          : input.year === 2027
            ? talCriteresJson.post_2026.filter((e) => e.reference_year === 2025)
            : [];
    const preList = buildPre2026List(input.year);
    if (postList.length === 0 && preList.length === 0) {
      return {
        ok: false,
        text: `Aucun barème TAL embarqué pour l'année ${input.year}.`,
      };
    }
    const gardes = [makeGarde("TAL_POUVOIR_DISCRETIONNAIRE_FIXATION")];
    if (preList.length > 0) {
      gardes.push(makeGarde("TAL_REGIME_TRANSITOIRE_PRE_2026"));
    }
    const structured: LoyerTalOutput = {
      mode: "bareme",
      regime: "bareme_officiel",
      calculation: null,
      bareme_post_2026: postList,
      bareme_pre_2026: preList,
      cmhc_results: [],
      provenance: {
        source: talCriteresJson.metadata.source,
        verified_at: talCriteresJson.metadata.verified_at,
        table_version: talCriteresJson.metadata.table_version,
      },
      gardes,
    };
    return { ok: true, structured, text: formatTalText(structured) };
  }

  // ── Mode 2 : Loyers moyens du marché SCHL (StatCan 34-10-0133-01) ──────────
  if (input.mode === "schl") {
    if (!db) {
      return {
        ok: false,
        text: "Base D1 en lecture seule (DB_ECONOMIE — loyers moyens SCHL) non liée dans cet environnement d'exécution.",
      };
    }
    const structureType: CmhcStructureType = input.structure_type ?? "row_and_apartment_3_plus";
    const structMeta = STRUCTURE_META[structureType];
    const unitType: CmhcUnitType = input.unit_type ?? "all";
    const targetUnits =
      unitType === "all" ? UNIT_META : UNIT_META.filter((u) => u.key === unitType);

    let centres: CmhcCentreRow[] = [];
    if (!input.cmhc_geo) {
      const majorRes = await db
        .prepare(
          "SELECT geo_member_id, geo_key, name_en, name_fr, search_norm, province_code, is_quebec, uom, first_year, last_year " +
            "FROM cmhc_centres WHERE geo_member_id IN (46, 48, 37, 56, 64, 30) ORDER BY is_quebec DESC, geo_member_id ASC",
        )
        .all<CmhcCentreRow>();
      centres = majorRes.results ?? [];
      if (centres.length === 0) {
        const fallbackRes = await db
          .prepare(
            "SELECT geo_member_id, geo_key, name_en, name_fr, search_norm, province_code, is_quebec, uom, first_year, last_year " +
              "FROM cmhc_centres WHERE is_quebec = 1 ORDER BY geo_member_id ASC LIMIT 6",
          )
          .all<CmhcCentreRow>();
        centres = fallbackRes.results ?? [];
      }
    } else if (/^\d+$/.test(input.cmhc_geo.trim())) {
      const id = Number(input.cmhc_geo.trim());
      const row = await db
        .prepare(
          "SELECT geo_member_id, geo_key, name_en, name_fr, search_norm, province_code, is_quebec, uom, first_year, last_year " +
            "FROM cmhc_centres WHERE geo_member_id = ?",
        )
        .bind(id)
        .first<CmhcCentreRow>();
      if (row) centres = [row];
    } else {
      const queryTerms = buildCmhcQueryTerms(input.cmhc_geo);
      if (queryTerms.length > 0) {
        let exactRow: CmhcCentreRow | null = null;
        for (const term of queryTerms) {
          exactRow = await db
            .prepare(
              "SELECT geo_member_id, geo_key, name_en, name_fr, search_norm, province_code, is_quebec, uom, first_year, last_year " +
                "FROM cmhc_centres WHERE search_norm = ? ORDER BY is_quebec DESC, geo_member_id ASC LIMIT 1",
            )
            .bind(term)
            .first<CmhcCentreRow>();
          if (exactRow) break;
        }
        if (exactRow) {
          centres = [exactRow];
        } else {
          // Repli exact sur name_fr / name_en normalisés (ex. « Smiths Falls, Ontario » vs « Smith Falls »)
          const allCentresRes = await db
            .prepare(
              "SELECT geo_member_id, geo_key, name_en, name_fr, search_norm, province_code, is_quebec, uom, first_year, last_year " +
                "FROM cmhc_centres ORDER BY is_quebec DESC, geo_member_id ASC",
            )
            .all<CmhcCentreRow>();
          const allCentres = allCentresRes.results ?? [];
          const termSet = new Set(queryTerms);
          const nameMatched = allCentres.filter((c) => {
            const frNorm = normalizeSearch(c.name_fr);
            const enNorm = normalizeSearch(c.name_en);
            return termSet.has(frNorm) || termSet.has(enNorm) || termSet.has(c.search_norm);
          });
          if (nameMatched.length > 0) {
            centres = [nameMatched[0]!];
          } else {
            const likeTerm = queryTerms[1] ?? queryTerms[0]!;
            const likeRes = await db
              .prepare(
                "SELECT geo_member_id, geo_key, name_en, name_fr, search_norm, province_code, is_quebec, uom, first_year, last_year " +
                  "FROM cmhc_centres WHERE search_norm LIKE ? ESCAPE '\\' ORDER BY is_quebec DESC, LENGTH(search_norm) ASC LIMIT 10",
              )
              .bind(`%${escapeLikePattern(likeTerm)}%`)
              .all<CmhcCentreRow>();
            const candidates = likeRes.results ?? [];
            if (candidates.length === 1) {
              centres = candidates;
            } else if (candidates.length > 1) {
              // Préférer le centre québécois si unique ou correspondance forte (ex. 'gatineau' -> partie québécoise)
              const qcCandidates = candidates.filter((c) => c.is_quebec === 1);
              if (qcCandidates.length === 1) {
                centres = qcCandidates;
              } else {
                const listLabel = candidates
                  .slice(0, 8)
                  .map((c) => `${c.name_fr} (id=${c.geo_member_id})`)
                  .join(", ");
                return {
                  ok: false,
                  text: `Plusieurs centres SCHL correspondent à « ${input.cmhc_geo} » : ${listLabel}. Préciser le nom exact ou l'identifiant numérique.`,
                };
              }
            }
          }
        }
      }
    }

    if (centres.length === 0) {
      return {
        ok: false,
        text: `Aucun centre urbain SCHL trouvé pour « ${input.cmhc_geo ?? ""} » dans Statistique Canada 34-10-0133-01.`,
      };
    }

    const metaRow = await db
      .prepare(
        "SELECT source_key, version_date FROM meta_sources WHERE source_key = 'statcan_cmhc_rents'",
      )
      .first<MetaSourceRow>();

    const cmhcResults: Array<z.infer<typeof CmhcCentreResultSchema>> = [];
    for (const c of centres) {
      const targetYear = input.year ?? c.last_year;
      if (targetYear < c.first_year || targetYear > c.last_year) {
        return {
          ok: false,
          text: `Année ${targetYear} hors plage SCHL pour ${c.name_fr} (disponible : ${c.first_year} à ${c.last_year}). Aucune extrapolation n'est effectuée.`,
        };
      }
      const rentsRes = await db
        .prepare(
          "SELECT unit_id, rent_dollars FROM cmhc_rents " +
            "WHERE geo_member_id = ? AND year = ? AND structure_id = ?",
        )
        .bind(c.geo_member_id, targetYear, structMeta.id)
        .all<CmhcRentRow>();
      const byUnit = new Map<number, number>(
        (rentsRes.results ?? []).map((r) => [r.unit_id, r.rent_dollars]),
      );

      const cells = targetUnits.map((u) => {
        const val = byUnit.get(u.id);
        return {
          unit_type: u.key,
          unit_label_fr: u.labelFr,
          rent_dollars: val ?? null,
          suppressed: val === undefined,
        };
      });

      cmhcResults.push({
        geo_member_id: c.geo_member_id,
        geo_key: c.geo_key,
        name_fr: c.name_fr,
        name_en: c.name_en,
        province_code: c.province_code,
        is_quebec: Boolean(c.is_quebec),
        year: targetYear,
        structure_type: structureType,
        structure_label_fr: structMeta.labelFr,
        uom: c.uom,
        cells,
      });
    }

    const verifiedAt = metaRow?.version_date ?? "2025-12-17";
    const structured: LoyerTalOutput = {
      mode: "schl",
      regime: "schl_marche",
      calculation: null,
      bareme_post_2026: [],
      bareme_pre_2026: [],
      cmhc_results: cmhcResults,
      provenance: {
        source:
          "Statistique Canada / SCHL — Tableau 34-10-0133-01 (loyers moyens du marché, enquête d'octobre)",
        verified_at: verifiedAt,
        table_version: verifiedAt,
      },
      gardes: [makeGarde("SCHL_LOYER_MOYEN_INDICATIF")],
    };
    return { ok: true, structured, text: formatTalText(structured) };
  }

  // ── Mode 3 : Calculateur post-1er janvier 2026 (RLRQ, c. T-15.01, r. 2) ────
  if (!input.lease_renewal_date) {
    return {
      ok: false,
      text: "Le paramètre 'lease_renewal_date' (date de début du bail renouvelé, YYYY-MM-DD) est requis en mode 'calcul_2026'.",
    };
  }
  if (input.current_rent_cents === undefined) {
    return {
      ok: false,
      text: "Le paramètre 'current_rent_cents' (loyer mensuel actuel en cents) est requis en mode 'calcul_2026'.",
    };
  }

  try {
    parseIsoDate(input.lease_renewal_date);
    if (input.notice_date !== undefined) {
      parseIsoDate(input.notice_date);
    }
  } catch (err) {
    return {
      ok: false,
      text: err instanceof Error ? err.message : "Date ISO invalide.",
    };
  }

  // Validation des paires de charges
  for (const [label, a, b] of [
    ["taxes municipales", input.municipal_taxes_prev_cents, input.municipal_taxes_curr_cents],
    ["taxes scolaires", input.school_taxes_prev_cents, input.school_taxes_curr_cents],
    ["assurances", input.insurance_prev_cents, input.insurance_curr_cents],
    ["déneigement", input.snow_removal_prev_cents, input.snow_removal_curr_cents],
  ] as const) {
    if ((a !== undefined) !== (b !== undefined)) {
      return {
        ok: false,
        text: `Paramètre incomplet pour ${label} : fournir simultanément les montants précédent et courant.`,
      };
    }
  }

  if (
    input.rpa_personal_services_cents !== undefined &&
    input.rpa_personal_services_cents > 0 &&
    !input.is_rpa
  ) {
    return {
      ok: false,
      text: "rpa_personal_services_cents > 0 requiert is_rpa=true (art. 4.1 Règlement sur les critères de fixation de loyer).",
    };
  }

  // Cas T1 : Avis donné avant le 1er janvier 2026 -> Régime transitoire (art. 6 Décret 1455-2025)
  if (input.notice_date !== undefined && input.notice_date < "2026-01-01") {
    const { year: renewalYear } = parseIsoDate(input.lease_renewal_date);
    const clampedPreYear = Math.min(2026, Math.max(2015, renewalYear));
    const preList = buildPre2026List(clampedPreYear);
    const gardes = [
      makeGarde(
        "TAL_REGIME_TRANSITOIRE_PRE_2026",
        `Avis daté du ${input.notice_date} (< 2026-01-01) : calculateur 2026 inapplicable.`,
      ),
    ];
    if (input.section_f_exemption_5_ans === true) {
      gardes.push(makeGarde("TAL_EXEMPTION_CINQ_ANS_ART_1955_CCQ"));
    }
    gardes.push(makeGarde("TAL_POUVOIR_DISCRETIONNAIRE_FIXATION"));
    const structured: LoyerTalOutput = {
      mode: "calcul_2026",
      regime: "pre_2026_transitoire",
      calculation: null,
      bareme_post_2026: [],
      bareme_pre_2026: preList,
      cmhc_results: [],
      provenance: {
        source: talCriteresJson.metadata.source,
        verified_at: talCriteresJson.metadata.verified_at,
        table_version: talCriteresJson.metadata.table_version,
      },
      gardes,
    };
    return { ok: true, structured, text: formatTalText(structured) };
  }

  // Cas T2 : Exemption de 5 ans (art. 1955 C.c.Q., Section F du bail)
  if (input.section_f_exemption_5_ans === true) {
    const structured: LoyerTalOutput = {
      mode: "calcul_2026",
      regime: "exemption_art_1955_ccq",
      calculation: null,
      bareme_post_2026: [],
      bareme_pre_2026: [],
      cmhc_results: [],
      provenance: {
        source: talCriteresJson.metadata.source,
        verified_at: talCriteresJson.metadata.verified_at,
        table_version: talCriteresJson.metadata.table_version,
      },
      gardes: [
        makeGarde("TAL_EXEMPTION_CINQ_ANS_ART_1955_CCQ"),
        makeGarde("TAL_POUVOIR_DISCRETIONNAIRE_FIXATION"),
      ],
    };
    return { ok: true, structured, text: formatTalText(structured) };
  }

  // Terme du bail (veille du début du bail renouvelé) & période de référence (art. 1)
  const leaseTermDate = addDays(input.lease_renewal_date, -1);
  const { year: termYear, month: termMonth } = parseIsoDate(leaseTermDate);
  const referenceYear = termMonth >= 4 ? termYear - 1 : termYear - 2;

  if (input.lease_renewal_date < "2026-01-01") {
    return {
      ok: false,
      text: `Date de renouvellement (${input.lease_renewal_date}) antérieure au 2026-01-01 : relève du régime pré-2026 (utiliser mode='bareme' ou fournir notice_date < 2026-01-01).`,
    };
  }

  const regimeEntry = talCriteresJson.post_2026.find((e) => e.reference_year === referenceYear);
  if (!regimeEntry) {
    return {
      ok: false,
      text: `Aucun pourcentage TAL publié/vérifié dans tal_criteres.json pour l'année de référence ${referenceYear} (renouvellement ${input.lease_renewal_date}, couvert jusqu'au ${talCriteresJson.metadata.last_lease_renewal_end_date}). Aucune extrapolation n'est effectuée.`,
    };
  }

  const currentRent = BigInt(input.current_rent_cents);
  const rpaServices = input.is_rpa ? BigInt(input.rpa_personal_services_cents ?? 0) : 0n;
  if (rpaServices > currentRent) {
    return {
      ok: false,
      text: `La part des services personnels RPA (${formatCentsToCad(rpaServices)} $) ne peut pas excéder le loyer total (${formatCentsToCad(currentRent)} $).`,
    };
  }

  const resTotal = BigInt(input.building_residential_rents_cents ?? input.current_rent_cents);
  if (resTotal < currentRent) {
    return {
      ok: false,
      text: `Les loyers résidentiels de l'immeuble (${formatCentsToCad(resTotal)} $) ne peuvent pas être inférieurs au loyer du logement visé (${formatCentsToCad(currentRent)} $).`,
    };
  }
  const nonResTotal = BigInt(input.building_non_residential_rents_cents ?? 0);
  const otherRevAnnual = BigInt(input.other_annual_revenue_cents ?? 0);

  // Étape 1 : Pourcentage de base & RPA (art. 3 par. 1°, art. 3.1 al. 3, art. 4.1)
  const rawBaseBps = BigInt(regimeEntry.base_rent_bps);
  const effectiveBaseBps = rawBaseBps > 0n ? rawBaseBps : 0n;
  const absBaseBps = rawBaseBps < 0n ? -rawBaseBps : rawBaseBps;
  const rawRpaBps = BigInt(regimeEntry.rpa_personal_services_bps);
  const effectiveRpaBps = rawRpaBps > 0n ? rawRpaBps : 0n;

  let adjBaseNormalCents = 0n;
  let adjBaseRpaCents = 0n;
  let adjBaseCents = 0n;
  if (input.is_rpa) {
    const normalRent = currentRent - rpaServices;
    adjBaseNormalCents = roundHalfUpSigned(normalRent * effectiveBaseBps, 10_000n);
    adjBaseRpaCents = roundHalfUpSigned(rpaServices * effectiveRpaBps, 10_000n);
    adjBaseCents = adjBaseNormalCents + adjBaseRpaCents;
  } else {
    adjBaseCents = roundHalfUpSigned(currentRent * effectiveBaseBps, 10_000n);
    adjBaseNormalCents = adjBaseCents;
  }

  // Étape 2 : Parts attribuables (art. 5 & parité outil JS officiel TAL)
  const poidLoyer = makeRational(currentRent, resTotal);
  const poidLoyerPlf = makeRational(
    currentRent * 12n,
    (resTotal + nonResTotal) * 12n + otherRevAnnual,
  );
  const taxShare = nonResTotal > 0n ? poidLoyerPlf : poidLoyer;
  const insurAndSnowShare = poidLoyerPlf;

  // Étape 3 : Taxes municipales, taxes scolaires et assurances (art. 4)
  const munPrev = BigInt(input.municipal_taxes_prev_cents ?? 0);
  const munCurr = BigInt(input.municipal_taxes_curr_cents ?? 0);
  if (munPrev === 0n && munCurr > 0n) {
    return {
      ok: false,
      text: "Taxes municipales précédentes nulles alors que les taxes courantes sont > 0 : variation en pourcentage indéfinie (art. 4).",
    };
  }
  const scolPrev = BigInt(input.school_taxes_prev_cents ?? 0);
  const scolCurr = BigInt(input.school_taxes_curr_cents ?? 0);
  if (scolPrev === 0n && scolCurr > 0n) {
    return {
      ok: false,
      text: "Taxes scolaires précédentes nulles alors que les taxes courantes sont > 0 : variation en pourcentage indéfinie (art. 4).",
    };
  }
  const insPrev = BigInt(input.insurance_prev_cents ?? 0);
  const insCurr = BigInt(input.insurance_curr_cents ?? 0);
  if (insPrev === 0n && insCurr > 0n) {
    return {
      ok: false,
      text: "Prime d'assurance précédente nulle alors que la prime courante est > 0 : variation en pourcentage indéfinie (art. 4).",
    };
  }

  const adjMunCents = computeArt4Component(munPrev, munCurr, taxShare, absBaseBps);
  const adjScolCents = computeArt4Component(scolPrev, scolCurr, taxShare, absBaseBps);
  const adjInsCents = computeArt4Component(insPrev, insCurr, insurAndSnowShare, absBaseBps);
  const adjTaxesAssurCents = adjMunCents + adjScolCents + adjInsCents;

  // Étape 4 : Dépenses d'immobilisation (5 %, art. 3 par. 5° & al. 4, art. 13)
  const capBps = BigInt(regimeEntry.capital_expenditures_bps);
  let immoAcc: Rational = { num: 0n, den: 1n };
  for (const item of input.capital_works ?? []) {
    if (item.target_unit_benefits === false) continue;
    const gross = BigInt(item.gross_amount_cents);
    const grant = BigInt(item.grant_cents ?? 0);
    const indemnity = BigInt(item.third_party_indemnity_cents ?? 0);
    const rawNet = gross - grant - indemnity;
    const net = rawNet > 0n ? rawNet : 0n;

    const loan = BigInt(item.reduced_interest_loan_cents ?? 0);
    if (loan > 0n) {
      if (loan > net) {
        return {
          ok: false,
          text: `Prêt à intérêt réduit (${formatCentsToCad(loan)} $) supérieur à la dépense nette (${formatCentsToCad(net)} $) pour ${item.label ?? "travaux"}.`,
        };
      }
      if (item.annual_loan_repayment_cents === undefined) {
        return {
          ok: false,
          text: `annual_loan_repayment_cents requis lorsqu'un prêt à intérêt réduit est déclaré (${item.label ?? "travaux"}).`,
        };
      }
    }

    const denomRes = resolveBeneficiaryDenom(
      item.beneficiary_scope,
      item.beneficiary_rents_monthly_cents,
      currentRent,
      resTotal,
      nonResTotal,
    );
    if (!denomRes.ok) return denomRes;

    let itemNum = net * capBps;
    if (loan > 0n) {
      const repay = BigInt(item.annual_loan_repayment_cents!);
      if (capBps * loan > 10_000n * repay) {
        itemNum += repay * 10_000n - capBps * loan;
      }
    }
    immoAcc = addRational(
      immoAcc,
      makeRational(itemNum * currentRent, 10_000n * 12n * denomRes.denom),
    );
  }
  const adjImmoCents = immoAcc.num <= 0n ? 0n : roundHalfUpSigned(immoAcc.num, immoAcc.den);

  // Étape 5 : Nouvelles dépenses d'exploitation & variations d'aide (art. 3 par. 6°, art. 13 al. 4)
  let nouvAcc: Rational = { num: 0n, den: 1n };
  for (const item of input.new_expenses ?? []) {
    if (item.target_unit_benefits === false) continue;
    const annual = BigInt(item.annual_amount_cents);
    const grant = BigInt(item.grant_cents ?? 0);
    const netAnnual = annual > grant ? annual - grant : 0n;
    const denomRes = resolveBeneficiaryDenom(
      item.beneficiary_scope,
      item.beneficiary_rents_monthly_cents,
      currentRent,
      resTotal,
      nonResTotal,
    );
    if (!denomRes.ok) return denomRes;
    nouvAcc = addRational(nouvAcc, makeRational(netAnnual * currentRent, 12n * denomRes.denom));
  }
  const adjNouvCents = roundHalfUpSigned(nouvAcc.num, nouvAcc.den);

  let aidAcc: Rational = { num: 0n, den: 1n };
  for (const item of input.aid_variations ?? []) {
    if (item.target_unit_benefits === false) continue;
    const prevAid = BigInt(item.previous_annual_aid_cents);
    const currAid = BigInt(item.current_annual_aid_cents);
    const denomRes = resolveBeneficiaryDenom(
      item.beneficiary_scope,
      item.beneficiary_rents_monthly_cents,
      currentRent,
      resTotal,
      nonResTotal,
    );
    if (!denomRes.ok) return denomRes;
    aidAcc = addRational(
      aidAcc,
      makeRational(-(currAid - prevAid) * currentRent, 12n * denomRes.denom),
    );
  }
  const adjAidCents = roundHalfUpSigned(aidAcc.num, aidAcc.den);

  // Étape 6 : Déneigement — parc de maisons mobiles (art. 12.1)
  const snowPrev = BigInt(input.snow_removal_prev_cents ?? 0);
  const snowCurr = BigInt(input.snow_removal_curr_cents ?? 0);
  const adjSnowCents = roundHalfUpSigned(
    (snowCurr - snowPrev) * poidLoyerPlf.num,
    12n * poidLoyerPlf.den,
  );

  // Étape 7 : Total et arrondi final au dollar près (art. 15.1)
  const totalAdjCents =
    adjBaseCents + adjTaxesAssurCents + adjImmoCents + adjNouvCents + adjAidCents + adjSnowCents;
  const unroundedNewRentCents = currentRent + totalAdjCents;
  const newRentCents = roundArt151Dollar(unroundedNewRentCents);
  const effectiveIncreaseBps = roundHalfUpSigned(
    (newRentCents - currentRent) * 10_000n,
    currentRent,
  );

  let discretionDetail: string | undefined;
  if (nonResTotal === 0n && otherRevAnnual > 0n) {
    discretionDetail =
      "Note technique (calculateur officiel TAL) : en l'absence de loyers non résidentiels, la part sur les taxes municipales et scolaires suit le ratio résidentiel pur (poid_loyer) plutôt que d'inclure other_annual_revenue_cents au dénominateur (à la différence des assurances).";
  }

  const structured: LoyerTalOutput = {
    mode: "calcul_2026",
    regime: "post_2026_calcul",
    calculation: {
      lease_term_date: leaseTermDate,
      lease_renewal_date: input.lease_renewal_date,
      reference_year: referenceYear,
      base_rent_bps: regimeEntry.base_rent_bps,
      rpa_personal_services_bps: regimeEntry.rpa_personal_services_bps,
      capital_expenditures_bps: regimeEntry.capital_expenditures_bps,
      current_rent_cents: input.current_rent_cents,
      current_rent_cad: formatCentsToCad(currentRent),
      adj_base_cents: assertSafeInt(adjBaseCents, "adj_base"),
      adj_base_normal_cents: assertSafeInt(adjBaseNormalCents, "adj_base_normal"),
      adj_base_rpa_cents: assertSafeInt(adjBaseRpaCents, "adj_base_rpa"),
      adj_municipal_taxes_cents: assertSafeInt(adjMunCents, "adj_mun"),
      adj_school_taxes_cents: assertSafeInt(adjScolCents, "adj_scol"),
      adj_insurance_cents: assertSafeInt(adjInsCents, "adj_ins"),
      adj_taxes_and_insurance_cents: assertSafeInt(adjTaxesAssurCents, "adj_taxes_assur"),
      adj_capital_works_cents: assertSafeInt(adjImmoCents, "adj_immo"),
      adj_new_expenses_cents: assertSafeInt(adjNouvCents, "adj_nouv"),
      adj_aid_variations_cents: assertSafeInt(adjAidCents, "adj_aid"),
      adj_snow_removal_cents: assertSafeInt(adjSnowCents, "adj_snow"),
      total_adjustment_cents: assertSafeInt(totalAdjCents, "total_adj"),
      total_adjustment_cad: formatCentsToCad(totalAdjCents),
      unrounded_new_rent_cents: assertSafeInt(unroundedNewRentCents, "unrounded_new_rent"),
      unrounded_new_rent_cad: formatCentsToCad(unroundedNewRentCents),
      new_rent_cents: assertSafeInt(newRentCents, "new_rent"),
      new_rent_dollars: assertSafeInt(newRentCents / 100n, "new_rent_dollars"),
      new_rent_cad: formatCentsToCad(newRentCents),
      effective_increase_bps: assertSafeInt(effectiveIncreaseBps, "effective_increase_bps"),
    },
    bareme_post_2026: [regimeEntry],
    bareme_pre_2026: [],
    cmhc_results: [],
    provenance: {
      source: talCriteresJson.metadata.source,
      verified_at: talCriteresJson.metadata.verified_at,
      table_version: talCriteresJson.metadata.table_version,
    },
    gardes: [makeGarde("TAL_POUVOIR_DISCRETIONNAIRE_FIXATION", discretionDetail)],
  };

  return { ok: true, structured, text: formatTalText(structured) };
}

function formatTalText(out: LoyerTalOutput): string {
  const lines: string[] = [];

  if (out.regime === "post_2026_calcul" && out.calculation) {
    const c = out.calculation;
    lines.push(
      `Calculateur TAL (RLRQ, c. T-15.01, r. 2 — renouvellement au ${c.lease_renewal_date}, terme ${c.lease_term_date}, année de référence ${c.reference_year}) :`,
      `- Loyer actuel : ${c.current_rent_cad} $`,
      `- Pourcentage de base (${formatBpsComma(c.base_rent_bps)}) : ${formatCentsToCad(c.adj_base_cents)} $`,
      `- Taxes & assurances (art. 4) : ${formatCentsToCad(c.adj_taxes_and_insurance_cents)} $ (mun. ${formatCentsToCad(c.adj_municipal_taxes_cents)} $, scol. ${formatCentsToCad(c.adj_school_taxes_cents)} $, assur. ${formatCentsToCad(c.adj_insurance_cents)} $)`,
      `- Travaux majeurs 5 % (art. 3 par. 5° / art. 13) : ${formatCentsToCad(c.adj_capital_works_cents)} $`,
      `- Nouvelles dépenses / variations d'aide / déneigement : ${formatCentsToCad(c.adj_new_expenses_cents + c.adj_aid_variations_cents + c.adj_snow_removal_cents)} $`,
      `- Ajustement total : ${c.total_adjustment_cad} $ → avant arrondi ${c.unrounded_new_rent_cad} $ → Nouveau loyer (art. 15.1) : ${c.new_rent_dollars} $ (${(c.effective_increase_bps / 100).toFixed(2).replace(".", ",")} %)`,
    );
  } else if (out.regime === "pre_2026_transitoire") {
    lines.push(
      "Fixation de loyer TAL — Régime transitoire pré-2026 applicable (art. 6 Décret 1455-2025 ; avis donné avant le 1er janvier 2026).",
    );
    if (out.gardes.some((g) => g.code === "TAL_EXEMPTION_CINQ_ANS_ART_1955_CCQ")) {
      lines.push(
        "Exemption de 5 ans également déclarée (art. 1955 C.c.Q., Section F du bail) : aucune fixation par le TAL pendant la période de 5 ans si les mentions obligatoires figurent au bail.",
      );
    }
    for (const row of out.bareme_pre_2026) {
      lines.push(
        `- Barème ${row.year} : électricité ${formatBpsComma(row.electricity_bps)}, gaz ${formatBpsComma(row.gas_bps)}, mazout ${formatBpsComma(row.oil_other_bps)}, entretien ${formatBpsComma(row.maintenance_bps)}, services ${formatBpsComma(row.services_bps)}, gestion ${formatBpsComma(row.management_bps)}, revenu net ${formatBpsComma(row.net_income_bps)}, immobilisations ${formatBpsComma(row.capital_expenditures_bps)}.`,
      );
    }
  } else if (out.regime === "exemption_art_1955_ccq") {
    lines.push(
      "Exemption de 5 ans déclarée (art. 1955 C.c.Q., Section F du bail) : aucune fixation par le TAL pendant la période de 5 ans si les mentions obligatoires figurent au bail.",
    );
  } else if (out.regime === "bareme_officiel") {
    lines.push("Barèmes officiels du Tribunal administratif du logement (TAL) :");
    for (const p of out.bareme_post_2026) {
      lines.push(
        `- Post-2026 (${p.lease_renewal_start} → ${p.lease_renewal_end}, réf. ${p.reference_year}) : base ${formatBpsComma(p.base_rent_bps)}, services RPA ${formatBpsComma(p.rpa_personal_services_bps)}, immobilisations ${formatBpsComma(p.capital_expenditures_bps)}`,
      );
    }
    for (const row of out.bareme_pre_2026) {
      const rpa =
        row.rpa_personal_services_bps !== null
          ? `, RPA ${formatBpsComma(row.rpa_personal_services_bps)}`
          : "";
      lines.push(
        `- Pré-2026 (${row.year}) : élec. ${formatBpsComma(row.electricity_bps)}, gaz ${formatBpsComma(row.gas_bps)}, mazout ${formatBpsComma(row.oil_other_bps)}, entretien ${formatBpsComma(row.maintenance_bps)}, services ${formatBpsComma(row.services_bps)}${rpa}, gestion ${formatBpsComma(row.management_bps)}, rev. net ${formatBpsComma(row.net_income_bps)}, immo. ${formatBpsComma(row.capital_expenditures_bps)}`,
      );
    }
  } else if (out.regime === "schl_marche") {
    lines.push("Loyers moyens du marché SCHL (Statistique Canada 34-10-0133-01) :");
    for (const c of out.cmhc_results) {
      const vals = c.cells
        .map((cell) =>
          cell.suppressed
            ? `${cell.unit_label_fr} : supprimé/n.d.`
            : `${cell.unit_label_fr} : ${cell.rent_dollars} $`,
        )
        .join(" · ");
      lines.push(`- ${c.name_fr} (${c.year}, ${c.structure_label_fr}) : ${vals}`);
    }
  }

  if (out.gardes.length > 0) {
    lines.push("", "Gardes :");
    for (const g of out.gardes) {
      lines.push(`- [${g.code}] ${g.message}`);
    }
  }
  lines.push(`\nSource : ${out.provenance.source} (vérifié le ${out.provenance.verified_at})`);
  return lines.join("\n");
}
