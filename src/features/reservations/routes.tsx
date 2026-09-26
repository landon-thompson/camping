import { Route } from 'react-router-dom';
import { BookPage } from './BookPage';
import { CampgroundsPage } from './CampgroundsPage';
import { CampgroundDetailPage } from './CampgroundDetailPage';
import { RulesPage } from './RulesPage';

/** Phase 3 screens: /book/* (campground directory, booking countdowns and reservations). */
export const reservationRoutes = (
  <>
    <Route path="book" element={<BookPage />} />
    <Route path="book/campgrounds" element={<CampgroundsPage />} />
    <Route path="book/campgrounds/:id" element={<CampgroundDetailPage />} />
    <Route path="book/rules" element={<RulesPage />} />
  </>
);
