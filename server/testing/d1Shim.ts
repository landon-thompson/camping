import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '../d1';

/** D1's API over an in-memory node:sqlite database, for tests. */
export function memoryD1(): D1Database & { sqlite: DatabaseSync; queries: number } {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    sqlite,
    queries: 0,
    prepare(sql: string): D1PreparedStatement {
      const make = (values: unknown[]): D1PreparedStatement & { exec(): Record<string, unknown>[] } => ({
        bind: (...v: unknown[]) => make(v),
        exec() {
          db.queries++;
          return sqlite.prepare(sql).all(...(values as never[])) as Record<string, unknown>[];
        },
        async first<T>() {
          return ((this.exec()[0] as T | undefined) ?? null) as T | null;
        },
        async all<T>() {
          return { results: this.exec() as T[] };
        },
        async run() {
          this.exec();
          return {};
        },
      });
      return make([]);
    },
    async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      sqlite.exec('BEGIN');
      try {
        const out = statements.map((s) => ({ results: (s as unknown as { exec(): T[] }).exec() }));
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return db;
}
