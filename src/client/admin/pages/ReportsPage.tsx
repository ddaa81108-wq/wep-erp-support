import type { ReactNode } from 'react';

export function ReportsPage({ children }: { children: ReactNode }) {
  return <section className="admin-page admin-reports-page" data-admin-page="reports">{children}</section>;
}
