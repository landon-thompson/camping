import { Route } from 'react-router-dom';
import { GearListPage } from './GearList';
import { GearFormPage } from './GearForm';
import { BudgetPage } from './Budget';
import { BuyNextPage } from './BuyNext';
import { ToolsIndexPage } from './ToolsIndex';
import { LoadToolPage } from './LoadTool';
import { PowerToolPage } from './PowerTool';
import { ChecklistsPage } from './Checklists';
import { ChecklistDetailPage } from './ChecklistDetail';

/** Phase 1 screens: /gear/* (items, budget, buy next) and /tools/* (calculators, checklist templates). */
export const gearRoutes = (
  <>
    <Route path="gear" element={<GearListPage />} />
    <Route path="gear/new" element={<GearFormPage />} />
    <Route path="gear/budget" element={<BudgetPage />} />
    <Route path="gear/next" element={<BuyNextPage />} />
    <Route path="gear/:id" element={<GearFormPage />} />

    <Route path="tools" element={<ToolsIndexPage />} />
    <Route path="tools/load" element={<LoadToolPage />} />
    <Route path="tools/power" element={<PowerToolPage />} />
    <Route path="tools/checklists" element={<ChecklistsPage />} />
    <Route path="tools/checklists/:id" element={<ChecklistDetailPage />} />
  </>
);
