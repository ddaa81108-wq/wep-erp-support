import { preloadSection } from '../dashboard/sectionLoaders.ts';
import { Building2, Calculator, ClipboardCheck, FileText, LockKeyhole, ShoppingCart, Users, WalletCards, type LucideIcon } from 'lucide-react';
import type { User } from '../api.ts';
import type { MainSection } from '../sections/debts/sectionConfig.ts';
import { employeeHasPermission } from './employeeNavigationModel.ts';

export { employeeCanOpenSection, initialEmployeeSection } from './employeeNavigationModel.ts';

type Props = { user: User; active: MainSection; open: (section: MainSection) => void };
type MenuItem = { section: MainSection; permission: string; label: string; icon: LucideIcon };

const ITEMS: readonly MenuItem[] = [
  { section: 'customers', permission: 'debts.read', label: 'قسم ديون العملاء', icon: Users },
  { section: 'collections', permission: 'collections.read', label: 'قسم استلامات الديون', icon: ClipboardCheck },
  { section: 'companies', permission: 'companies.read', label: 'قسم ديون الشركات', icon: Building2 },
  { section: 'libyan-deposits', permission: 'libyan_deposits.read', label: 'أمانات ليبية', icon: WalletCards },
  { section: 'egyptian-deposits', permission: 'egyptian_deposits.read', label: 'أمانات مصرية', icon: WalletCards },
  { section: 'masraweya', permission: 'masraweya.read', label: 'صفحة المصراوية', icon: Calculator },
  { section: 'purchases', permission: 'purchases.read', label: 'قسم المشتريات', icon: ShoppingCart },
  { section: 'treasury', permission: 'treasury.read', label: 'الخزينة', icon: WalletCards },
  { section: 'reports', permission: 'reports.read', label: 'التقارير الذكية', icon: FileText },
];

export function EmployeeNavigation({ user, active, open }: Props) {
  return (
    <nav aria-label="أقسام المنظومة">
      {ITEMS.map((item) => {
        const allowed = employeeHasPermission(user, item.permission);
        const Icon = item.icon;
        return (
          <button
            key={item.section}
            className={`${active === item.section ? 'active' : ''} ${allowed ? '' : 'locked'}`}
            onPointerEnter={() => allowed && preloadSection(item.section)}
            onFocus={() => allowed && preloadSection(item.section)}
            onPointerDown={() => allowed && preloadSection(item.section)}
            onClick={() => allowed && open(item.section)}
            disabled={!allowed}
            title={allowed ? item.label : 'القسم غير مصرح لهذا الحساب'}
          >
            <Icon size={20} />
            <span>{item.label}</span>
            {!allowed && <LockKeyhole className="section-lock" size={14} />}
          </button>
        );
      })}
    </nav>
  );
}
