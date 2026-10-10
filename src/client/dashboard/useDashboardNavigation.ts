import { useEffect, useState } from 'react';
import type { User } from '../api.ts';
import type { MainSection } from '../sections/debts/sectionConfig.ts';
import { initialDashboardSection } from './dashboardModel.ts';

const SIDEBAR_HIDDEN_KEY = 'abdo-erp-sidebar-hidden';

export function useDashboardNavigation(user: User) {
  const sectionStorageKey = `abdo-erp-active-section:${user.id}`;
  const [activeSection, setActiveSection] = useState<MainSection>(() =>
    initialDashboardSection(user, window.localStorage.getItem(sectionStorageKey)),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(
    () => window.localStorage.getItem(SIDEBAR_HIDDEN_KEY) === 'true',
  );

  useEffect(() => {
    window.localStorage.setItem(sectionStorageKey, activeSection);
  }, [activeSection, sectionStorageKey]);

  function setSidebarVisibility(hidden: boolean) {
    setSidebarHidden(hidden);
    window.localStorage.setItem(SIDEBAR_HIDDEN_KEY, String(hidden));
  }

  return {
    activeSection,
    setActiveSection,
    menuOpen,
    setMenuOpen,
    sidebarHidden,
    setSidebarVisibility,
  };
}
