#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(...args) {
  return execFileSync("git", args, { cwd: RACINE, encoding: "utf8" }).trim();
}

function echouer(titre, ...details) {
  console.error(`\n✘ ${titre}`);
  for (const d of details) console.error(`  ${d}`);
  console.error("");
  process.exit(1);
}

const sale = git("status", "--porcelain");
if (sale) {
  echouer(
    "L'arbre de travail n'est pas propre — déploiement refusé.",
    "Le Worker annonce son commit sur /health. Committer les changements d'abord.",
    ...sale
      .split("\n")
      .slice(0, 10)
      .map((l) => `    ${l}`),
  );
}

const commit = git("rev-parse", "--short", "HEAD");
const branche = git("rev-parse", "--abbrev-ref", "HEAD");
const surMain = branche === "main" || process.env.GITHUB_REF === "refs/heads/main";
if (!surMain) {
  console.warn(`⚠ Branche « ${branche} » et non « main ».\n`);
}

if (!process.env.CLOUDFLARE_API_TOKEN) {
  const qui = spawnSync("npx", ["wrangler", "whoami"], {
    cwd: RACINE,
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  if ((qui.status ?? 1) !== 0) {
    echouer(
      "CLOUDFLARE_API_TOKEN est absent et aucune session `wrangler login` active n'a été détectée.",
      "Définir CLOUDFLARE_API_TOKEN ou exécuter `npx wrangler login`.",
    );
  }
}

console.log(`\n── Déploiement du Worker MCP-Outils (commit ${commit})\n   npx wrangler deploy --var COMMIT:${commit}\n`);
const r = spawnSync("npx", ["wrangler", "deploy", "--var", `COMMIT:${commit}`], {
  cwd: RACINE,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if ((r.status ?? 1) !== 0) {
  echouer("Le déploiement du Worker a échoué.");
}

console.log(`\n✔ En ligne : commit ${commit} sur https://outils.poirierlavoie.ca/health\n`);
