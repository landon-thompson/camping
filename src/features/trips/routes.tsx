import { Route } from 'react-router-dom';
import { Placeholder } from '../../pages/Placeholder';

/** Phase 2 screens: /trips/* (season map, trip detail pages). */
export const tripRoutes = (
  <Route path="trips/*" element={<Placeholder title="Trips" phase="Phase 2" items={['Season map and trip pages']} />} />
);
