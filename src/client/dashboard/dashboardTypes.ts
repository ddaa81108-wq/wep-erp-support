export type DashboardNotice = { kind: 'success' | 'error'; text: string } | null;

export type DashboardDialog = 'customer' | 'audit' | 'financial-ledger' | 'system-settings' | null;
