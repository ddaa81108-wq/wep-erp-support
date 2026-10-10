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
    title: 'الموظفون والإداريون',
    description: 'إنشاء الحسابات، الموافقات، كلمات المرور وصلاحية كاملة لكل قسم محدد.',
    state: 'ready',
  },
  {
    key: 'general',
    title: 'إعدادات المنظومة',
    description: 'هوية المنظومة، التوقيت وسياسة ظهور الأقسام المقفلة للموظفين.',
    state: 'ready',
  },
  {
    key: 'audit',
    title: 'سجل التدقيق',
    description: 'من أضاف أو عدّل أو اعتمد، مع الوقت والنتيجة ورقم التتبع.',
    state: 'ready',
  },
  {
    key: 'ledger',
    title: 'سجل الأستاذ المالي',
    description: 'قراءة موحدة للقيود المالية من جميع الأقسام دون تعديل الأرصدة.',
    state: 'ready',
  },
  {
    key: 'security',
    title: 'مركز التشغيل والأمان',
    description: 'حالة قاعدة البيانات وإصدارها، الأجهزة والجلسات، الأخطاء وسلامة التشغيل.',
    state: 'protected',
  },
  {
    key: 'backup',
    title: 'النسخ الاحتياطي والاستعادة',
    description: 'خطة النسخ، نطاق الحماية، التحقق، اختبار الاستعادة وسياسة الاحتفاظ.',
    state: 'protected',
  },
];
