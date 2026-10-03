/**
 * The small slice of Cloudflare's D1 API this server uses (kept here instead of
 * adding @cloudflare/workers-types). Tests run against node:sqlite through the
 * same interface (server/testing/d1Shim.ts).
 */
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  /** Runs the statements in order inside one transaction. */
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
