/**
 * Public read-only trip page at /s/:token (no sign-in). Phase 2 fetches
 * GET /api/share/:token and renders the trip. Must work without auth.
 */
export function SharePage() {
  return <p className="p-6">This shared trip link isn’t available yet.</p>;
}
