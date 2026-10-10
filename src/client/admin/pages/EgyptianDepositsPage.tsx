import type { ReactNode } from 'react';

export function EgyptianDepositsPage({ children }: { children: ReactNode }) {
  return <section className="admin-page admin-egyptian-deposits-page" data-admin-page="egyptian-deposits">{children}</section>;
}
