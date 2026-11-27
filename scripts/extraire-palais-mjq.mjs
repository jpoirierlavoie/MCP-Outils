#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { argv } from "node:process";

const sourcePath = argv[2] ?? "sources-officielles/mjq-palais-2026-11-17.json";
const snapshot = JSON.parse(readFileSync(sourcePath, "utf8"));

const RELEVE_DATE = snapshot.exported_at || "2026-11-17";

const FORMULATIONS_INTERDITES = [
  "n'existe pas",
  "n'a jamais existé",
  "a été infirmée",
  "toujours en vigueur",
  "fait autorité",
  "citation valide",
];

const CANONICAL_NAMES = {
  alma: "Alma",
  amos: "Amos",
  amqui: "Amqui",
  "baie-comeau": "Baie-Comeau",
  "campbells-bay": "Campbell's Bay",
  "carleton-sur-mer": "Carleton-sur-Mer",
  chibougamau: "Chibougamau",
  chicoutimi: "Chicoutimi",
  cowansville: "Cowansville",
  "dolbeau-mistassini": "Dolbeau-Mistassini",
  drummondville: "Drummondville",
  forestville: "Forestville",
  gaspe: "Gaspé",
  gatineau: "Gatineau",
  granby: "Granby",
  "havre-aubert": "Havre-Aubert",
  joliette: "Joliette",
  kuujjuaq: "Kuujjuaq",
  "la-malbaie": "La Malbaie",
  "la-sarre": "La Sarre",
  "la-tuque": "La Tuque",
  "lac-megantic": "Lac-Mégantic",
  laval: "Laval",
  longueuil: "Longueuil",
  maniwaki: "Maniwaki",
  matane: "Matane",
  "mont-laurier": "Mont-Laurier",
  montmagny: "Montmagny",
  montreal: "Montréal",
  "new-carlisle": "New Carlisle",
  perce: "Percé",
  quebec: "Québec",
  rimouski: "Rimouski",
  "riviere-du-loup": "Rivière-du-Loup",
  roberval: "Roberval",
  "rouyn-noranda": "Rouyn-Noranda",
  "saint-hyacinthe": "Saint-Hyacinthe",
  "saint-jean-sur-richelieu": "Saint-Jean-sur-Richelieu",
  "saint-jerome": "Saint-Jérôme",
  "saint-joseph-de-beauce": "Saint-Joseph-de-Beauce",
  "sainte-agathe-des-monts": "Sainte-Agathe-des-Monts",
  "sainte-anne-des-monts": "Sainte-Anne-des-Monts",
  "salaberry-de-valleyfield": "Salaberry-de-Valleyfield",
  "sept-iles": "Sept-Îles",
  shawinigan: "Shawinigan",
  sherbrooke: "Sherbrooke",
  "sorel-tracy": "Sorel-Tracy",
  "thetford-mines": "Thetford Mines",
  "trois-rivieres": "Trois-Rivières",
  "val-dor": "Val-d'Or",
  victoriaville: "Victoriaville",
  "ville-marie": "Ville-Marie",
};

const PHONE_RE =
  /(?:\b1[-\s])?(?:8\d{2}|[2-9]\d{2})[-\s]\d{3}[-\s]\d{4}(?:,\s*(?:poste|option)\s*\d+)?/gi;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const POSTAL_RE = /([A-Z]\d[A-Z])\s*(\d[A-Z]\d)/;

function normSpace(s) {
  return String(s ?? "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/(\d)[\u2010-\u2015\u2212](\d)/g, "$1-$2")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function digitsOnly(s) {
  return String(s ?? "").replace(/\D/g, "");
}

function formatPhoneNumber(raw) {
  const s = normSpace(raw)
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/^(?:Sans frais|Télécopieur)\s*:\s*/i, "")
    .trim();

  return s.replace(
    /(1[-\s])?(\d{3})[-\s](\d{3})[-\s](\d{4})/g,
    (_, one, a, b, c) => `${one ? "1 " : ""}${a} ${b}-${c}`,
  );
}

function cleanEmail(raw) {
  return normSpace(raw)
    .replace(/^mailto:/i, "")
    .split("?")[0]
    .trim()
    .toLowerCase();
}

function slugToKey(slug) {
  return slug.replace(/^(?:palais|point-de-service)-de-justice-(?:de-|d(?=[aeiouy]))/, "");
}

function cleanTitle(raw) {
  let t = normSpace(raw)
    .replace(/\s*\(demande de moins de 15\s*000\s*\$\)\s*$/i, "")
    .replace(/\bDirecteur des poursuite criminelles\b/g, "Directeur des poursuites criminelles")
    .replace(/^vente immeubles$/i, "Vente d'immeubles");
  return t;
}

function cleanHours(raw) {
  const lines = normSpace(raw)
    .split(/\r?\n/)
    .map((l) => normSpace(l))
    .filter(
      (l) =>
        l.length > 0 &&
        !/^Heures d'ouverture$/i.test(l) &&
        !/^Toute correspondance doit être adressée/i.test(l),
    );
  let joined = lines
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/(\d)h\b/g, "$1 h")
    .replace(/\b(lundi au vendredi)\b/i, (m, _, offset) =>
      offset === 0 ? "Du lundi au vendredi" : m,
    )
    .trim();

  joined = joined.replace(/^Du Du /i, "Du ");
  return joined;
}

function parseAddress(key, addrText) {

  const beforeMailing = normSpace(addrText).split(/\n\s*Adresse postale\s*:/i)[0] ?? "";
  const cleanedBlock = beforeMailing.replace(/\(Situé entre les stations[\s\S]*?\)/gi, "").trim();

  const rawLines = cleanedBlock
    .split(/\r?\n/)
    .map((l) => normSpace(l))
    .filter(Boolean);

  const fullText = rawLines.join(" ");
  const postalMatch = POSTAL_RE.exec(fullText);
  if (!postalMatch) {
    throw new Error(`Code postal introuvable pour ${key}: ${JSON.stringify(addrText)}`);
  }
  const postal_code = `${postalMatch[1]} ${postalMatch[2]}`;

  const beforePostal = fullText.slice(0, postalMatch.index).trim();
  const qcIdx = beforePostal.lastIndexOf("(Québec)");
  if (qcIdx < 0) {
    throw new Error(`Mention (Québec) introuvable pour ${key}: ${JSON.stringify(addrText)}`);
  }

  let cityLineIdx = rawLines.findIndex((l) => l.includes("(Québec)"));
  let streetPart;
  let cityPart;

  if (cityLineIdx > 0 && !/^\(Québec\)/i.test(rawLines[cityLineIdx])) {
    streetPart = rawLines.slice(0, cityLineIdx).join(" ");
    cityPart = rawLines[cityLineIdx].split("(Québec)")[0].trim();
  } else {

    const prevIdx = cityLineIdx - 1;
    streetPart = rawLines.slice(0, prevIdx).join(" ");
    cityPart = rawLines[prevIdx].trim();
  }

  streetPart = streetPart.replace(/,\s*$/, "").trim();

  streetPart = streetPart.replace(/\bav\s+de la\b/i, "avenue de la");
  cityPart = cityPart.replace(/,\s*$/, "").trim();

  let street = streetPart;
  let unit = "";
  const unitMatch = /^(.*?),\s*((?:\d+(?:er|e)\s+étage|bureau\s+[^\s,]+|local\s+[^\s,]+))$/i.exec(
    streetPart,
  );
  if (unitMatch) {
    street = unitMatch[1].trim();
    unit = unitMatch[2].trim();
  }

  return { street, unit, city: cityPart, postal_code };
}

function parseMailingAddress(key, page, civic) {

  if (key === "kuujjuaq") {
    const acc = page.acc.find(
      (a) => /Adresses postales/i.test(a.category || "") && /Services judiciaires/i.test(a.title),
    );
    if (acc && acc.text) {
      const lines = normSpace(acc.text)
        .split(/\r?\n/)
        .map((l) => normSpace(l))
        .filter(Boolean);
      if (lines.length >= 3) {
        return `${lines[0]}, ${lines[1]} ${lines[2]}`;
      }
    }
  }

  for (const row of page.tableRows || []) {
    for (const cell of row) {
      for (const p of cell.ps || []) {
        const cleaned = normSpace(p);
        if (/^Toute correspondance doit être adressée/i.test(cleaned)) {
          return cleaned;
        }
      }
    }
  }

  const addrText = normSpace(page.tableRows?.[0]?.[0]?.text ?? "");
  const parts = addrText.split(/\n\s*Adresse postale\s*:/i);
  if (parts.length > 1) {
    const mailLines = parts[1]
      .split(/\r?\n/)
      .map((l) => normSpace(l))
      .filter(Boolean);
    const formatted =
      mailLines.length >= 2
        ? `${mailLines[0]}, ${mailLines.slice(1).join(" ")}`.replace(/\s+/g, " ").trim()
        : mailLines.join(" ");

    const civicNorm = `${civic.street}${civic.unit ? `, ${civic.unit}` : ""}, ${civic.city} (Québec) ${civic.postal_code}`;
    if (formatted.toLowerCase() !== civicNorm.toLowerCase()) {
      return formatted;
    }
  }

  return "";
}

function isProseOrIgnoreLine(line) {
  return (
    /^(?:Note\s*:|Seule\b|Seuls\b|Pour\b|Vous\b|Afin\b|Itinéraire$|District\b|Numéro\b|Heures\b|Site\b|Rôles\b|remplir\b|envoyer\b|fournir\b|payer\b|Matières\b|Audition\b|Par téléphone|Ce service|Édifice\b|\(situé\b|C\.\s*P\.|Case postale|Séances de parentalité|Comment procéder|Toutes et tous|Sous le thème|Lorsque\b|Mentionnez\b|Nous tenterons|Veuillez\b|Soyez\b|Communiquez avec|Les entrevues)/i.test(
      line,
    ) ||
    /\(Québec\)\s*[A-Z]\d[A-Z]\s*\d[A-Z]\d/i.test(line) ||
    /^[A-Z]\d[A-Z]\s*\d[A-Z]\d$/.test(line) ||
    /^\(situé entre\b/i.test(line) ||
    /^\d+,\s*(?:rue|boulevard|avenue)\b/i.test(line) ||
    /^Local\s+\d+\.\d+/i.test(line) ||
    /^(?:Montréal|Kuujjuaq)\s*\(Québec\)/i.test(line)
  );
}

function extractStructuredEmails(items) {
  return [
    ...new Set(
      (items || [])
        .map((e) => cleanEmail(typeof e === "string" ? e : e.href || e.text || ""))
        .filter(Boolean),
    ),
  ];
}

function delimitStructuredEmails(text, structuredEmails) {
  let out = text;
  for (const se of structuredEmails) {
    const escaped = se.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), (match, offset, full) => {
      const prev = offset > 0 ? full[offset - 1] : "";
      const next = offset + match.length < full.length ? full[offset + match.length] : "";
      const prefix = prev && !/[\s:;,(<]/.test(prev) ? "\n" : "";
      const suffix = next && !/[\s:;,.)>]/.test(next) ? "\n" : "";
      return `${prefix}${match}${suffix}`;
    });
  }
  return out;
}

function extractLineContacts(line, faxDigitSet, phoneDigitSet, structuredEmails = []) {
  let remainingForEmails = line;
  const emails = [];
  for (const se of structuredEmails) {
    const escaped = se.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    if (re.test(remainingForEmails)) {
      emails.push(se);
      remainingForEmails = remainingForEmails.replace(re, " ");
    }
  }
  for (const m of remainingForEmails.matchAll(EMAIL_RE)) {
    const cleaned = cleanEmail(m[0]);
    if (cleaned && !emails.includes(cleaned)) emails.push(cleaned);
  }
  const rawPhones = [...line.matchAll(PHONE_RE)].map((m) => m[0]);

  const tels = [];
  const faxes = [];
  let qual = "";

  let stripped = line;
  for (const rp of rawPhones) stripped = stripped.replace(rp, "");
  for (const e of emails) {
    const escaped = e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    stripped = stripped.replace(new RegExp(escaped, "gi"), "");
  }
  stripped = stripped
    .replace(/^(?:Sans frais|Télécopieur)\s*:\s*/i, "")
    .replace(/^Téléscripteur[^:]*:\s*/i, "(téléscripteur) ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^\([^)]+\)$/.test(stripped)) {
    qual = stripped.slice(1, -1).trim();
  } else if (stripped && stripped.length <= 45 && !/^[-,:;()]+$/.test(stripped)) {
    qual = stripped.replace(/^\(|\)$/g, "").trim();
  }

  const isExplicitFax = /^Télécopieur\s*:/i.test(line);
  const isTty = /^Téléscripteur/i.test(line);

  for (const rp of rawPhones) {
    const formatted = formatPhoneNumber(rp);
    const d = digitsOnly(formatted);
    if (isExplicitFax) {
      faxes.push(formatted);
    } else if (faxDigitSet.has(d) && !phoneDigitSet.has(d)) {
      faxes.push(formatted);
    } else if (faxDigitSet.has(d) && phoneDigitSet.has(d)) {

      faxes.push(formatted);
    } else {
      tels.push(isTty ? `${formatted} (téléscripteur)` : formatted);
    }
  }

  return { tels, faxes, emails, qual };
}

function addOrMergeContact(contacts, next) {
  if (!next.tel && !next.fax && !next.courriel) return;
  const key = (c) => `${c.service}|${c.tel ?? ""}|${c.fax ?? ""}|${c.courriel ?? ""}`;

  const existingSameService = contacts.find(
    (c) =>
      c.service === next.service &&
      (!next.tel || !c.tel || c.tel === next.tel) &&
      (!next.fax || !c.fax || c.fax === next.fax) &&
      (!next.courriel || !c.courriel || c.courriel === next.courriel),
  );
  if (existingSameService) {
    if (next.tel && !existingSameService.tel) existingSameService.tel = next.tel;
    if (next.fax && !existingSameService.fax) existingSameService.fax = next.fax;
    if (next.courriel && !existingSameService.courriel) existingSameService.courriel = next.courriel;
    return;
  }

  if (!contacts.some((c) => key(c) === key(next))) {
    contacts.push({ ...next });
  }
}

function parseTopTable(key, page) {
  const rows = page.tableRows || [];
  let coordCell = null;
  let hoursCell = null;
  let itinerantCell = null;

  for (let r = 1; r < rows.length; r++) {
    for (const cell of rows[r]) {
      const t = normSpace(cell.text);
      if (!t) continue;
      if (/^Heures d'ouverture/i.test(t)) {
        hoursCell = cell;
      } else if (/^Cour itinérante/i.test(t)) {
        itinerantCell = cell;
      } else if (
        /^Coordonnées/i.test(t) ||
        (cell.phones && cell.phones.length > 0) ||
        (cell.faxes && cell.faxes.length > 0)
      ) {
        coordCell = cell;
      }
    }
  }

  const opening_hours = hoursCell ? cleanHours(hoursCell.text) : undefined;
  let generalFax;
  const topContacts = [];

  if (coordCell) {
    const faxDigits = new Set((coordCell.faxes || []).map((f) => digitsOnly(formatPhoneNumber(f))));
    const structuredTopEmails = extractStructuredEmails(coordCell.emails);
    const coordText = delimitStructuredEmails(normSpace(coordCell.text), structuredTopEmails);
    const lines = coordText
      .split(/\r?\n/)
      .map((l) => normSpace(l))
      .filter((l) => l && !/^Coordonnées$/i.test(l));

    const faxLines = [];
    const telEntries = [];
    let remainingTopForEmails = coordText;
    for (const se of structuredTopEmails) {
      const escaped = se.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      remainingTopForEmails = remainingTopForEmails.replace(new RegExp(escaped, "gi"), " ");
    }
    const emailList = [
      ...new Set([
        ...structuredTopEmails,
        ...[...remainingTopForEmails.matchAll(EMAIL_RE)].map((m) => cleanEmail(m[0])),
      ]),
    ].filter(Boolean);

    let pendingPrefix = "";
    for (const line of lines) {
      if (/:$/.test(line) && !PHONE_RE.test(line)) {
        pendingPrefix = line.replace(/:$/, "").trim();
        continue;
      }
      const lineEmails = [...line.matchAll(EMAIL_RE)];
      const linePhones = [...line.matchAll(PHONE_RE)];
      if (lineEmails.length > 0 && linePhones.length === 0) continue;

      for (const m of linePhones) {
        const num = formatPhoneNumber(m[0]);
        const d = digitsOnly(num);
        const remainder = normSpace(line.replace(m[0], "")).replace(/^\(|\)$/g, "").trim();
        const qual = [pendingPrefix, remainder].filter(Boolean).join(" — ");
        if (faxDigits.has(d)) {
          faxLines.push(qual ? `${num} (${qual})` : num);
        } else {
          telEntries.push({ tel: num, qual });
        }
      }
      pendingPrefix = "";
    }

    if (faxLines.length > 0) {
      generalFax = faxLines[0];
    }

    if (telEntries.length > 0) {
      for (let i = 0; i < telEntries.length; i++) {
        const entry = telEntries[i];
        const service = entry.qual
          ? `Renseignements généraux (${entry.qual})`
          : "Renseignements généraux";
        addOrMergeContact(topContacts, {
          service,
          tel: entry.tel,
          ...(i === 0 && emailList[0] ? { courriel: emailList[0] } : {}),
        });
      }
    } else if (emailList.length > 0) {
      addOrMergeContact(topContacts, {
        service: "Renseignements généraux",
        courriel: emailList[0],
      });
    }
  }

  if (itinerantCell) {
    for (const p of itinerantCell.phones || []) {
      const m = normSpace(p).match(PHONE_RE);
      if (m) {
        addOrMergeContact(topContacts, {
          service: "Cour itinérante",
          tel: formatPhoneNumber(m[0]),
        });
      }
    }
  }

  return { fax: generalFax, opening_hours, topContacts };
}

function parseAccordionContacts(key, page) {
  const contacts = [];
  let seenGenericClientCentre = false;

  for (const a of page.acc || []) {
    if (/^Adresses postales$/i.test(a.category || "")) {

      if (/Services judiciaires/i.test(a.title)) continue;
    }

    if (/Centre de services judiciaires Gouin/i.test(a.title)) continue;

    let title = cleanTitle(a.title);
    if (key === "montreal" && title === "Chambre de la jeunesse") {
      title = "Chambre de la jeunesse (410, rue De Bellechasse Est, greffe 525)";
    } else if (key === "montreal" && title === "Cour d'appel du Québec") {
      title = "Cour d'appel du Québec (Édifice Ernest-Cormier)";
    } else if (/^Visite offerte aux étudiants$/i.test(title)) {
      const m = normSpace(a.text).match(PHONE_RE);
      if (m) {
        addOrMergeContact(contacts, {
          service: title,
          tel: `${formatPhoneNumber(m[0])}, poste 0`,
        });
      }
      continue;
    }

    const structuredEmails = extractStructuredEmails(a.emails);
    const rawText = delimitStructuredEmails(normSpace(a.text || ""), structuredEmails);
    const allFaxes = (a.faxes || []).map((f) => formatPhoneNumber(f));
    const allPhones = (a.phones || []).map((p) => formatPhoneNumber(p));

    const faxDigitSet = new Set();
    const phoneDigitSet = new Set();
    const distinctPhones = [...new Set(allPhones.flatMap((p) => [...p.matchAll(PHONE_RE)].map((m) => digitsOnly(m[0]))))];
    const distinctFaxes = [...new Set(allFaxes.flatMap((f) => [...f.matchAll(PHONE_RE)].map((m) => digitsOnly(m[0]))))];

    for (const d of distinctPhones) phoneDigitSet.add(d);
    for (const d of distinctFaxes) {
      if (phoneDigitSet.has(d) && distinctPhones.length === 1 && distinctFaxes.length > 1) {

        continue;
      }
      faxDigitSet.add(d);
      if (distinctPhones.length > 1 || distinctFaxes.length === 1) {
        phoneDigitSet.delete(d);
      }
    }

    if (!rawText) {
      for (const p of a.phones || []) {
        const m = normSpace(p).match(PHONE_RE);
        if (m) {
          addOrMergeContact(contacts, {
            service: title,
            tel: formatPhoneNumber(m[0]),
          });
        }
      }
      continue;
    }

    const lines = rawText
      .split(/\r?\n/)
      .map((l) => normSpace(l))
      .filter(Boolean);

    const mergedLines = [];
    for (const l of lines) {
      if (mergedLines.length > 0 && /\($/.test(mergedLines[mergedLines.length - 1])) {
        mergedLines[mergedLines.length - 1] = `${mergedLines[mergedLines.length - 1]}${l}`;
      } else {
        mergedLines.push(l);
      }
    }

    let currentSubLabel = "";
    const parsedEntries = [];

    for (const line of mergedLines) {
      if (isProseOrIgnoreLine(line)) continue;

      const hasPhone = PHONE_RE.test(line);
      PHONE_RE.lastIndex = 0;
      const hasEmail = EMAIL_RE.test(line);
      EMAIL_RE.lastIndex = 0;

      if (!hasPhone && !hasEmail) {

        if (/^Services judiciaires$/i.test(line)) continue;
        if (line.length <= 70) {
          currentSubLabel = line.replace(/:$/, "").trim();
        }
        continue;
      }

      const { tels, faxes, emails, qual } = extractLineContacts(
        line,
        faxDigitSet,
        phoneDigitSet,
        structuredEmails,
      );

      let cleanQual = qual.replace(/:\s*$/, "").trim();
      if (key === "laval" && title === "Chambre civile" && /Chambre criminelle/i.test(cleanQual)) {
        cleanQual = cleanQual.replace(/^Chambre criminelle(?: et pénale)?\s*-\s*/i, "").trim();
      }
      if (title === "Chambre criminelle et pénale" && /^Chambre criminelle et pénale\s*-\s*/i.test(cleanQual)) {
        cleanQual = cleanQual.replace(/^Chambre criminelle et pénale\s*-\s*/i, "").trim();
      }
      const cleanSubLabel = currentSubLabel.replace(/\s*-Chambre\b/g, " - Chambre");

      const subParts = [];
      if (cleanSubLabel && cleanSubLabel.toLowerCase() !== title.toLowerCase()) {
        subParts.push(cleanSubLabel);
      }
      if (cleanQual && !/^(?:sans frais|sur rendez-vous)$/i.test(cleanQual)) {

        if (
          cleanQual.toLowerCase() !== title.toLowerCase() &&
          cleanQual.toLowerCase() !== cleanSubLabel.toLowerCase()
        ) {
          subParts.push(cleanQual);
        }
      }

      const serviceName = subParts.length > 0 ? `${title} — ${subParts.join(" · ")}` : title;

      const rdvSuffix = /\bsur rendez-vous\b/i.test(cleanQual) ? " (sur rendez-vous)" : "";
      const sfSuffix = /\bsans frais\b/i.test(cleanQual) ? " (sans frais)" : "";

      const item = { service: serviceName };
      if (tels.length > 0) item.tel = `${tels[0]}${rdvSuffix || sfSuffix}`;
      if (faxes.length > 0) item.fax = faxes[0];
      if (emails.length > 0) item.courriel = emails[0];

      const prev = parsedEntries[parsedEntries.length - 1];
      if (
        prev &&
        prev.service === item.service &&
        (!item.tel || !prev.tel || prev.tel === item.tel) &&
        (!item.fax || !prev.fax || prev.fax === item.fax) &&
        (!item.courriel || !prev.courriel || prev.courriel === item.courriel)
      ) {
        if (item.tel && !prev.tel) prev.tel = item.tel;
        if (item.fax && !prev.fax) prev.fax = item.fax;
        if (item.courriel && !prev.courriel) prev.courriel = item.courriel;
      } else {
        parsedEntries.push(item);
      }

      for (let ti = 1; ti < tels.length; ti++) {
        parsedEntries.push({ service: serviceName, tel: tels[ti] });
      }
      for (let ei = 1; ei < emails.length; ei++) {
        parsedEntries.push({ service: serviceName, courriel: emails[ei] });
      }
    }

    for (const entry of parsedEntries) {
      const isGenericCentre =
        ((entry.tel && /^(?:1 866 536-5140|418 643-5140)(?:\s*\(sans frais\))?$/i.test(entry.tel)) ||
          entry.courriel === "informations@justice.gouv.qc.ca") &&
        !entry.tel?.includes("option");
      if (isGenericCentre) {
        if (seenGenericClientCentre) continue;
        seenGenericClientCentre = true;
      }
      addOrMergeContact(contacts, entry);
    }
  }

  return contacts;
}

const oldPalaisSrc = readFileSync("src/qc/palais.ts", "utf8");
const palaisEntries = {};

for (const page of snapshot.pages) {
  const key = slugToKey(page.slug);
  const location_type = page.slug.startsWith("point-de-service-") ? "point_de_service" : "palais";
  const name = CANONICAL_NAMES[key];
  if (!name) {
    throw new Error(`Clef inattendue dans l'instantané : ${key} (${page.slug})`);
  }

  const addrText = page.tableRows?.[0]?.[0]?.text ?? "";
  const civic = parseAddress(key, addrText);
  const mailing_address = parseMailingAddress(key, page, civic);
  const { fax, opening_hours, topContacts } = parseTopTable(key, page);
  const accContacts = parseAccordionContacts(key, page);

  const contacts = [];
  for (const c of topContacts) addOrMergeContact(contacts, c);
  for (const c of accContacts) addOrMergeContact(contacts, c);

  palaisEntries[key] = {
    name,
    location_type,
    street: civic.street,
    unit: civic.unit,
    city: civic.city,
    postal_code: civic.postal_code,
    mailing_address,
    ...(fax ? { fax } : {}),
    ...(opening_hours ? { opening_hours } : {}),
    contacts,
  };
}

const mtlPage = snapshot.pages.find((p) => p.slug === "palais-de-justice-de-montreal");
const jeunesseAcc = mtlPage?.acc.find((a) => a.title === "Chambre de la jeunesse");
if (!jeunesseAcc) {
  throw new Error("Accordéon Chambre de la jeunesse introuvable sur la page de Montréal.");
}
const jeunesseLines = normSpace(jeunesseAcc.text)
  .split(/\r?\n/)
  .map((l) => normSpace(l))
  .filter(Boolean);
const jStreet = jeunesseLines[0];
const jCityPostal = jeunesseLines[1];
const jCpMatch = POSTAL_RE.exec(jCityPostal);
const jCity = jCityPostal.split("(Québec)")[0].trim();
const jPostal = `${jCpMatch[1]} ${jCpMatch[2]}`;
const jTel = formatPhoneNumber(jeunesseAcc.phones[0]);
const jFax = formatPhoneNumber(jeunesseAcc.faxes[0]);
const jHoursLine = jeunesseLines.find((l) => /^Du lundi au vendredi/i.test(l));
const jHours = jHoursLine ? cleanHours(jHoursLine) : undefined;

palaisEntries["montreal-chambre-de-la-jeunesse"] = {
  name: "Montréal - Chambre de la jeunesse",
  location_type: "palais",
  street: jStreet,
  unit: "",
  city: jCity,
  postal_code: jPostal,
  mailing_address: "",
  ...(jFax ? { fax: jFax } : {}),
  ...(jHours ? { opening_hours: jHours } : {}),
  contacts: [
    {
      service: "Chambre de la jeunesse",
      tel: jTel,
      ...(jFax ? { fax: jFax } : {}),
    },
  ],
};

const sortedKeys = Object.keys(palaisEntries).sort();
if (sortedKeys.length !== 53) {
  throw new Error(`Attendu 53 entrées dans PALAIS, obtenu ${sortedKeys.length}`);
}

let nbPalais = 0;
let nbPoints = 0;
let totalContacts = 0;

for (const key of sortedKeys) {
  const p = palaisEntries[key];
  if (p.location_type === "palais") nbPalais++;
  else nbPoints++;

  if (!/^[A-Z]\d[A-Z] \d[A-Z]\d$/.test(p.postal_code)) {
    throw new Error(`Code postal invalide pour ${key} : ${p.postal_code}`);
  }
  if (!p.opening_hours || p.opening_hours.length === 0) {
    throw new Error(`Heures d'ouverture manquantes pour ${key}`);
  }
  if (p.contacts.length === 0) {
    throw new Error(`Aucun contact extrait pour ${key}`);
  }
  totalContacts += p.contacts.length;

  const serialized = JSON.stringify(p).toLowerCase();
  for (const interdite of FORMULATIONS_INTERDITES) {
    if (serialized.includes(interdite)) {
      throw new Error(`Formulation interdite « ${interdite} » détectée dans ${key}`);
    }
  }
}

if (nbPalais !== 44 || nbPoints !== 9) {
  throw new Error(`Comptes inattendus : palais=${nbPalais}, points=${nbPoints}`);
}

for (const key of sortedKeys) {
  const p = palaisEntries[key];
  const blockMatch = new RegExp(`(?:"${key}"|\\b${key}): \\{([\\s\\S]*?)\\n  \\},`).exec(oldPalaisSrc);
  if (!blockMatch) {
    console.log(`[AJOUT] ${key}: ${p.street}, ${p.city} (${p.postal_code})`);
    continue;
  }
  const b = blockMatch[1];
  for (const field of ["street", "unit", "city", "postal_code", "mailing_address"]) {
    const m = new RegExp(`${field}: (".*?")`).exec(b);
    const prevVal = m ? JSON.parse(m[1]) : "";
    if (prevVal !== p[field]) {
      console.log(`[DIFF ${key}.${field}] ${JSON.stringify(prevVal)} -> ${JSON.stringify(p[field])}`);
    }
  }
}

const q = (v) => JSON.stringify(v);
const renderContact = (c) => {
  const fields = [`service: ${q(c.service)}`];
  if (c.tel) fields.push(`tel: ${q(c.tel)}`);
  if (c.fax) fields.push(`fax: ${q(c.fax)}`);
  if (c.courriel) fields.push(`courriel: ${q(c.courriel)}`);
  return `      { ${fields.join(", ")} },`;
};

const renderPalais = (key, p) => {
  const propKey = /^[a-z]+$/.test(key) ? key : q(key);
  const lines = [
    `  ${propKey}: {`,
    `    name: ${q(p.name)},`,
    `    location_type: ${q(p.location_type)},`,
    `    street: ${q(p.street)},`,
    `    unit: ${q(p.unit)},`,
    `    city: ${q(p.city)},`,
    `    postal_code: ${q(p.postal_code)},`,
    `    mailing_address: ${q(p.mailing_address)},`,
  ];
  if (p.fax) lines.push(`    fax: ${q(p.fax)},`);
  if (p.opening_hours) lines.push(`    opening_hours: ${q(p.opening_hours)},`);
  lines.push(`    contacts: [`);
  for (const c of p.contacts) {
    lines.push(renderContact(c));
  }
  lines.push(`    ],`);
  lines.push(`  },`);
  return lines.join("\n");
};

const outputTs = `export interface Contact {
  readonly service: string;
  readonly tel?: string;
  readonly fax?: string;
  readonly courriel?: string;
}

export type TypeLieu = "palais" | "point_de_service";

export interface Palais {
  readonly name: string;
  readonly location_type: TypeLieu;
  readonly street: string;
  readonly unit: string;
  readonly city: string;
  readonly postal_code: string;
  readonly mailing_address: string;
  readonly fax?: string;
  readonly opening_hours?: string;
  readonly contacts: readonly Contact[];
}

export const PROVINCE = "Québec";
export const PAYS = "Canada";

export const RELEVE_LE = ${q(RELEVE_DATE)};

export const PALAIS: Readonly<Record<string, Palais>> = {
${sortedKeys.map((k) => renderPalais(k, palaisEntries[k])).join("\n")}
};
`;

writeFileSync("src/qc/palais.ts", outputTs, "utf8");
console.log(
  `src/qc/palais.ts régénéré : ${sortedKeys.length} lieux (${nbPalais} palais, ${nbPoints} points de service), ${totalContacts} contacts.`,
);
