import { Route } from 'react-router-dom';
import { TripsListPage } from './TripsListPage';
import { TripPage } from './TripPage';

/** Phase 2 screens: /trips/* (season map, trip pages). */
export const tripRoutes = (
  <Route path="trips">
    <Route index element={<TripsListPage />} />
    <Route path=":id" element={<TripPage />} />
  </Route>
);
