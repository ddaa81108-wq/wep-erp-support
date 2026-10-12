import type { CollectionsDashboard } from '../../api.ts';
import { collectionMoney } from './useCollectionsDashboard.ts';

export function OutstandingCollectionCash({ items, busy, onReceive }: {
  items: NonNullable<CollectionsDashboard['outstandingCancelledSubmissions']>;
  busy: string;
  onReceive?: (id: string) => void;
}) {
  if (!items.length) return null;
  return <section className="collection-panel outstanding-collection-cash" aria-label="نقدية سابقة لم تُسلّم">
    <h2>نقدية سابقة لم تُسلّم</h2>
    <p className="muted">دفعات معتمدة سابقة، ما زالت تنتظر تسليم النقدية.</p>
    {items.map(item => <div className="outstanding-cash-row" key={item.id}>
      <span>{item.customerName} — {item.collectorName}</span>
      <strong>{collectionMoney.format(item.amountUnits)} د.ل</strong>
      {onReceive && <button className="primary" disabled={busy !== ''} onClick={() => onReceive(item.id)}>تم استلام النقدية</button>}
    </div>)}
  </section>;
}
