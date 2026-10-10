import { LogOut, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import type { User } from '../api.ts';
import { AdminNavigation } from '../admin/AdminNavigation.tsx';
import { EmployeeNavigation } from '../employee/EmployeeNavigation.tsx';
import type { MainSection } from '../sections/debts/sectionConfig.ts';
import { ThemeToggle, type Theme } from '../components/ThemeToggle.tsx';

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
  const open = (section: MainSection) => {
    onOpenSection(section);
    onCloseMenu();
  };

  return <>
    <aside className={`sidebar ${menuOpen ? 'open' : ''} ${hidden ? 'hidden' : ''}`}>
      <div className="sidebar-identity">
        <span className="brand-mark">ع</span>
        <div className="identity-app"><strong>عبده ERP</strong><small>محلي</small></div>
        <div className="identity-user"><strong>{user.displayName}</strong><small>{user.role === 'admin' ? 'مدير النظام' : user.username}</small></div>
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
