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
  "TAUX_BOC_PRIME_DATE_MANQUANTE",
  "TAUX_BOC_PRIME_INDICATIF_BANCAIRE",
  "TAUX_BOC_INSTANTANE_HORS_LIGNE",
  "TAUX_BOC_NOON_HISTORIQUE_PRE_2017",
  "TAUX_BOC_REPORT_JOUR_OUVRABLE_PRECEDENT",
  "TAUX_BOC_CONVERSION_LOI_MONNAIE",
  "IPC_INSTANTANE_HORS_LIGNE",
  "IPC_BASE_REINDEXATION_ATTENTION",
  "IPC_INDEXATION_CONTRACTUELLE_NON_NORMATIVE",
  "TAL_REGIME_TRANSITOIRE_PRE_2026",
  "TAL_EXEMPTION_CINQ_ANS_ART_1955_CCQ",
  "TAL_POUVOIR_DISCRETIONNAIRE_FIXATION",
  "SCHL_LOYER_MOYEN_INDICATIF",
  "INTERET_SIMPLE_ART_1620_CCQ",
  "DOSSIER_NOMENCLATURE_SEULEMENT",
  "GREFFE_SANS_PLUMITIF",
  "GREFFE_SANS_ADRESSE_PUBLIEE",
  "PALAIS_RELEVE_MJQ_DATE",
  "PALAIS_COORDONNEES_NON_PUBLIEES",
  "REGISTRE_ABSENCE_PERSONNES_PHYSIQUES",
  "REGISTRE_FRAICHEUR_ET_OPPOSABILITE_LPLE",
  "REGISTRE_ABSENCE_NON_PROBANTE_ANCILLAIRES",
  "REGISTRE_GLEIF_DECLARATIF_CONSOLIDATION",
  "LICENCE_DONNEES_OUVERTES_NC_SA",
  "ADRESSE_EXISTENCE_CIVIQUE_NON_DOMICILE",
  "ADRESSE_LOT_ET_MATRICULE_SANS_VALEUR_LEGALE",
  "ADRESSE_CORRESPONDANCE_APPROXIMATIVE",
  "ADRESSE_LOT_MULTI_OU_COPROPRIETE",
  "ADRESSE_LOT_OU_MATRICULE_IMMEUBLE_PARENT",
  "TERMINOLOGIE_AIDE_REDACTION_NON_NORMATIVE",
] as const;

const GardeCodeSchema = z.enum(GARDE_CODES);
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

const GARDE_MESSAGES: Record<GardeCode, string> = {
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
  TAUX_BOC_PRIME_DATE_MANQUANTE:
    "La période demandée dépasse la dernière date vérifiée dans la table embarquée des taux préférentiels de la Banque du Canada (série V80691311). Aucune extrapolation n'est effectuée : le calcul a été arrêté à la dernière date couverte.",
  TAUX_BOC_PRIME_INDICATIF_BANCAIRE:
    "La série V80691311 de la Banque du Canada reflète le taux préférentiel hebdomadaire (mercredis) affiché par les principales banques à charte à titre indicatif : vérifier au contrat ou à l'acte de prêt le prêteur de référence, la date exacte d'effet des variations en cours de semaine, le plancher éventuel, la base de calcul (p. ex. Exact/365 vs Exact/Exact) et le mode de capitalisation.",
  TAUX_BOC_INSTANTANE_HORS_LIGNE:
    "Données issues d'un instantané local en lecture seule de la Banque du Canada (et de Statistique Canada 10-10-0008-01 pour les taux au comptant de midi 2001–2007), sans requête réseau au moment de l'appel. Les séries de la Banque du Canada constituent des indicateurs statistiques publiés à titre informatif et ne lient pas une institution financière ou un contrat particulier.",
  TAUX_BOC_NOON_HISTORIQUE_PRE_2017:
    "Régime historique antérieur au 1er mai 2017 : avant le 1er mai 2017, les taux de change affichés correspondent aux taux indicatifs au comptant de midi (Noon Spot, HE) plutôt qu'aux taux moyens quotidiens publiés à 16 h 30 HE à compter du 1er mai 2017.",
  TAUX_BOC_REPORT_JOUR_OUVRABLE_PRECEDENT:
    "Aucune observation n'ayant été publiée à la date demandée (fin de semaine, jour férié ou date sans cotation), le taux du jour ouvrable ou de cotation précédent disponible a été retenu ; vérifier si le contrat, le jugement ou la loi applicable prescrit plutôt le jour ouvrable suivant.",
  TAUX_BOC_CONVERSION_LOI_MONNAIE:
    "La conversion en monnaie canadienne utilise le taux indicatif de la Banque du Canada à la date retenue ; en vertu de l'art. 12 de la Loi sur la monnaie (L.R.C. 1985, c. C-52) et des art. 1561 et 3161 C.c.Q., les jugements canadiens sont rendus en monnaie canadienne et la date de conversion juridique (exigibilité, jugement ou paiement) relève de l'analyse juridique ou du jugement.",
  IPC_INSTANTANE_HORS_LIGNE:
    "Données issues d'un instantané local en lecture seule de Statistique Canada (tableaux 18-10-0004-01 mensuel et 18-10-0005-01 annuel, Licence du gouvernement ouvert – Canada), sans requête réseau au moment de l'appel ni extrapolation au-delà de la dernière période publiée.",
  IPC_BASE_REINDEXATION_ATTENTION:
    "Vérifier l'année de base (UOM, p. ex. '2002=100' vs '1992=100') et la série exacte stipulée au contrat : une indexation directe entre deux périodes ayant des années de base différentes est mathématiquement invalide sans facteur de raccordement officiel de Statistique Canada. Vérifier également si la clause prévoit un décalage du mois de référence ou un indice spécifique (Ensemble vs Logement).",
  IPC_INDEXATION_CONTRACTUELLE_NON_NORMATIVE:
    "L'indexation arithmétique exacte en BigInt (y compris les options de plancher, de plafond et d'arrondi) constitue une aide au calcul et n'interprète pas la clause contractuelle ou légale (p. ex. cumulativité, plafond annuel vs pluriannuel, ou inapplicabilité d'une clause d'indexation automatique aux baux résidentiels régis par l'art. 1942 C.c.Q. et le Règlement sur les critères de fixation de loyer).",
  TAL_REGIME_TRANSITOIRE_PRE_2026:
    "Régime transitoire (art. 6 du Décret 1455-2025) : lorsque l'avis de modification visé à l'art. 1942 C.c.Q. a été donné avant le 1er janvier 2026 (ou qu'une demande de réajustement prend effet avant cette date), les articles 1, 3, 3.1, 5, 11 et 13 du Règlement sur les critères de fixation de loyer (RLRQ, c. T-15.01, r. 2) tels qu'ils se lisaient le 31 décembre 2025 continuent de s'appliquer (grille multi-composantes énergie, entretien, services, gestion, revenu net et immobilisations), et non le taux IPC post-2026.",
  TAL_EXEMPTION_CINQ_ANS_ART_1955_CCQ:
    "Exemption de 5 ans (art. 1955 C.c.Q., Section F du bail obligatoire) : la fixation de loyer par le TAL ne s'applique pas pendant les 5 ans suivant l'état prêt à l'habitation d'un immeuble nouvellement bâti ou nouvellement converti à des fins locatives (sauf changement d'affectation d'une RPA visé à l'art. 1955.1 C.c.Q.), pourvu que la restriction et le loyer maximal sur 5 ans (le cas échéant) figurent à la Section F du bail ; vérifier également les exemptions statutaires (coopératives, HLM).",
  TAL_POUVOIR_DISCRETIONNAIRE_FIXATION:
    "En vertu du Règlement sur les critères de fixation de loyer (RLRQ, c. T-15.01, r. 2), les pourcentages publiés par le TAL servent au calcul judiciaire en cas de demande de fixation et ne constituent pas un plafond automatique ni une décision du tribunal : le TAL conserve un pouvoir d'appréciation et de preuve (art. 6 loyer de faveur, art. 7 bail non mensuel, art. 8–9 réduction/relèvement de services, art. 11–12 chambres/maisons mobiles, art. 13 pièces justificatives et subventions, art. 15 absence de renseignements).",
  SCHL_LOYER_MOYEN_INDICATIF:
    "Les loyers moyens publiés par la SCHL (Statistique Canada, tableau 34-10-0133-01, enquête d'octobre dans les centres de 10 000 habitants et plus, Licence du gouvernement ouvert – Canada) reflètent une moyenne statistique sur le parc locatif existant et sont fournis à titre purement indicatif : ils ne constituent ni un plafond légal de loyer au sens du Code civil du Québec ni une preuve de loyer de logements comparables au sens de l'art. 1896 ou 1950 C.c.Q.",
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
  REGISTRE_GLEIF_DECLARATIF_CONSOLIDATION:
    "Les données GLEIF (LEI, statuts d'enregistrement et relations mères/filiales Level 2) sont auto-déclaratives et reflètent uniquement la consolidation comptable (IFRS/PCGR) déclarée auprès d'un émetteur accrédité (LOU) : elles n'établissent NI le contrôle juridique, NI la détention d'actions votantes, NI les bénéficiaires ultimes au sens de la L.P.L.E. (RLRQ, c. P-44.1), de la L.C.S.A. (L.R.C. 1985, c. C-44) ou du Règlement sur la comptabilité et les normes d'exercice professionnel des avocats (RLRQ, c. B-1, r. 5, art. 20 et 23). Les entités sans LEI ('NO_LEI') ou contrôlées par des personnes physiques ('NATURAL_PERSONS') n'apparaissent pas comme sociétés mères consolidantes. Vérifier registration_status (p. ex. LAPSED), next_renewal_date et les registres corporatifs officiels avant d'alléguer un lien d'affiliation, de solidarité ou la levée du voile corporatif (art. 317 C.c.Q.).",
  LICENCE_DONNEES_OUVERTES_NC_SA:
    "Certaines sources intégrées (fichier ouvert du REQ ; données linguistiques de l'OQLF) sont diffusées sous licence CC BY-NC-SA 4.0 (Attribution – Pas d'utilisation commerciale – Partage dans les mêmes conditions) ; l'usage commercial ou en cabinet est assujetti aux conditions du diffuseur ou à son autorisation écrite.",
  ADRESSE_EXISTENCE_CIVIQUE_NON_DOMICILE:
    "Le Référentiel québécois des adresses (RQA) confirme uniquement l'existence géographique et municipale d'un point d'adresse civique à la date de diffusion indiquée ; il n'établit JAMAIS qu'une personne physique ou morale y a son domicile, sa résidence ou un établissement aux fins de signification ou de compétence territoriale (art. 41 s., 100, 125 C.p.c.).",
  ADRESSE_LOT_ET_MATRICULE_SANS_VALEUR_LEGALE:
    "Les numéros de lot cadastral (numero_lot, pouvant en outre omettre les parties privatives en copropriété divise ou refléter une jointure de bâtiment sur plusieurs lots) et le matricule d'évaluation municipale issus du RQA sont fournis à titre purement indicatif et n'ont AUCUNE valeur légale (art. 3030 al. 2 et 3032 C.c.Q.). Toujours vérifier l'index des immeubles au Registre foncier du Québec avant toute désignation cadastrale dans un acte ou une réquisition d'inscription.",
  ADRESSE_CORRESPONDANCE_APPROXIMATIVE:
    "La correspondance d'adresse retournée n'est pas un appariement civique exact (correction orthographique d'odonyme, unité d'appartement ou de bureau non confirmée dans le RQA, ou rue repérée sans ce numéro civique) : revérifier minutieusement chaque composante auprès de la municipalité ou de Postes Canada avant toute signification.",
  ADRESSE_LOT_MULTI_OU_COPROPRIETE:
    "Ambiguïté cadastrale ou de copropriété : au moins un candidat comporte plusieurs numéros de lot, vise un immeuble subdivisé en unités (copropriété divise potentielle), partage le lot de l'immeuble parent ou associe un même lot à plusieurs adresses civiques. En vertu des art. 3030 al. 2 et 3032 C.c.Q., ne jamais confondre le lot de l'immeuble parent ou des parties communes avec le lot d'une partie privative : vérifier l'index des immeubles et le plan cadastral au Registre foncier du Québec.",
  ADRESSE_LOT_OU_MATRICULE_IMMEUBLE_PARENT:
    "Repli sur l'immeuble parent (numero_unite = '') : l'unité demandée est absente du RQA ou sa fiche ne porte pas de numéro de lot ou de matricule propre ; les données cadastrales ou d'évaluation affichées proviennent de la fiche du bâtiment principal. En copropriété divise, ce lot parent ne constitue pas le lot de la partie privative (art. 3030 al. 2 et 3032 C.c.Q.).",
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
