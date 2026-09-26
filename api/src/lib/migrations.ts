/**
 * Database migrations, applied automatically (in order, once each) the first
 * time the API talks to the database after a deploy. Never edit a migration
 * that has shipped — add a new one.
 *
 * Design note: app data is stored as JSON documents in `records` (one row per
 * gear item, trip, checklist item, …). The shape of each record type is
 * defined and validated in the app (src/model/schemas.ts). This keeps offline
 * sync simple and means most new features need no database migration.
 */
export interface Migration {
  id: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    id: '001_initial',
    statements: [
      `CREATE TABLE dbo.households (
        id NVARCHAR(64) NOT NULL CONSTRAINT pk_households PRIMARY KEY,
        name NVARCHAR(200) NOT NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT df_households_created DEFAULT SYSUTCDATETIME()
      )`,
      `CREATE TABLE dbo.members (
        user_id NVARCHAR(128) NOT NULL CONSTRAINT pk_members PRIMARY KEY,
        household_id NVARCHAR(64) NOT NULL CONSTRAINT fk_members_household REFERENCES dbo.households(id),
        email NVARCHAR(320) NULL,
        identity_provider NVARCHAR(40) NULL,
        first_seen_at DATETIME2 NOT NULL CONSTRAINT df_members_first DEFAULT SYSUTCDATETIME(),
        last_seen_at DATETIME2 NOT NULL CONSTRAINT df_members_last DEFAULT SYSUTCDATETIME()
      )`,
      `CREATE TABLE dbo.records (
        household_id NVARCHAR(64) NOT NULL CONSTRAINT fk_records_household REFERENCES dbo.households(id),
        id NVARCHAR(128) NOT NULL,
        type NVARCHAR(40) NOT NULL,
        data NVARCHAR(MAX) NOT NULL CONSTRAINT ck_records_json CHECK (ISJSON(data) = 1),
        client_updated_at BIGINT NOT NULL,
        updated_by NVARCHAR(128) NULL,
        deleted BIT NOT NULL CONSTRAINT df_records_deleted DEFAULT 0,
        server_updated_at DATETIME2 NOT NULL CONSTRAINT df_records_server_updated DEFAULT SYSUTCDATETIME(),
        rv ROWVERSION NOT NULL,
        CONSTRAINT pk_records PRIMARY KEY (household_id, id)
      )`,
      `CREATE UNIQUE INDEX ix_records_rv ON dbo.records (household_id, rv)`,
      `CREATE INDEX ix_records_type ON dbo.records (household_id, type) WHERE deleted = 0`,
      // Read-only trip links (Phase 2). The token is the whole secret, so it is long and random.
      `CREATE TABLE dbo.share_links (
        token NVARCHAR(64) NOT NULL CONSTRAINT pk_share_links PRIMARY KEY,
        household_id NVARCHAR(64) NOT NULL CONSTRAINT fk_share_household REFERENCES dbo.households(id),
        trip_id NVARCHAR(128) NOT NULL,
        created_by NVARCHAR(128) NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT df_share_created DEFAULT SYSUTCDATETIME(),
        revoked_at DATETIME2 NULL
      )`,
    ],
  },
];
