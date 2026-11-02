import { api, type CollectionWorkspaceReceipt } from '../../api.ts';
import { useState } from 'react';
import { displayLocale, uiText } from '../../i18n/language.ts';
import { collectionError, collectionMoney } from '../../sections/collections/useCollectionsDashboard.ts';

type Props = {
  items: CollectionWorkspaceReceipt[];
  busy: boolean;
  run: (id: string, action: () => Promise<unknown>) => Promise<boolean>;
};
const date = new Intl.DateTimeFormat(displayLocale, { dateStyle: 'short', timeStyle: 'short' });
export function CollectionReceiptRows({ items, busy, run }: Props) {
  const [cancelling, setCancelling] = useState<{
    receipt: CollectionWorkspaceReceipt;
    requestId: string;
  } | null>(null);
  const [reason, setReason] = useState(''),
    [failure, setFailure] = useState('');
  async function cancelApproval() {
    if (!cancelling?.receipt.approvedTransactionId) return;
    const { receipt, requestId } = cancelling;
    setFailure('');
    const success = await run(receipt.id, async () => {
      try {
        await api.cancelCollectionApproval(receipt.kind, receipt.id, {
          requestId,
          reason: reason.trim(),
          expectedTransactionId: receipt.approvedTransactionId!,
        });
      } catch (caught) {
        setFailure(collectionError(caught));
        throw caught;
      }
    });
    if (success) setCancelling(null);
  }
  return (
    <div className="board-receipt-list">
      {items.map((item) => (
        <article
          className={`board-receipt ${item.approvalCancelled ? 'is-cancelled' : item.status === 'pending' ? 'is-pending' : item.cashReceivedAt ? 'is-received' : 'is-cash'}`}
          key={item.kind + item.id}
          data-receipt-id={item.id}
        >
          <div className="board-receipt-heading">
            <div>
              <strong>{item.customerName}</strong>
              <small>
                {item.collectorName} ·{' '}
                {item.kind === 'unlinked'
                  ? uiText('استلام بلا كارت موجه')
                  : item.mode === 'full'
                    ? uiText('استلام كلي')
                    : uiText('استلام جزئي')}
              </small>
            </div>
            <b>
              {collectionMoney.format(item.amountUnits)} <small>{uiText('د.ل')}</small>
            </b>
          </div>
          <div className="board-receipt-foot">
            <time dateTime={item.submittedAt}>{date.format(new Date(item.submittedAt))}</time>
            {item.status === 'pending' && item.kind === 'linked' ? (
              <div className="board-row-actions">
                <button
                  disabled={busy}
                  className="board-approve"
                  onClick={() => void run(item.id, () => api.decideCollection(item.id, 'approve'))}
                >
                  {uiText('اعتماد')}
                </button>
                <button
                  disabled={busy}
                  className="board-reject"
                  onClick={() => void run(item.id, () => api.decideCollection(item.id, 'reject'))}
                >
                  {uiText('رفض')}
                </button>
              </div>
            ) : item.status === 'approved' && !item.cashReceivedAt ? (
              <div className="board-row-actions">
                <button
                  disabled={busy}
                  className="board-cash"
                  onClick={() =>
                    void run(item.id, () =>
                      item.kind === 'linked'
                        ? api.receiveCollectionCash(item.id)
                        : api.receiveUnlinkedCollectionCash(item.id),
                    )
                  }
                >
                  {uiText('تأكيد استلام النقدية')}
                </button>
                <button
                  className="board-reject"
                  disabled={busy || Boolean(item.currencyMismatch) || !item.approvedTransactionId}
                  onClick={() => {
                    setReason('');
                    setFailure('');
                    setCancelling({ receipt: item, requestId: crypto.randomUUID() });
                  }}
                >
                  {uiText('إلغاء الاعتماد')}
                </button>
              </div>
            ) : item.cashReceivedAt ? (
              <span className="board-received">
                {uiText('مستلمة')} · {date.format(new Date(item.cashReceivedAt))}
                {item.cashReceivedByName ? ` · ${item.cashReceivedByName}` : ''}
              </span>
            ) : (
              <span>
                {item.approvalCancelled
                  ? uiText('أُلغي الاعتماد — صُحح الرصيد')
                  : item.status === 'rejected'
                    ? uiText('مرفوض')
                    : uiText('بانتظار الربط')}
              </span>
            )}
          </div>
          {Boolean(item.approvalCancelled) && (
            <p className="board-cancellation-reason">{uiText('سبب الإلغاء: {0}', [item.decisionNote])}</p>
          )}
          {Boolean(item.currencyMismatch) && (
            <p className="alert error">
              {uiText('استلام قديم مرتبط بعملة مختلفة؛ يلزم مراجعة الإدارة، ولم يتم تعديل الرصيد تلقائيًا.')}
            </p>
          )}
        </article>
      ))}
      {cancelling && (
        <div className="collection-confirm-shade">
          <section
            className="approval-cancel-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={uiText('إلغاء اعتماد الاستلام')}
          >
            <h3>{uiText('إلغاء اعتماد الاستلام')}</h3>
            <p>
              <strong>{cancelling.receipt.customerName}</strong> —{' '}
              {collectionMoney.format(cancelling.receipt.amountUnits)} {uiText('د.ل')}
            </p>
            <p>
              {uiText(
                'سيُلغى أثر هذه العملية فقط ويُعاد حساب رصيد العميل. تبقى بقية الدفعات كما هي، ويُحفظ سبب الإلغاء في السجل.',
              )}
            </p>
            <label>
              {uiText('سبب إلغاء الاعتماد')}
              <textarea
                autoFocus
                rows={3}
                maxLength={500}
                value={reason}
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {failure && (
              <p role="alert" className="alert error">
                {failure}
              </p>
            )}
            <div>
              <button disabled={busy} onClick={() => setCancelling(null)}>
                {uiText('رجوع')}
              </button>
              <button
                className="danger"
                disabled={busy || reason.trim().length < 5}
                onClick={() => void cancelApproval()}
              >
                {uiText('إلغاء الاعتماد وتصحيح الرصيد')}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
