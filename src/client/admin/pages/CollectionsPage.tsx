import type { ReactNode } from 'react';

export function CollectionsPage({ children }: { children: ReactNode }) {
  return <section className="admin-page admin-collections-page-route" data-admin-page="collections">{children}</section>;
}
