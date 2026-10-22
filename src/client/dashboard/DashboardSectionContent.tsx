import { uiText } from '../i18n/language.ts';
import { sectionLoaders } from './sectionLoaders.ts';
import { SectionSnapshotsProvider } from './sectionSnapshots.tsx';
import { lazy, Suspense } from 'react';
import type { User } from '../api.ts';
import { AdminSectionRouter } from '../admin/AdminSectionRouter.tsx';
import type { MainSection } from '../sections/debts/sectionConfig.ts';
import type { DebtPageProps } from '../sections/debts/pages/debtPageTypes.ts';

const CustomerDebtsSection = lazy(sectionLoaders['customers']);
const CompanyDebtsSection = lazy(sectionLoaders['companies']);
const LibyanDepositsSection = lazy(sectionLoaders['libyan-deposits']);
const EgyptianDepositsSection = lazy(sectionLoaders['egyptian-deposits']);
const CollectionsSection = lazy(sectionLoaders['collections']);
const MasraweyaSection = lazy(sectionLoaders['masraweya']);
const PurchasesSection = lazy(sectionLoaders['purchases']);
const SettingsOverview = lazy(sectionLoaders['settings']);
const TreasurySection = lazy(sectionLoaders['treasury']);
const ReportsSection = lazy(sectionLoaders['reports']);

function SectionLoading() {
  return <div className="empty"><div className="spinner" /><p>{uiText("جارٍ فتح القسم…")}</p></div>;
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
    <SectionSnapshotsProvider key={`${user.id}:${user.role}:${user.permissions?.join('|') ?? ''}`}>
    <AdminSectionRouter section={user.role === 'admin' ? activeSection : null}>
      <Suspense fallback={<SectionLoading />}>{content}</Suspense>
    </AdminSectionRouter>
    </SectionSnapshotsProvider>
  );
}
