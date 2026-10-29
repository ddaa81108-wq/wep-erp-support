import { uiText } from '../../i18n/language.ts';
import type { CollectionsDashboard } from '../../api.ts';
import { collectionMoney } from './useCollectionsDashboard.ts';

export function OutstandingCollectionCash({ items, busy, onReceive }: {
  items: Array<NonNullable<CollectionsDashboard['outstandingCancelledSubmissions']>[number] & { receiptKind?: 'unlinked' }>;
  busy: string;
  onReceive?: (id: string, kind?: 'unlinked') => void;
}) {
  if (!items.length) return null;
  return <section className="collection-panel outstanding-collection-cash" aria-label={uiText("نقدية سابقة لم تُسلّم")}>
    <h2>{uiText("نقدية سابقة لم تُسلّم")}</h2>
    <p className="muted">{uiText("دفعات معتمدة سابقة، ما زالت تنتظر تسليم النقدية.")}</p>
    {items.map(item => <div className="outstanding-cash-row" key={(item.receiptKind??'linked')+item.id}>
      <span>{item.customerName} — {item.collectorName}</span>
      <strong>{collectionMoney.format(item.amountUnits)} {uiText(" د.ل")}</strong>
      {onReceive && <button className="primary" disabled={busy !== ''} onClick={() => onReceive(item.id,item.receiptKind)}>{uiText("تم استلام النقدية")}</button>}
    </div>)}
  </section>;
}
