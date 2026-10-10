import type { ReactNode } from 'react';

export function MasraweyaPage({ children }: { children: ReactNode }) {
  return <section className="admin-page admin-masraweya-page-route" data-admin-page="masraweya">{children}</section>;
}
