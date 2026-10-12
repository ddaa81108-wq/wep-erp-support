import type { ReactNode } from 'react';

export function CollectionCardDetails({ rejected, children }: { rejected: boolean; children: ReactNode }) {
  return rejected ? <details className="rejected-card-details">
    <summary>التفاصيل والإجراءات</summary>
    {children}
  </details> : <>{children}</>;
}
