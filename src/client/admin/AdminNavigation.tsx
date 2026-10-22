import { uiText } from '../i18n/language.ts';
import { preloadSection } from '../dashboard/sectionLoaders.ts';
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
      <button className={active === 'customers' ? 'active' : ''} onPointerEnter={() => preloadSection('customers')} onFocus={() => preloadSection('customers')} onPointerDown={() => preloadSection('customers')} onClick={() => open('customers')}>
        <Users size={20} />
        {uiText("قسم ديون العملاء")}</button>
      <button className={active === 'collections' ? 'active' : ''} onPointerEnter={() => preloadSection('collections')} onFocus={() => preloadSection('collections')} onPointerDown={() => preloadSection('collections')} onClick={() => open('collections')}>
        <ClipboardCheck size={20} />
        {uiText("قسم استلامات الديون")}</button>
      <button className={active === 'companies' ? 'active' : ''} onPointerEnter={() => preloadSection('companies')} onFocus={() => preloadSection('companies')} onPointerDown={() => preloadSection('companies')} onClick={() => open('companies')}>
        <Building2 size={20} />
        {uiText("قسم ديون الشركات")}</button>
      <button
        className={active === 'libyan-deposits' ? 'active' : ''}
        onPointerEnter={() => preloadSection('libyan-deposits')} onFocus={() => preloadSection('libyan-deposits')} onPointerDown={() => preloadSection('libyan-deposits')} onClick={() => open('libyan-deposits')}
      >
        <WalletCards size={20} />
        {uiText("أمانات ليبية")}</button>
      <button
        className={active === 'egyptian-deposits' ? 'active' : ''}
        onPointerEnter={() => preloadSection('egyptian-deposits')} onFocus={() => preloadSection('egyptian-deposits')} onPointerDown={() => preloadSection('egyptian-deposits')} onClick={() => open('egyptian-deposits')}
      >
        <WalletCards size={20} />
        {uiText("أمانات مصرية")}</button>
      <button className={active === 'masraweya' ? 'active' : ''} onPointerEnter={() => preloadSection('masraweya')} onFocus={() => preloadSection('masraweya')} onPointerDown={() => preloadSection('masraweya')} onClick={() => open('masraweya')}>
        <Calculator size={20} />
        {uiText("صفحة المصراوية")}</button>
      <button className={active === 'purchases' ? 'active' : ''} onPointerEnter={() => preloadSection('purchases')} onFocus={() => preloadSection('purchases')} onPointerDown={() => preloadSection('purchases')} onClick={() => open('purchases')}>
        <ShoppingCart size={20} />
        {uiText("قسم المشتريات")}</button>
      <button className={active === 'treasury' ? 'active' : ''} onPointerEnter={() => preloadSection('treasury')} onFocus={() => preloadSection('treasury')} onPointerDown={() => preloadSection('treasury')} onClick={() => open('treasury')}>
        <WalletCards size={20} />
        {uiText("الخزينة")}</button>
      <button className={active === 'reports' ? 'active' : ''} onPointerEnter={() => preloadSection('reports')} onFocus={() => preloadSection('reports')} onPointerDown={() => preloadSection('reports')} onClick={() => open('reports')}>
        <FileText size={20} />
        {uiText("التقارير الذكية")}</button>
      <button className={active === 'settings' ? 'active' : ''} onPointerEnter={() => preloadSection('settings')} onFocus={() => preloadSection('settings')} onPointerDown={() => preloadSection('settings')} onClick={() => open('settings')}>
        <Settings size={20} />
        {uiText("الإعدادات")}</button>
    </nav>
  );
}
