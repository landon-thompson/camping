import { fmtTimes, rangeGeometry, rangeLabel } from './rangeScale';

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

/**
 * How many fish to expect vs. a typical lake: the bar spans the low–high
 * range (10th–90th percentile), the tick is the middle guess, the dashed line
 * is a typical lake. Log scale from ¼× to 4×; arrows when the range runs past.
 */
export function RangeBar({ range, compact = false }: { range: { p10: number; med: number; p90: number }; compact?: boolean }) {
  const g = rangeGeometry(range);
  const label = rangeLabel(range);
  return (
    <div role="img" aria-label={label} className={compact ? 'w-full' : 'w-full pt-1'}>
      <div className="relative h-5">
        {/* track */}
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-2 ring-1 ring-line" />
        {/* typical lake */}
        <div className="absolute top-0 h-5 border-l-2 border-dashed border-ink-2/70" style={{ left: pct(g.typical) }} />
        {/* range */}
        <div
          className={`absolute top-1/2 h-3 -translate-y-1/2 bg-brand/45 ${g.clipLow ? 'rounded-l-none' : 'rounded-l-full'} ${g.clipHigh ? 'rounded-r-none' : 'rounded-r-full'}`}
          style={{ left: pct(g.lo), width: `max(4px, ${pct(g.hi - g.lo)})` }}
        />
        {/* middle guess */}
        <div className="absolute top-0 h-5 w-1 -translate-x-1/2 rounded-full bg-brand" style={{ left: pct(g.mid) }} />
        {g.clipLow && (
          <span aria-hidden className="absolute -left-0.5 top-1/2 -translate-y-1/2 text-[10px] leading-none text-brand">
            ◀
          </span>
        )}
        {g.clipHigh && (
          <span aria-hidden className="absolute -right-0.5 top-1/2 -translate-y-1/2 text-[10px] leading-none text-brand">
            ▶
          </span>
        )}
      </div>
      {compact ? (
        <p aria-hidden className="mt-0.5 text-xs tabular-nums text-ink-2">
          {fmtTimes(range.p10)}–{fmtTimes(range.p90)}× typical · middle guess <span className="font-semibold text-ink">{fmtTimes(range.med)}×</span>
        </p>
      ) : (
        <div aria-hidden className="relative mt-1 h-4 text-xs text-ink-2">
          <span className="absolute left-0">¼×</span>
          <span className="absolute -translate-x-1/2" style={{ left: pct(g.typical) }}>
            typical
          </span>
          <span className="absolute right-0">4×</span>
        </div>
      )}
    </div>
  );
}
