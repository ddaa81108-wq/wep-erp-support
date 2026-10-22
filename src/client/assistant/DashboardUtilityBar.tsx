import { uiText } from '../i18n/language.ts';
import type { User } from '../api.ts';
import type { MainSection } from '../../shared/sections.ts';
import { NotificationCenter } from './NotificationCenter.tsx';
import type { DebtSection } from '../sections/debts/sectionConfig.ts';
import { GlobalAccountSearch } from './GlobalAccountSearch.tsx';
import { SyncStatus } from './SyncStatus.tsx';
import { Readability } from '../components/Readability.tsx';
import { Menu } from 'lucide-react';
import { SECTION_CONTRACTS } from '../../shared/sections.ts';

export function DashboardUtilityBar({
  user,
  onOpenSection,
  onOpenAccount,
  onOpenMenu,
  activeSection,
}: {
  user: User;
  activeSection: MainSection;
  onOpenSection: (section: MainSection) => void;
  onOpenAccount: (section: DebtSection, id: string) => void;
  onOpenMenu: () => void;
}) {
  const isDebtSection = activeSection === 'customers' || activeSection === 'companies'
    || activeSection === 'libyan-deposits' || activeSection === 'egyptian-deposits';
  const isUtilityHeading = isDebtSection || activeSection === 'collections' || activeSection === 'masraweya';
  return (
    <div className="dashboard-utility-bar">
      <button
        type="button"
        className="mobile-app-menu"
        onClick={onOpenMenu}
        aria-label={uiText("فتح القائمة الرئيسية")}
        title={uiText("فتح القائمة الرئيسية")}
      >
        <Menu size={19} />
      </button>
      <div className="utility-search-group">
        <GlobalAccountSearch onSelect={onOpenAccount} desktopLabel={(activeSection === 'companies' || activeSection === 'treasury') ? uiText("البحث الموحد") : undefined} />
        <Readability toolbar />
      </div>
      <div className="dashboard-section-title" aria-label={uiText("القسم الحالي: {0}", [uiText(SECTION_CONTRACTS[activeSection].title)])}>
        <div className="dashboard-section-heading" role={isUtilityHeading ? 'heading' : undefined} aria-level={isUtilityHeading ? 1 : undefined}>{uiText(SECTION_CONTRACTS[activeSection].title)}</div>
      </div>
      <div className="dashboard-utility-actions">
        <SyncStatus detailed={activeSection === 'customers'} />
        <NotificationCenter user={user} onOpenSection={onOpenSection} />
      </div>
    </div>
  );
}
