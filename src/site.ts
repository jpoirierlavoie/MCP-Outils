import bocPrimeRatesJson from "./data/boc_prime_rates.json" with { type: "json" };
import lafRatesJson from "./data/laf_art28_rates.json" with { type: "json" };
import {
  listToolDescriptors,
  SERVER_DESCRIPTION,
  SERVER_NAME,
  SERVER_VERSION,
  type ToolDescriptor,
} from "./mcp/server.js";
import { analyserNumeroDossier } from "./qc/dossier.js";
import { GARDE_DOSSIER, GARDE_PALAIS, GARDE_SANS_ADRESSE } from "./qc/format.js";
import { GREFFES } from "./qc/greffes.js";
import { JURIDICTIONS, LIBELLE_TYPE_GREFFE } from "./qc/juridictions.js";
import { MJQ_MAJ } from "./qc/lieux.js";
import { adresseDuGreffe, listerDistricts, localitesItinerantes, siegeFixe } from "./qc/lookup.js";
import { RELEVE_LE } from "./qc/palais.js";
import { EN, OUTILS_EN } from "./site.i18n.js";

const ORIGINE_SITE = "https://outils.poirierlavoie.ca";
const DEPOT = "https://github.com/jpoirierlavoie/MCP-Outils";
const DEPOT_PLUGIN = "https://github.com/jpoirierlavoie/droit-civil-quebecois";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function bi(fr: string, en: string): string {
  return `<span data-l="fr">${esc(fr)}</span><span data-l="en" lang="en">${esc(en)}</span>`;
}

function biP(fr: readonly string[], en: readonly string[]): string {
  return (
    `<div data-l="fr">${fr.map((p) => `<p>${esc(p)}</p>`).join("")}</div>\n` +
    `<div data-l="en" lang="en">${en.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`
  );
}

export const SECTIONS = [
  { id: "outils", fr: "Les 15 outils", en: "The 15 tools" },
  { id: "dossier", fr: "Numéro de dossier", en: "Court file numbers" },
  { id: "greffes", fr: "Greffes et palais", en: "Registries and courthouses" },
  { id: "acces", fr: "Accès et installation", en: "Access & setup" },
  { id: "schema", fr: "Les schémas (technique)", en: "The schemas (technical)" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const TITRE_SECTION = new Map<SectionId, { fr: string; en: string }>(
  SECTIONS.map((s) => [s.id, { fr: s.fr, en: s.en }]),
);

function h2(id: SectionId): string {
  const t = TITRE_SECTION.get(id)!;
  return `<h2 id="h-${id}">${bi(t.fr, t.en)}</h2>`;
}

function compacterBloc(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\/\/.*$/, "").trim())
    .filter(Boolean)
    .join("\n");
}

const CLAIR =
  "color-scheme:light;--f:#0f172a;--m:#475569;--b:#cbd5e1;--bi:#64748b;--a:#1d4ed8;--bg:#f8fafc;--card:#fff;" +
  "--th:#f1f5f9;--code:#e2e8f0;--hover:#f1f5f9;--avert-bg:#eff6ff;--avert-b:#93c5fd";

const SOMBRE =
  "color-scheme:dark;--f:#e4e4e7;--m:#a1a1aa;--b:#27272b;--bi:#71717a;--a:#6ea8fe;--bg:#0c0c0e;--card:#141417;" +
  "--th:#1b1b1f;--code:#1c1c21;--hover:#1d1d22;--avert-bg:#15171c;--avert-b:#303642";

const LARGE = "78rem";
const SOLEIL = "☀︎";
const FLECHE = "↑︎";

const CSS = `
:root{${CLAIR}}
@media(prefers-color-scheme:dark){:root{${SOMBRE}}}
html.t-light{${CLAIR}}
html.t-dark{${SOMBRE}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--f);font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:1rem;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:${LARGE};margin:0 auto;padding:2rem 1.25rem 4rem;display:grid;gap:1rem}
main{min-width:0;max-width:60rem;width:100%;justify-self:center}
section[id]{scroll-margin-top:1.5rem}
#dossier,#greffes,#schema{content-visibility:auto;contain-intrinsic-size:auto 40rem}
h1{font-size:clamp(1.45rem,1.2rem + 1vw,1.85rem);line-height:1.25;letter-spacing:-.02em;margin:0;text-wrap:balance}
h2{font-size:1.28rem;line-height:1.3;letter-spacing:-.015em;margin:2.75rem 0 .8rem;padding-bottom:.4rem;border-bottom:1px solid var(--b);text-wrap:balance}
h3{font-size:1.08rem;line-height:1.35;letter-spacing:-.01em;margin:1.75rem 0 .45rem;text-wrap:balance}
#schema h3,h4{font-size:.98rem;line-height:1.4;margin:1.2rem 0 .25rem}
p{margin:.6rem 0;text-wrap:pretty;overflow-wrap:break-word}
li{text-wrap:pretty;overflow-wrap:break-word}
a{color:var(--a);text-underline-offset:.18em;text-decoration-thickness:1px}
a:hover{text-decoration-thickness:2px}
code{font:.88em ui-monospace,'SF Mono','Cascadia Code',Menlo,Consolas,monospace;background:var(--code);padding:.12em .38em;border-radius:4px}
:where(a,button,input,select,summary,[tabindex]):focus-visible{outline:2px solid var(--a);outline-offset:2px}
.saut{position:fixed;left:1rem;top:1rem;z-index:20;padding:.45rem .85rem;background:var(--card);
  color:var(--a);border:2px solid var(--a);border-radius:8px;font-weight:700;text-decoration:none}
.saut:not(:focus-visible){position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip-path:inset(50%);white-space:nowrap;border:0}
.suite{display:flex;align-items:center;justify-content:space-between;gap:.5rem 1rem;flex-wrap:wrap;
  margin:0 0 1.1rem;padding:0 0 .7rem;border-bottom:1px solid var(--b);font-size:.875rem}
.suite-t{font-weight:600;color:var(--f);letter-spacing:-.01em}
.suite ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.35rem}
.suite a{display:inline-block;padding:.3rem .72rem;border:1px solid transparent;border-radius:999px;
  color:var(--m);font-weight:500;text-decoration:none;min-height:1.75rem}
.suite a:hover{color:var(--a);border-color:var(--b);background:var(--card)}
.suite a[aria-current=page]{color:var(--a);font-weight:600;border-color:var(--a);background:var(--card)}
.bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.btn-sec,#bascule,#theme{font:inherit;font-size:.82rem;font-weight:500;letter-spacing:.01em;background:var(--card);border:1px solid var(--bi);
  border-radius:999px;padding:.35rem .9rem;cursor:pointer;color:var(--f);text-decoration:none;white-space:nowrap;display:inline-block}
.btn-sec:hover,#bascule:hover,#theme:hover{border-color:var(--a);color:var(--a)}
.btns{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
#theme{min-width:6.5rem;text-align:center}
#theme [data-t]{display:none}
html:not(.t-light):not(.t-dark) #theme [data-t=auto],
html.t-light #theme [data-t=light],
html.t-dark #theme [data-t=dark]{display:inline}
.badge{display:inline-block;font-size:.78rem;font-weight:500;padding:.2rem .65rem;border-radius:999px;
  border:1px solid var(--avert-b);background:var(--avert-bg);color:var(--f)}
.ctl{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin:1rem 0}
.ctl input,.ctl select{font:inherit;font-size:.9rem;padding:.42rem .65rem;border:1px solid var(--bi);
  border-radius:6px;background:var(--card);color:var(--f)}
.ctl input{flex:1;min-width:10rem}
.m{color:var(--m);font-size:.875rem}
.tw{overflow-x:auto;border:1px solid var(--b);border-radius:8px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:.875rem}
th,td{padding:.55rem .75rem;text-align:left;border-bottom:1px solid var(--b);vertical-align:top}
th{background:var(--th);position:sticky;top:0;font-weight:600;text-wrap:balance}
td.n,th.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
tbody tr:hover{background:var(--hover)}
pre{background:var(--code);border:1px solid var(--b);border-radius:8px;padding:.75rem .95rem;
  overflow-x:auto;font:.84rem/1.5 ui-monospace,'SF Mono','Cascadia Code',Menlo,Consolas,monospace}
.tdm{max-width:60rem;width:100%;justify-self:center}
.tdm ul{list-style:none;margin:.5rem 0 0;padding:0;font-size:.85rem}
.tdm li{margin:.15rem 0}
.tdm a{display:block;padding:.28rem .65rem;border-left:2px solid var(--b);
  color:var(--m);text-decoration:none}
.tdm a:hover,.tdm a.on{color:var(--a);border-left-color:var(--a)}
.tdm a.on{font-weight:600}
details{border:1px solid var(--b);border-radius:8px;background:var(--card);margin:.5rem 0;padding:.65rem .95rem}
summary{cursor:pointer;font-weight:600}
#outils article{border-left:3px solid var(--b);padding-left:1rem;margin:1.5rem 0}
#outils .titre{color:var(--m);font-style:italic;margin:.1rem 0 .5rem}
.avert{background:var(--avert-bg);border:1px solid var(--avert-b);border-radius:8px;padding:.35rem 1.25rem 1rem}
footer{margin-top:3.5rem;padding-top:1.25rem;border-top:1px solid var(--b);font-size:.875rem;color:var(--m)}
.sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip-path:inset(50%);white-space:nowrap;border:0}
.haut{position:fixed;right:1.25rem;bottom:1.25rem;z-index:10;width:2.6rem;height:2.6rem;
  display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:1.1rem;
  background:var(--card);color:var(--f);border:1px solid var(--bi);border-radius:999px}
.haut:hover{color:var(--a);border-color:var(--a)}
html.js .haut{opacity:0;visibility:hidden}
html.js .haut.on{opacity:1;visibility:visible}
@media(prefers-reduced-motion:no-preference){
  html{scroll-behavior:smooth}
  .haut{transition:opacity .2s,visibility .2s,color .2s,border-color .2s}
}
@media(forced-colors:active){
  .suite a[aria-current=page],.tdm a.on{outline:2px solid Highlight}
}
html.l-fr [data-l=en],html.l-en [data-l=fr]{display:none}
@media(min-width:${LARGE}){
  .wrap{grid-template-columns:13rem minmax(0,60rem);gap:2.5rem;align-items:start}
  main,.tdm{max-width:none}
  .tdm{position:sticky;top:2rem;border:0;background:none;margin:0;padding:0;
    max-height:calc(100vh - 4rem);overflow:auto}
  .tdm>summary{display:none}
}
`;

const BOOT = `
try{
  var r=document.documentElement, c=[];
  var p=localStorage.getItem('outilsLang')||(navigator.language||'fr').slice(0,2);
  c.push(p==='en'?'l-en':'l-fr'); r.lang=(p==='en'?'en':'fr');
  var t=localStorage.getItem('outilsTheme');
  if(t==='light'||t==='dark') c.push('t-'+t);
  r.className=c.join(' ');
  var ti=document.querySelector&&document.querySelector('title[data-en]');
  if(ti&&p==='en') document.title=ti.getAttribute('data-en');
}catch(e){}
`;

const JS = String.raw`
(function(){
  var d=document, h=d.documentElement;

  var b=d.getElementById('bascule');
  if(b) b.addEventListener('click',function(){
    var nv=h.classList.contains('l-en')?'fr':'en';
    h.classList.toggle('l-fr',nv==='fr'); h.classList.toggle('l-en',nv==='en');
    h.lang=nv;
    var ti=d.querySelector('title[data-en]');
    if(ti) d.title=ti.getAttribute(nv==='en'?'data-en':'data-fr')||d.title;
    try{localStorage.setItem('outilsLang',nv);}catch(e){}
  });

  var tb=d.getElementById('theme');
  if(tb) tb.addEventListener('click',function(){
    var cur=h.classList.contains('t-light')?'light'
           :h.classList.contains('t-dark')?'dark':'auto';
    var nx=cur==='auto'?'light':cur==='light'?'dark':'auto';
    h.classList.remove('t-light'); h.classList.remove('t-dark');
    if(nx!=='auto') h.classList.add('t-'+nx);
    try{
      if(nx==='auto') localStorage.removeItem('outilsTheme');
      else localStorage.setItem('outilsTheme',nx);
    }catch(e){}
  });

  var td=d.querySelector('.tdm');
  if(td){
    try{
      var mq=matchMedia('(min-width:LARGEUR)');
      var sync=function(){td.open=mq.matches;};
      sync();
      if(mq.addEventListener) mq.addEventListener('change',sync);
      else if(mq.addListener) mq.addListener(sync);
    }catch(e){}
    try{
      var liens=[].slice.call(td.querySelectorAll('a'));
      var cibles=liens.map(function(a){return d.getElementById(a.getAttribute('href').slice(1));});
      var io=new IntersectionObserver(function(es){
        for(var n=0;n<es.length;n++){
          if(!es[n].isIntersecting) continue;
          var k=cibles.indexOf(es[n].target); if(k<0) continue;
          for(var j=0;j<liens.length;j++) liens[j].classList.remove('on');
          liens[k].classList.add('on');
        }
      },{rootMargin:'0px 0px -70% 0px'});
      for(var n2=0;n2<cibles.length;n2++) if(cibles[n2]) io.observe(cibles[n2]);
    }catch(e){}
  }

  var ht=d.querySelector('.haut');
  if(ht){
    try{
      h.classList.add('js');
      var seuil=function(){return (window.innerHeight||600)*0.8;};
      var maj=function(){
        var y=window.pageYOffset||d.documentElement.scrollTop||0;
        if(y>seuil()) ht.classList.add('on'); else ht.classList.remove('on');
      };
      maj();
      window.addEventListener('scroll',maj,{passive:true});
    }catch(e){}
  }

  var q=d.getElementById('q'), sel=d.getElementById('dist'), tb2=d.getElementById('tgreffes');
  if(q&&sel&&tb2){
    var corps=tb2.tBodies[0], rangs=[].slice.call(corps.rows);
    var cpt=d.getElementById('compte');
    var plier=function(s){
      return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    };
    var idx=rangs.map(function(r){return plier(r.textContent);});
    var filtrer=function(){
      var t=plier(q.value.trim()), dd=sel.value, n=0;
      for(var i=0;i<rangs.length;i++){
        var r=rangs[i];
        var okd=(dd===''||r.getAttribute('data-d')===dd);
        var okt=(t===''||idx[i].indexOf(t)>=0);
        var vu=okd&&okt;
        r.style.display=vu?'':'none';
        if(vu) n++;
      }
      if(cpt) cpt.textContent=n+' / '+rangs.length;
    };
    q.addEventListener('input',filtrer);
    sel.addEventListener('change',filtrer);
    filtrer();
  }
})();
`;

function jsClient(): string {
  if (!JS.includes("plier")) throw new Error("JS client tronqué : « plier » absent");
  if (!JS.includes("LARGEUR")) throw new Error("jeton LARGEUR absent du JS client");
  return JS.replace("LARGEUR", LARGE);
}

function sautContenu(): string {
  return `<a href="#contenu-principal" class="saut">${bi("Aller au contenu principal", "Skip to main content")}</a>`;
}

function barreSuite(): string {
  return `<nav class="suite" aria-labelledby="suite-t">
<span id="suite-t" class="sr">${bi("Suite Droit civil québécois", "Québec Civil Law suite")}</span>
<span class="suite-t">${bi("Droit civil québécois", "Québec Civil Law")}</span>
<ul>
<li><a href="https://acces.poirierlavoie.ca/">${bi("Accès", "Access")}</a></li>
<li><a href="https://legislation.poirierlavoie.ca/">${bi("Législation", "Legislation")}</a></li>
<li><a href="https://jurisprudence.poirierlavoie.ca/">${bi("Jurisprudence", "Case Law")}</a></li>
<li><a href="/" aria-current="page">${bi("Outils", "Tools")}</a></li>
</ul>
</nav>`;
}

function tdm(): string {
  const items = SECTIONS.map((s) => `<li><a href="#${s.id}">${bi(s.fr, s.en)}</a></li>`).join("");
  return `<details class="tdm" open>
<summary id="tdm-t">${bi("Sommaire", "Contents")}</summary>
<nav aria-labelledby="tdm-t"><ul>${items}</ul></nav>
</details>`;
}

function haut(): string {
  return (
    `<a href="#top" class="haut"><span aria-hidden="true">${FLECHE}</span>` +
    `<span class="sr">${bi("Haut de page", "Back to top")}</span></a>`
  );
}

function etat(t: string, fr: string, en: string): string {
  return `<span data-t="${t}">${bi(fr, en)}</span>`;
}

function entete(): string {
  return `<header>
${barreSuite()}
<div class="bar">
<h1>${bi("MCP Outils — Délais, intérêts, greffes, registres, terminologie et économie", EN.titre)}</h1>
<div class="btns">
<button id="theme" type="button" title="Thème / Theme">${etat("auto", "◐ Auto", "◐ Auto")}${etat("light", `${SOLEIL} Clair`, `${SOLEIL} Light`)}${etat("dark", "☾ Sombre", "☾ Dark")}</button>
<button id="bascule" type="button" title="Français / English">FR&nbsp;·&nbsp;EN</button>
</div>
</div>
${biP(
  [
    "Connecteur gratuit réservé aux membres actifs en règle du Barreau du Québec pour la pratique du litige civil et commercial québécois " +
      "(via acces.poirierlavoie.ca, aucune clé API CanLII requise). Il permet à votre assistant IA de calculer avec exactitude " +
      "les jours fériés, les délais de procédure, les intérêts (art. 1619 C.c.Q.) et la fixation " +
      "de loyer TAL, et de consulter hors ligne les dossiers de cour, palais de justice, registres " +
      "d'entreprises (REQ, RBQ, OPC, RENA, Corporations Canada, GLEIF), adresses/lots RQA, " +
      "terminologie bijuridique, taux Banque du Canada, IPC StatCan et loyers SCHL.",
  ],
  EN.intro,
)}
<div class="avert">
${biP(
  [
    "Chaque calcul et chaque consultation s'exécute localement sur des jeux de données publics, " +
      "sans appel externe ni journalisation des noms de parties, adresses, extraits de projets " +
      "d'actes, dates, montants ou numéros de dossier.",
    "Cet outil applique des règles de calendrier/calcul et lit des instantanés datés : il " +
      "n'établit jamais qu'un dossier de cour existe, ne remplace ni le Registraire des " +
      "entreprises ni le Registre foncier du Québec, ne prouve pas le domicile d'une partie et " +
      "ne choisit pas automatiquement le délai applicable. Vérifiez aux sources officielles avant " +
      "toute signification ou tout dépôt.",
  ],
  EN.avertissement,
)}
</div>
<p class="btns">
<span class="badge">${bi("Barreau du Québec · Sans clé CanLII", "Barreau du Québec · No CanLII key")}</span>
<code>https://outils.poirierlavoie.ca/mcp/oauth</code>
<a class="btn-sec" href="https://acces.poirierlavoie.ca/demande">${bi("Demander l'accès (/demande) →", "Apply for access (/demande) →")}</a>
</p>
</header>`;
}

export const RESUME_OUTILS_FR: Readonly<Record<string, readonly string[]>> = {
  calendrier_holidays: [
    "Dresse la liste des jours fériés et non juridiques d'une année civile selon le Code de procédure civile, la prescription du Code civil ou les lois d'interprétation du Québec et du Canada.",
  ],
  calendrier_deadlines: [
    "Calcule jusqu'à 25 délais de procédure ou légaux d'un seul coup (vers l'avant ou à rebours), en tenant compte du report après 17 h 00 lors d'une notification technologique, des fins de semaine/jours fériés et des périodes hors séance.",
    "Effectue un calcul purement arithmétique sans déterminer quel délai légal s'applique à votre situation — vérifiez toujours la règle applicable.",
  ],
  interets_1619: [
    "Calcule au cent près les intérêts légaux (5 %), l'indemnité additionnelle de l'art. 1619 C.c.Q. (taux trimestriels art. 28 L.A.F. de Revenu Québec), un taux contractuel fixe ou le taux préférentiel BDC (série V80691311) majoré d'une marge (spread_bps), jusqu'à 50 tranches.",
    "N'extrapole jamais au-delà du dernier trimestre L.A.F. publié ni de la dernière date préférentielle vérifiée.",
  ],
  greffe_parse_number: [
    "Décompose un numéro de dossier judiciaire québécois (ou un préfixe comme TAL-, TAQ-, C.F.-) pour indiquer le greffe, le palais de justice, le district judiciaire, le tribunal et sa compétence.",
    "Lit uniquement des tables locales hors ligne : ne consulte aucun plumitif et ne prouve pas l'existence du dossier.",
  ],
  palais_list: [
    "Répertorie les 44 palais de justice et 9 points de service du Québec avec leur adresse civique, les numéros de greffe qui y siègent et leur district judiciaire, filtrables par région ou par nom.",
  ],
  palais_get: [
    "Affiche la fiche complète d'un palais de justice : adresse civique et postale, heures d'ouverture, télécopieur, numéros de téléphone et courriels par chambre ou service. Vérifiez sur le site du Ministère avant toute signification ou audience.",
  ],
  registre_search: [
    "Recherche hors ligne dans les données ouvertes du Registraire des entreprises du Québec (REQ, enrichies des licences RBQ, permis OPC et inscriptions RENA), de Corporations Canada et de la GLEIF (entités canadiennes titulaires d'un LEI, dont banques et fiducies) par nom, nom d'emprunt, société à numéro, NEQ, numéro fédéral ou LEI.",
    "La loi exclut les dirigeants et bénéficiaires ultimes personnes physiques des jeux ouverts : vérifiez aux portails officiels avant de désigner ou signifier une partie.",
  ],
  registre_get_entity: [
    "Obtient la fiche détaillée d'une entreprise par NEQ à 10 chiffres, numéro fédéral, NE/BN ou LEI à 20 caractères (statut, forme juridique, établissements, licences RBQ, permis OPC, RENA, hiérarchie comptable GLEIF Level 2 et liens directs vers les portails officiels REQ, Corporations Canada, PCI/ISC et GLEIF). Instantané informatif seulement — ne vaut pas certificat officiel.",
  ],
  adresse_verify: [
    "Vérifie l'existence municipale d'une adresse au Québec et en normalise l'orthographe, le code postal et le district judiciaire probable (en corrigeant fautes de frappe et anciens noms de rue). N'établit jamais le domicile d'une partie ni un titre foncier.",
  ],
  terminologie_lookup: [
    "Recherche les équivalents français et anglais justes en droit civil québécois dans un glossaire spécialisé, les lois bilingues, TERMIUM Plus et l'OQLF, tout en signalant les faux amis de common law ou de droit français (p. ex. « mortgage » vs « hypothec »).",
  ],
  termino_attestations: [
    "Vérifie combien de fois un terme juridique paraît dans les lois du Québec et du Canada et affiche côte à côte les extraits officiels en français et en anglais pour appuyer un choix de rédaction.",
  ],
  terminologie_scan: [
    "Relit un extrait de projet d'acte, contrat ou lettre (en français ou en anglais) pour repérer les calques de common law (« mortgage », « consideration », « joint and several »), les francismes de France et les termes abrogés d'avant 2016 (« bref », « comparution »), sans jamais modifier votre texte.",
  ],
  taux_boc_rates: [
    "Consulte hors ligne les taux de change de la Banque du Canada face au CAD (2001–2026+) et les taux directeur, d'escompte et préférentiel (V39079, V122530, V80691311), avec conversion exacte en BigInt selon l'art. 12 de la Loi sur la monnaie.",
    "Distingue explicitement le régime au comptant de midi (avant le 1er mai 2017) de la moyenne quotidienne de 16 h 30 HE et signale tout report au jour ouvrable précédent.",
  ],
  indice_ipc: [
    "Consulte hors ligne les indices des prix à la consommation de Statistique Canada (tableaux 18-10-0004-01 mensuel et 18-10-0005-01 annuel : Ensemble, Logement, Logement locatif, Loyer et Soins de santé pour Québec, Montréal, RMR de Québec et Canada) avec variation annuelle (%).",
    "Calcule une indexation contractuelle exacte en BigInt (plancher, plafond et arrondi) et bloque toute division entre années de base distinctes (2002=100 vs 1992=100) sans facteur officiel.",
  ],
  loyer_tal: [
    "Fournit les barèmes officiels du TAL (2015–2027), exécute le calculateur déterministe post-1er janvier 2026 en BigInt (RLRQ, c. T-15.01, r. 2 ; Décret 1455-2025) avec part RPA, taxes/assurances asymétriques, travaux 5 % et arrondi art. 15.1, et consulte les loyers moyens SCHL (34-10-0133-01).",
    "Signale les avis antérieurs au 1er janvier 2026 (art. 6 Décret 1455-2025), l'exemption de 5 ans (art. 1955 C.c.Q., Section F) et le pouvoir d'appréciation du TAL.",
  ],
};

function marqueurAppel(d: ToolDescriptor): string {
  return `<p class="m"><code>openWorldHint: ${d.annotations.openWorldHint}</code> · <code>readOnlyHint: ${d.annotations.readOnlyHint}</code> — ${bi(
    "aucun appel externe : calcul local ou consultation hors ligne en lecture seule.",
    "no outbound call: local calculation or read-only offline lookup.",
  )}</p>`;
}

function outils(): string {
  const carte = (d: ToolDescriptor) => {
    const en = OUTILS_EN[d.name];
    const resumeFr = RESUME_OUTILS_FR[d.name] ?? [d.description];
    const resumeEn = en?.resume ?? [en?.texte ?? d.description];
    return `<article>
<h4><code>${esc(d.name)}</code></h4>
<p class="titre">${bi(d.title, en?.titre ?? d.title)}</p>
${biP(resumeFr, resumeEn)}
<details>
<summary>${bi("Instruction exacte transmise à l'assistant IA", "Exact prompt sent to the AI assistant")}</summary>
${biP([d.description], [en?.texte ?? d.description])}
${marqueurAppel(d)}
</details>
</article>`;
  };

  const tous = listToolDescriptors();
  const calculs = tous.filter((d) => d.family === "calcul");
  const greffe = tous.filter((d) => d.family === "greffe");
  const registre = tous.filter((d) => d.family === "registre");
  const adresse = tous.filter((d) => d.family === "adresse");
  const terminologie = tous.filter((d) => d.family === "terminologie");
  const economie = tous.filter((d) => d.family === "economie");

  return `<section id="outils">
${h2("outils")}
${biP(
  [
    "Vous n'avez jamais à lancer ces fonctions vous-même : votre assistant IA les appelle automatiquement en arrière-plan pour calculer des délais, intérêts ou loyers TAL, vérifier une entreprise ou une adresse, consulter les taux BdC ou l'IPC, ou relire votre terminologie.",
  ],
  EN.outilsIntro,
)}
<h3>${bi("Calculateurs exacts (jours fériés, délais, intérêts art. 1619 C.c.Q.)", EN.familleCalcul)}</h3>
${biP(
  [
    "Trois calculateurs arithmétiques fondés sur le Code de procédure civile, les lois d'interprétation " +
      "(Québec et Canada) et le Code civil du Québec (art. 1618–1620 C.c.Q., taux de l'art. 28 L.A.F. " +
      `jusqu'au trimestre ${lafRatesJson.metadata.last_quarter} et taux préférentiel BDC V80691311 vérifié jusqu'au ${bocPrimeRatesJson.metadata.last_verified_date}).`,
  ],
  EN.familleCalculTexte,
)}
${calculs.map(carte).join("\n")}
<h3>${bi("Tables locales du Québec — numéros de dossier et palais de justice", EN.familleGreffe)}</h3>
${biP(
  [
    "Trois outils s'appuyant sur des tables de référence tirées du ministère de la Justice du Québec " +
      `(palais relevés le ${RELEVE_LE}, rattachements du ${MJQ_MAJ}). Ils ne consultent aucun ` +
      "plumitif et n'effectuent aucun appel externe.",
  ],
  EN.familleGreffeTexte,
)}
${greffe.map(carte).join("\n")}
<h3>${bi("Registres d'entreprises (QC / Canada / GLEIF) — REQ, RBQ, OPC, RENA, Corporations Canada et LEI", EN.familleRegistre)}</h3>
${biP(
  [
    "Deux outils adossés à un instantané local en lecture seule des registres publics d'entreprises et " +
      "des hiérarchies comptables GLEIF (CC0 1.0). Les dirigeants, administrateurs et bénéficiaires ultimes " +
      "personnes physiques sont exclus conformément à la Loi sur la publicité légale des entreprises (RLRQ, c. P-44.1) " +
      "et à la L.C.S.A. : des liens directs vers les portails officiels (REQ, Corporations Canada, PCI/ISC et GLEIF) " +
      "sont fournis à chaque fiche.",
  ],
  EN.familleRegistreTexte,
)}
${registre.map(carte).join("\n")}
<h3>${bi("Adresses civiques du Québec — Référentiel québécois des adresses (RQA)", EN.familleAdresse)}</h3>
${biP(
  [
    "Un outil adossé à une copie locale en lecture seule du Référentiel québécois des adresses " +
      "(MRNF, ~5 millions d'adresses) et d'Odonymes et renvois. Il confirme l'existence municipale " +
      "d'une adresse civique sans jamais établir le domicile d'une partie ni la propriété foncière.",
  ],
  EN.familleAdresseTexte,
)}
${adresse.map(carte).join("\n")}
<h3>${bi("Terminologie juridique bilingue et bijuridique (FR / EN)", EN.familleTerminologie)}</h3>
${biP(
  [
    "Trois outils adossés à une base terminologique locale en lecture seule réunissant un glossaire " +
      "de droit civil québécois, des concordances législatives bilingues, TERMIUM Plus® (Droit et " +
      "justice) et les fiches de l'OQLF afin de repérer les calques de common law ou de droit français.",
  ],
  EN.familleTerminologieTexte,
)}
${terminologie.map(carte).join("\n")}
<h3>${bi("Économie, IPC et logement (Banque du Canada, StatCan et TAL)", EN.familleEconomie)}</h3>
${biP(
  [
    "Trois outils réunissant une base locale en lecture seule (DB_ECONOMIE : taux de change et taux " +
      "directeurs Banque du Canada depuis 2001, IPC mensuel/annuel Statistique Canada 18-10-0004-01 " +
      "et 18-10-0005-01, loyers moyens SCHL 34-10-0133-01) et les barèmes réglementaires embarqués " +
      "du Tribunal administratif du logement (RLRQ, c. T-15.01, r. 2).",
  ],
  EN.familleEconomieTexte,
)}
${economie.map(carte).join("\n")}
</section>`;
}

interface JsonSchemaProperty {
  type?: string;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  description?: string;
  items?: JsonSchemaProperty & {
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
}

function contraintes(s: JsonSchemaProperty): string {
  const bouts: string[] = [];
  if (s.enum) bouts.push(s.enum.map((v) => `« ${String(v)} »`).join(" · "));
  if (s.pattern) bouts.push(`motif ${s.pattern}`);
  if (s.minLength !== undefined || s.maxLength !== undefined) {
    bouts.push(`${s.minLength ?? 0}–${s.maxLength ?? "∞"} car.`);
  }
  if (s.minimum !== undefined || s.maximum !== undefined) {
    bouts.push(`${s.minimum ?? "−∞"} – ${s.maximum ?? "∞"}`);
  }
  if (s.minItems !== undefined || s.maxItems !== undefined) {
    bouts.push(`${s.minItems ?? 0}–${s.maxItems ?? "∞"} éléments`);
  }
  return bouts.join(" · ");
}

function schemas(): string {
  const bloc = (d: ToolDescriptor) => {
    const schema = d.inputSchema as {
      properties?: Record<string, JsonSchemaProperty>;
      required?: string[];
    };
    const props = schema.properties ?? {};
    const requis = new Set(schema.required ?? []);
    const noms = Object.keys(props);
    const idTitre = `sc-${esc(d.name)}`;
    if (noms.length === 0) {
      return `<h4 id="${idTitre}"><code>${esc(d.name)}</code></h4>
<p class="m">${bi("Aucun paramètre.", "No parameters.")}</p>`;
    }

    const ligne = (n: string, p: JsonSchemaProperty, obligatoire: boolean, sous = false) => {
      const type = p.type === "array" ? `array&lt;${p.items?.type ?? "?"}&gt;` : (p.type ?? "?");
      return `<tr>
<td>${sous ? '<span class="m">· </span>' : ""}<code>${esc(n)}</code>${obligatoire ? ` <span class="m">${bi("requis", EN.requis)}</span>` : ""}</td>
<td><code>${esc(type)}</code></td>
<td class="m">${esc(contraintes(p))}</td>
<td class="m">${esc(p.description ?? "")}</td>
</tr>`;
    };

    const lignes = noms
      .flatMap((n) => {
        const p = props[n]!;
        const sortie = [ligne(n, p, requis.has(n))];
        const sousProps = p.items?.properties;
        if (sousProps) {
          const sousRequis = new Set(p.items?.required ?? []);
          for (const [sn, sp] of Object.entries(sousProps)) {
            sortie.push(ligne(`${n}[].${sn}`, sp, sousRequis.has(sn), true));
          }
        }
        return sortie;
      })
      .join("");

    return `<h3 id="${idTitre}"><code>${esc(d.name)}</code></h3>
<div class="tw" tabindex="0" role="region" aria-labelledby="${idTitre}"><table><thead><tr>
<th scope="col">${bi("Paramètre", EN.colParam)}</th><th scope="col">${bi("Type", EN.colType)}</th>
<th scope="col">${bi("Contraintes", EN.colContrainte)}</th><th scope="col">${bi("Description", EN.colDescription)}</th>
</tr></thead><tbody>${lignes}</tbody></table></div>`;
  };

  return `<section id="schema">
${h2("schema")}
${biP(
  [
    "Référence technique pour les développeurs et scripts : chaque outil n'accepte que les " +
      "paramètres listés ci-dessous, générés directement à partir des règles de validation du serveur.",
    "La colonne Description reste en français dans les deux vues, car ces phrases sont le texte " +
      "exact reçu par l'assistant.",
  ],
  EN.schemaTexte,
)}
<details>
<summary>${bi("Afficher les tables de paramètres des 15 outils (référence technique)", EN.schemaResume)}</summary>
${listToolDescriptors().map(bloc).join("\n")}
</details>
</section>`;
}

const EXEMPLES = [
  "500-05-123456-241",
  "TAL-594531",
  "C.F.-T-1234-26",
  "XYZ-9999",
  "999-99-123456",
  "500 - 05 - 123456",
] as const;

function issue(entree: string): string {
  const r = analyserNumeroDossier(entree);
  if (r.parse_error) return `⚠ ${r.parse_error}`;
  if (r.forum) {
    return `${r.forum.name} (${r.forum.abbr}) — ${
      r.is_administrative ? "tribunal administratif" : "cour fédérale"
    }`;
  }
  if (r.is_administrative && !r.greffe_number) {
    return "Préfixe alphabétique non répertorié — aucun tribunal deviné, et ce n'est pas une erreur.";
  }
  const bouts = [
    r.greffe ? `greffe ${r.greffe_number} · ${r.greffe.palais_de_justice}` : null,
    r.greffe ? `district de ${r.greffe.district_judiciaire}` : null,
    r.juridiction ? `${r.juridiction.tribunal} · ${r.juridiction.competence}` : null,
  ].filter((b): b is string => b !== null);
  return bouts.join(" · ");
}

function dossier(): string {
  const lignes = EXEMPLES.map(
    (e) => `<tr><td><code>${esc(e)}</code></td><td class="m">${esc(issue(e))}</td></tr>`,
  ).join("");

  const jur = Object.entries(JURIDICTIONS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([code, j]) => `<tr><td><code>${esc(code)}</code></td><td>${esc(j.tribunal)}</td>
<td>${esc(j.competence)}</td><td class="m">${esc(LIBELLE_TYPE_GREFFE[j.greffe_type])}</td></tr>`,
    )
    .join("");

  return `<section id="dossier">
${h2("dossier")}
${biP(
  [
    "Un numéro de dossier judiciaire québécois se lit NNN-NN-NNNNNN-NNN. Les positions 1 à 3 " +
      "indiquent le greffe (palais de justice et district judiciaire), et les positions 5 et 6 " +
      "indiquent la juridiction (tribunal, compétence, type de greffe). Le reste correspond au " +
      "numéro séquentiel et aux chiffres finaux.",
    "Les positions 7 et suivantes ne sont pas analysées et aucun chiffre de contrôle n'est vérifié, " +
      "faute de règle officielle permettant d'éviter de faux rejets sur des dossiers valides.",
    "Lorsqu'un numéro commence par un préfixe alphabétique (TAL-, TAQ-, C.F.-), ce préfixe désigne " +
      "directement un tribunal ou organisme qui numérote ses propres dossiers.",
  ],
  EN.dossierTexte,
)}
<h3 id="h-dossier-ex">${bi("Exemples de lecture d'un numéro de dossier", EN.dossierExemples)}</h3>
${biP(
  [
    "Les exemples ci-dessous montrent directement comment l'outil décompose différents formats de numéros de dossier :",
  ],
  EN.dossierExemplesTexte,
)}
<div class="tw" tabindex="0" role="region" aria-labelledby="h-dossier-ex"><table><thead><tr>
<th scope="col">${bi("Entrée", EN.colEntree)}</th><th scope="col">${bi("Issue", EN.colIssue)}</th>
</tr></thead><tbody>${lignes}</tbody></table></div>
<div class="avert"><p>${bi(GARDE_DOSSIER, GARDE_DOSSIER)}</p></div>
<h3 id="h-dossier-jur">${bi("Codes de juridiction", EN.juridictionsTitre)}</h3>
${biP(
  [
    "Le code à deux chiffres des positions 5 et 6. Le tiret (—) aux codes 46, 72 et 73 est normal : " +
      "ces séries administratives ne relèvent d'aucun tribunal particulier.",
  ],
  EN.juridictionsTexte,
)}
<div class="tw" tabindex="0" role="region" aria-labelledby="h-dossier-jur"><table><thead><tr>
<th scope="col">${bi("Code", EN.colCode)}</th><th scope="col">${bi("Tribunal", EN.colTribunal)}</th>
<th scope="col">${bi("Compétence", EN.colCompetence)}</th><th scope="col">${bi("Type de greffe", EN.colGreffeType)}</th>
</tr></thead><tbody>${jur}</tbody></table></div>
</section>`;
}

function greffes(): string {
  const districts = listerDistricts();
  const options = districts.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("");

  const lignes = Object.keys(GREFFES)
    .sort()
    .map((numero) => {
      const g = GREFFES[numero]!;
      const adresse = adresseDuGreffe(numero);
      const siege = g.palais_key ? null : siegeFixe(numero);
      const localites = localitesItinerantes(numero);

      const cellAdresse = adresse
        ? `${esc(adresse.street)}${adresse.unit ? `, ${esc(adresse.unit)}` : ""}<br>` +
          `${esc(adresse.city)} (Québec) ${esc(adresse.postal_code)}` +
          (siege
            ? `<br><span class="m">${bi(
                `Siège fixe : ${siege.palais.name}, rattaché par le relevé du Ministère`,
                `Fixed seat: ${siege.palais.name}, attached by the Ministry's listing`,
              )}</span>`
            : "")
        : `<span class="m">${bi("aucune adresse publiée", EN.sansAdresse)}</span>`;

      const types = [
        g.point_de_service
          ? `<span class="m">${bi("cour itinérante", EN.typeItinerant)}</span>`
          : null,
        localites.length > 0 ? `<span class="m">${esc(localites.join(", "))}</span>` : null,
      ]
        .filter((t): t is string => t !== null)
        .join("<br>");

      return `<tr data-d="${esc(g.district_judiciaire)}">
<td><code>${esc(numero)}</code></td>
<td>${esc(g.palais_de_justice)}</td>
<td>${esc(g.district_judiciaire)}</td>
<td>${cellAdresse}</td>
<td>${types}</td>
</tr>`;
    })
    .join("");

  return `<section id="greffes">
${h2("greffes")}
${biP(
  [
    "Les greffes du Québec, classés selon les trois premiers chiffres d'un numéro de dossier. " +
      "Un greffe est un registre administratif et un palais est un bâtiment : un même numéro de " +
      "greffe peut desservir plusieurs lieux, et un même palais peut regrouper plusieurs greffes.",
  ],
  EN.greffesTexte,
)}
<search class="ctl">
<label class="sr" for="q">${bi("Filtrer les greffes et palais", "Filter registries and courthouses")}</label>
<input id="q" type="search" placeholder="Filtrer / Filter">
<label class="sr" for="dist">${bi("Filtrer par district judiciaire", "Filter by judicial district")}</label>
<select id="dist"><option value="">Tous les districts · All districts</option>${options}</select>
<span class="m" id="compte" role="status" aria-live="polite"></span>
</search>
<div class="tw" tabindex="0" role="region" aria-labelledby="h-greffes"><table id="tgreffes"><thead><tr>
<th scope="col">${bi("Greffe", EN.colGreffe)}</th><th scope="col">${bi("Palais", EN.colPalais)}</th>
<th scope="col">${bi("District judiciaire", EN.colDistrict)}</th><th scope="col">${bi("Adresse", EN.colAdresse)}</th>
<th scope="col">${bi("Type", EN.colTypeLieu)}</th>
</tr></thead><tbody>${lignes}</tbody></table></div>

<div class="avert">
<p>${bi(GARDE_SANS_ADRESSE, GARDE_SANS_ADRESSE)}</p>
</div>

<h3>${bi("Coordonnées et heures d'ouverture", EN.coordonneesTitre)}</h3>
<div class="avert">
${biP(
  [
    "L'outil palais_get (et la sortie structurée de greffe_parse_number) rend les numéros de " +
      "téléphone, télécopieurs, adresses courriel par chambre ou service et heures d'ouverture " +
      `relevés auprès du ministère de la Justice du Québec le ${RELEVE_LE} (44 palais de justice ` +
      "et 9 points de service).",
    "Les numéros et heures d'ouverture peuvent changer sans préavis : vérifier sur le site " +
      "officiel du Ministère avant toute signification, tout dépôt ou toute audience.",
  ],
  EN.coordonneesTexte,
)}
<p><a href="https://www.justice.gouv.qc.ca/nous-joindre/trouver-un-palais-de-justice/">justice.gouv.qc.ca</a></p>
</div>

<div class="avert">
<p>${bi(GARDE_PALAIS, GARDE_PALAIS)}</p>
<p class="m">${bi(
    `Adresses relevées le ${RELEVE_LE} · rattachements des greffes selon le relevé du Ministère mis à jour le ${MJQ_MAJ}.`,
    `Addresses surveyed ${RELEVE_LE} · registry attachments per the Ministry's listing updated ${MJQ_MAJ}.`,
  )}</p>
</div>
</section>`;
}

function acces(): string {
  return `<section id="acces">
${h2("acces")}
${biP(
  [
    "Accès réservé gratuitement aux membres actifs en règle du Barreau du Québec — aucune clé API CanLII requise (ce connecteur ne dépend pas de CanLII).",
    "Déposez une demande unique sur acces.poirierlavoie.ca/demande (clé API CanLII facultative sur /demande et gérable dans /moi ; exigée uniquement pour juris), puis connectez https://outils.poirierlavoie.ca/mcp/oauth via OAuth 2.1 (par défaut) dans claude.ai, Gemini ou Antigravity — ou utilisez https://outils.poirierlavoie.ca/mcp avec votre jeton personnel (/moi) pour les scripts et CLI sans navigateur.",
  ],
  EN.acces,
)}
<details>
<summary>${bi("Détails techniques (OAuth 2.1, découverte MCP, quotas et licences)", EN.accesTechniqueTitre)}</summary>
${biP(
  [
    `Service ${SERVER_NAME} v${SERVER_VERSION} — points d'accès : https://outils.poirierlavoie.ca/mcp/oauth ` +
      "(OAuth 2.1 PKCE S256 par défaut via acces.poirierlavoie.ca ; refus 401 RFC 9728 sans jeton) et https://outils.poirierlavoie.ca/mcp " +
      "(jeton Bearer ou ?key= sans navigateur ; retourne 404 sans corps à tout appel non authentifié ; portées acceptées : tous, outils et héritée les_deux). Métadonnées RFC 9728 : " +
      "https://outils.poirierlavoie.ca/.well-known/oauth-protected-resource/mcp/oauth · Fiche de " +
      "découverte MCP : https://outils.poirierlavoie.ca/mcp/server-card · Santé sans " +
      "journalisation : https://outils.poirierlavoie.ca/health (quota quotidien partagé local : " +
      "3 000 appels/jour actif, 300 limité ; débit par titulaire : 300 req/min actif, 20 limité).",
    "Le code source et le glossaire de droit civil sont libres et gratuits sous licence Apache-2.0 " +
      "(voir LICENSE), tandis que les jeux de données publics intégrés demeurent soumis aux " +
      "licences de leurs éditeurs respectifs décrites dans NOTICE (dont CC BY-NC-SA 4.0 pour " +
      "le REQ et l'OQLF).",
  ],
  EN.accesTechnique,
)}
</details>
<p><a href="https://acces.poirierlavoie.ca/">acces.poirierlavoie.ca</a>
 · <a href="https://legislation.poirierlavoie.ca/">${bi("Législation", "Legislation")}</a>
 · <a href="https://jurisprudence.poirierlavoie.ca/">${bi("Jurisprudence", "Case Law")}</a>
 · <a href="${DEPOT_PLUGIN}">droit-civil-quebecois</a>
 · <a href="${DEPOT}">github.com/jpoirierlavoie/MCP-Outils</a>
 · <a href="mailto:jason@poirierlavoie.ca">jason@poirierlavoie.ca</a></p>
</section>`;
}

function pied(): string {
  return `<footer>
${biP(
  [
    "Jason Poirier Lavoie, avocat (Québec). Sources de données ouvertes : Revenu Québec " +
      "(art. 28 L.A.F.), Tribunal administratif du logement / LégisQuébec (RLRQ, c. T-15.01, r. 2), " +
      "Banque du Canada (taux de change et taux directeurs/préférentiels), " +
      "Statistique Canada (Tableaux 10-10-0008-01, 18-10-0004-01, 18-10-0005-01 et 34-10-0133-01 SCHL, OGL-Canada), " +
      "ministère de la Justice du Québec, " +
      "Registraire des entreprises (CC BY-NC-SA 4.0), RBQ / OPC / AMP — RENA / MRNF — RQA (CC BY 4.0), " +
      "Corporations Canada et TERMIUM Plus® (OGL-Canada), GLEIF Golden Copy L1/L2/REPEX (CC0 1.0), " +
      "Office québécois de la langue française (CC BY-NC-SA 4.0).",
    "Aucun conseil juridique. Cet outil ne remplace ni la vérification à la source, ni le " +
      "jugement professionnel.",
  ],
  EN.pied,
)}
</footer>`;
}

function construireJsonLd(): string {
  const nomsOutils = listToolDescriptors().map((d) => d.name);
  const graphe = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${ORIGINE_SITE}/#site`,
        url: `${ORIGINE_SITE}/`,
        name: [
          "MCP Outils — Délais, intérêts, greffes, registres, terminologie et économie",
          EN.titre,
        ],
        inLanguage: ["fr-CA", "en-CA"],
        isPartOf: {
          "@type": "SoftwareApplication",
          "@id": `${DEPOT_PLUGIN}#plugin`,
          name: "Droit civil québécois",
          url: DEPOT_PLUGIN,
        },
      },
      {
        "@type": "WebAPI",
        "@id": `${ORIGINE_SITE}/#api`,
        name: "MCP Outils (outils)",
        url: `${ORIGINE_SITE}/`,
        documentation: `${ORIGINE_SITE}/mcp/server-card`,
        termsOfService: "https://acces.poirierlavoie.ca/cgu",
        license: "https://www.apache.org/licenses/LICENSE-2.0",
        isAccessibleForFree: true,
        inLanguage: ["fr-CA", "en-CA"],
        description: SERVER_DESCRIPTION,
        featureList: nomsOutils,
      },
      {
        "@type": "Dataset",
        "@id": `${ORIGINE_SITE}/#open-data`,
        name: [
          "Tables judiciaires MJQ, taux art. 28 L.A.F., taux BdC, IPC StatCan, critères TAL, registres d'entreprises, adresses RQA et terminologie bijuridique",
          "MJQ judicial directories, art. 28 T.A.A. rates, BoC rates, StatCan CPI/CMHC, TAL rent criteria, business registries, RQA addresses, and bijural terminology",
        ],
        description: `57 registries across 36 judicial districts (MJQ surveyed ${RELEVE_LE}, registry attachments ${MJQ_MAJ}), art. 28 L.A.F. rates through ${lafRatesJson.metadata.last_quarter}, Bank of Canada rates through ${bocPrimeRatesJson.metadata.last_verified_date}, and read-only REQ/RBQ/OPC/RENA, Corporations Canada, GLEIF (CC0 1.0), RQA, StatCan (10-10-0008-01, 18-10-0004-01, 18-10-0005-01, 34-10-0133-01), TAL T-15.01 r. 2, and bijural terminology snapshots.`,
        url: `${ORIGINE_SITE}/#greffes`,
        inLanguage: ["fr-CA", "en-CA"],
        dateModified: RELEVE_LE,
        license: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
      },
    ],
  };
  return JSON.stringify(graphe).replace(/</g, "\\u003c");
}

function renderSite(): string {
  const corps = [entete(), outils(), dossier(), greffes(), acces(), schemas(), pied()].join("\n");
  const titrePage = "MCP Outils — Délais, intérêts, greffes, registres et économie";
  const titrePageEn = "MCP Tools — Deadlines, Interest, Registries, Terms, Economy";
  const descMeta =
    "Serveur MCP sans journalisation : délais C.p.c., intérêts art. 1619 C.c.Q., greffes, registres, adresses RQA, terminologie, taux BdC, IPC et loyer TAL.";

  return `<!doctype html>
<html lang="fr" class="l-fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title data-fr="${esc(titrePage)}" data-en="${esc(titrePageEn)}">${esc(titrePage)}</title>
<meta name="description" content="${esc(descMeta)}">
<link rel="canonical" href="${ORIGINE_SITE}/">
<link rel="alternate" type="application/mcp-server-card+json" href="${ORIGINE_SITE}/mcp/server-card">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(titrePage)}">
<meta property="og:description" content="${esc(descMeta)}">
<meta property="og:url" content="${ORIGINE_SITE}/">
<meta property="og:locale" content="fr_CA">
<meta property="og:locale:alternate" content="en_CA">
<style>${compacterBloc(CSS)}</style>
<script type="application/ld+json">${construireJsonLd()}</script>
<script>${compacterBloc(BOOT)}</script>
</head>
<body>
${sautContenu()}
<div class="wrap">
${tdm()}
<main id="contenu-principal" tabindex="-1">
${corps}
</main>
</div>
${haut()}
<script>${compacterBloc(jsClient())}</script>
</body>
</html>`;
}

let memo: string | null = null;

export function pagePubliqueHtml(): string {
  if (memo === null) memo = renderSite();
  return memo;
}

export const CHEMINS_DECOUVERTE_PUBLIQUE = ["/robots.txt", "/sitemap.xml", "/llms.txt"] as const;
type CheminDecouvertePublique = (typeof CHEMINS_DECOUVERTE_PUBLIQUE)[number];

export function estCheminDecouvertePublique(
  pathname: string,
): pathname is CheminDecouvertePublique {
  return (CHEMINS_DECOUVERTE_PUBLIQUE as readonly string[]).includes(pathname);
}

const ROBOTS_TXT = [
  "User-agent: *",
  "Allow: /",
  "Disallow: /mcp",
  "Disallow: /health",
  `Sitemap: ${ORIGINE_SITE}/sitemap.xml`,
  "",
].join("\n");

const SITEMAP_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  `  <url><loc>${ORIGINE_SITE}/</loc></url>`,
  "</urlset>",
  "",
].join("\n");

let llmsMemo: string | null = null;

function construireLlmsTxt(): string {
  const outilsLignes = listToolDescriptors().map(
    (d) => `- \`${d.name}\` — ${d.title} / ${OUTILS_EN[d.name]?.titre ?? d.title}`,
  );
  return [
    `# MCP Outils (\`outils\`, ${SERVER_NAME} v${SERVER_VERSION}) — Québec Civil Litigation Tools`,
    "",
    `> ${SERVER_DESCRIPTION}`,
    "",
    "## Endpoints (OAuth 2.1 & Bearer token via MCP-Acces)",
    "",
    `- Streamable HTTP (default OAuth 2.1 PKCE via acces.poirierlavoie.ca; scopes \`tous\`, \`outils\`, legacy \`les_deux\`): \`${ORIGINE_SITE}/mcp/oauth\``,
    `- Streamable HTTP (headless CLI/API Bearer token / \`?key=\`; returns empty 404 when unauthenticated): \`${ORIGINE_SITE}/mcp\``,
    `- OAuth 2.1 Protected Resource Metadata (RFC 9728): ${ORIGINE_SITE}/.well-known/oauth-protected-resource/mcp/oauth`,
    `- MCP Server Card (SEP-2127): ${ORIGINE_SITE}/mcp/server-card`,
    "",
    "## Tools (15 deterministic read-only MCP tools, derived from live registry)",
    "",
    ...outilsLignes,
    "",
    "## Québec Civil Law MCP Suite (`droit-civil-quebecois`)",
    "",
    "- [MCP Accès (Admission & OAuth 2.1 Portal)](https://acces.poirierlavoie.ca/): Barreau du Québec admission (`/demande`, CanLII API key optional and required only for `juris`, never for `lois` or `outils`) and `/moi` self-service portal for all 3 connectors.",
    "- [MCP Législation (`lois`)](https://legislation.poirierlavoie.ca/): Official Québec & federal statutes, regulations, court directives, and AMF texts (no CanLII key required).",
    "- [MCP Jurisprudence (`juris`)](https://jurisprudence.poirierlavoie.ca/): Case-law citation verification & CanLII metadata (BYOK CanLII).",
    `- [MCP Outils (\`outils\`)](${ORIGINE_SITE}/): 15 tools across 6 families — calculators, judicial registries, corporate/GLEIF snapshots, RQA addresses, bijural terminology, Bank of Canada rates, StatCan CPI, and TAL/CMHC rents (no CanLII key required).`,
    `- [Umbrella Plugin Repository](${DEPOT_PLUGIN}) · [Connector Repository](${DEPOT})`,
    "",
  ].join("\n");
}

export function repondreDecouvertePublique(
  chemin: CheminDecouvertePublique,
  method: string,
): Response {
  if (llmsMemo === null) llmsMemo = construireLlmsTxt();
  const { corps, type } =
    chemin === "/robots.txt"
      ? { corps: ROBOTS_TXT, type: "text/plain; charset=utf-8" }
      : chemin === "/sitemap.xml"
        ? { corps: SITEMAP_XML, type: "application/xml; charset=utf-8" }
        : { corps: llmsMemo, type: "text/markdown; charset=utf-8" };

  const headers = {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "public, max-age=600",
  };

  return method === "HEAD"
    ? new Response(null, { status: 200, headers })
    : new Response(corps, { status: 200, headers });
}
