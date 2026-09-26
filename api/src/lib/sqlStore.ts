import sql from 'mssql';
import { MIGRATIONS } from './migrations';
import type { IncomingRecord, Member, PullResult, PushResult, ShareLinkRow, Store, StoredRecord } from './store';

/** Thrown when the database can't be reached yet; the API answers 503 and the app retries. */
export class StoreUnavailableError extends Error {}

// Azure SQL error numbers that mean "try again shortly" — notably 40613, which
// the serverless free tier returns while it resumes from auto-pause.
const TRANSIENT_SQL_ERRORS = new Set([4060, 4221, 40143, 40197, 40501, 40540, 40613, 42108, 42109, 49918, 49919, 49920]);
const TRANSIENT_CODES = new Set(['ETIMEOUT', 'ESOCKET', 'ECONNRESET', 'ECONNCLOSED', 'ENOTOPEN']);

function isTransient(e: unknown): boolean {
  const err = e as { number?: number; code?: string; originalError?: { info?: { number?: number } } };
  const num = err.number ?? err.originalError?.info?.number;
  return (num !== undefined && TRANSIENT_SQL_ERRORS.has(num)) || (!!err.code && TRANSIENT_CODES.has(err.code));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  id: string;
  type: string;
  data: string;
  client_updated_at: string | number;
  updated_by: string | null;
  deleted: boolean;
  rv: string | number;
}

function toStored(r: Row): StoredRecord {
  return {
    id: r.id,
    type: r.type,
    data: JSON.parse(r.data) as unknown,
    updatedAt: Number(r.client_updated_at),
    updatedBy: r.updated_by,
    deleted: r.deleted,
    rev: String(r.rv),
  };
}

export class SqlStore implements Store {
  private pool: Promise<sql.ConnectionPool> | null = null;
  private migrated: Promise<void> | null = null;

  constructor(
    private connectionString: string,
    /** Stay under the ~45 s Static Web Apps function timeout. */
    private retryBudgetMs = 30_000,
  ) {}

  private async connect(): Promise<sql.ConnectionPool> {
    if (!this.pool) {
      const pool = new sql.ConnectionPool(this.connectionString);
      this.pool = pool.connect().catch((e: unknown) => {
        this.pool = null;
        throw e;
      });
    }
    return this.pool;
  }

  /** Run `fn`, retrying while the database is waking up. */
  private async withRetry<T>(fn: (pool: sql.ConnectionPool) => Promise<T>): Promise<T> {
    const deadline = Date.now() + this.retryBudgetMs;
    let delay = 1_000;
    for (;;) {
      try {
        const pool = await this.connect();
        await this.ensureMigrated(pool);
        return await fn(pool);
      } catch (e) {
        if (!isTransient(e)) throw e;
        const pool = this.pool;
        this.pool = null;
        this.migrated = null;
        void pool?.then((p) => p.close()).catch(() => undefined);
        if (Date.now() + delay > deadline) {
          throw new StoreUnavailableError('The database is waking up (free tier auto-pause). Try again in a minute.');
        }
        await sleep(delay);
        delay = Math.min(delay * 2, 8_000);
      }
    }
  }

  private ensureMigrated(pool: sql.ConnectionPool): Promise<void> {
    this.migrated ??= migrate(pool).then(
      () => undefined,
      (e: unknown) => {
        this.migrated = null;
        throw e;
      },
    );
    return this.migrated;
  }

  async ensureMember(householdId: string, member: Member): Promise<void> {
    await this.withRetry(async (pool) => {
      await pool
        .request()
        .input('h', sql.NVarChar(64), householdId)
        .input('uid', sql.NVarChar(128), member.userId)
        .input('email', sql.NVarChar(320), member.email)
        .input('idp', sql.NVarChar(40), member.identityProvider).query(`
          IF NOT EXISTS (SELECT 1 FROM dbo.households WITH (UPDLOCK, HOLDLOCK) WHERE id = @h)
            INSERT INTO dbo.households (id, name) VALUES (@h, N'Family');
          MERGE dbo.members WITH (HOLDLOCK) AS t
          USING (SELECT @uid AS user_id) AS s ON t.user_id = s.user_id
          WHEN MATCHED THEN UPDATE SET email = @email, identity_provider = @idp, last_seen_at = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT (user_id, household_id, email, identity_provider)
            VALUES (@uid, @h, @email, @idp);`);
    });
  }

  async push(householdId: string, userId: string, records: IncomingRecord[]): Promise<PushResult> {
    return this.withRetry(async (pool) => {
      const result: PushResult = { accepted: [], rejected: [] };
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        for (const r of records) {
          // Upsert only if the incoming edit is at least as new (last write wins).
          const res = await new sql.Request(tx)
            .input('h', sql.NVarChar(64), householdId)
            .input('id', sql.NVarChar(128), r.id)
            .input('type', sql.NVarChar(40), r.type)
            .input('data', sql.NVarChar(sql.MAX), JSON.stringify(r.data))
            .input('ts', sql.BigInt, r.updatedAt)
            .input('by', sql.NVarChar(128), userId)
            .input('del', sql.Bit, r.deleted).query<{ rv: string }>(`
              MERGE dbo.records WITH (HOLDLOCK) AS t
              USING (SELECT @h AS household_id, @id AS id) AS s
                ON t.household_id = s.household_id AND t.id = s.id
              WHEN MATCHED AND @ts >= t.client_updated_at THEN
                UPDATE SET type = @type, data = @data, client_updated_at = @ts, updated_by = @by,
                           deleted = @del, server_updated_at = SYSUTCDATETIME()
              WHEN NOT MATCHED THEN
                INSERT (household_id, id, type, data, client_updated_at, updated_by, deleted)
                VALUES (@h, @id, @type, @data, @ts, @by, @del)
              OUTPUT CAST(inserted.rv AS BIGINT) AS rv;`);
          const written = res.recordset[0];
          if (written) {
            result.accepted.push({ id: r.id, rev: String(written.rv) });
            continue;
          }
          const current = await new sql.Request(tx)
            .input('h', sql.NVarChar(64), householdId)
            .input('id', sql.NVarChar(128), r.id).query<Row>(`
              SELECT id, type, data, client_updated_at, updated_by, deleted, CAST(rv AS BIGINT) AS rv
              FROM dbo.records WHERE household_id = @h AND id = @id;`);
          const row = current.recordset[0];
          if (row) result.rejected.push(toStored(row));
        }
        await tx.commit();
      } catch (e) {
        await tx.rollback().catch(() => undefined);
        throw e;
      }
      return result;
    });
  }

  async pull(householdId: string, since: string, limit: number): Promise<PullResult> {
    return this.withRetry(async (pool) => {
      // MIN_ACTIVE_ROWVERSION() hides rows from transactions still in flight,
      // so a slow write can never land *behind* a cursor we've handed out.
      const res = await pool
        .request()
        .input('h', sql.NVarChar(64), householdId)
        .input('since', sql.BigInt, since)
        .input('take', sql.Int, limit + 1).query<Row>(`
          SELECT TOP (@take) id, type, data, client_updated_at, updated_by, deleted, CAST(rv AS BIGINT) AS rv
          FROM dbo.records
          WHERE household_id = @h
            AND rv > CAST(@since AS BINARY(8))
            AND rv < MIN_ACTIVE_ROWVERSION()
          ORDER BY rv;`);
      const rows = res.recordset;
      const more = rows.length > limit;
      const page = (more ? rows.slice(0, limit) : rows).map(toStored);
      const last = page[page.length - 1];
      return { records: page, cursor: last ? last.rev : since, more };
    });
  }

  async getRecord(householdId: string, type: string, id: string): Promise<StoredRecord | null> {
    return this.withRetry(async (pool) => {
      const res = await pool
        .request()
        .input('h', sql.NVarChar(64), householdId)
        .input('type', sql.NVarChar(40), type)
        .input('id', sql.NVarChar(128), id).query<Row>(`
          SELECT TOP (1) id, type, data, client_updated_at, updated_by, deleted, CAST(rv AS BIGINT) AS rv
          FROM dbo.records WHERE household_id = @h AND type = @type AND id = @id AND deleted = 0;`);
      const row = res.recordset[0];
      return row ? toStored(row) : null;
    });
  }

  async getRecordsByTripId(householdId: string, type: string, tripId: string): Promise<StoredRecord[]> {
    return this.withRetry(async (pool) => {
      const res = await pool
        .request()
        .input('h', sql.NVarChar(64), householdId)
        .input('type', sql.NVarChar(40), type)
        .input('tripId', sql.NVarChar(128), tripId).query<Row>(`
          SELECT id, type, data, client_updated_at, updated_by, deleted, CAST(rv AS BIGINT) AS rv
          FROM dbo.records
          WHERE household_id = @h AND type = @type AND deleted = 0 AND JSON_VALUE(data, '$.tripId') = @tripId;`);
      return res.recordset.map(toStored);
    });
  }

  async createShareLink(householdId: string, token: string, tripId: string, createdBy: string | null): Promise<void> {
    await this.withRetry(async (pool) => {
      await pool
        .request()
        .input('token', sql.NVarChar(64), token)
        .input('h', sql.NVarChar(64), householdId)
        .input('tripId', sql.NVarChar(128), tripId)
        .input('by', sql.NVarChar(128), createdBy)
        .query('INSERT INTO dbo.share_links (token, household_id, trip_id, created_by) VALUES (@token, @h, @tripId, @by);');
    });
  }

  async getShareLink(householdId: string, token: string): Promise<ShareLinkRow | null> {
    return this.withRetry(async (pool) => {
      const res = await pool
        .request()
        .input('token', sql.NVarChar(64), token)
        .input('h', sql.NVarChar(64), householdId).query<{ trip_id: string; revoked_at: Date | null }>(`
          SELECT trip_id, revoked_at FROM dbo.share_links WHERE token = @token AND household_id = @h;`);
      const row = res.recordset[0];
      return row ? { tripId: row.trip_id, revoked: row.revoked_at !== null } : null;
    });
  }

  async revokeShareLink(householdId: string, token: string): Promise<boolean> {
    return this.withRetry(async (pool) => {
      const res = await pool
        .request()
        .input('token', sql.NVarChar(64), token)
        .input('h', sql.NVarChar(64), householdId).query<{ affected: number }>(`
          UPDATE dbo.share_links SET revoked_at = COALESCE(revoked_at, SYSUTCDATETIME())
          WHERE token = @token AND household_id = @h;
          SELECT @@ROWCOUNT AS affected;`);
      return (res.recordset[0]?.affected ?? 0) > 0;
    });
  }

  async close(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    this.migrated = null;
    if (pool) await (await pool).close();
  }
}

export async function migrate(pool: sql.ConnectionPool): Promise<string[]> {
  const applied: string[] = [];
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Only one instance migrates at a time.
    await new sql.Request(tx).query(
      `EXEC sp_getapplock @Resource = 'camp_migrations', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000;`,
    );
    await new sql.Request(tx).query(`
      IF OBJECT_ID('dbo.schema_migrations', 'U') IS NULL
        CREATE TABLE dbo.schema_migrations (
          id NVARCHAR(100) NOT NULL CONSTRAINT pk_schema_migrations PRIMARY KEY,
          applied_at DATETIME2 NOT NULL CONSTRAINT df_schema_migrations DEFAULT SYSUTCDATETIME()
        );`);
    const done = await new sql.Request(tx).query<{ id: string }>('SELECT id FROM dbo.schema_migrations');
    const doneIds = new Set(done.recordset.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (doneIds.has(m.id)) continue;
      for (const stmt of m.statements) await new sql.Request(tx).batch(stmt);
      await new sql.Request(tx).input('id', sql.NVarChar(100), m.id).query('INSERT INTO dbo.schema_migrations (id) VALUES (@id)');
      applied.push(m.id);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => undefined);
    throw e;
  }
  return applied;
}
