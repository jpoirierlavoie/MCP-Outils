import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { carteServeur } from "../src/index.js";
import {
  listToolDescriptors,
  SERVER_DESCRIPTION,
  SERVER_NAME,
  SERVER_TITLE,
  SERVER_VERSION,
} from "../src/mcp/server.js";

const lire = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf-8");

describe("Parité README, manifestes Antigravity / Gemini et fiche SEP-2127", () => {
  const readme = lire("README.md");
  const claudeMd = lire("CLAUDE.md");
  const geminiMd = lire("GEMINI.md");
  const securityMd = lire("SECURITY.md");
  const licenseTxt = lire("LICENSE");
  const noticeTxt = lire("NOTICE");
  const issueCfg = lire(".github/ISSUE_TEMPLATE/config.yml");
  const prTemplate = lire(".github/PULL_REQUEST_TEMPLATE.md");
  const packageRaw = lire("package.json");
  const pluginRaw = lire("plugin.json");
  const mcpConfigRaw = lire("mcp_config.json");
  const geminiExtRaw = lire("gemini-extension.json");
  const wranglerRaw = lire("wrangler.jsonc");
  const logoSvg = lire("assets/logo.svg");

  const pkg = JSON.parse(packageRaw) as {
    name: string;
    version: string;
    description: string;
  };
  const plugin = JSON.parse(pluginRaw) as {
    name: string;
    displayName: string;
    version: string;
    description: string;
    logo: string;
    suggestedPrompts: string[];
    homepage: string;
    repository: string;
  };
  const mcpConfig = JSON.parse(mcpConfigRaw) as {
    mcpServers: Record<string, Record<string, unknown>>;
  };
  const geminiExt = JSON.parse(geminiExtRaw) as {
    name: string;
    version: string;
    description: string;
    contextFileName?: unknown;
    settings?: unknown[];
    mcpServers: Record<string, Record<string, unknown>>;
  };
  const wranglerCfg = JSON.parse(wranglerRaw) as { name: string };
  const card = carteServeur();

  it("le registre des 15 outils concorde 1:1 avec le tableau du README", () => {
    const nomsRegistre = listToolDescriptors()
      .map((d) => d.name)
      .sort();
    expect(nomsRegistre).toHaveLength(15);

    const cites = [
      ...readme.matchAll(
        /^\| `(?:calcul|greffe|registre|adresse|terminologie|economie)` \| `([a-z0-9_]+)` \|/gm,
      ),
    ].map((m) => m[1]!);
    expect(cites).toHaveLength(15);
    expect([...new Set(cites)].sort()).toEqual(nomsRegistre);
  });

  it("package.json, SERVER_*, plugin.json, gemini-extension.json, wrangler.jsonc et /mcp/server-card concordent partout", () => {
    expect(pkg.version).toBe(SERVER_VERSION);
    expect(plugin.version).toBe(pkg.version);
    expect(geminiExt.version).toBe(pkg.version);
    expect(card.version).toBe(pkg.version);

    expect(pkg.name).toBe("mcp-outils");
    expect(SERVER_NAME).toBe(pkg.name);
    expect(plugin.name).toBe(pkg.name);
    expect(geminiExt.name).toBe(pkg.name);
    expect(card.name).toBe(`ca.poirierlavoie.outils/${pkg.name}`);

    expect(SERVER_TITLE).toBe("MCP Outils");
    expect(plugin.displayName).toBe(SERVER_TITLE);
    expect(card.title).toBe(SERVER_TITLE);

    expect(pkg.description).toBe(SERVER_DESCRIPTION);
    expect(plugin.description).toBe(SERVER_DESCRIPTION);
    expect(geminiExt.description).toBe(SERVER_DESCRIPTION);
    expect(card.description).toBe(SERVER_DESCRIPTION);

    expect(wranglerCfg.name).toBe("outils");
    expect(plugin.homepage).toBe("https://outils.poirierlavoie.ca/");
    expect(plugin.repository).toBe("https://github.com/jpoirierlavoie/MCP-Outils");
    expect(card.repository.url).toBe("https://github.com/jpoirierlavoie/MCP-Outils");
    expect(card.remotes[0]?.headers).toEqual([]);
  });

  it("mcp_config.json et gemini-extension.json déclarent le connecteur public 'outils' sans secret ni eager", () => {
    for (const brut of [mcpConfigRaw, geminiExtRaw]) {
      expect(brut).not.toMatch(/[0-9a-f]{32,}/i);
    }

    expect(Object.keys(mcpConfig.mcpServers)).toEqual(["outils"]);
    expect(mcpConfig.mcpServers.outils).toEqual({
      url: "https://outils.poirierlavoie.ca/mcp",
    });

    expect(geminiExt.contextFileName).toEqual([]);
    expect(geminiExt.settings).toEqual([]);
    expect(Object.keys(geminiExt.mcpServers)).toEqual(["outils"]);
    expect(geminiExt.mcpServers.outils).toEqual({
      type: "http",
      url: "https://outils.poirierlavoie.ca/mcp",
    });
  });

  it("assets/logo.svg est un SVG carré valide et plugin.json respecte strictement le schéma Antigravity", () => {
    const allowedPluginKeys = new Set([
      "$schema",
      "name",
      "displayName",
      "version",
      "description",
      "logo",
      "suggestedPrompts",
      "author",
      "homepage",
      "repository",
      "disabled",
    ]);
    for (const k of Object.keys(plugin)) {
      expect(allowedPluginKeys.has(k), `Clé plugin.json non autorisée : ${k}`).toBe(true);
    }
    const author = (plugin as Record<string, unknown>).author as Record<string, unknown>;
    expect(Object.keys(author)).toEqual(["name"]);

    expect(plugin.logo).toBe("assets/logo.svg");
    expect(logoSvg).toContain("<svg");
    expect(logoSvg).toContain('viewBox="0 0 128 128"');
    expect(plugin.suggestedPrompts).toHaveLength(3);
    expect(plugin.suggestedPrompts.every((p) => p.trim().length > 0)).toBe(true);
  });

  it("CLAUDE.md et GEMINI.md sont identiques (< 24 000 octets UTF-8) et aucun ancien nom de dépôt ne subsiste", () => {
    expect(geminiMd).toBe(claudeMd);
    const octets = new TextEncoder().encode(geminiMd).byteLength;
    expect(octets).toBeGreaterThan(1_000);
    expect(octets).toBeLessThan(24_000);

    for (const doc of [
      readme,
      claudeMd,
      geminiMd,
      securityMd,
      licenseTxt,
      noticeTxt,
      issueCfg,
      prTemplate,
    ]) {
      expect(doc).not.toContain("pratique-civile-outils");
      expect(doc).not.toContain("MCP-Socle-Juridique");
      expect(doc).not.toContain("socle-juridique");
    }

    expect(licenseTxt).toContain("Apache License");
    expect(licenseTxt).toContain("Version 2.0, January 2004");
    expect(noticeTxt).toContain("Apache-2.0");
    expect(noticeTxt).toContain("CC BY-NC-SA 4.0");
  });
});
