import { Link, NavLink, type LinkProps } from 'react-router-dom';

/** Horizontal sub-nav tabs, used at the top of the /gear/* and /tools/* screens. */
function SubNav({ tabs }: { tabs: { to: string; label: string; end?: boolean }[] }) {
  return (
    <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Section">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-semibold ${
              isActive ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-2'
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function GearSubNav() {
  return (
    <SubNav
      tabs={[
        { to: '/gear', label: 'Items', end: true },
        { to: '/gear/budget', label: 'Budget' },
        { to: '/gear/next', label: 'Buy next' },
      ]}
    />
  );
}

export function ToolsSubNav() {
  return (
    <SubNav
      tabs={[
        { to: '/tools', label: 'Overview', end: true },
        { to: '/tools/load', label: 'Load & tow' },
        { to: '/tools/power', label: 'Power' },
        { to: '/tools/checklists', label: 'Checklists' },
      ]}
    />
  );
}

type Variant = 'primary' | 'secondary' | 'ghost';
const linkStyles: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink',
  secondary: 'border border-line bg-surface-2 text-ink',
  ghost: 'text-brand underline-offset-2 hover:underline',
};

/** A same-styled `Button` that navigates client-side (react-router `Link`), for internal nav. */
export function NavButton({ variant = 'primary', className = '', ...props }: LinkProps & { variant?: Variant }) {
  return (
    <Link
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-semibold ${linkStyles[variant]} ${className}`}
      {...props}
    />
  );
}
