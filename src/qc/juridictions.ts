type TypeGreffe = "GC" | "GP" | "GI";

export interface Juridiction {
  readonly tribunal: string;
  readonly competence: string;
  readonly greffe_type: TypeGreffe;
}

export const LIBELLE_TYPE_GREFFE: Readonly<Record<TypeGreffe, string>> = {
  GC: "greffe civil",
  GP: "greffe pénal et criminel",
  GI: "greffe des infractions statutaires",
};

export const JURIDICTIONS: Readonly<Record<string, Juridiction>> = {
  "01": { tribunal: "Cour supérieure", competence: "Chambre criminelle", greffe_type: "GP" },
  "02": { tribunal: "Cour du Québec", competence: "Chambre civile", greffe_type: "GC" },
  "04": { tribunal: "Cour supérieure", competence: "Chambre familiale", greffe_type: "GC" },
  "05": { tribunal: "Cour supérieure", competence: "Division générale", greffe_type: "GC" },
  "06": { tribunal: "Cour supérieure", competence: "Recours collectifs", greffe_type: "GC" },
  "07": { tribunal: "Cour du Québec", competence: "Tribunal des professions", greffe_type: "GC" },
  "09": { tribunal: "Cour d'appel", competence: "Chambre civile", greffe_type: "GC" },
  "10": { tribunal: "Cour d'appel", competence: "Chambre criminelle et pénale", greffe_type: "GC" },
  "11": { tribunal: "Cour supérieure", competence: "Chambre commerciale", greffe_type: "GC" },
  "12": { tribunal: "Cour supérieure", competence: "Chambre familiale", greffe_type: "GC" },
  "13": { tribunal: "Cour supérieure", competence: "Chambre familiale", greffe_type: "GC" },
  "14": {
    tribunal: "Cour supérieure",
    competence: "Procédures non contentieuses",
    greffe_type: "GC",
  },
  "17": { tribunal: "Cour supérieure", competence: "Chambre civile", greffe_type: "GC" },
  "18": { tribunal: "Cour supérieure", competence: "Shérif", greffe_type: "GC" },
  "19": { tribunal: "Cour du Québec", competence: "Chambre civile", greffe_type: "GC" },
  "22": { tribunal: "Cour du Québec", competence: "Chambre civile", greffe_type: "GC" },
  "27": {
    tribunal: "Cour du Québec",
    competence: "Chambre criminelle et pénale",
    greffe_type: "GP",
  },
  "32": {
    tribunal: "Cour du Québec",
    competence: "Division des petites créances",
    greffe_type: "GC",
  },
  "34": { tribunal: "Cour du Québec", competence: "Chambre civile", greffe_type: "GC" },
  "36": { tribunal: "Cour supérieure", competence: "Procès de novo", greffe_type: "GC" },
  "38": {
    tribunal: "Cour du Québec",
    competence: "Chambre criminelle et pénale",
    greffe_type: "GC",
  },
  "46": { tribunal: "—", competence: "Appels divers", greffe_type: "GC" },
  "53": {
    tribunal: "Cour du Québec",
    competence: "Tribunal des droits de la personne",
    greffe_type: "GC",
  },
  "61": {
    tribunal: "Cour du Québec",
    competence: "Chambre criminelle et pénale",
    greffe_type: "GI",
  },
  "72": { tribunal: "—", competence: "Infractions statutaires fédérales", greffe_type: "GP" },
  "73": { tribunal: "—", competence: "Dossiers G.R.C.", greffe_type: "GP" },
  "80": {
    tribunal: "Cour du Québec",
    competence: "Appel en matière administrative",
    greffe_type: "GC",
  },
};
