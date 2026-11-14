import { bindings, defineConfig, defineWorker } from "cf/config";

const worker = defineWorker({
  name: "pratique-civile-outils",
  compatibilityDate: "2026-11-13",
  compatibilityFlags: ["nodejs_compat"],
  entrypoint: "./src/index.ts",
  domains: ["outils.poirierlavoie.ca"],
  logpush: false,
  observability: {
    enabled: false,
    redactQueryString: true,
    logs: {
      enabled: false,
      invocationLogs: false,
      persist: false,
    },
    traces: {
      enabled: false,
      persist: false,
    },
  },
  env: {
    RATE_LIMITER: bindings.rateLimit({
      namespace: "1001",
      simple: {
        limit: 60,
        period: 60,
      },
    }),
  },
});

export default defineConfig({ worker });
