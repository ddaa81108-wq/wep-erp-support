import type { ReactNode } from 'react';

export function CompanyDebtsPage({ children }: { children: ReactNode }) {
  return <section className="admin-page admin-company-debts-page" data-admin-page="company-debts">{children}</section>;
}
