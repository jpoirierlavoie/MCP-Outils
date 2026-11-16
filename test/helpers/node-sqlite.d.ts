declare module "node:sqlite" {
  export type SQLInputValue = null | number | bigint | string | Uint8Array;
  export type SQLOutputValue = null | number | bigint | string | Uint8Array;

  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    all(...anonymousParameters: SQLInputValue[]): Array<Record<string, SQLOutputValue>>;
    get(...anonymousParameters: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
    run(...anonymousParameters: SQLInputValue[]): StatementResultingChanges;
    columns(): Array<{
      column: string | null;
      database: string | null;
      name: string;
      origin: string | null;
      table: string | null;
      type: string | null;
    }>;
    setReturnArrays(returnArrays: boolean): void;
  }

  export class DatabaseSync {
    constructor(location?: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf-8" | "utf8"): string;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
}

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
};
