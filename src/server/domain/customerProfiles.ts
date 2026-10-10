export type DebtPartyKind = 'customer' | 'company' | 'depositLyd' | 'depositEgp';

export const PARTY_PROFILES = {
  customer: { accountType: 'customer', sectionKey: 'customer_debts', currency: 'LYD', scope: 'customers', reference: 'customer_transaction', referencePrefix: 'CUST', treasurySource: 'customer_payment', entity: 'customer', event: 'customer', missing: 'customer', duplicateCode: 'CUSTOMER_ALREADY_EXISTS', duplicateMessage: 'هذا العميل موجود بالفعل. افتح سجله الدائم بدل إنشاء سجل جديد.' },
  company: { accountType: 'partner', sectionKey: 'company_debts', currency: 'LYD', scope: 'companies', reference: 'company_transaction', referencePrefix: 'COMP', treasurySource: 'company_payment', entity: 'company', event: 'company', missing: 'company', duplicateCode: 'COMPANY_ALREADY_EXISTS', duplicateMessage: 'هذه الشركة موجودة بالفعل. افتح سجلها الدائم بدل إنشاء سجل جديد.' },
  depositLyd: { accountType: 'customer', sectionKey: 'libyan_deposits', currency: 'LYD', scope: 'libyan-deposits', reference: 'libyan_deposit_transaction', referencePrefix: 'LDEP', treasurySource: null, entity: 'libyan_deposit', event: 'libyan-deposit', missing: 'libyan_deposit', duplicateCode: 'DEPOSIT_ACCOUNT_ALREADY_EXISTS', duplicateMessage: 'حساب الأمانة الليبية موجود بالفعل. افتح سجله الدائم.' },
  depositEgp: { accountType: 'customer', sectionKey: 'egyptian_deposits', currency: 'EGP', scope: 'egyptian-deposits', reference: 'egyptian_deposit_transaction', referencePrefix: 'EDEP', treasurySource: null, entity: 'egyptian_deposit', event: 'egyptian-deposit', missing: 'egyptian_deposit', duplicateCode: 'DEPOSIT_ACCOUNT_ALREADY_EXISTS', duplicateMessage: 'حساب الأمانة المصرية موجود بالفعل. افتح سجله الدائم.' },
} as const;

export const partyProfile = (kind: DebtPartyKind) => PARTY_PROFILES[kind];
