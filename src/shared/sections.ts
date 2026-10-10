export const MAIN_SECTIONS = [
  'customers',
  'companies',
  'libyan-deposits',
  'egyptian-deposits',
  'collections',
  'masraweya',
  'purchases',
  'treasury',
  'reports',
  'settings',
] as const;

export type MainSection = (typeof MAIN_SECTIONS)[number];
export type DebtSection = Extract<
  MainSection,
  'customers' | 'companies' | 'libyan-deposits' | 'egyptian-deposits'
>;
export type SectionAccessLevel = 'none' | 'read' | 'manage';

export const ASSIGNABLE_PERMISSIONS = [
  'debts.read',
  'debts.write',
  'companies.read',
  'companies.write',
  'libyan_deposits.read',
  'libyan_deposits.write',
  'egyptian_deposits.read',
  'egyptian_deposits.write',
  'collections.read',
  'collections.write',
  'masraweya.read',
  'masraweya.write',
  'purchases.read',
  'purchases.write',
  'purchases.finalize',
  'treasury.read',
  'treasury.write',
  'reports.read',
] as const;

export type AssignablePermission = (typeof ASSIGNABLE_PERMISSIONS)[number];

type SectionContract = {
  title: string;
  databaseKey: string | null;
  readPermission: AssignablePermission | null;
  writePermissions: readonly AssignablePermission[];
};

export const SECTION_CONTRACTS: Record<MainSection, SectionContract> = {
  customers: {
    title: 'قسم ديون العملاء',
    databaseKey: 'customer_debts',
    readPermission: 'debts.read',
    writePermissions: ['debts.write'],
  },
  companies: {
    title: 'قسم ديون الشركات',
    databaseKey: 'company_debts',
    readPermission: 'companies.read',
    writePermissions: ['companies.write'],
  },
  'libyan-deposits': {
    title: 'أمانات ليبية',
    databaseKey: 'libyan_deposits',
    readPermission: 'libyan_deposits.read',
    writePermissions: ['libyan_deposits.write'],
  },
  'egyptian-deposits': {
    title: 'أمانات مصرية',
    databaseKey: 'egyptian_deposits',
    readPermission: 'egyptian_deposits.read',
    writePermissions: ['egyptian_deposits.write'],
  },
  collections: {
    title: 'قسم استلامات الديون',
    databaseKey: 'collections',
    readPermission: 'collections.read',
    writePermissions: ['collections.write'],
  },
  masraweya: {
    title: 'صفحة المصراوية',
    databaseKey: 'masraweya',
    readPermission: 'masraweya.read',
    writePermissions: ['masraweya.write'],
  },
  purchases: {
    title: 'قسم المشتريات',
    databaseKey: 'purchases',
    readPermission: 'purchases.read',
    writePermissions: ['purchases.write', 'purchases.finalize'],
  },
  treasury: {
    title: 'الخزينة',
    databaseKey: 'treasury',
    readPermission: 'treasury.read',
    writePermissions: ['treasury.write'],
  },
  reports: {
    title: 'التقارير الذكية',
    databaseKey: 'reports',
    readPermission: 'reports.read',
    writePermissions: [],
  },
  settings: {
    title: 'الإعدادات',
    databaseKey: null,
    readPermission: null,
    writePermissions: [],
  },
};

export const DEBT_SECTIONS = [
  'customers',
  'companies',
  'libyan-deposits',
  'egyptian-deposits',
] as const satisfies readonly DebtSection[];

export function isMainSection(value: unknown): value is MainSection {
  return typeof value === 'string' && MAIN_SECTIONS.some((section) => section === value);
}

export function canReadSection(permissions: readonly string[] | undefined, section: MainSection) {
  const permission = SECTION_CONTRACTS[section].readPermission;
  return permission !== null && permissions?.includes(permission) === true;
}
