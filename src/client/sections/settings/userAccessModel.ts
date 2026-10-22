import { uiText } from '../../i18n/language.ts';
import type { ManagedUser } from '../../api.ts';

export type AccessLevel = 'none' | 'read' | 'manage';
type SectionAccessKey = keyof ManagedUser['sectionAccess'];

export type UserAccessConfig = {
  field: string;
  title: string;
  availableLabel: string;
  sectionAccessKey?: SectionAccessKey;
  managePermission?: string;
  readPermission: string;
  writePermissions: string[];
  hint?: string;
};

export const USER_ACCESS_CONFIG: UserAccessConfig[] = [
  {
    field: 'customerDebtsAccess',
    title: uiText("قسم ديون العملاء"),
    availableLabel: uiText("متاح بصلاحية كاملة"),
    sectionAccessKey: 'customerDebts',
    readPermission: 'debts.read',
    writePermissions: ['debts.write'],
    hint: uiText("عند الإتاحة يعمل الموظف داخل القسم بكامل وظائفه، دون فتح إعدادات النظام."),
  },
  {
    field: 'companyDebtsAccess',
    title: uiText("قسم ديون الشركات"),
    availableLabel: uiText("متاح بصلاحية كاملة"),
    sectionAccessKey: 'companyDebts',
    readPermission: 'companies.read',
    writePermissions: ['companies.write'],
    hint: uiText("صلاحية مستقلة تمامًا عن قسم ديون العملاء."),
  },
  {
    field: 'libyanDepositsAccess',
    title: uiText("أمانات ليبية"),
    availableLabel: uiText("متاح بصلاحية كاملة"),
    sectionAccessKey: 'libyanDeposits',
    readPermission: 'libyan_deposits.read',
    writePermissions: ['libyan_deposits.write'],
  },
  {
    field: 'egyptianDepositsAccess',
    title: uiText("أمانات مصرية"),
    availableLabel: uiText("متاح بصلاحية كاملة"),
    sectionAccessKey: 'egyptianDeposits',
    readPermission: 'egyptian_deposits.read',
    writePermissions: ['egyptian_deposits.write'],
  },
  {
    field: 'collectionsAccess',
    title: uiText("قسم استلامات الديون"),
    availableLabel: uiText("متاح بصلاحية كاملة للموظف"),
    managePermission: 'collections.write',
    readPermission: 'collections.read',
    writePermissions: ['collections.write'],
    hint: uiText("اعتماد الإدارة واستلام النقدية يظلان للإدارة فقط لأنهما وظيفتان إداريتان."),
  },
  {
    field: 'masraweyaAccess',
    title: uiText("صفحة المصراوية"),
    availableLabel: uiText("متاحة بصلاحية كاملة"),
    sectionAccessKey: 'masraweya',
    readPermission: 'masraweya.read',
    writePermissions: ['masraweya.write'],
  },
  {
    field: 'purchasesAccess',
    title: uiText("قسم المشتريات"),
    availableLabel: uiText("متاح بصلاحية كاملة"),
    sectionAccessKey: 'purchases',
    readPermission: 'purchases.read',
    writePermissions: ['purchases.write', 'purchases.finalize'],
    hint: uiText("الصلاحية تشمل البيان وسمسم وترحيل اليوم."),
  },
  {
    field: 'treasuryAccess',
    title: uiText("الخزينة"),
    availableLabel: uiText("متاحة بصلاحية كاملة"),
    sectionAccessKey: 'treasury',
    readPermission: 'treasury.read',
    writePermissions: ['treasury.write'],
    hint: uiText("النقد النشط لا يتغير إلا من سجل الدخول والخروج داخل الخزينة."),
  },
  {
    field: 'reportsAccess',
    title: uiText("التقارير الذكية"),
    availableLabel: uiText("متاحة للقراءة"),
    sectionAccessKey: 'reports',
    readPermission: 'reports.read',
    writePermissions: [],
    hint: uiText("التقارير قراءة وتحليل فقط ولا تسمح بتعديل أي رصيد أو معاملة."),
  },
];

export function accessLevel(form: FormData, field: string): AccessLevel {
  const value = String(form.get(field) ?? 'none');
  return value === 'manage' || value === 'read' ? value : 'none';
}

export function selectedUserPermissions(form: FormData) {
  return USER_ACCESS_CONFIG.flatMap((config) => {
    const level = accessLevel(form, config.field);
    if (level === 'manage') return [config.readPermission, ...config.writePermissions];
    if (level === 'read') return [config.readPermission];
    return [];
  });
}

export function selectedSectionAccess(form: FormData) {
  return {
    customerDebtsAccess: accessLevel(form, 'customerDebtsAccess'),
    companyDebtsAccess: accessLevel(form, 'companyDebtsAccess'),
    libyanDepositsAccess: accessLevel(form, 'libyanDepositsAccess'),
    egyptianDepositsAccess: accessLevel(form, 'egyptianDepositsAccess'),
    masraweyaAccess: accessLevel(form, 'masraweyaAccess'),
    purchasesAccess: accessLevel(form, 'purchasesAccess'),
    treasuryAccess: accessLevel(form, 'treasuryAccess'),
    reportsAccess: accessLevel(form, 'reportsAccess'),
  };
}

export function currentAccess(user: ManagedUser | null, config: UserAccessConfig): AccessLevel {
  if (!user) return 'none';
  if (config.sectionAccessKey) return user.sectionAccess[config.sectionAccessKey];
  return config.managePermission && user.permissions.includes(config.managePermission) ? 'manage' : 'none';
}
