import { useEffect, useState } from 'react';
import { flushBeforeNavigation } from './navigationGuards.ts';
import { api, type User } from '../api.ts';
import { debtSectionText, type DebtSection } from '../sections/debts/sectionConfig.ts';
import { DashboardSidebar } from './DashboardSidebar.tsx';
import { DashboardOverlays } from './DashboardOverlays.tsx';
import type { Theme } from '../components/ThemeToggle.tsx';
import { permissionPrefixFor } from '../sections/debts/debtSectionUtils.ts';
import { dashboardErrorText, debtSectionFor } from './dashboardModel.ts';
import { useDashboardNavigation } from './useDashboardNavigation.ts';
import { DashboardSectionContent } from './DashboardSectionContent.tsx';
import { useCollectionRouting } from './useCollectionRouting.ts';
import { useDebtAccounts } from './useDebtAccounts.ts';
import type { DashboardDialog, DashboardNotice } from './dashboardTypes.ts';
import { DashboardUtilityBar } from '../assistant/DashboardUtilityBar.tsx';
import type { DebtPageProps } from '../sections/debts/pages/debtPageTypes.ts';

export function Dashboard({
  user,
  theme,
  onThemeToggle,
  onLogout,
}: {
  user: User;
  theme: Theme;
  onThemeToggle: () => void;
  onLogout: () => void;
}) {
  const {
    activeSection,
    setActiveSection,
    menuOpen: menu,
    setMenuOpen: setMenu,
    sidebarHidden,
    setSidebarVisibility,
    restoreSection,
  } = useDashboardNavigation(user);
  const [dialog, setDialog] = useState<DashboardDialog>(null);
  const [notice, setNotice] = useState<DashboardNotice>(null);
  const [pendingAccount, setPendingAccount] = useState<{ section: DebtSection; id: string } | null>(null);
  const debtSection: DebtSection = debtSectionFor(activeSection);
  const permissionPrefix = permissionPrefixFor(debtSection);
  const canRead = user.role === 'admin' || user.permissions?.includes(`${permissionPrefix}.read`) === true;
  const canWrite = user.role === 'admin' || user.permissions?.includes(`${permissionPrefix}.write`) === true;
  const labels = debtSectionText[debtSection];
  const debtAccounts = useDebtAccounts({ activeSection, debtSection, canRead, onNotice: setNotice });
  useEffect(() => {
    if (!window.history.state?.erpGuard) {
      window.history.replaceState({ erpGuard: true, erpRoot: true, erpSection: activeSection }, '', '/erp');
      window.history.pushState({ erpGuard: true, erpRoot: true, erpSection: activeSection }, '', '/erp');
    }
    const onBack = (event: PopStateEvent) => {
      if (dialog) {
        setDialog(null);
        window.history.pushState({ erpGuard: true, erpSection: activeSection }, '', '/erp');
      } else if (debtAccounts.ledger) {
        debtAccounts.closeLedger();
        window.history.pushState({ erpGuard: true, erpSection: activeSection }, '', '/erp');
      } else if (menu) {
        setMenu(false);
        window.history.pushState({ erpGuard: true, erpSection: activeSection }, '', '/erp');
      } else if (event.state?.erpGuard && event.state?.erpRoot) {
        const leave = window.confirm('هل تريد تسجيل الخروج من المنظومة؟\nاضغط "إلغاء" للبقاء داخل الموقع.');
        if (leave) {
          void logout();
        } else {
          window.history.pushState({ erpGuard: true, erpRoot: true, erpSection: activeSection }, '', '/erp');
        }
      } else if (event.state?.erpGuard && event.state?.erpSection) {
        restoreSection(event.state.erpSection);
      } else {
        const leave = window.confirm('هل تريد تسجيل الخروج من المنظومة؟\nاضغط "إلغاء" للبقاء داخل الموقع.');
        if (leave) {
          void logout();
        } else {
          window.history.pushState({ erpGuard: true, erpRoot: true, erpSection: activeSection }, '', '/erp');
        }
      }
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, [activeSection, debtAccounts.closeLedger, debtAccounts.ledger, dialog, menu, restoreSection]);
  const {
    routing,
    selectedCustomers,
    assignees,
    assigneeId,
    setAssigneeId,
    startRouting,
    cancelRouting,
    selectCustomer,
    confirmRouting,
    resetRouting,
  } = useCollectionRouting({
    debtSection,
    refreshAccounts: debtAccounts.refreshAfterMutation,
    onNotice: setNotice,
  });
  useEffect(() => {
    resetRouting();
  }, [activeSection, resetRouting]);
  useEffect(() => {
    if (!pendingAccount || activeSection !== pendingAccount.section || debtSection !== pendingAccount.section || !canRead) return;
    void debtAccounts.loadLedger(pendingAccount.id)
      .then(() => setPendingAccount(null))
      .catch((error) => { setPendingAccount(null); setNotice({ kind: 'error', text: dashboardErrorText(error) }); });
  }, [activeSection, canRead, debtAccounts, debtSection, pendingAccount]);
  async function logout() {
    if (!(await flushBeforeNavigation())) return;
    try {
      await api.logout();
    } finally {
      onLogout();
    }
  }
  const debtPageProps: DebtPageProps = {
    isAdmin: user.role === 'admin',
    customers: debtAccounts.customers,
    visibleCustomers: debtAccounts.visibleCustomers,
    totalDebt: debtAccounts.listSummary.netBalance,
    activeCards: debtAccounts.listSummary.activeCards,
    pendingReviewCount: debtAccounts.listSummary.pendingReviewCount,
    onReviewZero: debtAccounts.reviewZero,
    totalItems: debtAccounts.listSummary.totalItems,
    canRead,
    canWrite,
    loading: debtAccounts.loading,
    loadingMore: debtAccounts.loadingMore,
    hasMore: debtAccounts.hasMore,
    query: debtAccounts.query,
    filter: debtAccounts.filter,
    notice,
    routing,
    selectedCustomers,
    assignees,
    assigneeId,
    onOpenMenu: () => setMenu(true),
    onQueryChange: debtAccounts.setQuery,
    onFilterChange: debtAccounts.setFilter,
    onDismissNotice: () => setNotice(null),
    onAdd: () => setDialog('customer'),
    onStartRouting: () => void startRouting(),
    onCancelRouting: cancelRouting,
    onAssigneeChange: setAssigneeId,
    onCustomerSelection: selectCustomer,
    onConfirmRouting: () => void confirmRouting(),
    onOpenLedger: (id) => void debtAccounts.loadLedger(id)
      .catch((error) => setNotice({ kind: 'error', text: dashboardErrorText(error) })),
    onTogglePinned: (customer) => void debtAccounts.togglePinned(customer),
    onLoadMore: () => void debtAccounts.loadMoreCustomers(),
  };
  return (
    <div className={`app-shell ${sidebarHidden ? 'sidebar-hidden' : ''}`}>
      <DashboardSidebar
        user={user}
        theme={theme}
        activeSection={activeSection}
        menuOpen={menu}
        hidden={sidebarHidden}
        onOpenSection={setActiveSection}
        onHide={() => setSidebarVisibility(true)}
        onReveal={() => setSidebarVisibility(false)}
        onCloseMenu={() => setMenu(false)}
        onThemeToggle={onThemeToggle}
        onLogout={() => void logout()}
      />
      <main className={`workspace section-${debtSection} active-section-${activeSection}`}>
        <DashboardUtilityBar user={user} activeSection={activeSection} onOpenSection={setActiveSection} onOpenMenu={() => setMenu(true)} onOpenAccount={(section, id) => {
          setPendingAccount({ section, id }); setActiveSection(section);
        }} />
        <DashboardSectionContent
          activeSection={activeSection}
          user={user}
          onOpenAudit={() => setDialog('audit')}
          onOpenFinancialLedger={() => setDialog('financial-ledger')}
          onOpenSystemSettings={() => setDialog('system-settings')}
          debtPageProps={debtPageProps}
        />
      </main>
      <DashboardOverlays
        section={debtSection}
        ledger={debtAccounts.ledger}
        dialog={dialog}
        canWrite={canWrite}
        onCloseLedger={debtAccounts.closeLedger}
        onRefreshLedger={debtAccounts.refreshOpenLedger}
        onLoadOlder={debtAccounts.loadOlderLedger}
        onNotice={setNotice}
        onCloseDialog={() => {
          setDialog(null);
        }}
        onCustomerCreated={(customer) => {
          setDialog(null);
          debtAccounts.mergeCustomer(customer);
          void debtAccounts.refreshCustomer(customer.id);
          void debtAccounts.loadLedger(customer.id);
          setNotice({ kind: 'success', text: `تم إنشاء كارت ${labels.singular} وسجله الدائم.` });
        }}
        onExistingCustomer={(customerId) => {
          setDialog(null);
          void debtAccounts.loadLedger(customerId);
        }}
      />
    </div>
  );
}
