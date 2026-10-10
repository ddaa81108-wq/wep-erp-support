import type { ReactNode } from 'react';

export function LibyanDepositsPage({ children }: { children: ReactNode }) {
  return <section className="admin-page admin-libyan-deposits-page" data-admin-page="libyan-deposits">{children}</section>;
}
