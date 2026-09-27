import type { Campground, Reservation, Trip } from '../../model/schemas';

/**
 * Reads a pasted booking confirmation (ReserveMN / Recreation.gov email or page text)
 * and pulls out what we track. Nothing is fetched: the owner pastes their own email.
 * Email layouts aren't published, so this looks for common labels and the owner
 * checks the result before saving.
 */
export type ParsedConfirmation = {
  fields: Partial<Pick<Reservation, 'status' | 'confirmation' | 'site' | 'arrivalDate' | 'nights' | 'costUsd' | 'feesUsd' | 'cancelDeadline'>>;
  /** Human-readable names of what was found, e.g. ["confirmation #", "site"]. */
  found: string[];
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DATE_RE = new RegExp(
  [
    '(\\d{4})-(\\d{1,2})-(\\d{1,2})', // 2027-06-12
    '(\\d{1,2})/(\\d{1,2})/(\\d{2,4})', // 06/12/2027
    `${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, // June 12, 2027
    `(\\d{1,2})\\s+${MONTH_RE},?\\s+(\\d{4})`, // 12 June 2027
  ].join('|'),
  'gi',
);

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const monthNum = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;

/** All dates in a string, in order, as YYYY-MM-DD. */
export function findDates(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(DATE_RE)) {
    const g = m.slice(1).map((x) => x ?? '');
    const d = g[0]
      ? iso(+g[0], +g[1]!, +g[2]!)
      : g[3]
        ? iso(+g[5]!, +g[3], +g[4]!)
        : g[6]
          ? iso(+g[8]!, monthNum(g[6]), +g[7]!)
          : iso(+g[11]!, monthNum(g[10]!), +g[9]!);
    if (d) out.push(d);
  }
  return out;
}

function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function nightsBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** The text after a label on its line, plus the next line (labels and values are often split in emails). */
function afterLabel(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    const m = label.exec(lines[i]!);
    if (m) return `${lines[i]!.slice(m.index + m[0].length)} \n ${lines[i + 1] ?? ''}`;
  }
  return null;
}

const AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/;
const amountIn = (s: string): number | null => {
  const m = AMOUNT.exec(s);
  return m ? Number(m[1]!.replace(/,/g, '')) : null;
};
/** Amount on the label's line, or on the next line if the label stands alone. */
function amountAfter(lines: string[], i: number, labelEnd: number): number | null {
  return amountIn(lines[i]!.slice(labelEnd)) ?? (lines[i]!.slice(labelEnd).trim().length < 3 ? amountIn(lines[i + 1] ?? '') : null);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseConfirmation(text: string): ParsedConfirmation {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean);
  const fields: ParsedConfirmation['fields'] = {};
  const found: string[] = [];
  const all = lines.join('\n');

  // Confirmation / reservation number: a token with at least one digit.
  const conf = /\b(?:confirmation|reservation|order|booking)\s*(?:#|no\.?|number|num\.?|id|code)?\s*[:#]?\s*(?:is\s+)?((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,})\b/i.exec(all);
  if (conf) {
    fields.confirmation = conf[1]!.toUpperCase();
    found.push('confirmation #');
  }

  const site = /(?:^|[^a-z])(?:camp)?site\s*(?:#|no\.?|number)?\s*[:#]?\s*([A-Z]{0,3}-?\d{1,4}[A-Z]?)\b/i.exec(all);
  if (site) {
    fields.site = site[1]!.toUpperCase();
    found.push('site');
  }

  // Dates: labelled arrival/departure first, then a "date – date" range.
  const arrivalText = afterLabel(lines, /\b(?:arrival(?:\s+date)?|arriv(?:e|ing)|check[\s-]?in(?:\s+date)?|start\s+date)\b\s*:?/i);
  const departText = afterLabel(lines, /\b(?:departure(?:\s+date)?|depart(?:ing)?|check[\s-]?out(?:\s+date)?|end\s+date)\b\s*:?/i);
  let arrival = arrivalText ? (findDates(arrivalText)[0] ?? null) : null;
  let depart = departText ? (findDates(departText)[0] ?? null) : null;
  if (!arrival) {
    for (const l of lines) {
      if (!/(?:-|–|—|\bto\b|\bthrough\b)/i.test(l)) continue;
      const ds = findDates(l);
      if (ds.length >= 2 && ds[1]! > ds[0]!) {
        arrival = ds[0]!;
        depart = depart ?? ds[1]!;
        break;
      }
    }
  }
  let nights: number | null = null;
  const nm = /\b(\d{1,2})\s*nights?\b/i.exec(all) ?? /\bnights?\s*[:#]?\s*(\d{1,2})\b/i.exec(all);
  if (nm) nights = Number(nm[1]);
  if (arrival && depart && depart > arrival) nights = nightsBetween(arrival, depart);
  if (arrival) {
    fields.arrivalDate = arrival;
    found.push('arrival date');
  }
  if (nights && nights > 0) {
    fields.nights = nights;
    found.push('nights');
  }

  // Money: fee lines (reservation/transaction…) vs campsite lines; total as a fallback.
  let fees = 0;
  let feeSeen = false;
  let cost: number | null = null;
  let total: number | null = null;
  lines.forEach((l, i) => {
    const fee = /\b(?:reservation|transaction|processing|booking|service|convenience|change)\s+fees?\b\s*:?/i.exec(l);
    const siteFee = /\b(?:camp)?site\s+(?:fee|cost|charge|total)s?\b|\b(?:camping|use|lodging|nightly)\s+(?:fee|cost|charge|total)s?\b|\bsub-?total\b\s*:?/i.exec(l);
    const tot = /\b(?:grand\s+)?total(?:\s+(?:paid|charged|cost|due|amount))?\b\s*:?|\bamount\s+(?:paid|charged)\b\s*:?/i.exec(l);
    if (fee) {
      const v = amountAfter(lines, i, fee.index + fee[0].length);
      if (v !== null) {
        fees += v;
        feeSeen = true;
      }
    } else if (siteFee) {
      const v = amountAfter(lines, i, siteFee.index + siteFee[0].length);
      if (v !== null && cost === null) cost = v;
    } else if (tot && total === null) {
      total = amountAfter(lines, i, tot.index + tot[0].length);
    }
  });
  if (cost === null && total !== null) cost = round2(Math.max(0, total - fees));
  if (cost !== null) {
    fields.costUsd = round2(cost);
    found.push('cost');
  }
  if (feeSeen) {
    fields.feesUsd = round2(fees);
    found.push('fees');
  }

  const cancelText = afterLabel(lines, /\bcancel(?:lation)?\s+(?:by|before|deadline|until)\b\s*:?/i);
  const cancel = cancelText ? findDates(cancelText)[0] : undefined;
  if (cancel) {
    fields.cancelDeadline = cancel;
    found.push('cancellation deadline');
  }

  if (/\b(?:has been|was|is)\s+cancell?ed\b|\bcancell?ation\s+confirm/i.test(all)) fields.status = 'cancelled';
  else if (fields.confirmation) fields.status = 'booked';

  return { fields, found };
}

/**
 * The trip's location after switching campground: the new campground's pin when it has
 * one. A pin that came from the old campground is cleared if the new one has none;
 * a spot the owner set by hand is kept in that case.
 */
export function locationForCampground(
  current: Trip['location'],
  previous: Campground | undefined,
  next: Campground | undefined,
): Trip['location'] {
  if (next?.location) return { lat: next.location.lat, lng: next.location.lng, label: next.name };
  const fromPrevious =
    current &&
    previous &&
    (current.label === previous.name ||
      (previous.location && current.lat === previous.location.lat && current.lng === previous.location.lng));
  return fromPrevious ? null : current;
}

/** What a saved reservation changes on its trip (dates, status), or null when nothing. */
export function tripUpdateFromReservation(trip: Trip, r: Reservation): { trip: Trip; changes: string[] } | null {
  const next = { ...trip };
  const changes: string[] = [];
  if (r.status === 'booked') {
    if (r.arrivalDate && r.arrivalDate !== trip.startDate) {
      next.startDate = r.arrivalDate;
      changes.push('start date');
    }
    if (r.arrivalDate && r.nights) {
      const end = addDays(r.arrivalDate, r.nights);
      if (end !== trip.endDate) {
        next.endDate = end;
        changes.push('end date');
      }
    }
    if (trip.status === 'idea' || trip.status === 'planned') {
      next.status = 'booked';
      changes.push('status → booked');
    }
  } else if (r.status === 'cancelled' && trip.status === 'booked') {
    next.status = 'planned';
    changes.push('status → planned');
  }
  return changes.length ? { trip: next, changes } : null;
}
