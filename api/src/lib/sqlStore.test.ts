import sql from 'mssql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqlStore } from './sqlStore';

/**
 * Integration test against a real SQL Server. Skipped unless
 * TEST_SQL_CONNECTION_STRING is set (see README → Testing the database code).
 * It creates and drops its own throwaway database.
 */
const master = process.env.TEST_SQL_CONNECTION_STRING;
const dbName = `camp_test_${Date.now()}`;

describe.skipIf(!master)('SqlStore against SQL Server', () => {
  let admin: sql.ConnectionPool;
  let store: SqlStore;

  beforeAll(async () => {
    admin = await new sql.ConnectionPool(master!).connect();
    await admin.request().batch(`CREATE DATABASE [${dbName}]`);
    store = new SqlStore(`${master!.replace(/;?\s*$/, '')};Database=${dbName}`);
  }, 60_000);

  afterAll(async () => {
    await store?.close();
    await admin?.request().batch(`ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${dbName}]`);
    await admin?.close();
  }, 60_000);

  it('migrates, registers members, and syncs with last-write-wins', async () => {
    await store.ensureMember('family', { userId: 'u1', email: 'a@example.com', identityProvider: 'aad' });
    await store.ensureMember('family', { userId: 'u1', email: 'a@example.com', identityProvider: 'aad' });

    const first = await store.push('family', 'u1', [
      { id: 'gear:1', type: 'gear', data: { name: 'Fridge' }, updatedAt: 200, deleted: false },
      { id: 'gear:2', type: 'gear', data: { name: 'Stove' }, updatedAt: 200, deleted: false },
    ]);
    expect(first.accepted.map((a) => a.id)).toEqual(['gear:1', 'gear:2']);

    const stale = await store.push('family', 'u2', [
      { id: 'gear:1', type: 'gear', data: { name: 'Old' }, updatedAt: 100, deleted: false },
    ]);
    expect(stale.accepted).toEqual([]);
    expect(stale.rejected[0]).toMatchObject({ id: 'gear:1', data: { name: 'Fridge' }, updatedBy: 'u1' });

    const all = await store.pull('family', '0', 1);
    expect(all.records).toHaveLength(1);
    expect(all.more).toBe(true);
    const rest = await store.pull('family', all.cursor, 10);
    expect(rest.records.map((r) => r.id)).toEqual(['gear:2']);
    expect(rest.more).toBe(false);

    // A newer edit (a delete) moves the record past the cursor.
    await store.push('family', 'u2', [{ id: 'gear:1', type: 'gear', data: { name: 'Fridge' }, updatedAt: 300, deleted: true }]);
    const after = await store.pull('family', rest.cursor, 10);
    expect(after.records).toEqual([expect.objectContaining({ id: 'gear:1', deleted: true, updatedAt: 300 })]);

    const other = await store.pull('someone-else', '0', 10);
    expect(other.records).toEqual([]);
  }, 60_000);

  it('finds records by type+id and type+tripId, and manages share links', async () => {
    await store.push('family', 'u1', [
      { id: 'trip:1', type: 'trip', data: { name: 'Shakedown' }, updatedAt: 1, deleted: false },
      { id: 'reservation:1', type: 'reservation', data: { tripId: 'trip:1', site: 'A1' }, updatedAt: 1, deleted: false },
      { id: 'reservation:2', type: 'reservation', data: { tripId: 'trip:2', site: 'B2' }, updatedAt: 1, deleted: false },
    ]);

    expect(await store.getRecord('family', 'trip', 'trip:1')).toMatchObject({ id: 'trip:1', data: { name: 'Shakedown' } });
    expect(await store.getRecord('family', 'trip', 'trip:missing')).toBeNull();
    expect(await store.getRecord('family', 'reservation', 'trip:1')).toBeNull();

    const forTrip1 = await store.getRecordsByTripId('family', 'reservation', 'trip:1');
    expect(forTrip1.map((r) => r.id)).toEqual(['reservation:1']);

    await store.createShareLink('family', 'tok-abc', 'trip:1', 'u1');
    expect(await store.getShareLink('family', 'tok-abc')).toEqual({ tripId: 'trip:1', revoked: false });
    expect(await store.getShareLink('family', 'unknown-token')).toBeNull();

    expect(await store.revokeShareLink('family', 'tok-abc')).toBe(true);
    expect(await store.getShareLink('family', 'tok-abc')).toEqual({ tripId: 'trip:1', revoked: true });
    expect(await store.revokeShareLink('family', 'tok-abc')).toBe(true); // idempotent
    expect(await store.revokeShareLink('family', 'never-existed')).toBe(false);
  }, 60_000);
});
