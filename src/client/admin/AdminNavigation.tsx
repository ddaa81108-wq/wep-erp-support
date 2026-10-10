import {
  Building2,
  Calculator,
  ClipboardCheck,
  Settings,
  ShoppingCart,
  Users,
  WalletCards,
  FileText,
} from 'lucide-react';
import type { MainSection } from '../sections/debts/sectionConfig.ts';

type Props = { active: MainSection; open: (section: MainSection) => void };

export function AdminNavigation({ active, open }: Props) {
  return (
    <nav>
      <button className={active === 'customers' ? 'active' : ''} onClick={() => open('customers')}>
        <Users size={20} />
        قسم ديون العملاء
      </button>
      <button className={active === 'companies' ? 'active' : ''} onClick={() => open('companies')}>
        <Building2 size={20} />
        قسم ديون الشركات
      </button>
      <button
        className={active === 'libyan-deposits' ? 'active' : ''}
        onClick={() => open('libyan-deposits')}
      >
        <WalletCards size={20} />
        أمانات ليبية
      </button>
      <button
        className={active === 'egyptian-deposits' ? 'active' : ''}
        onClick={() => open('egyptian-deposits')}
      >
        <WalletCards size={20} />
        أمانات مصرية
      </button>
      <button className={active === 'collections' ? 'active' : ''} onClick={() => open('collections')}>
        <ClipboardCheck size={20} />
        قسم استلامات الديون
      </button>
      <button className={active === 'masraweya' ? 'active' : ''} onClick={() => open('masraweya')}>
        <Calculator size={20} />
        صفحة المصراوية
      </button>
      <button className={active === 'purchases' ? 'active' : ''} onClick={() => open('purchases')}>
        <ShoppingCart size={20} />
        قسم المشتريات
      </button>
      <button className={active === 'settings' ? 'active' : ''} onClick={() => open('settings')}>
        <Settings size={20} />
        الإعدادات
      </button>
      <button className={active === 'treasury' ? 'active' : ''} onClick={() => open('treasury')}>
        <WalletCards size={20} />
        الخزينة
      </button>
      <button className={active === 'reports' ? 'active' : ''} onClick={() => open('reports')}>
        <FileText size={20} />
        التقارير الذكية
      </button>
    </nav>
  );
}
