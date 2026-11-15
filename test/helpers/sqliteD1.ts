import { DatabaseSync, type SQLInputValue } from "node:sqlite";

function toSqlValue(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return String(value);
}

function toPlainObject<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === "bigint" ? Number(v) : v;
  }
  return out as T;
}

function emptyMeta(changes = 0, lastRowId = 0): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  };
}

class SqliteD1PreparedStatement {
  private readonly db: DatabaseSync;
  private readonly query: string;
  private readonly params: SQLInputValue[];

  constructor(db: DatabaseSync, query: string, params: SQLInputValue[] = []) {
    this.db = db;
    this.query = query;
    this.params = params;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1PreparedStatement(
      this.db,
      this.query,
      values.map((v) => toSqlValue(v)),
    ) as unknown as D1PreparedStatement;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.query);
    const row = stmt.get(...this.params);
    if (!row) return null;
    const plain = toPlainObject<Record<string, unknown>>(row);
    if (typeof colName === "string") {
      const val = plain[colName];
      return (val === undefined ? null : val) as T | null;
    }
    return plain as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const stmt = this.db.prepare(this.query);
    const rows = stmt.all(...this.params);
    const results = rows.map((r) => toPlainObject<T>(r));
    return {
      results,
      success: true,
      meta: emptyMeta(0, 0),
    };
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const stmt = this.db.prepare(this.query);
    const info = stmt.run(...this.params);
    const changes = Number(info.changes);
    const lastRowId = Number(info.lastInsertRowid);
    return {
      results: [],
      success: true,
      meta: emptyMeta(changes, lastRowId),
    };
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const stmt = this.db.prepare(this.query);
    const cols = stmt.columns().map((c) => c.name);
    const rows = stmt.all(...this.params);
    const arrays = rows.map((r) => {
      const plain = toPlainObject<Record<string, unknown>>(r);
      return cols.map((c) => plain[c]);
    });
    if (options?.columnNames) {
      return [cols, ...arrays] as unknown as T[];
    }
    return arrays as unknown as T[];
  }
}

export interface SqliteD1Harness {
  readonly d1: D1Database;
  readonly rawDb: DatabaseSync;
  close(): void;
}

export function createSqliteD1Harness(options?: {
  seedSql?: string | readonly string[];
  enforceQueryOnly?: boolean;
  filePath?: string;
}): SqliteD1Harness {
  const rawDb = new DatabaseSync(options?.filePath ?? ":memory:");
  rawDb.exec("PRAGMA foreign_keys = ON;");

  if (options?.seedSql) {
    const chunks =
      typeof options.seedSql === "string" ? [options.seedSql] : Array.from(options.seedSql);
    for (const chunk of chunks) {
      if (chunk.trim()) {
        rawDb.exec(chunk);
      }
    }
  }

  if (options?.enforceQueryOnly ?? true) {
    rawDb.exec("PRAGMA query_only = ON;");
  }

  const impl = {
    prepare(query: string): D1PreparedStatement {
      return new SqliteD1PreparedStatement(rawDb, query) as unknown as D1PreparedStatement;
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const out: D1Result<T>[] = [];
      for (const st of statements) {
        out.push(await st.all<T>());
      }
      return out;
    },
    async exec(query: string): Promise<D1ExecResult> {
      rawDb.exec(query);
      return { count: 1, duration: 0 };
    },
    withSession(): D1DatabaseSession {
      return {
        prepare: (q: string) => impl.prepare(q),
        batch: <T = unknown>(stmts: D1PreparedStatement[]) => impl.batch<T>(stmts),
        getBookmark: () => null,
      } as unknown as D1DatabaseSession;
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },
  };

  return {
    d1: impl as unknown as D1Database,
    rawDb,
    close(): void {
      rawDb.close();
    },
  };
}
