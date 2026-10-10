import { lazy, Suspense } from 'react';
import type { User } from '../api.ts';
import { AdminSectionRouter } from '../admin/AdminSectionRouter.tsx';
import type { MainSection } from '../sections/debts/sectionConfig.ts';
import type { DebtPageProps } from '../sections/debts/pages/debtPageTypes.ts';

const CustomerDebtsSection = lazy(() => import('../sections/debts/pages/CustomerDebtsSection.tsx').then((module) => ({ default: module.CustomerDebtsSection })));
const CompanyDebtsSection = lazy(() => import('../sections/debts/pages/CompanyDebtsSection.tsx').then((module) => ({ default: module.CompanyDebtsSection })));
const LibyanDepositsSection = lazy(() => import('../sections/debts/pages/LibyanDepositsSection.tsx').then((module) => ({ default: module.LibyanDepositsSection })));
const EgyptianDepositsSection = lazy(() => import('../sections/debts/pages/EgyptianDepositsSection.tsx').then((module) => ({ default: module.EgyptianDepositsSection })));
const CollectionsSection = lazy(() => import('../sections/collections/CollectionsSection.tsx').then((module) => ({ default: module.CollectionsSection })));
const MasraweyaSection = lazy(() => import('../sections/masraweya/MasraweyaSection.tsx').then((module) => ({ default: module.MasraweyaSection })));
const PurchasesSection = lazy(() => import('../sections/purchases/PurchasesSection.tsx').then((module) => ({ default: module.PurchasesSection })));
const SettingsOverview = lazy(() => import('../sections/settings/SettingsOverview.tsx').then((module) => ({ default: module.SettingsOverview })));
const TreasurySection = lazy(() => import('../sections/treasury/TreasurySection.tsx').then((module) => ({ default: module.TreasurySection })));
const ReportsSection = lazy(() => import('../sections/reports/ReportsSection.tsx').then((module) => ({ default: module.ReportsSection })));

function SectionLoading() {
  return <div className="empty"><div className="spinner" /><p>جارٍ فتح القسم…</p></div>;
}

type DashboardSectionContentProps = {
  activeSection: MainSection;
  user: User;
  debtPageProps: DebtPageProps;
  onOpenAudit: () => void;
  onOpenFinancialLedger: () => void;
  onOpenSystemSettings: () => void;
};

export function DashboardSectionContent({
  activeSection,
  user,
  debtPageProps,
  onOpenAudit,
  onOpenFinancialLedger,
  onOpenSystemSettings,
}: DashboardSectionContentProps) {
  let content = <CustomerDebtsSection {...debtPageProps} />;

  if (activeSection === 'companies') {
    content = <CompanyDebtsSection {...debtPageProps} />;
  } else if (activeSection === 'libyan-deposits') {
    content = <LibyanDepositsSection {...debtPageProps} />;
  } else if (activeSection === 'egyptian-deposits') {
    content = <EgyptianDepositsSection {...debtPageProps} />;
  } else if (activeSection === 'settings') {
    content = (
      <SettingsOverview
        user={user}
        onOpenAudit={onOpenAudit}
        onOpenFinancialLedger={onOpenFinancialLedger}
        onOpenSystemSettings={onOpenSystemSettings}
      />
    );
  } else if (activeSection === 'collections') {
    content = <CollectionsSection user={user} />;
  } else if (activeSection === 'masraweya') {
    content = <MasraweyaSection user={user} />;
  } else if (activeSection === 'purchases') {
    content = <PurchasesSection user={user} />;
  } else if (activeSection === 'treasury') {
    content = <TreasurySection user={user} />;
  } else if (activeSection === 'reports') {
    content = <ReportsSection />;
  }

  return (
    <AdminSectionRouter section={user.role === 'admin' ? activeSection : null}>
      <Suspense fallback={<SectionLoading />}>{content}</Suspense>
    </AdminSectionRouter>
  );
}
