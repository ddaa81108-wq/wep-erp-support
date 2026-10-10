import type { ReactNode } from 'react';

export function CustomerDebtsPage({ children }: { children: ReactNode }) {
  return <section className="admin-page admin-customer-debts-page" data-admin-page="customer-debts">{children}</section>;
}
