import { Building2, UserRound, LogOut, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type User } from '../api.ts';
import { AdminNavigation } from '../admin/AdminNavigation.tsx';
import { EmployeeNavigation } from '../employee/EmployeeNavigation.tsx';
import type { MainSection } from '../sections/debts/sectionConfig.ts';
import { ThemeToggle, type Theme } from '../components/ThemeToggle.tsx';
import { useSidebarPalette } from './useSidebarPalette.ts';

type Props = {
  user: User;
  theme: Theme;
  activeSection: MainSection;
  menuOpen: boolean;
  hidden: boolean;
  onOpenSection: (section: MainSection) => void;
  onHide: () => void;
  onReveal: () => void;
  onCloseMenu: () => void;
  onThemeToggle: () => void;
  onLogout: () => void;
};

export function DashboardSidebar({
  user,
  theme,
  activeSection,
  menuOpen,
  hidden,
  onOpenSection,
  onHide,
  onReveal,
  onCloseMenu,
  onThemeToggle,
  onLogout,
}: Props) {
  const palette = useSidebarPalette();
  const [systemName, setSystemName] = useState('VIB Abdo Company');
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void api.organizationBranding().then(result => {
        if (active) setSystemName(['عبده ERP', 'عبده ERP المحلي', 'Abdo ERP Local'].includes(result.systemName.trim()) ? 'VIB Abdo Company' : result.systemName);
      }).catch(() => { /* Keep the last known name during a connection failure. */ });
    };
    refresh();
    window.addEventListener('abdo:organization-settings-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('abdo:organization-settings-changed', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [user.id]);
  const open = (section: MainSection) => {
    onOpenSection(section);
    onCloseMenu();
  };

  return <>
    <aside data-palette={activeSection === 'egyptian-deposits' ? 'gold' : activeSection === 'companies' ? 'blue' : activeSection === 'customers' || activeSection === 'purchases' ? 'gold' : palette} data-appearance={activeSection === 'customers' ? 'customer-gold-two' : activeSection === 'purchases' ? 'purchases-compact' : activeSection === 'companies' ? 'company-royal' : activeSection === 'egyptian-deposits' ? 'customer-gold-two' : undefined} className={`sidebar ${menuOpen ? 'open' : ''} ${hidden ? 'hidden' : ''}`}>
      <div className="sidebar-identity">
        <span className="brand-mark" aria-hidden="true">
          VIB
        </span>
        <div className="identity-app"><Building2 aria-hidden="true" size={19} /><strong title={systemName}>{systemName}</strong><small>محلي</small></div>
        <div className="identity-user"><span className="identity-avatar" aria-hidden="true"><UserRound size={22} /></span><div className="identity-user-copy"><strong title={user.displayName}>{user.displayName}</strong><small>{user.role === 'admin' ? 'مدير النظام' : user.username}</small></div></div>
        <button className="sidebar-hide-button" onClick={onHide} aria-label="إخفاء الشريط الجانبي" title="إخفاء الشريط الجانبي"><PanelRightClose size={17} /></button>
        <button className="sidebar-mobile-close" onClick={onCloseMenu} aria-label="إغلاق القائمة الرئيسية" title="إغلاق القائمة الرئيسية"><X size={18} /></button>
      </div>
      {user.role === 'admin'
        ? <AdminNavigation active={activeSection} open={open} />
        : <EmployeeNavigation user={user} active={activeSection} open={open} />}
      <div className="sidebar-controls">
        <ThemeToggle theme={theme} onToggle={onThemeToggle} />
        <button className="logout-button" onClick={onLogout}><LogOut size={17} /><span>تسجيل الخروج</span></button>
      </div>
    </aside>
    {hidden && <button className="sidebar-reveal" onClick={onReveal} aria-label="إظهار الشريط الجانبي" title="إظهار الشريط الجانبي"><PanelRightOpen size={18} /><span>إظهار القائمة</span></button>}
    {menuOpen && <button className="drawer-shade" onClick={onCloseMenu} aria-label="إغلاق القائمة" />}
  </>;
}




