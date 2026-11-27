const MOUNT = "/mcp";
const QUERY_KEY = "key";

export const NOMS_SECRETS = ["MCP_TOKEN", "MCP_TOKEN_VEILLE", "MCP_SHARED_SECRET"] as const;

export const SERVICE_ID = "outils" as const;

export const PORTE = {
  mount: MOUNT,
  queryKey: QUERY_KEY,
  nomsSecrets: NOMS_SECRETS,
  segmentBorne: true,
} as const;

const MOUNT_OAUTH = "/mcp/oauth" as const;

export const PORTE_OAUTH = {
  mount: MOUNT_OAUTH,
  nomsSecrets: [] as const,
  autoriserChemin: false,
} as const;
