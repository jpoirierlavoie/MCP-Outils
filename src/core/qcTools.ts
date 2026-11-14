import { z } from "zod";
import { analyserNumeroDossier } from "../qc/dossier.js";
import {
  document,
  GARDE_DOSSIER,
  GARDE_PALAIS,
  GARDE_SANS_ADRESSE,
  joindre,
  nombreFr,
  pluriel,
  SANS_PLUMITIF,
} from "../qc/format.js";
import { LIBELLE_CATEGORIE } from "../qc/forums.js";
import { LIBELLE_TYPE_GREFFE } from "../qc/juridictions.js";
import { MJQ_MAJ } from "../qc/lieux.js";
import {
  adresseDuGreffe,
  getGreffe,
  greffesDuPalais,
  listerDistricts,
  listerPalais,
  localitesItinerantes,
  type PalaisResolu,
  resoudrePalais,
  siegeFixe,
} from "../qc/lookup.js";
import { PAYS, type Palais, PROVINCE, RELEVE_LE, type TypeLieu } from "../qc/palais.js";
import {
  type Garde,
  GardeSchema,
  makeGarde,
  ProvenanceSchema,
} from "./gardes.js";

const PROVENANCE_DOSSIER_SOURCE =
  "Ministère de la Justice du Québec — numéros des greffes et nomenclature judiciaire";
const PROVENANCE_PALAIS_SOURCE =
  "Ministère de la Justice du Québec — répertoire des palais de justice et points de service";

// ── Schémas d'entrée (fermés, Z.strictObject) ──────────────────────────────────

export const ParseCourtFileInputSchema = z.strictObject({
  court_file_number: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .describe("Le numéro brut, p. ex. « 500-05-123456-241 » ou « TAL-594531 »."),
});
export type ParseCourtFileInput = z.infer<typeof ParseCourtFileInputSchema>;

export const PalaisListInputSchema = z.strictObject({
  district: z
    .string()
    .max(60)
    .optional()
    .describe("District judiciaire, p. ex. « Montréal ». Les diacritiques sont pliés."),
  query: z
    .string()
    .max(60)
    .optional()
    .describe("Texte libre : nom du palais, ville ou numéro de greffe."),
  type: z
    .enum(["palais", "point_de_service"])
    .optional()
    .describe(
      "« palais » (43) ou « point_de_service » (8, au sens du MJQ — à ne pas confondre avec les greffes de cour itinérante).",
    ),
});
export type PalaisListInput = z.infer<typeof PalaisListInputSchema>;

export const PalaisGetInputSchema = z.strictObject({
  greffe_number: z
    .string()
    .trim()
    .min(1)
    .max(3)
    .optional()
    .describe(
      "Numéro de greffe à 3 chiffres, p. ex. « 500 ». ⚠ Fournir EXACTEMENT l'un des deux : soit « greffe_number », soit « palais ». Les deux ensemble, ou aucun, sont REFUSÉS.",
    ),
  palais: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .optional()
    .describe(
      "Nom ou clef du palais, p. ex. « Montréal » ou « saint-jerome ». ⚠ Fournir EXACTEMENT l'un des deux : soit « palais », soit « greffe_number ». Les deux ensemble, ou aucun, sont REFUSÉS. Un nom ambigu fait rendre la LISTE des candidats plutôt qu'un choix arbitraire.",
    ),
});
export type PalaisGetInput = z.infer<typeof PalaisGetInputSchema>;

// ── Schémas de sortie structurée ──────────────────────────────────────────────

export const ContactOutputSchema = z.object({
  service: z.string(),
  tel: z.string().nullable(),
  courriel: z.string().nullable(),
});

export const PalaisAdresseOutputSchema = z.object({
  key: z.string().nullable(),
  name: z.string(),
  location_type: z.enum(["palais", "point_de_service"]),
  street: z.string(),
  unit: z.string().nullable(),
  city: z.string(),
  province: z.literal(PROVINCE),
  postal_code: z.string(),
  country: z.literal(PAYS),
  mailing_address: z.string().nullable(),
  contacts: z.array(ContactOutputSchema),
});

export const ParseCourtFileOutputSchema = z.object({
  input: z.string(),
  outcome: z.enum(["forum", "unknown_alpha_prefix", "invalid_format", "judicial"]),
  is_administrative: z.boolean(),
  forum: z
    .object({
      key: z.string(),
      name: z.string(),
      abbr: z.string(),
      category: z.enum(["administratif", "federal"]),
      category_label_fr: z.string(),
    })
    .nullable(),
  greffe_number: z.string().nullable(),
  greffe: z
    .object({
      palais_de_justice: z.string(),
      district_judiciaire: z.string(),
      palais_key: z.string().nullable(),
      point_de_service: z.boolean(),
      localites_itinerantes: z.array(z.string()),
      adresse: PalaisAdresseOutputSchema.nullable(),
    })
    .nullable(),
  juridiction_number: z.string().nullable(),
  juridiction: z
    .object({
      tribunal: z.string(),
      competence: z.string(),
      greffe_type: z.enum(["GC", "GI", "GP"]),
      greffe_type_label_fr: z.string(),
    })
    .nullable(),
  parse_error: z.string().nullable(),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
export type ParseCourtFileOutput = z.infer<typeof ParseCourtFileOutputSchema>;

export const GreffeSummaryOutputSchema = z.object({
  numero: z.string(),
  palais_de_justice: z.string(),
  district_judiciaire: z.string(),
  point_de_service: z.boolean(),
});

export const PalaisSummaryOutputSchema = z.object({
  key: z.string(),
  name: z.string(),
  location_type: z.enum(["palais", "point_de_service"]),
  street: z.string(),
  unit: z.string().nullable(),
  city: z.string(),
  province: z.literal(PROVINCE),
  postal_code: z.string(),
  country: z.literal(PAYS),
  greffes: z.array(GreffeSummaryOutputSchema),
});

export const PalaisListOutputSchema = z.object({
  filters: z.object({
    district: z.string().nullable(),
    query: z.string().nullable(),
    type: z.enum(["palais", "point_de_service"]).nullable(),
  }),
  count: z.number().int(),
  results: z.array(PalaisSummaryOutputSchema),
  known_districts: z.array(z.string()).nullable(),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
export type PalaisListOutput = z.infer<typeof PalaisListOutputSchema>;

export const PalaisGetOutputSchema = z.object({
  lookup_by: z.enum(["greffe_number", "palais"]),
  greffe: z
    .object({
      numero: z.string(),
      palais_de_justice: z.string(),
      district_judiciaire: z.string(),
      point_de_service: z.boolean(),
      localites_itinerantes: z.array(z.string()),
      siege_fixe_palais_key: z.string().nullable(),
    })
    .nullable(),
  palais: PalaisAdresseOutputSchema.nullable(),
  greffes_at_palais: z.array(GreffeSummaryOutputSchema),
  provenance: ProvenanceSchema,
  gardes: z.array(GardeSchema),
});
export type PalaisGetOutput = z.infer<typeof PalaisGetOutputSchema>;

function toPalaisAdresseOutput(
  key: string | null,
  p: Palais,
): z.infer<typeof PalaisAdresseOutputSchema> {
  return {
    key,
    name: p.name,
    location_type: p.location_type,
    street: p.street,
    unit: p.unit ? p.unit : null,
    city: p.city,
    province: PROVINCE,
    postal_code: p.postal_code,
    country: PAYS,
    mailing_address: p.mailing_address ? p.mailing_address : null,
    contacts: p.contacts.map((c) => ({
      service: c.service,
      tel: c.tel ?? null,
      courriel: c.courriel ?? null,
    })),
  };
}

// ── 1. greffe_parse_court_file_number ─────────────────────────────────────────

export function parseCourtFile(input: ParseCourtFileInput): {
  structured: ParseCourtFileOutput;
  text: string;
} {
  const brut = input.court_file_number;
  const propre = brut.trim();
  const r = analyserNumeroDossier(brut);
  const provenance = {
    source: PROVENANCE_DOSSIER_SOURCE,
    verified_at: RELEVE_LE,
    table_version: MJQ_MAJ,
  };

  const lignes: string[] = [`Analyse de « ${propre} » — aucun appel, table locale.`, ""];

  // ── Forum non judiciaire : le préfixe EST la réponse ────────────────────────
  if (r.forum) {
    lignes.push(
      `Forum : ${r.forum.name} (${r.forum.abbr})`,
      `Catégorie : ${LIBELLE_CATEGORIE[r.forum.category]}`,
      "",
      "Ce corps numérote ses dossiers lui-même : il n'y a ni greffe ni juridiction à",
      "résoudre, et le numéro se conserve tel quel.",
    );
    if (r.forum.category === "federal") {
      lignes.push(
        "",
        "Une cour fédérale n'est PAS un tribunal administratif. Pour vérifier une de ses",
        "décisions, employer le connecteur « Jurisprudence » (jurisprudence_verify_citations).",
      );
    }
    const text = [...lignes, "", GARDE_DOSSIER].join("\n");
    return {
      text,
      structured: {
        input: propre,
        outcome: "forum",
        is_administrative: r.is_administrative,
        forum: {
          key: r.forum_key!,
          name: r.forum.name,
          abbr: r.forum.abbr,
          category: r.forum.category,
          category_label_fr: LIBELLE_CATEGORIE[r.forum.category],
        },
        greffe_number: null,
        greffe: null,
        juridiction_number: null,
        juridiction: null,
        parse_error: null,
        provenance,
        gardes: [makeGarde("DOSSIER_NOMENCLATURE_SEULEMENT")],
      },
    };
  }

  // ── Préfixe alphabétique non répertorié ─────────────────────────────────────
  if (r.is_administrative && !r.greffe_number && !r.parse_error) {
    lignes.push(
      "Préfixe alphabétique NON répertorié.",
      "",
      "Ce numéro n'est pas de forme judiciaire québécoise : il émane vraisemblablement",
      "d'un tribunal ou d'un organisme qui numérote ses dossiers lui-même. Le connecteur",
      "ne devine PAS de quel corps il s'agit — un nom deviné vaudrait moins que rien.",
    );
    const text = [...lignes, "", GARDE_DOSSIER].join("\n");
    return {
      text,
      structured: {
        input: propre,
        outcome: "unknown_alpha_prefix",
        is_administrative: true,
        forum: null,
        greffe_number: null,
        greffe: null,
        juridiction_number: null,
        juridiction: null,
        parse_error: null,
        provenance,
        gardes: [makeGarde("DOSSIER_NOMENCLATURE_SEULEMENT")],
      },
    };
  }

  // ── Forme refusée ───────────────────────────────────────────────────────────
  if (!r.greffe_number) {
    lignes.push(
      r.parse_error ?? "Numéro non analysable.",
      "",
      "Forme attendue : NNN-NN-NNNNNN-NNN (ex. : 500-05-123456-241) — trois chiffres de",
      "greffe, deux de juridiction. Les tribunaux administratifs et les cours fédérales",
      "emploient plutôt un préfixe alphabétique (TAL-…, C.F.-…).",
    );
    const text = [...lignes, "", GARDE_DOSSIER].join("\n");
    return {
      text,
      structured: {
        input: propre,
        outcome: "invalid_format",
        is_administrative: false,
        forum: null,
        greffe_number: null,
        greffe: null,
        juridiction_number: null,
        juridiction: null,
        parse_error: r.parse_error,
        provenance,
        gardes: [makeGarde("DOSSIER_NOMENCLATURE_SEULEMENT")],
      },
    };
  }

  // ── Numéro judiciaire ───────────────────────────────────────────────────────
  if (r.greffe) {
    lignes.push(
      `Greffe ${r.greffe_number}      ${joindre([
        r.greffe.palais_de_justice,
        `district judiciaire de ${r.greffe.district_judiciaire}`,
      ])}`,
    );
  } else {
    lignes.push(`Greffe ${r.greffe_number}      INCONNU de la table de référence.`);
  }

  if (r.juridiction) {
    lignes.push(
      `Juridiction ${r.juridiction_number} ${joindre([
        r.juridiction.tribunal,
        r.juridiction.competence,
        LIBELLE_TYPE_GREFFE[r.juridiction.greffe_type],
      ])}`,
    );
  } else {
    lignes.push(`Juridiction ${r.juridiction_number} INCONNUE de la table de référence.`);
  }

  const gardes: Garde[] = [
    makeGarde("DOSSIER_NOMENCLATURE_SEULEMENT"),
    makeGarde("GREFFE_SANS_PLUMITIF"),
  ];

  let greffeOut: ParseCourtFileOutput["greffe"] = null;
  if (r.greffe) {
    const localites = localitesItinerantes(r.greffe_number);
    const adresse = adresseDuGreffe(r.greffe_number);
    const resolvedKey = adresse
      ? (r.greffe.palais_key ?? siegeFixe(r.greffe_number)?.clef ?? null)
      : null;

    if (adresse) {
      lignes.push("", `Palais : ${adresse.name}`, `  ${adresse.street}`);
      if (adresse.unit) lignes.push(`  ${adresse.unit}`);
      lignes.push(`  ${adresse.city} (${PROVINCE}) ${adresse.postal_code}`);
    } else {
      lignes.push("", `Aucune adresse publiée n'est rattachée au greffe ${r.greffe_number}.`);
      if (localites.length > 0) {
        lignes.push(`Cour itinérante desservant : ${localites.join(", ")}.`);
      }
      lignes.push(GARDE_SANS_ADRESSE);
      gardes.push(makeGarde("GREFFE_SANS_ADRESSE_PUBLIEE"));
    }

    greffeOut = {
      palais_de_justice: r.greffe.palais_de_justice,
      district_judiciaire: r.greffe.district_judiciaire,
      palais_key: r.greffe.palais_key,
      point_de_service: r.greffe.point_de_service,
      localites_itinerantes: localites,
      adresse: adresse ? toPalaisAdresseOutput(resolvedKey, adresse) : null,
    };
  }

  if (r.parse_error) lignes.push("", `⚠ ${r.parse_error}`);

  lignes.push("", "Pour la fiche complète du palais, employer palais_get.", SANS_PLUMITIF);

  const text = [...lignes, "", GARDE_DOSSIER].join("\n");
  return {
    text,
    structured: {
      input: propre,
      outcome: "judicial",
      is_administrative: false,
      forum: null,
      greffe_number: r.greffe_number,
      greffe: greffeOut,
      juridiction_number: r.juridiction_number,
      juridiction: r.juridiction
        ? {
            tribunal: r.juridiction.tribunal,
            competence: r.juridiction.competence,
            greffe_type: r.juridiction.greffe_type,
            greffe_type_label_fr: LIBELLE_TYPE_GREFFE[r.juridiction.greffe_type],
          }
        : null,
      parse_error: r.parse_error,
      provenance,
      gardes,
    },
  };
}

// ── 2. palais_list ────────────────────────────────────────────────────────────

function lignePalais(p: PalaisResolu): string {
  const lignes: string[] = [
    p.palais.location_type === "point_de_service"
      ? `${p.palais.name} — point de service de justice`
      : p.palais.name,
  ];
  lignes.push(`${p.palais.street}, ${p.palais.city} (${PROVINCE}) ${p.palais.postal_code}`);

  if (p.greffes.length > 0) {
    const districts = [...new Set(p.greffes.map((g) => g.greffe.district_judiciaire))];
    lignes.push(
      `Greffe${p.greffes.length > 1 ? "s" : ""} ${p.greffes.map((g) => g.numero).join(", ")} · ` +
        `district${districts.length > 1 ? "s" : ""} de ${districts.join(", ")}`,
    );
  } else {
    lignes.push("Aucun numéro de greffe ne désigne ce palais dans la table de référence.");
  }
  return lignes.join("\n");
}

export function palaisList(input: PalaisListInput): {
  structured: PalaisListOutput;
  text: string;
} {
  const district = input.district?.trim() || undefined;
  const query = input.query?.trim() || undefined;
  const type: TypeLieu | undefined = input.type;

  const resultats = listerPalais({
    ...(district !== undefined ? { district } : {}),
    ...(query !== undefined ? { query } : {}),
    ...(type !== undefined ? { type } : {}),
  });

  const filtres = [
    district ? `district=${district}` : null,
    query ? `recherche=${query}` : null,
    type ? `type=${type}` : null,
  ].filter((s): s is string => s !== null);

  const provenance = {
    source: PROVENANCE_PALAIS_SOURCE,
    verified_at: RELEVE_LE,
    table_version: MJQ_MAJ,
  };
  const gardes: Garde[] = [makeGarde("PALAIS_RELEVE_MJQ_DATE")];

  if (resultats.length === 0) {
    const districts = listerDistricts();
    const text = [
      `Aucun lieu ne répond${filtres.length ? ` à ${filtres.join(", ")}` : ""}.`,
      "",
      "Une liste vide ne vaut pas constat d'absence : le filtre peut ne pas correspondre",
      "à l'orthographe du relevé. Les 36 districts judiciaires connus sont :",
      "",
      districts.join(" · "),
      "",
      GARDE_PALAIS,
    ].join("\n");
    return {
      text,
      structured: {
        filters: {
          district: district ?? null,
          query: query ?? null,
          type: type ?? null,
        },
        count: 0,
        results: [],
        known_districts: districts,
        provenance,
        gardes,
      },
    };
  }

  const entete =
    `${pluriel(resultats.length, "lieu", "lieux")} de justice` +
    `${filtres.length ? ` (${filtres.join(", ")})` : ""} :`;

  const pied = [
    filtres.length === 0
      ? `Relevé complet : ${nombreFr(43)} palais de justice et ${nombreFr(8)} points de service.`
      : null,
    "Pour la fiche complète d'un lieu — adresse postale, greffes, localités desservies —",
    "employer palais_get.",
    "",
    GARDE_PALAIS,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");

  const text = document(entete, resultats.map(lignePalais), pied);
  return {
    text,
    structured: {
      filters: {
        district: district ?? null,
        query: query ?? null,
        type: type ?? null,
      },
      count: resultats.length,
      results: resultats.map((p) => ({
        key: p.clef,
        name: p.palais.name,
        location_type: p.palais.location_type,
        street: p.palais.street,
        unit: p.palais.unit ? p.palais.unit : null,
        city: p.palais.city,
        province: PROVINCE,
        postal_code: p.palais.postal_code,
        country: PAYS,
        greffes: p.greffes.map((g) => ({
          numero: g.numero,
          palais_de_justice: g.greffe.palais_de_justice,
          district_judiciaire: g.greffe.district_judiciaire,
          point_de_service: g.greffe.point_de_service,
        })),
      })),
      known_districts: null,
      provenance,
      gardes,
    },
  };
}

// ── 3. palais_get ─────────────────────────────────────────────────────────────

function blocAdresse(p: Palais): string[] {
  const lignes = ["Adresse :", `  ${p.street}`];
  if (p.unit) lignes.push(`  ${p.unit}`);
  lignes.push(`  ${p.city} (${PROVINCE}) ${p.postal_code}`, `  ${PAYS}`);
  if (p.mailing_address) lignes.push("", `Adresse postale : ${p.mailing_address}`);

  if (p.contacts.length > 0) {
    lignes.push("", "Coordonnées :");
    for (const c of p.contacts) {
      lignes.push(`  · ${joindre([c.service, c.tel, c.courriel])}`);
    }
  } else {
    lignes.push(
      "",
      "Coordonnées : ce connecteur n'en porte AUCUNE (ni téléphone, ni courriel, ni",
      "heures d'ouverture). Les obtenir auprès du ministère de la Justice du Québec.",
    );
  }
  return lignes;
}

export type PalaisGetResult =
  | { ok: true; structured: PalaisGetOutput; text: string }
  | { ok: false; text: string };

export function palaisGet(input: PalaisGetInput): PalaisGetResult {
  const greffeNumber = input.greffe_number?.trim() || undefined;
  const palaisClef = input.palais?.trim() || undefined;

  if (Boolean(greffeNumber) === Boolean(palaisClef)) {
    return {
      ok: false,
      text:
        "Fournir EXACTEMENT l'une des deux formes : soit « greffe_number » (3 chiffres, " +
        "p. ex. 500), soit « palais » (nom ou clef, p. ex. « Montréal »).",
    };
  }

  const provenance = {
    source: PROVENANCE_PALAIS_SOURCE,
    verified_at: RELEVE_LE,
    table_version: MJQ_MAJ,
  };

  // ── Par numéro de greffe ────────────────────────────────────────────────────
  if (greffeNumber) {
    const greffe = getGreffe(greffeNumber);
    if (!greffe) {
      return {
        ok: false,
        text: [
          `Le greffe « ${greffeNumber} » ne figure pas dans la table de référence.`,
          "",
          "Cette table est un relevé du ministère de la Justice, NON un registre exhaustif :",
          "un numéro absent du relevé peut désigner un greffe réel. Explications possibles :",
          "numéro erroné · greffe créé ou renuméroté depuis le relevé · absent du relevé.",
          "Consulter palais_list pour le répertoire connu.",
          "",
          GARDE_PALAIS,
        ].join("\n"),
      };
    }

    const lignes: string[] = [
      `Greffe ${greffeNumber} — ${greffe.palais_de_justice}`,
      `District judiciaire : ${greffe.district_judiciaire}`,
    ];

    const localites = greffe.point_de_service ? localitesItinerantes(greffeNumber) : [];
    if (greffe.point_de_service) {
      lignes.push("Cour ITINÉRANTE : elle siège là où la cour se déplace.");
      if (localites.length > 0) {
        lignes.push(
          `${pluriel(localites.length, "localité desservie", "localités desservies")} : ${localites.join(", ")}.`,
        );
      }
    }

    const adresse = adresseDuGreffe(greffeNumber);
    const siege = adresse && !greffe.palais_key ? siegeFixe(greffeNumber) : null;
    const gardes: Garde[] = [makeGarde("PALAIS_RELEVE_MJQ_DATE")];
    let resolvedKey: string | null = null;

    if (adresse) {
      resolvedKey = greffe.palais_key ?? siege?.clef ?? null;
      if (siege) {
        lignes.push(
          "",
          `Siège fixe : ${siege.palais.name} — rattaché à ce greffe par le relevé du`,
          "ministère de la Justice, et non par déduction.",
        );
      }
      lignes.push("", ...blocAdresse(adresse));
      if (adresse.contacts.length === 0) {
        gardes.push(makeGarde("PALAIS_COORDONNEES_NON_PUBLIEES"));
      }
    } else {
      lignes.push("", `Aucune adresse publiée n'est rattachée au greffe ${greffeNumber}.`);
      lignes.push(GARDE_SANS_ADRESSE);
      gardes.push(makeGarde("GREFFE_SANS_ADRESSE_PUBLIEE"));
    }

    return {
      ok: true,
      text: [...lignes, "", GARDE_PALAIS].join("\n"),
      structured: {
        lookup_by: "greffe_number",
        greffe: {
          numero: greffeNumber,
          palais_de_justice: greffe.palais_de_justice,
          district_judiciaire: greffe.district_judiciaire,
          point_de_service: greffe.point_de_service,
          localites_itinerantes: localites,
          siege_fixe_palais_key: siege?.clef ?? null,
        },
        palais: adresse ? toPalaisAdresseOutput(resolvedKey, adresse) : null,
        greffes_at_palais: [],
        provenance,
        gardes,
      },
    };
  }

  // ── Par nom ou clef de palais ───────────────────────────────────────────────
  const direct = resoudrePalais(palaisClef!);
  const candidats = direct ? [direct] : listerPalais({ query: palaisClef });

  if (candidats.length === 0) {
    return {
      ok: false,
      text: [
        `Aucun lieu de justice ne correspond à « ${palaisClef} ».`,
        "",
        "L'orthographe du relevé peut différer de celle attendue : le palais de Chicoutimi",
        "est à Saguenay, celui de Havre-Aubert aux Îles-de-la-Madeleine. Employer",
        "palais_list pour parcourir le répertoire.",
        "",
        GARDE_PALAIS,
      ].join("\n"),
    };
  }

  if (candidats.length > 1) {
    return {
      ok: false,
      text: [
        `« ${palaisClef} » désigne ${candidats.length} lieux :`,
        "",
        ...candidats.map((c) => `  · ${c.palais.name} (${c.palais.city}) — clef « ${c.clef} »`),
        "",
        "Préciser la clef, ou employer palais_list.",
        "",
        GARDE_PALAIS,
      ].join("\n"),
    };
  }

  const trouve = candidats[0]!;
  const lignes = [
    trouve.palais.location_type === "point_de_service"
      ? `${trouve.palais.name} — point de service de justice`
      : `Palais de justice de ${trouve.palais.name}`,
    "",
    ...blocAdresse(trouve.palais),
  ];

  const greffes = greffesDuPalais(trouve.clef);
  if (greffes.length > 0) {
    lignes.push("", "Greffes qui y siègent :");
    for (const { numero, greffe } of greffes) {
      lignes.push(`  · ${numero} — district judiciaire de ${greffe.district_judiciaire}`);
    }
  } else {
    lignes.push(
      "",
      "Aucun numéro de greffe ne désigne ce palais dans la table de référence.",
      "Il n'est PAS rattaché d'office à un greffe voisin : une correspondance devinée",
      "vaudrait moins que son absence.",
    );
  }

  lignes.push(
    "",
    "Les chambres et compétences ne se rattachent PAS au bâtiment mais au numéro de",
    "dossier : employer greffe_parse_court_file_number pour les obtenir.",
  );

  const gardes: Garde[] = [makeGarde("PALAIS_RELEVE_MJQ_DATE")];
  if (trouve.palais.contacts.length === 0) {
    gardes.push(makeGarde("PALAIS_COORDONNEES_NON_PUBLIEES"));
  }

  return {
    ok: true,
    text: [...lignes, "", GARDE_PALAIS].join("\n"),
    structured: {
      lookup_by: "palais",
      greffe: null,
      palais: toPalaisAdresseOutput(trouve.clef, trouve.palais),
      greffes_at_palais: greffes.map(({ numero, greffe }) => ({
        numero,
        palais_de_justice: greffe.palais_de_justice,
        district_judiciaire: greffe.district_judiciaire,
        point_de_service: greffe.point_de_service,
      })),
      provenance,
      gardes,
    },
  };
}
