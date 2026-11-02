import { useEffect, useState } from 'react';
import { api, type CollectionWorkspace } from '../../api.ts';
import { displayLocale, uiText } from '../../i18n/language.ts';
import { collectionError, collectionMoney } from '../../sections/collections/useCollectionsDashboard.ts';

const date = new Intl.DateTimeFormat(displayLocale, { dateStyle: 'short', timeStyle: 'short' });
export function EmployeeCollectionReceipts({
  cashOnly,
  search,
  revision,
  assignmentId,
}: {
  cashOnly: boolean;
  search: string;
  revision: object;
  assignmentId?: string;
}) {
  // Keyed by tab/search in the parent, so each filtered result starts on page one.
  const [page, setPage] = useState(1),
    [result, setResult] = useState<CollectionWorkspace | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void api
      .myCollectionReceipts(
        { state: cashOnly ? 'cash' : 'all', q: search, page, assignmentId },
        controller.signal,
      )
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(collectionError(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cashOnly, search, page, revision, retry, assignmentId]);
  return (
    <section className="collection-panel employee-receipts">
      <div className="board-content-heading">
        <h2>{cashOnly ? uiText('نقدية معتمدة لم تُسلّم') : uiText('سجل تحصيلاتي')}</h2>
        <small role="status">
          {loading
            ? uiText('يتم تحديث العرض…')
            : error
              ? uiText('تعذر تحديث العرض')
              : uiText('متصل بالمزامنة الحية')}
        </small>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button onClick={() => setRetry((value) => value + 1)}>{uiText('إعادة المحاولة')}</button>
        </div>
      )}
      {!result && loading && <p className="board-empty">{uiText('جارٍ تحميل الاستلامات…')}</p>}
      {result && (
        <>
          <div className="board-receipt-list">
            {result.items.map((item) => (
              <article
                className={`board-receipt employee-receipt ${item.kind === 'unlinked' ? 'unlinked-receipt-card ' : ''}${item.approvalCancelled ? 'is-cancelled' : item.status === 'pending' ? 'is-pending' : item.cashReceivedAt ? 'is-received' : 'is-cash'}`}
                key={item.kind + item.id}
              >
                <div className="board-receipt-heading">
                  <div>
                    <strong>{item.customerName}</strong>
                    <small>
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
                  <span
                    className={'employee-receipt-status ' + (item.cashReceivedAt ? 'board-received' : '')}
                  >
                    {item.approvalCancelled
                      ? uiText('أُلغي الاعتماد — صُحح الرصيد')
                      : item.status === 'pending'
                        ? uiText('ينتظر الاعتماد')
                        : item.cashReceivedAt
                          ? uiText('تم تسليم النقدية')
                          : uiText('معتمد — النقدية لم تُسلّم')}
                  </span>
                </div>
                {item.cashReceivedAt && (
                  <small className="employee-cash-time">
                    {uiText('تاريخ تسليم النقدية: {0}', [date.format(new Date(item.cashReceivedAt))])}
                  </small>
                )}
                {Boolean(item.approvalCancelled) && (
                  <p className="board-cancellation-reason">
                    {uiText('سبب الإلغاء: {0}', [item.decisionNote])}
                  </p>
                )}
              </article>
            ))}
          </div>
          {!loading && !result.items.length && (
            <p className="board-empty">
              {cashOnly
                ? uiText('لا توجد نقدية حالية تنتظر التسليم في هذا العرض.')
                : uiText('لا توجد تحصيلات في هذا العرض.')}
            </p>
          )}
          {(page > 1 || result.hasMore) && (
            <div className="board-pagination">
              <button disabled={loading || page === 1} onClick={() => setPage((value) => value - 1)}>
                {uiText('السابق')}
              </button>
              <span>
                {uiText('صفحة {0}', [page])} · {uiText('{0} استلام', [result.totalItems])}
              </span>
              <button disabled={loading || !result.hasMore} onClick={() => setPage((value) => value + 1)}>
                {uiText('التالي')}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function EmployeeAssignmentReceipts({ id, revision }: { id: string; revision: object }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="employee-card-history" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{uiText('تفاصيل الاستلامات')}</summary>
      {open && (
        <EmployeeCollectionReceipts cashOnly={false} search="" assignmentId={id} revision={revision} />
      )}
    </details>
  );
}
