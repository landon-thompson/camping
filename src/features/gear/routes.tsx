import { Route } from 'react-router-dom';
import { Placeholder } from '../../pages/Placeholder';

/** Phase 1 screens: /gear/* (items, budget, buy next) and /tools/* (calculators, checklist templates). */
export const gearRoutes = (
  <>
    <Route path="gear/*" element={<Placeholder title="Gear" phase="Phase 1" items={['Gear list, budget and buy-next list']} />} />
    <Route path="tools/*" element={<Placeholder title="Tools" phase="Phase 1" items={['Load & tow and power calculators', 'Checklist templates']} />} />
  </>
);
