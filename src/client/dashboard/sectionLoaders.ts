import type { MainSection } from '../sections/debts/sectionConfig.ts';

export const sectionLoaders = {
  'customers': () => import('../sections/debts/pages/CustomerDebtsSection.tsx').then((module) => ({ default: module.CustomerDebtsSection })),
  'companies': () => import('../sections/debts/pages/CompanyDebtsSection.tsx').then((module) => ({ default: module.CompanyDebtsSection })),
  'libyan-deposits': () => import('../sections/debts/pages/LibyanDepositsSection.tsx').then((module) => ({ default: module.LibyanDepositsSection })),
  'egyptian-deposits': () => import('../sections/debts/pages/EgyptianDepositsSection.tsx').then((module) => ({ default: module.EgyptianDepositsSection })),
  'collections': () => import('../sections/collections/CollectionsSection.tsx').then((module) => ({ default: module.CollectionsSection })),
  'masraweya': () => import('../sections/masraweya/MasraweyaSection.tsx').then((module) => ({ default: module.MasraweyaSection })),
  'purchases': () => import('../sections/purchases/PurchasesSection.tsx').then((module) => ({ default: module.PurchasesSection })),
  'settings': () => import('../sections/settings/SettingsOverview.tsx').then((module) => ({ default: module.SettingsOverview })),
  'treasury': () => import('../sections/treasury/TreasurySection.tsx').then((module) => ({ default: module.TreasurySection })),
  'reports': () => import('../sections/reports/ReportsSection.tsx').then((module) => ({ default: module.ReportsSection })),
};

// Warm UI code only on navigation intent, without reading account data.
export function preloadSection(section: MainSection) {
  void sectionLoaders[section]().catch(() => {
    // Normal navigation retries after a network failure.
  });
}
