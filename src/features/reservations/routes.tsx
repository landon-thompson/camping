import { Route } from 'react-router-dom';
import { Placeholder } from '../../pages/Placeholder';

/** Phase 3 screens: /book/* (campground directory, booking countdowns, reservations). */
export const reservationRoutes = (
  <Route path="book/*" element={<Placeholder title="Book" phase="Phase 3" items={['Campground directory, booking windows and reservations']} />} />
);
