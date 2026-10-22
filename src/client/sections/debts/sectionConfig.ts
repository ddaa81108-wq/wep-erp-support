import { uiText } from '../../i18n/language.ts';
export type { DebtSection, MainSection } from '../../../shared/sections.ts';

export const debtSectionText = {
  customers: {
    title: uiText("قسم ديون العملاء"),
    singular: uiText("العميل"),
    plural: uiText("العملاء"),
    add: uiText("إضافة عميل"),
    ledgerTitle: uiText("السجل الموحد للعميل"),
    trustLabel: uiText("أمانة للعميل"),
  },
  companies: {
    title: uiText("قسم ديون الشركات"),
    singular: uiText("الشركة"),
    plural: uiText("الشركات"),
    add: uiText("إضافة شركة"),
    ledgerTitle: uiText("السجل الموحد للشركة"),
    trustLabel: uiText("أمانة للشركة"),
  },
  'libyan-deposits': {
    title: uiText("أمانات ليبية"),
    singular: uiText("العميل"),
    plural: uiText("حسابات الأمانات"),
    add: uiText("إضافة أمانة"),
    ledgerTitle: uiText("سجل الأمانة الليبية"),
    trustLabel: uiText("أمانة للعميل"),
    currency: uiText("د.ل"),
    increase: uiText("دخول", [], 'ledger'),
    decrease: uiText("خروج"),
    positiveLabel: uiText("أمانة للعميل"),
    negativeLabel: uiText("دين على العميل"),
  },
  'egyptian-deposits': {
    title: uiText("أمانات مصرية"),
    singular: uiText("العميل"),
    plural: uiText("حسابات الأمانات"),
    add: uiText("إضافة أمانة"),
    ledgerTitle: uiText("سجل الأمانة المصرية"),
    trustLabel: uiText("دين علينا للعميل"),
    currency: uiText("ج.م"),
    increase: uiText("إيداع مصري"),
    decrease: uiText("سحب مصري"),
    positiveLabel: uiText("لصالح المنظومة — دين على العميل"),
    negativeLabel: uiText("دين علينا للعميل"),
  },
} as const;
