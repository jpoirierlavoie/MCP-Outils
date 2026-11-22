/**
 * Page publique du serveur MCP (`GET /`) et fichiers publics de découverte
 * (`/robots.txt`, `/sitemap.xml`, `/llms.txt`).
 *
 * TOUT LE CONTENU DÉRIVE DES DONNÉES VIVES : les outils viennent de
 * `listToolDescriptors()`, les schémas de `z.toJSONSchema(...)`, les issues du vrai
 * parseur exécuté au rendu, les palais des tables `src/qc/` et la dernière période
 * tarifaire de `laf_art28_rates.json`.
 *
 * Aucune dépendance ni requête tierce. Sans JavaScript, le français reste affiché.
 */

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

export function biP(fr: readonly string[], en: readonly string[]): string {
  return (
    `<div data-l="fr">${fr.map((p) => `<p>${esc(p)}</p>`).join("")}</div>\n` +
    `<div data-l="en" lang="en">${en.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`
  );
}

export const SECTIONS = [
  { id: "outils", fr: "Les outils", en: "The tools" },
  { id: "schema", fr: "Les schémas", en: "The schemas" },
  { id: "dossier", fr: "Numéro de dossier", en: "Court file numbers" },
  { id: "greffes", fr: "Greffes et palais", en: "Registries and courthouses" },
  { id: "acces", fr: "Accès", en: "Access" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

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

// ── Thème (identique aux connecteurs jumeaux) ─────────────────────────────────

const CLAIR =
  "color-scheme:light;--f:#111;--m:#666;--b:#e2e0da;--a:#7a2e1d;--bg:#fdfcfa;--card:#fff;" +
  "--th:#f7f5f1;--code:#f2efe9;--hover:#faf8f4;--avert-bg:#fbf7f1;--avert-b:#e6d9c6";

const SOMBRE =
  "color-scheme:dark;--f:#e8e6e1;--m:#a09a90;--b:#3a372f;--a:#e08b6a;--bg:#16150f;--card:#1e1c16;" +
  "--th:#252219;--code:#252219;--hover:#242118;--avert-bg:#211d15;--avert-b:#3d3527";

const LARGE = "78rem";
const SOLEIL = "☀︎";
const FLECHE = "↑︎";

const CSS = `
:root{${CLAIR}}
@media(prefers-color-scheme:dark){:root{${SOMBRE}}}
html.t-light{${CLAIR}}
html.t-dark{${SOMBRE}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--f);font:16px/1.6 Georgia,'Times New Roman',serif}
.wrap{max-width:${LARGE};margin:0 auto;padding:2rem 1.25rem 4rem;display:grid;gap:1rem}
main{min-width:0;max-width:60rem;width:100%;justify-self:center}
section[id]{scroll-margin-top:1.5rem}
#schema,#dossier,#greffes{content-visibility:auto;contain-intrinsic-size:auto 40rem}
h1{font-size:1.6rem;margin:0}
h2{font-size:1.35rem;margin:2.75rem 0 .75rem;padding-bottom:.3rem;border-bottom:2px solid var(--b)}
h3{font-size:1.1rem;margin:1.75rem 0 .5rem}
#schema h3,h4{font-size:1rem;margin:1.25rem 0 .25rem}
p{margin:.6rem 0}
a{color:var(--a)}
code{font:.9em ui-monospace,Menlo,Consolas,monospace;background:var(--code);padding:.1em .35em;border-radius:3px}
:where(a,button,input,select,summary,[tabindex]):focus-visible{outline:2px solid var(--a);outline-offset:2px}
.saut{position:fixed;left:1rem;top:1rem;z-index:20;padding:.45rem .85rem;background:var(--card);
  color:var(--a);border:2px solid var(--a);border-radius:6px;font-weight:700;text-decoration:none}
.saut:not(:focus-visible){position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip-path:inset(50%);white-space:nowrap;border:0}
.suite{display:flex;align-items:center;justify-content:space-between;gap:.5rem 1rem;flex-wrap:wrap;
  margin:0 0 1rem;padding:0 0 .65rem;border-bottom:1px solid var(--b);font-size:.88rem}
.suite-t{font-weight:700;color:var(--m);letter-spacing:.02em}
.suite ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.35rem}
.suite a{display:inline-block;padding:.28rem .65rem;border:1px solid transparent;border-radius:999px;
  color:var(--m);text-decoration:none;min-height:1.75rem}
.suite a:hover{color:var(--a);border-color:var(--b);background:var(--card)}
.suite a[aria-current=page]{color:var(--a);font-weight:700;border-color:var(--a);background:var(--card)}
.bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.btn-sec,#bascule,#theme{font:inherit;font-size:.8rem;letter-spacing:.04em;background:var(--card);border:1px solid var(--b);
  border-radius:999px;padding:.35rem .9rem;cursor:pointer;color:var(--m);text-decoration:none;white-space:nowrap;display:inline-block}
.btn-sec:hover,#bascule:hover,#theme:hover{border-color:var(--a);color:var(--a)}
.btns{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
#theme{min-width:6.5rem;text-align:center}
#theme [data-t]{display:none}
html:not(.t-light):not(.t-dark) #theme [data-t=auto],
html.t-light #theme [data-t=light],
html.t-dark #theme [data-t=dark]{display:inline}
.badge{display:inline-block;font-size:.78rem;padding:.2rem .6rem;border-radius:999px;
  border:1px solid var(--avert-b);background:var(--avert-bg);color:var(--f)}
.ctl{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin:1rem 0}
.ctl input,.ctl select{font:inherit;font-size:.9rem;padding:.4rem .6rem;border:1px solid var(--b);
  border-radius:4px;background:var(--card);color:var(--f)}
.ctl input{flex:1;min-width:10rem}
.m{color:var(--m);font-size:.85rem}
.tw{overflow-x:auto;border:1px solid var(--b);border-radius:6px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:.88rem}
th,td{padding:.5rem .7rem;text-align:left;border-bottom:1px solid var(--b);vertical-align:top}
th{background:var(--th);position:sticky;top:0}
td.n,th.n{text-align:right;white-space:nowrap}
tbody tr:hover{background:var(--hover)}
pre{background:var(--code);border:1px solid var(--b);border-radius:6px;padding:.7rem .9rem;
  overflow-x:auto;font-size:.85rem;line-height:1.5}
.tdm{max-width:60rem;width:100%;justify-self:center}
.tdm ul{list-style:none;margin:.5rem 0 0;padding:0;font-size:.85rem}
.tdm li{margin:.15rem 0}
.tdm a{display:block;padding:.25rem .6rem;border-left:2px solid var(--b);
  color:var(--m);text-decoration:none}
.tdm a:hover,.tdm a.on{color:var(--a);border-left-color:var(--a)}
.tdm a.on{font-weight:700}
details{border:1px solid var(--b);border-radius:6px;background:var(--card);margin:.5rem 0;padding:.6rem .9rem}
summary{cursor:pointer;font-weight:700}
#outils article{border-left:3px solid var(--b);padding-left:1rem;margin:1.5rem 0}
#outils .titre{color:var(--m);font-style:italic;margin:.1rem 0 .5rem}
.avert{background:var(--avert-bg);border:1px solid var(--avert-b);border-radius:6px;padding:.25rem 1.25rem 1rem}
footer{margin-top:3.5rem;padding-top:1.25rem;border-top:2px solid var(--b);font-size:.9rem;color:var(--m)}
.sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;
  clip-path:inset(50%);white-space:nowrap;border:0}
.haut{position:fixed;right:1.25rem;bottom:1.25rem;z-index:10;width:2.6rem;height:2.6rem;
  display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:1.1rem;
  background:var(--card);color:var(--m);border:1px solid var(--b);border-radius:999px}
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

// biome-ignore lint/complexity/noUselessStringRaw: parade délibérée
const BOOT = String.raw`
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
<h1>${bi("MCP Outils — Délais, intérêts, greffes, registres et terminologie", EN.titre)}</h1>
<div class="btns">
<button id="theme" type="button" title="Thème / Theme">${etat("auto", "◐ Auto", "◐ Auto")}${etat("light", `${SOLEIL} Clair`, `${SOLEIL} Light`)}${etat("dark", "☾ Sombre", "☾ Dark")}</button>
<button id="bascule" type="button" title="Français / English">FR&nbsp;·&nbsp;EN</button>
</div>
</div>
${biP(
  [
    `Serveur MCP public, sans journalisation et déterministe (${SERVER_NAME} v${SERVER_VERSION}). ` +
      "Il calcule les jours fériés, les délais procéduraux, les intérêts légaux et l'indemnité " +
      "additionnelle (art. 1619 C.c.Q.), lit la nomenclature judiciaire québécoise (numéros de " +
      "dossier, greffes et palais), et consulte des instantanés locaux en lecture seule pour les " +
      "registres d'entreprises (REQ, RBQ, OPC, RENA, Corporations Canada), les adresses civiques " +
      "(RQA) et la terminologie juridique bilingue et bijuridique.",
  ],
  EN.intro,
)}
<div class="avert">
${biP(
  [
    "Chaque calcul et chaque consultation s'exécute localement sans appel HTTP sortant, sans écriture " +
      "à la requête (bases D1 strictement en lecture seule) et sans journalisation des charges utiles, " +
      "noms de parties, adresses, extraits d'actes, dates, montants ou numéros de dossier.",
    "Cet outil applique des règles arithmétiques et lit des instantanés datés : il n'établit jamais " +
      "l'existence d'un dossier, ne remplace ni le portail officiel du Registraire des entreprises ni " +
      "le Registre foncier du Québec, n'établit pas le domicile d'une partie et n'effectue aucune " +
      "qualification juridique automatique. Vérifier aux sources officielles avant toute signification " +
      "ou tout dépôt.",
  ],
  EN.avertissement,
)}
</div>
<p class="btns">
<span class="badge">${bi("Accès public · Aucun compte requis", "Public access · No account required")}</span>
<code>https://outils.poirierlavoie.ca/mcp</code>
<a class="btn-sec" href="https://acces.poirierlavoie.ca/#connecteurs">${bi("Connecteurs réservés aux membres →", "Member connectors (Legislation & Case Law) →")}</a>
</p>
</header>`;
}

function marqueurAppel(d: ToolDescriptor): string {
  return `<p class="m"><code>openWorldHint: ${d.annotations.openWorldHint}</code> · <code>readOnlyHint: ${d.annotations.readOnlyHint}</code> — ${bi(
    "aucun appel sortant : calcul pur, table compilée ou base D1 locale en lecture seule.",
    "no outbound call: pure computation, compiled table, or read-only local D1 snapshot.",
  )}</p>`;
}

function outils(): string {
  const carte = (d: ToolDescriptor) => {
    const en = OUTILS_EN[d.name];
    return `<article>
<h4><code>${esc(d.name)}</code></h4>
<p class="titre">${bi(d.title, en?.titre ?? d.title)}</p>
${biP([d.description], [en?.texte ?? d.description])}
${marqueurAppel(d)}
</article>`;
  };

  const tous = listToolDescriptors();
  const calculs = tous.filter((d) => d.family === "calcul");
  const greffe = tous.filter((d) => d.family === "greffe");
  const registre = tous.filter((d) => d.family === "registre");
  const adresse = tous.filter((d) => d.family === "adresse");
  const terminologie = tous.filter((d) => d.family === "terminologie");

  return `<section id="outils">
${h2("outils")}
<h3>${bi("Calculateurs déterministes (jours fériés, délais, intérêts art. 1619 C.c.Q.)", EN.familleCalcul)}</h3>
${biP(
  [
    "Trois outils arithmétiques purs portant sur le Code de procédure civile, les lois d'interprétation " +
      "(Québec et Canada) et le Code civil du Québec (art. 1618–1620 C.c.Q., table art. 28 L.A.F. " +
      `jusqu'au trimestre ${lafRatesJson.metadata.last_quarter}).`,
  ],
  EN.familleCalculTexte,
)}
${calculs.map(carte).join("\n")}
<h3>${bi("Tables locales du Québec — numéros de dossier et palais de justice", EN.familleGreffe)}</h3>
${biP(
  [
    "Trois outils qui lisent des tables de référence compilées dans le Worker, relevées auprès " +
      `du ministère de la Justice du Québec (palais le ${RELEVE_LE}, rattachements le ${MJQ_MAJ}). ` +
      "Ils ne consultent aucun plumitif, ne font aucune requête sortante et n'écrivent rien.",
  ],
  EN.familleGreffeTexte,
)}
${greffe.map(carte).join("\n")}
<h3>${bi("Registres d'entreprises (QC / Canada) — REQ, RBQ, OPC, RENA et Corporations Canada", EN.familleRegistre)}</h3>
${biP(
  [
    "Deux outils adossés à une base D1 en lecture seule regroupant les jeux de données ouvertes " +
      "corporatifs. Les dirigeants, administrateurs et actionnaires personnes physiques sont exclus " +
      "du fichier ouvert du REQ conformément à la Loi sur la publicité légale des entreprises (RLRQ, c. P-44.1).",
  ],
  EN.familleRegistreTexte,
)}
${registre.map(carte).join("\n")}
<h3>${bi("Adresses civiques du Québec — Référentiel québécois des adresses (RQA)", EN.familleAdresse)}</h3>
${biP(
  [
    "Un outil adossé à une base D1 normalisée en lecture seule du Référentiel québécois des adresses " +
      "(MRNF, ~5 millions d'adresses) et d'Odonymes et renvois. Confirme l'existence municipale d'une " +
      "adresse civique sans jamais établir le domicile d'une partie ni la propriété foncière.",
  ],
  EN.familleAdresseTexte,
)}
${adresse.map(carte).join("\n")}
<h3>${bi("Terminologie juridique bilingue et bijuridique (FR / EN)", EN.familleTerminologie)}</h3>
${biP(
  [
    "Trois outils adossés à une base D1 terminologique en lecture seule croisant un glossaire curé " +
      "de droit civil québécois, les concordances statutaires bilingues alignées, TERMIUM Plus® " +
      "(Droit et justice) et les fiches juridiques de l'OQLF afin de prévenir les contaminations " +
      "de common law et de droit français.",
  ],
  EN.familleTerminologieTexte,
)}
${terminologie.map(carte).join("\n")}
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
    const schema = d.inputSchemaJson as {
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
    "Chaque outil déclare un schéma d'entrée FERMÉ (additionalProperties: false) : toute propriété " +
      "non listée est refusée. Ces tables sont générées par z.toJSONSchema depuis les schémas Zod " +
      "mêmes que le serveur applique à l'appel.",
    "La colonne Description reste en FRANÇAIS dans les deux vues : ces phrases sont le texte " +
      "canonique reçu par le modèle.",
  ],
  EN.schemaTexte,
)}
${listToolDescriptors().map(bloc).join("\n")}
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
      "sont le greffe — palais de justice et district judiciaire. Les positions 5 et 6 sont la " +
      "juridiction — tribunal, compétence, type de greffe. Le reste est une séquence et des " +
      "chiffres de contrôle.",
    "Les positions 7 et suivantes ne sont PAS analysées, et aucune somme de contrôle n'est " +
      "vérifiée : il n'y en a pas. En inventer une rejetterait des numéros valides, ce qui est " +
      "le pire des deux défauts.",
    "Un préfixe alphabétique court-circuite tout cela : TAL-, TAQ-, C.F.- et leurs pareils " +
      "nomment un corps qui numérote ses dossiers lui-même. Le préfixe EST la réponse à " +
      "« quel tribunal ».",
  ],
  EN.dossierTexte,
)}
<h3 id="h-dossier-ex">${bi("Les issues, rendues par le vrai parseur", EN.dossierExemples)}</h3>
${biP(
  [
    "Les exemples ci-dessous ne sont pas transcrits : la page exécute le parseur au moment du " +
      "rendu et affiche ce qu'il renvoie. Cette documentation ne peut donc pas diverger du " +
      "comportement.",
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
    "Le code à deux chiffres des positions 5 et 6. Le tiret cadratin des codes 46, 72 et 73 est " +
      "une valeur RÉELLE : ces séries ne relèvent d'aucun tribunal nommé.",
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
    "Les greffes du Québec, cléés sur le numéro à trois chiffres par lequel commence un numéro " +
      "de dossier. Un greffe est un REGISTRE ; un palais est un BÂTIMENT — la relation n'est ni " +
      "bijective ni totale, et un greffe dessert souvent plusieurs lieux.",
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
    "Point d'accès Streamable HTTP public (aucun secret requis) : " +
      "https://outils.poirierlavoie.ca/mcp — se connecte sans authentification dans Claude Research, " +
      "Gemini Deep Research, Claude Code / Desktop, Antigravity et Gemini CLI, et accompagne les " +
      "compétences du greffon « droit-civil-quebecois » aux côtés des connecteurs de sources " +
      "primaires authentifiés (admission des membres en règle du Barreau du Québec sur " +
      "https://acces.poirierlavoie.ca).",
    "La fiche publique de découverte (SEP-2127) est publiée sur " +
      "https://outils.poirierlavoie.ca/mcp/server-card ; le dépôt inclut les manifestes " +
      "pour Google Antigravity (plugin.json, mcp_config.json) et Gemini CLI (gemini-extension.json). " +
      "Vérification de santé sans journalisation des charges utiles : " +
      "https://outils.poirierlavoie.ca/healthz (limitation de débit à 240 requêtes / 60 s par IP).",
    "Le code source et le glossaire curé sont libres et gratuits sous licence Apache-2.0 " +
      "(voir LICENSE), tandis que les jeux de données publics intégrés demeurent soumis aux " +
      "licences de leurs éditeurs respectifs décrites dans NOTICE (dont CC BY-NC-SA 4.0 pour " +
      "REQ et OQLF) ; l'ensemble des tests s'exécute localement sans accès réseau.",
  ],
  EN.acces,
)}
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
      "(art. 28 L.A.F.), ministère de la Justice du Québec, Registraire des entreprises " +
      "(CC BY-NC-SA 4.0), RBQ / OPC / AMP — RENA / MRNF — RQA (CC BY 4.0), Corporations Canada " +
      "et TERMIUM Plus® (OGL-Canada), Office québécois de la langue française (CC BY-NC-SA 4.0).",
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
        name: ["MCP Outils — Délais, intérêts, greffes, registres et terminologie", EN.titre],
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
          "Tables judiciaires MJQ, taux art. 28 L.A.F., registres d'entreprises, adresses RQA et terminologie bijuridique",
          "MJQ judicial directories, art. 28 T.A.A. rates, business registries, RQA addresses, and bijural terminology",
        ],
        description: `56 registries across 36 judicial districts (MJQ surveyed ${RELEVE_LE}, registry attachments ${MJQ_MAJ}), art. 28 L.A.F. rates through ${lafRatesJson.metadata.last_quarter}, and read-only REQ/RBQ/OPC/RENA, RQA, and bijural terminology snapshots.`,
        url: `${ORIGINE_SITE}/#greffes`,
        inLanguage: ["fr-CA", "en-CA"],
        dateModified: RELEVE_LE,
        license: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
      },
    ],
  };
  return JSON.stringify(graphe).replace(/</g, "\\u003c");
}

export function renderSite(): string {
  const corps = [entete(), outils(), schemas(), dossier(), greffes(), acces(), pied()].join("\n");
  const titrePage = "MCP Outils — Délais, intérêts, greffes, registres et adresses";
  const titrePageEn = "MCP Tools — Deadlines, Interest, Registries & Legal Terms";
  const descMeta =
    "Serveur MCP public sans journalisation : délais C.p.c., intérêts art. 1619 C.c.Q., greffes, registres d'entreprises, adresses RQA et terminologie bijuridique.";

  return `<!doctype html>
<html lang="fr" class="l-fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
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

// ── Découverte publique (/robots.txt, /sitemap.xml, /llms.txt) ───────────────

export const CHEMINS_DECOUVERTE_PUBLIQUE = ["/robots.txt", "/sitemap.xml", "/llms.txt"] as const;
export type CheminDecouvertePublique = (typeof CHEMINS_DECOUVERTE_PUBLIQUE)[number];

export function estCheminDecouvertePublique(
  pathname: string,
): pathname is CheminDecouvertePublique {
  return (CHEMINS_DECOUVERTE_PUBLIQUE as readonly string[]).includes(pathname);
}

const ROBOTS_TXT = [
  "User-agent: *",
  "Allow: /",
  "Disallow: /mcp",
  "Disallow: /healthz",
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
    `# MCP Outils (\`outils\`, ${SERVER_NAME} v${SERVER_VERSION}) — Public Québec Civil Litigation Tools`,
    "",
    `> ${SERVER_DESCRIPTION}`,
    "",
    "## Public Endpoint (no authentication or secret required)",
    "",
    `- Streamable HTTP: \`${ORIGINE_SITE}/mcp\``,
    `- MCP Server Card (SEP-2127): ${ORIGINE_SITE}/mcp/server-card`,
    "",
    "## Tools (12 deterministic read-only MCP tools, derived from live registry)",
    "",
    ...outilsLignes,
    "",
    "## Québec Civil Law MCP Suite (`droit-civil-quebecois`)",
    "",
    "- [MCP Accès (Admission & OAuth 2.1 Portal)](https://acces.poirierlavoie.ca/): Barreau du Québec admission (`/demande`) and `/moi` self-service portal for authenticated connectors.",
    "- [MCP Législation (`lois`)](https://legislation.poirierlavoie.ca/): Official Québec & federal statutes, regulations, court directives, and AMF texts.",
    "- [MCP Jurisprudence (`juris`)](https://jurisprudence.poirierlavoie.ca/): Case-law citation verification & CanLII metadata (BYOK CanLII).",
    `- [MCP Outils (\`outils\` — Public)](${ORIGINE_SITE}/): Calculators, judicial registries, corporate snapshots, RQA addresses, and bijural terminology.`,
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
