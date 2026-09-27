import { useRecords, type Row } from '../../db/records';
import type { Agency, BookingRule, Campground, Reservation } from '../../model/schemas';

/** Every seeded booking rule uses one of these fixed ids. */
export const RULE_ID_FOR_AGENCY: Record<Agency, string> = {
  'mn-state-park': 'booking_rule:mn-state-park',
  'mn-state-forest': 'booking_rule:mn-state-forest',
  'sd-state-park': 'booking_rule:sd-state-park',
  usfs: 'booking_rule:usfs',
  other: 'booking_rule:dispersed',
};

export function useBookingRules(): { loading: boolean; byAgency: Partial<Record<Agency, Row<BookingRule>>>; rows: Row<BookingRule>[] } {
  const { loading, rows } = useRecords('booking_rule');
  const byAgency: Partial<Record<Agency, Row<BookingRule>>> = {};
  for (const r of rows) byAgency[r.data.agency] = r;
  return { loading, byAgency, rows };
}

export function useCampgrounds(): { loading: boolean; rows: Row<Campground>[] } {
  return useRecords('campground');
}

export function useReservations(): { loading: boolean; rows: Row<Reservation>[] } {
  return useRecords('reservation');
}

/** The one `reservation:*` record for a trip, if it has been created yet. */
export function reservationForTrip(reservations: Row<Reservation>[], tripId: string): Row<Reservation> | undefined {
  return reservations.find((r) => r.data.tripId === tripId);
}

export const AGENCY_LABEL: Record<Agency, string> = {
  'mn-state-park': 'MN state park',
  'mn-state-forest': 'MN state forest',
  'sd-state-park': 'SD state park',
  usfs: 'US Forest Service',
  other: 'Other / dispersed',
};
