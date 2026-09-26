/**
 * Preview build (`npm run build:preview`): a self-contained copy of the app for
 * showing it off before Azure is set up. No login, no sync, no service worker —
 * data stays in the viewer's browser.
 */
export const IS_PREVIEW = import.meta.env.VITE_PREVIEW === '1';
