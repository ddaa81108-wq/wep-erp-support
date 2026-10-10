import type { ReactNode } from 'react';
import type { MainSection } from '../sections/debts/sectionConfig.ts';
import { CollectionsPage } from './pages/CollectionsPage.tsx';
import { CompanyDebtsPage } from './pages/CompanyDebtsPage.tsx';
import { CustomerDebtsPage } from './pages/CustomerDebtsPage.tsx';
import { EgyptianDepositsPage } from './pages/EgyptianDepositsPage.tsx';
import { LibyanDepositsPage } from './pages/LibyanDepositsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { MasraweyaPage } from './pages/MasraweyaPage.tsx';
import { PurchasesPage } from './pages/PurchasesPage.tsx';
import { TreasuryPage } from './pages/TreasuryPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';

type Props = {
  section: MainSection | null;
  children: ReactNode;
};

export function AdminSectionRouter({ section, children }: Props) {
  if (section === null) return children;
  if (section === 'settings') return <SettingsPage>{children}</SettingsPage>;
  if (section === 'collections') return <CollectionsPage>{children}</CollectionsPage>;
  if (section === 'masraweya') return <MasraweyaPage>{children}</MasraweyaPage>;
  if (section === 'purchases') return <PurchasesPage>{children}</PurchasesPage>;
  if (section === 'treasury') return <TreasuryPage>{children}</TreasuryPage>;
  if (section === 'reports') return <ReportsPage>{children}</ReportsPage>;
  if (section === 'companies') return <CompanyDebtsPage>{children}</CompanyDebtsPage>;
  if (section === 'libyan-deposits') return <LibyanDepositsPage>{children}</LibyanDepositsPage>;
  if (section === 'egyptian-deposits') return <EgyptianDepositsPage>{children}</EgyptianDepositsPage>;
  return <CustomerDebtsPage>{children}</CustomerDebtsPage>;
}
