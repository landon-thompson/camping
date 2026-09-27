import { NavLink, Outlet } from 'react-router-dom';
import { SyncBadge } from './SyncBadge';
import { UpdatePrompt } from './UpdatePrompt';
import { IS_PREVIEW } from '../lib/preview';

const icons = {
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  gear: 'M4 7h16v12H4zM9 7V5h6v2M4 12h16',
  trips: 'M3 20 9.5 7l4 7 2.5-4L21 20z',
  book: 'M5 4h14v17H5zM9 2v4M15 2v4M5 9h14M9 14l2 2 4-4',
  tools: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 16.5h7M16.5 13v7',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
};

const tabs = [
  { to: '/', label: 'Home', icon: icons.home, end: true },
  { to: '/trips', label: 'Trips', icon: icons.trips },
  { to: '/book', label: 'Book', icon: icons.book },
  { to: '/gear', label: 'Gear', icon: icons.gear },
  { to: '/tools', label: 'Tools', icon: icons.tools },
];

export function Layout() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="safe-top sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <span className="shrink-0 whitespace-nowrap text-lg font-bold text-brand">Camp Planner</span>
          <div className="flex shrink-0 items-center gap-1">
            <SyncBadge />
            <NavLink to="/settings" aria-label="Settings" className="grid h-11 w-11 place-items-center rounded-full text-ink-2">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
                <path d={icons.settings} />
              </svg>
            </NavLink>
          </div>
        </div>
      </header>

      {IS_PREVIEW && (
        <p role="note" className="border-b border-line bg-info-bg px-4 py-2 text-sm text-info">
          <strong>Preview.</strong> Edits are saved in this browser only. Login, sync and offline install arrive once Azure is set up.
        </p>
      )}

      <main className="flex-1 px-4 pb-28 pt-4">
        <Outlet />
      </main>

      <nav
        aria-label="Main"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur"
      >
        <ul className="mx-auto grid max-w-2xl grid-cols-5">
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold ${
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
