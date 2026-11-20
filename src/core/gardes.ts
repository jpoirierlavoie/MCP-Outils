import { z } from "zod";
import { GARDE_DOSSIER, GARDE_PALAIS, GARDE_SANS_ADRESSE, SANS_PLUMITIF } from "../qc/format.js";

export const GARDE_CODES = [
  "SAMEDI_CONGE_LOI_INTERPRETATION_QC",
  "SAMEDI_CONGE_LOI_INTERPRETATION_CA",
  "DELAI_A_REBOURS_VERIFIER_TEXTE",
  "NOTIFICATION_TECHNOLOGIQUE_APRES_17H",
  "NOTIFICATION_TECHNOLOGIQUE_17H_SECONDE_EXACTE",
  "NOTIFICATION_TECHNOLOGIQUE_SANS_HEURE",
  "JOUR_NON_SEANCE_ART_82_AL_2",
  "JOURS_PROCLAMES_NON_PREVISIBLES",
  "DEPOT_GREFFE_HEURES_OUVERTURE",
  "TAUX_LAF_TRIMESTRE_MANQUANT",
  "TAUX_LAF_SURCHARGE_APPELANT",
  "INTERET_SIMPLE_ART_1620_CCQ",
  "DOSSIER_NOMENCLATURE_SEULEMENT",
  "GREFFE_SANS_PLUMITIF",
  "GREFFE_SANS_ADRESSE_PUBLIEE",
  "PALAIS_RELEVE_MJQ_DATE",
  "PALAIS_COORDONNEES_NON_PUBLIEES",
  "REGISTRE_ABSENCE_PERSONNES_PHYSIQUES",
  "REGISTRE_FRAICHEUR_ET_OPPOSABILITE_LPLE",
  "REGISTRE_ABSENCE_NON_PROBANTE_ANCILLAIRES",
  "LICENCE_DONNEES_OUVERTES_NC_SA",
  "ADRESSE_EXISTENCE_CIVIQUE_NON_DOMICILE",
  "ADRESSE_LOT_ET_MATRICULE_SANS_VALEUR_LEGALE",
  "ADRESSE_CORRESPONDANCE_APPROXIMATIVE",
  "TERMINOLOGIE_AIDE_REDACTION_NON_NORMATIVE",
] as const;

export const GardeCodeSchema = z.enum(GARDE_CODES);
export type GardeCode = z.infer<typeof GardeCodeSchema>;

export const GardeSchema = z.object({
  code: GardeCodeSchema.describe("Identifiant normatif de l'avertissement juridique."),
  message: z.string().describe("Explication juridique en français à vérifier par le praticien."),
});
export type Garde = z.infer<typeof GardeSchema>;

export const ProvenanceSchema = z.object({
  source: z
    .string()
    .describe("Référence législative, réglementaire ou administrative de la règle ou table."),
  verified_at: z
    .string()
    .describe("Date ISO de la dernière vérification humaine des sources intégrées."),
  table_version: z
    .string()
    .optional()
    .describe("Version de la table tarifaire embarquée, le cas échéant."),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const GARDE_MESSAGES: Record<GardeCode, string> = {
  SAMEDI_CONGE_LOI_INTERPRETATION_QC:
    "Sous le régime de la Loi d'interprétation (RLRQ, c. I-16), le samedi n'est pas un jour férié au sens de l'art. 61 par. 23° et l'art. 52 al. 1 ne prolonge que les délais expirant un jour férié : le report du samedi n'est donc pas appliqué par défaut sous 'qc_li'. L'art. 52 al. 2 L.I. prolonge toutefois au jour ouvrable suivant les délais expirant un samedi pour l'inscription d'un droit au bureau de la publicité des droits (activer rollover_saturday=true) ; pour la prescription, utiliser le régime 'qc_prescription' (art. 2879 al. 2 C.c.Q.).",
  SAMEDI_CONGE_LOI_INTERPRETATION_CA:
    "Sous le régime de la Loi d'interprétation fédérale (L.R.C. 1985, c. I-21), le samedi n'est pas un « jour férié » (holiday) au sens de l'art. 35(1) et l'art. 26 ne prolonge que les délais expirant un « holiday » : le report du samedi n'est donc pas appliqué par défaut sous 'ca_li'. Activer rollover_saturday=true uniquement si une règle judiciaire ou disposition particulière (p. ex. calcul devant les Cours fédérales ou fermeture de greffe) assimile le samedi à un jour non juridique.",
  DELAI_A_REBOURS_VERIFIER_TEXTE:
    "Délai calculé à rebours (avant une audience ou une étape) : la règle générale de prolongation de l'art. 83 al. 3 C.p.c. vise les délais prospectifs. Si la date brute tombe un jour non juridique, reculer au jour ouvrable précédent (preceding_business_day) est l'approche prudente, mais le texte exact (loi, règlement ou jugement, p. ex. « au moins X jours avant » ou jours francs) doit être vérifié.",
  NOTIFICATION_TECHNOLOGIQUE_APRES_17H:
    "En vertu de l'art. 111 al. 2 C.p.c., une notification faite par un moyen technologique après 17 h 00 ou un samedi ou un jour férié est réputée faite à 8 h 00 le jour ouvrable qui suit. Le point de départ du délai a été déplacé au jour ouvrable suivant.",
  NOTIFICATION_TECHNOLOGIQUE_17H_SECONDE_EXACTE:
    "Notification technologique reçue exactement à 17:00 sans indication des secondes : l'art. 111 al. 2 C.p.c. vise une notification faite « après 17 h 00 ». Le point de départ du délai n'a pas été déplacé par défaut (17:00:00 n'étant pas après 17 h 00) ; vérifier la seconde exacte de transmission/réception pour confirmer si le déplacement s'applique.",
  NOTIFICATION_TECHNOLOGIQUE_SANS_HEURE:
    "Notification technologique sans heure précisée (event_time / anchor_time omis) : l'art. 111 al. 2 C.p.c. reporte au jour ouvrable suivant toute notification faite après 17 h 00. Par défaut, l'envoi sur jour ouvrable a été présumé fait à 17 h 00 ou avant ; vérifier l'horodatage exact de transmission/réception.",
  JOUR_NON_SEANCE_ART_82_AL_2:
    "Une ou plusieurs dates calculées tombent dans une période où les tribunaux de première instance ne sont pas tenus de siéger (du 30 juin au 1er septembre ou du 20 décembre au 7 janvier, art. 82 al. 2 C.p.c.). Ces périodes ne sont PAS des jours fériés et ne suspendent ni ne prolongent les délais.",
  JOURS_PROCLAMES_NON_PREVISIBLES:
    "Le calendrier statutaire n'inclut pas les jours fériés proclamés ad hoc par décret ou proclamation (art. 61 par. 23° i)-j) L.I. QC; art. 35(1) L.I. CA) ni les fermetures exceptionnelles d'un greffe par avis ou directive.",
  DEPOT_GREFFE_HEURES_OUVERTURE:
    "Un acte déposé au greffe sur support technologique hors des heures d'ouverture est réputé déposé à la prochaine heure d'ouverture (art. 107 al. 4 C.p.c.), et un dépôt sans paiement des frais exigibles peut affecter sa date de réception (art. 107 al. 5 C.p.c.). Prévoir le dépôt pendant les heures d'ouverture du dernier jour.",
  TAUX_LAF_TRIMESTRE_MANQUANT:
    "La période demandée dépasse les trimestres publiés et vérifiés dans la table embarquée de l'art. 28 L.A.F. Aucune extrapolation n'est effectuée : le calcul a été arrêté à la fin du dernier trimestre couvert (sauf fourniture explicite de rate_overrides).",
  TAUX_LAF_SURCHARGE_APPELANT:
    "Des surcharges de taux art. 28 L.A.F. (rate_overrides) fournies par l'appelant ont été utilisées pour des trimestres postérieurs à la table embarquée ; ces taux n'ont pas été vérifiés par le serveur et doivent être confirmés sur la publication officielle de Revenu Québec.",
  INTERET_SIMPLE_ART_1620_CCQ:
    "En vertu de l'art. 1620 C.c.Q., les intérêts légaux et l'indemnité additionnelle de l'art. 1619 C.c.Q. sont des intérêts simples (sans capitalisation), sauf disposition législative particulière, convention écrite valable ou ordonnance judiciaire contraire.",
  DOSSIER_NOMENCLATURE_SEULEMENT: GARDE_DOSSIER,
  GREFFE_SANS_PLUMITIF: SANS_PLUMITIF,
  GREFFE_SANS_ADRESSE_PUBLIEE: GARDE_SANS_ADRESSE,
  PALAIS_RELEVE_MJQ_DATE: GARDE_PALAIS,
  PALAIS_COORDONNEES_NON_PUBLIEES:
    "Coordonnées : ce connecteur n'en porte AUCUNE (ni téléphone, ni courriel, ni heures d'ouverture). Les obtenir auprès du ministère de la Justice du Québec.",
  REGISTRE_ABSENCE_PERSONNES_PHYSIQUES:
    "Le fichier ouvert du Registraire des entreprises et les CSV ouverts de Corporations Canada excluent les noms et adresses des personnes physiques (administrateurs, actionnaires principaux, bénéficiaires ultimes, fondés de pouvoir). Cet outil ne permet NI la recherche de conflits d'intérêts sur les dirigeants/actionnaires, NI la vérification de l'identité d'une société au sens des art. 20 et 23 al. 2 du Règlement sur la comptabilité et les normes d'exercice professionnel des avocats (RLRQ, c. B-1, r. 5), qui exigent la confirmation des administrateurs et des détenteurs de 25 % et plus. Consulter le portail officiel du Registraire ou de Corporations Canada à cette fin.",
  REGISTRE_FRAICHEUR_ET_OPPOSABILITE_LPLE:
    "Données issues d'instantanés périodiques (bimensuel pour le REQ, quotidien/mensuel pour les registres complémentaires) et non de l'état des informations en direct ayant valeur probante en vertu de l'art. 98 de la Loi sur la publicité légale des entreprises (RLRQ, c. P-44.1). Vérifier l'état des informations à jour avant toute désignation finale d'une partie (art. 99–100 C.p.c.) ou signification au siège/établissement (art. 125 C.p.c.).",
  REGISTRE_ABSENCE_NON_PROBANTE_ANCILLAIRES:
    "L'absence de correspondance jointe aux fichiers ouverts RBQ, OPC ou RENA (appariés sur le NEQ déclaré) ne constitue jamais une attestation officielle de conformité, d'absence de licence/permis ou d'admissibilité aux contrats publics.",
  LICENCE_DONNEES_OUVERTES_NC_SA:
    "Certaines sources intégrées (fichier ouvert du REQ ; données linguistiques de l'OQLF) sont diffusées sous licence CC BY-NC-SA 4.0 (Attribution – Pas d'utilisation commerciale – Partage dans les mêmes conditions) ; l'usage commercial ou en cabinet est assujetti aux conditions du diffuseur ou à son autorisation écrite.",
  ADRESSE_EXISTENCE_CIVIQUE_NON_DOMICILE:
    "Le Référentiel québécois des adresses (RQA) confirme uniquement l'existence géographique et municipale d'un point d'adresse civique à la date de diffusion indiquée ; il n'établit JAMAIS qu'une personne physique ou morale y a son domicile, sa résidence ou un établissement aux fins de signification ou de compétence territoriale (art. 41 s., 100, 125 C.p.c.).",
  ADRESSE_LOT_ET_MATRICULE_SANS_VALEUR_LEGALE:
    "Les numéros de lot cadastral (numero_lot, pouvant en outre omettre les parties privatives en copropriété divise ou refléter une jointure de bâtiment sur plusieurs lots) et le matricule d'évaluation municipale issus du RQA sont fournis à titre purement indicatif et n'ont AUCUNE valeur légale (art. 3030 al. 2 et 3032 C.c.Q.). Toujours vérifier l'index des immeubles au Registre foncier du Québec avant toute désignation cadastrale dans un acte ou une réquisition d'inscription.",
  ADRESSE_CORRESPONDANCE_APPROXIMATIVE:
    "La correspondance d'adresse retournée n'est pas un appariement civique exact (correction orthographique d'odonyme, unité d'appartement ou de bureau non confirmée dans le RQA, ou rue repérée sans ce numéro civique) : revérifier minutieusement chaque composante auprès de la municipalité ou de Postes Canada avant toute signification.",
  TERMINOLOGIE_AIDE_REDACTION_NON_NORMATIVE:
    "Les équivalents terminologiques (hors attestations textuelles tirées des lois consolidées) constituent une aide à la rédaction bijuridique ; en droit québécois, les versions française et anglaise des lois ont la même valeur juridique sous réserve de la préséance du texte français en cas de divergence que les règles ordinaires d'interprétation ne permettent pas de résoudre (art. 7 par. 3° et 7.1 de la Charte de la langue française).",
};

export function makeGarde(code: GardeCode, detail?: string): Garde {
  const base = GARDE_MESSAGES[code];
  return {
    code,
    message: detail ? `${base} ${detail}` : base,
  };
}
