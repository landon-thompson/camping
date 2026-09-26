import { NavLink, Outlet } from 'react-router-dom';
import { SyncBadge } from './SyncBadge';
import { UpdatePrompt } from './UpdatePrompt';

const icons = {
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  gear: 'M4 7h16v12H4zM9 7V5h6v2M4 12h16',
  trips: 'M3 20 9.5 7l4 7 2.5-4L21 20z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
};

const tabs = [
  { to: '/', label: 'Home', icon: icons.home, end: true },
  { to: '/gear', label: 'Gear', icon: icons.gear },
  { to: '/trips', label: 'Trips', icon: icons.trips },
  { to: '/settings', label: 'Settings', icon: icons.settings },
];

export function Layout() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="safe-top sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <span className="text-lg font-bold text-brand">Camp Planner</span>
          <SyncBadge />
        </div>
      </header>

      <main className="flex-1 px-4 pb-28 pt-4">
        <Outlet />
      </main>

      <nav
        aria-label="Main"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur"
      >
        <ul className="mx-auto grid max-w-2xl grid-cols-4">
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `flex min-h-16 flex-col items-center justify-center gap-1 text-sm font-semibold ${
                    isActive ? 'text-brand' : 'text-ink-2'
                  }`
                }
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
                  <path d={t.icon} />
                </svg>
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <UpdatePrompt />
    </div>
  );
}
