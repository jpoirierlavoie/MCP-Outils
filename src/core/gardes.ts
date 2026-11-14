import { z } from "zod";

export const GARDE_CODES = [
  "SAMEDI_CONGE_LOI_INTERPRETATION_QC",
  "DELAI_A_REBOURS_VERIFIER_TEXTE",
  "NOTIFICATION_TECHNOLOGIQUE_APRES_17H",
  "JOUR_NON_SEANCE_ART_82_AL_2",
  "JOURS_PROCLAMES_NON_PREVISIBLES",
  "DEPOT_GREFFE_HEURES_OUVERTURE",
  "TAUX_LAF_TRIMESTRE_MANQUANT",
  "INTERET_SIMPLE_ART_1620_CCQ",
] as const;

export const GardeCodeSchema = z.enum(GARDE_CODES);
export type GardeCode = z.infer<typeof GardeCodeSchema>;

export const GardeSchema = z.object({
  code: GardeCodeSchema.describe("Identifiant normatif de l'avertissement juridique."),
  message: z.string().describe("Explication juridique en français à vérifier par le praticien."),
});
export type Garde = z.infer<typeof GardeSchema>;

export const ProvenanceSchema = z.object({
  source: z.string().describe("Référence législative, réglementaire ou administrative de la règle ou table."),
  verified_at: z.string().describe("Date ISO de la dernière vérification humaine des sources intégrées."),
  table_version: z
    .string()
    .optional()
    .describe("Version de la table tarifaire embarquée, le cas échéant."),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const GARDE_MESSAGES: Record<GardeCode, string> = {
  SAMEDI_CONGE_LOI_INTERPRETATION_QC:
    "Sous le régime de la Loi d'interprétation (RLRQ, c. I-16), le samedi n'est pas un jour férié au sens de l'art. 61 par. 23°, mais l'art. 52 prolonge néanmoins au jour ouvrable suivant le délai qui expirerait un samedi (sauf exclusion explicite de l'option rollover_saturday).",
  DELAI_A_REBOURS_VERIFIER_TEXTE:
    "Délai calculé à rebours (avant une audience ou une étape) : la règle générale de prolongation de l'art. 83 al. 3 C.p.c. vise les délais prospectifs. Si la date brute tombe un jour non juridique, reculer au jour ouvrable précédent (preceding_business_day) est l'approche prudente, mais le texte exact (loi, règlement ou jugement, p. ex. « au moins X jours avant » ou jours francs) doit être vérifié.",
  NOTIFICATION_TECHNOLOGIQUE_APRES_17H:
    "En vertu de l'art. 111 al. 2 C.p.c., une notification faite par un moyen technologique après 17 h 00 ou un samedi ou un jour férié est réputée faite à 8 h 00 le jour ouvrable qui suit. Le point de départ du délai a été déplacé au jour ouvrable suivant.",
  JOUR_NON_SEANCE_ART_82_AL_2:
    "Une ou plusieurs dates calculées tombent dans une période où les tribunaux de première instance ne sont pas tenus de siéger (du 30 juin au 1er septembre ou du 20 décembre au 7 janvier, art. 82 al. 2 C.p.c.). Ces périodes ne sont PAS des jours fériés et ne suspendent ni ne prolongent les délais.",
  JOURS_PROCLAMES_NON_PREVISIBLES:
    "Le calendrier statutaire n'inclut pas les jours fériés proclamés ad hoc par décret ou proclamation (art. 61 par. 23° i)-j) L.I. QC; art. 35(1) L.I. CA) ni les fermetures exceptionnelles d'un greffe par avis ou directive.",
  DEPOT_GREFFE_HEURES_OUVERTURE:
    "Un acte déposé au greffe sur support technologique hors des heures d'ouverture est réputé déposé à la prochaine heure d'ouverture (art. 107 al. 4 C.p.c.), et un dépôt sans paiement des frais exigibles peut affecter sa date de réception (art. 107 al. 5 C.p.c.). Prévoir le dépôt pendant les heures d'ouverture du dernier jour.",
  TAUX_LAF_TRIMESTRE_MANQUANT:
    "La période demandée dépasse les trimestres publiés et vérifiés dans la table embarquée de l'art. 28 L.A.F. Aucune extrapolation n'est effectuée : le calcul a été arrêté à la fin du dernier trimestre couvert (sauf fourniture explicite de rate_overrides).",
  INTERET_SIMPLE_ART_1620_CCQ:
    "En vertu de l'art. 1620 C.c.Q., les intérêts légaux et l'indemnité additionnelle de l'art. 1619 C.c.Q. sont des intérêts simples (sans capitalisation), sauf disposition législative particulière, convention écrite valable ou ordonnance judiciaire contraire.",
};

export function makeGarde(code: GardeCode, detail?: string): Garde {
  const base = GARDE_MESSAGES[code];
  return {
    code,
    message: detail ? `${base} ${detail}` : base,
  };
}
