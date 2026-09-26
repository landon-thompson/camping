import { Route } from 'react-router-dom';
import { TrailsLibraryPage } from './TrailsLibraryPage';

/** Phase 4: /trails — a library of every imported route/pin plus a full map. Optional per contract. */
export const trailRoutes = <Route path="trails/*" element={<TrailsLibraryPage />} />;
