import type { ReactNode } from 'react';

export function TreasuryPage({ children }: { children: ReactNode }) {
  return (
    <section className="admin-page admin-treasury-page" data-admin-page="treasury">
      {children}
    </section>
  );
}
