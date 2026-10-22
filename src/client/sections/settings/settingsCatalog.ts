import { uiText } from '../../i18n/language.ts';
export type SettingsModuleKey =
  | 'accounts'
  | 'general'
  | 'audit'
  | 'ledger'
  | 'security'
  | 'backup';

export type SettingsModule = {
  key: SettingsModuleKey;
  title: string;
  description: string;
  state: 'ready' | 'protected';
};

export const SETTINGS_MODULES: readonly SettingsModule[] = [
  {
    key: 'accounts',
    title: uiText("الموظفون والإداريون"),
    description: uiText("إنشاء الحسابات، الموافقات، كلمات المرور وصلاحية كاملة لكل قسم محدد."),
    state: 'ready',
  },
  {
    key: 'general',
    title: uiText("إعدادات المنظومة"),
    description: uiText("هوية المنظومة، التوقيت وسياسة ظهور الأقسام المقفلة للموظفين."),
    state: 'ready',
  },
  {
    key: 'audit',
    title: uiText("سجل التدقيق"),
    description: uiText("من أضاف أو عدّل أو اعتمد، مع الوقت والنتيجة ورقم التتبع."),
    state: 'ready',
  },
  {
    key: 'ledger',
    title: uiText("سجل الأستاذ المالي"),
    description: uiText("قراءة موحدة للقيود المالية من جميع الأقسام دون تعديل الأرصدة."),
    state: 'ready',
  },
  {
    key: 'security',
    title: uiText("مركز التشغيل والأمان"),
    description: uiText("حالة قاعدة البيانات وإصدارها، الأجهزة والجلسات، الأخطاء وسلامة التشغيل."),
    state: 'protected',
  },
  {
    key: 'backup',
    title: uiText("النسخ الاحتياطي والاستعادة"),
    description: uiText("خطة النسخ، نطاق الحماية، التحقق، اختبار الاستعادة وسياسة الاحتفاظ."),
    state: 'protected',
  },
];
