import type { D1Database } from './d1';

/** Bindings and settings from Cloudflare Pages → Settings (see docs/CLOUDFLARE.md). */
export interface Env {
  /** D1 database binding. Without it the app runs in on-this-phone mode. */
  DB?: D1Database;
  /** Zero Trust team domain, e.g. "campers.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's "Application Audience (AUD) Tag". */
  ACCESS_AUD?: string;
  /** Your email: sees the People list and shares the family data. */
  OWNER_EMAIL?: string;
  /** Comma-separated emails that share the family's trips (everyone else gets their own space). */
  FAMILY_EMAILS?: string;
  /** Free Recreation.gov (RIDB) API key, optional. */
  RIDB_API_KEY?: string;
  /** Local development only (`.dev.vars`): pretend this email signed in. Ignored once ACCESS_TEAM_DOMAIN is set. */
  DEV_USER_EMAIL?: string;
}

const emails = (s: string | undefined) =>
  (s ?? '')
    .split(/[,\s;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const FAMILY_HOUSEHOLD = 'family';

/** Whose trips a signed-in person sees: the owner and listed family share one space; anyone else has their own. */
export function householdFor(env: Env, email: string): string {
  const e = email.toLowerCase();
  if (e === (env.OWNER_EMAIL ?? '').trim().toLowerCase() || emails(env.FAMILY_EMAILS).includes(e)) return FAMILY_HOUSEHOLD;
  return `person:${e}`;
}

export const isOwner = (env: Env, email: string) => !!env.OWNER_EMAIL && email.toLowerCase() === env.OWNER_EMAIL.trim().toLowerCase();
