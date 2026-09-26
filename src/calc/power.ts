import type { PowerLoad } from '../model/schemas';

export type PowerStatus = 'ok' | 'near' | 'over';

/** Below this state of charge at the end of the trip, we call it "cutting it close". */
export const LOW_END_PCT = 20;

export interface PowerInput {
  batteryWh: number;
  usablePct: number;
  startPct: number;
  loads: PowerLoad[];
  solar: { enabled: boolean; panelW: number; peakSunHours: number; efficiencyPct: number };
  driveCharge: { watts: number; hoursPerDay: number };
  tripDays: number;
}

export interface PowerResult {
  consumptionWh: number;
  solarWh: number;
  driveWh: number;
  /** Positive = gaining charge each day. */
  netWh: number;
  usableWh: number;
  startWh: number;
  /** Days until the battery is empty; Infinity if charging keeps up. */
  daysOfAutonomy: number;
  /** Charge left at the end of the trip, % of usable capacity. */
  endPct: number;
  /** Day (1-based) the battery runs flat, or null. */
  flatOnDay: number | null;
  status: PowerStatus;
}

export function loadWhPerDay(l: PowerLoad): number {
  if (!l.enabled) return 0;
  if (l.whPerDay !== null) return l.whPerDay;
  return (l.watts ?? 0) * (l.hoursPerDay ?? 0);
}

export function computePower(p: PowerInput): PowerResult {
  const consumptionWh = p.loads.reduce((a, l) => a + loadWhPerDay(l), 0);
  const solarWh = p.solar.enabled ? p.solar.panelW * p.solar.peakSunHours * (p.solar.efficiencyPct / 100) : 0;
  const driveWh = p.driveCharge.watts * p.driveCharge.hoursPerDay;
  const netWh = solarWh + driveWh - consumptionWh;
  const usableWh = p.batteryWh * (p.usablePct / 100);
  const startWh = usableWh * (p.startPct / 100);

  const daysOfAutonomy = netWh >= 0 ? Infinity : startWh / -netWh;

  // Walk the trip day by day; a full battery can't store extra solar.
  let level = startWh;
  let flatOnDay: number | null = null;
  for (let d = 1; d <= p.tripDays; d++) {
    level = Math.min(usableWh, level + netWh);
    if (level <= 0) {
      level = 0;
      flatOnDay ??= d;
    }
  }
  const endPct = usableWh > 0 ? (level / usableWh) * 100 : 0;
  const status: PowerStatus = flatOnDay !== null ? 'over' : endPct < LOW_END_PCT ? 'near' : 'ok';

  return { consumptionWh, solarWh, driveWh, netWh, usableWh, startWh, daysOfAutonomy, endPct, flatOnDay, status };
}
