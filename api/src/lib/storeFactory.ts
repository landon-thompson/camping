import { MemoryStore, type Store } from './store';
import { SqlStore } from './sqlStore';

export class StoreNotConfiguredError extends Error {}

let store: Store | null = null;

/**
 * DATA_STORE=memory → throwaway in-memory data (local development only).
 * Otherwise SQL_CONNECTION_STRING must point at the Azure SQL database.
 */
export function getStore(): Store {
  if (store) return store;
  if (process.env.DATA_STORE === 'memory') {
    store = new MemoryStore();
    return store;
  }
  const cs = process.env.SQL_CONNECTION_STRING;
  if (!cs) {
    throw new StoreNotConfiguredError(
      'Database not configured: add SQL_CONNECTION_STRING in the Static Web App → Environment variables.',
    );
  }
  store = new SqlStore(cs);
  return store;
}

export function householdId(): string {
  return process.env.HOUSEHOLD_ID || 'family';
}
