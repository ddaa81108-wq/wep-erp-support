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
    title: 'قسم ديون العملاء',
    availableLabel: 'متاح بصلاحية كاملة',
    sectionAccessKey: 'customerDebts',
    readPermission: 'debts.read',
    writePermissions: ['debts.write'],
    hint: 'عند الإتاحة يعمل الموظف داخل القسم بكامل وظائفه، دون فتح إعدادات النظام.',
  },
  {
    field: 'companyDebtsAccess',
    title: 'قسم ديون الشركات',
    availableLabel: 'متاح بصلاحية كاملة',
    sectionAccessKey: 'companyDebts',
    readPermission: 'companies.read',
    writePermissions: ['companies.write'],
    hint: 'صلاحية مستقلة تمامًا عن قسم ديون العملاء.',
  },
  {
    field: 'libyanDepositsAccess',
    title: 'أمانات ليبية',
    availableLabel: 'متاح بصلاحية كاملة',
    sectionAccessKey: 'libyanDeposits',
    readPermission: 'libyan_deposits.read',
    writePermissions: ['libyan_deposits.write'],
  },
  {
    field: 'egyptianDepositsAccess',
    title: 'أمانات مصرية',
    availableLabel: 'متاح بصلاحية كاملة',
    sectionAccessKey: 'egyptianDeposits',
    readPermission: 'egyptian_deposits.read',
    writePermissions: ['egyptian_deposits.write'],
  },
  {
    field: 'collectionsAccess',
    title: 'قسم استلامات الديون',
    availableLabel: 'متاح بصلاحية كاملة للموظف',
    managePermission: 'collections.write',
    readPermission: 'collections.read',
    writePermissions: ['collections.write'],
    hint: 'اعتماد الإدارة واستلام النقدية يظلان للإدارة فقط لأنهما وظيفتان إداريتان.',
  },
  {
    field: 'masraweyaAccess',
    title: 'صفحة المصراوية',
    availableLabel: 'متاحة بصلاحية كاملة',
    sectionAccessKey: 'masraweya',
    readPermission: 'masraweya.read',
    writePermissions: ['masraweya.write'],
  },
  {
    field: 'purchasesAccess',
    title: 'قسم المشتريات',
    availableLabel: 'متاح بصلاحية كاملة',
    sectionAccessKey: 'purchases',
    readPermission: 'purchases.read',
    writePermissions: ['purchases.write', 'purchases.finalize'],
    hint: 'الصلاحية تشمل البيان وسمسم وترحيل اليوم.',
  },
  {
    field: 'treasuryAccess',
    title: 'الخزينة',
    availableLabel: 'متاحة بصلاحية كاملة',
    sectionAccessKey: 'treasury',
    readPermission: 'treasury.read',
    writePermissions: ['treasury.write'],
    hint: 'النقد النشط لا يتغير إلا من سجل الدخول والخروج داخل الخزينة.',
  },
  {
    field: 'reportsAccess',
    title: 'التقارير الذكية',
    availableLabel: 'متاحة للقراءة',
    sectionAccessKey: 'reports',
    readPermission: 'reports.read',
    writePermissions: [],
    hint: 'التقارير قراءة وتحليل فقط ولا تسمح بتعديل أي رصيد أو معاملة.',
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
