import { useEffect, useState } from 'react';
import { api, type CollectionsDashboard, type CollectionWorkspace } from '../../api.ts';
import { uiText } from '../../i18n/language.ts';
import {
  assignmentTone,
  collectionError,
  collectionMoney,
} from '../../sections/collections/useCollectionsDashboard.ts';
import { OutstandingCollectionCash } from '../../sections/collections/OutstandingCollectionCash.tsx';
import { UnlinkedReceiptsPanel } from './UnlinkedReceiptsPanel.tsx';
import { CollectionReceiptRows } from './CollectionReceiptRows.tsx';
import { CollectionAssignmentHistory } from './CollectionAssignmentHistory.tsx';
import { CollectionCardAmounts } from '../../sections/collections/CollectionCardAmounts.tsx';

type Tab = 'review' | 'cash' | 'all' | 'previous';
type Props = {
  data: CollectionsDashboard;
  busy: string;
  selectedBatchId: string;
  onBatch: (id: string) => void;
  onPayroll: () => void;
  onExport: (id: string, date: string) => void;
  onClose: (id: string) => void;
  run: (id: string, action: () => Promise<unknown>) => Promise<boolean>;
  setBusy: (value: string) => void;
  setError: (value: string) => void;
  load: (quiet?: boolean) => Promise<void>;
};
const labels = {
  review: () => uiText('بانتظار المراجعة'),
  cash: () => uiText('بانتظار تسليم النقدية'),
  all: () => uiText('كل الكروت'),
  previous: () => uiText('نقدية سابقة'),
};

export function CollectionWorkBoard({
  data,
  busy,
  selectedBatchId,
  onBatch,
  onPayroll,
  onExport,
  onClose,
  run,
  setBusy,
  setError,
  load,
}: Props) {
  const [tab, setTab] = useState<Tab>('all'),
    [employeeId, setEmployeeId] = useState('');
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    batchId: string;
    employeeId: string;
    value: CollectionWorkspace;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false),
    [error, setReadError] = useState(''),
    [retry, setRetry] = useState(0);
  const batch = data.openBatches.find((item) => item.id === selectedBatchId) ?? data.openBatches[0];
  const batchId = batch?.id ?? '';
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);
  const key = JSON.stringify([batchId, employeeId, tab, search, page]);
  useEffect(() => {
    const controller = new AbortController();
    setRefreshing(true);
    setReadError('');
    void api
      .collectionWorkspace(
        { batchId, employeeId, state: tab === 'previous' ? 'all' : tab, q: search, page },
        controller.signal,
      )
      .then((value) => {
        if (!controller.signal.aborted) setSnapshot({ key, batchId, employeeId, value });
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setReadError(collectionError(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setRefreshing(false);
      });
    return () => controller.abort();
  }, [batchId, employeeId, tab, search, page, key, data, retry]);
  const view = snapshot?.key === key ? snapshot.value : null;
  const summary =
    snapshot?.batchId === batchId && snapshot.employeeId === employeeId ? snapshot.value.summary : null;
  const employees = snapshot?.value.employees ?? [];
  const previous = [
    ...(data.outstandingCancelledSubmissions ?? []).map((item) => ({
      ...item,
      receiptKind: undefined as 'unlinked' | undefined,
    })),
    ...(data.outstandingClosedUnlinkedReceipts ?? []).map((item) => ({
      ...item,
      receiptKind: 'unlinked' as const,
    })),
  ]
    .filter((item) => !data.openBatches.some((open) => open.id === item.batchId))
    .filter((item) => !employeeId || item.collectorUserId === employeeId);
  const visiblePrevious = previous.filter(
    (item) => !search || `${item.customerName} ${item.collectorName}`.includes(search),
  );
  const scopedAssignments = data.assignments.filter(
    (item) => item.batchId === batchId && (!employeeId || item.assigneeUserId === employeeId),
  );
  const assignments = scopedAssignments.filter(
    (item) => !search || `${item.customerName} ${item.assigneeName} ${item.phone ?? ''}`.includes(search),
  );
  const counts = {
    review: summary?.pendingCount,
    cash: summary?.cashPendingCount,
    all: scopedAssignments.length,
    previous: previous.length,
  };
  const blocked = busy !== '' || refreshing || error !== '';
  const choose = (next: Tab) => {
    setTab(next);
    setPage(1);
  };
  const receivePrevious = (id: string, kind?: 'unlinked') =>
    void run(id, () =>
      kind === 'unlinked' ? api.receiveUnlinkedCollectionCash(id) : api.receiveCollectionCash(id),
    );
  const pager = view && (page > 1 || view.hasMore) && (
    <div className="board-pagination">
      <button disabled={page === 1 || refreshing} onClick={() => setPage((value) => value - 1)}>
        {uiText('السابق')}
      </button>
      <span>
        {uiText('صفحة {0}', [page])} · {uiText('{0} استلام', [collectionMoney.format(view.totalItems)])}
      </span>
      <button disabled={!view.hasMore || refreshing} onClick={() => setPage((value) => value + 1)}>
        {uiText('التالي')}
      </button>
    </div>
  );
  return (
    <div className="collection-board">
      <section className="board-filters collection-panel" aria-label={uiText('تحديد نطاق الاستلامات')}>
        <div className="board-batch-row board-day-close">
          <label>
            {uiText('دفعة العمل')}
            <select
              value={batchId}
              disabled={!batch || busy !== ''}
              onChange={(event) => {
                onBatch(event.target.value);
                setPage(1);
              }}
              aria-label={uiText('دفعة العمل')}
            >
              {!batch && <option value="">{uiText('لا توجد دفعات مفتوحة')}</option>}
              {data.openBatches.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.businessDate} · {uiText('دفعة {0}', [item.batchNumber])}
                </option>
              ))}
            </select>
          </label>
          <label>
            {uiText('الموظف')}
            <select
              value={employeeId}
              aria-label={uiText('الموظف')}
              onChange={(event) => {
                setEmployeeId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">{uiText('كل الموظفين')}</option>
              {employees.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="board-search">
            {uiText('بحث في العرض')}
            <input
              value={query}
              aria-label={uiText('بحث في الاستلامات')}
              placeholder={uiText('اسم العميل أو الموظف أو الهاتف')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="collection-toolbar-actions board-batch-actions">
            <button className="secondary compact-action payroll-open-button" onClick={onPayroll}>
              {uiText('المرتبات')}
            </button>
            <button
              className={`batch-close-button ${batch && (data.assignments.some((item) => item.batchId === batch.id) || (summary?.receiptCount ?? 0) > 0) ? 'batch-occupied' : 'batch-empty'}`}
              disabled={busy !== '' || !batch}
              onClick={() => batch && onClose(batch.id)}
            >
              {uiText('إغلاق ومسح الدفعة')}
            </button>
            <button
              className="compact-action"
              disabled={busy !== '' || !batch}
              onClick={() => batch && onExport(batch.id, batch.businessDate)}
            >
              {uiText('كشف PDF للدفعة')}
            </button>
          </div>
        </div>
        <div className="board-close-scope">
          <div>
            <strong>{uiText('إغلاق دفعة العمل')}</strong>
            <small>{uiText('الإغلاق يشمل الدفعة كاملة، مهما كان الموظف أو البحث المختار.')}</small>
          </div>
          <div className="board-close-counts">
            <span>{uiText('مراجعة: {0}', [batch?.pendingCount ?? 0])}</span>
            <span>
              {uiText('نقدية غير مستلمة: {0} د.ل', [collectionMoney.format(batch?.cashPendingUnits ?? 0)])}
            </span>
          </div>
        </div>
      </section>
      <section className="collection-board-summary" aria-label={uiText('ملخص الدفعة والموظف')}>
        {[
          ['approved', uiText('المعتمد'), summary?.approvedUnits],
          ['received', uiText('المستلم نقدًا'), summary?.receivedUnits],
          ['outstanding', uiText('المتبقي تسليمه'), summary?.outstandingUnits],
          ['pending', uiText('بانتظار الاعتماد'), summary?.pendingCount],
        ].map(([id, label, value]) => (
          <article key={id} data-metric={id}>
            <span>{label}</span>
            <strong>
              {value === undefined ? '—' : collectionMoney.format(Number(value))}
              <small>{id === 'pending' ? uiText('عملية') : uiText('د.ل')}</small>
            </strong>
            {id === 'pending' && (
              <small>{uiText('غير المربوط ضمن هذا العدد: {0}', [summary?.unlinkedPendingCount ?? 0])}</small>
            )}
          </article>
        ))}
      </section>
      <p className="board-scope-note">
        {uiText(
          'الملخص للدفعة والموظف المختارين. البحث والتبويب لا يغيّران الإجماليات. النقدية السابقة منفصلة.',
        )}
      </p>
      <div className="board-tabs" role="tablist" aria-label={uiText('تنظيم استلامات الديون')}>
        {(['all', 'review', 'cash', 'previous'] as Tab[]).map((name) => (
          <button
            role="tab"
            aria-selected={tab === name}
            aria-controls="collection-board-content"
            id={'board-tab-' + name}
            key={name}
            onClick={() => choose(name)}
          >
            {labels[name]()}
            <b>{counts[name] === undefined ? '—' : collectionMoney.format(counts[name]!)}</b>
          </button>
        ))}
      </div>
      <section
        id="collection-board-content"
        role="tabpanel"
        aria-labelledby={'board-tab-' + tab}
        className="board-main collection-panel"
      >
        <div className="board-content-heading">
          <h2>{labels[tab]()}</h2>
          <small role="status">
            {error
              ? uiText('تعذر تحديث العرض')
              : refreshing
                ? uiText('يتم تحديث العرض…')
                : uiText('متصل بالمزامنة الحية')}
          </small>
        </div>
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button onClick={() => setRetry((value) => value + 1)}>{uiText('إعادة المحاولة')}</button>
          </div>
        )}
        {tab === 'previous' ? (
          <>
            <p className="board-scope-note">
              {uiText('مبالغ من دفعات مغلقة، ما زالت مستحقة على الموظف. لا تدخل في ملخص الدفعة الحالية.')}
            </p>
            <OutstandingCollectionCash
              items={visiblePrevious}
              busy={blocked ? 'loading' : ''}
              onReceive={receivePrevious}
              actionLabel={uiText('تأكيد استلام النقدية')}
            />
            {!visiblePrevious.length && (
              <div className="board-empty">{uiText('لا توجد نقدية سابقة في هذا العرض.')}</div>
            )}
          </>
        ) : tab === 'all' ? (
          <>
            <div className="board-assignment-grid">
              {assignments.map((assignment) => (
                <article
                  className={'admin-customer-collection-card board-assignment ' + assignmentTone(assignment)}
                  key={assignment.id}
                >
                  <header>
                    <div>
                      <strong>{assignment.customerName}</strong>
                      <span>{assignment.assigneeName}</span>
                    </div>
                  </header>
                  <CollectionCardAmounts assignment={assignment} />
                  <div className="board-assignment-state">
                    <span>
                      {assignment.latestStatus === 'rejected' && !assignment.hasPending
                        ? uiText('رُفضت العملية — التوجيه مستمر')
                        : assignment.hasPending
                        ? uiText('يحتاج مراجعة')
                        : assignment.cashOutstandingCount
                          ? uiText('نقدية لم تُسلّم')
                          : assignment.latestCashReceivedAt
                            ? uiText('تم تسليم النقدية')
                            : uiText('جاهز للمتابعة')}
                    </span>
                    {assignment.cashOutstandingCount > 0 && (
                      <b>{uiText('{0} استلام', [assignment.cashOutstandingCount])}</b>
                    )}
                  </div>
                  <CollectionAssignmentHistory
                    assignment={assignment}
                    revision={data}
                    busy={blocked}
                    run={run}
                  />
                </article>
              ))}
            </div>
            {!assignments.length && <div className="board-empty">{uiText('لا توجد كروت في هذا العرض')}</div>}
            <details className="board-ledger">
              <summary>{uiText('سجل استلامات الدفعة')}</summary>
              {view && (
                <>
                  <UnlinkedReceiptsPanel
                    receipts={view.items.filter(
                      (item) => item.kind === 'unlinked' && item.status === 'pending',
                    )}
                    busy={blocked ? 'loading' : ''}
                    setBusy={setBusy}
                    setError={setError}
                    load={load}
                  />
                  <CollectionReceiptRows
                    items={view.items.filter((item) => item.kind === 'linked' || item.status !== 'pending')}
                    busy={blocked}
                    run={run}
                  />
                  {pager}
                </>
              )}
            </details>
          </>
        ) : !view && !error ? (
          <div className="board-empty" role="status">
            {uiText('جارٍ تحميل الاستلامات…')}
          </div>
        ) : (
          view && (
            <>
              <UnlinkedReceiptsPanel
                receipts={view.items.filter((item) => item.kind === 'unlinked' && item.status === 'pending')}
                busy={blocked ? 'loading' : ''}
                setBusy={setBusy}
                setError={setError}
                load={load}
              />
              <CollectionReceiptRows
                items={view.items.filter((item) => item.kind === 'linked' || item.status !== 'pending')}
                busy={blocked}
                run={run}
              />
              {!view.items.length && (
                <div className="board-empty">
                  {tab === 'review'
                    ? uiText('لا توجد عمليات تنتظر المراجعة في هذا العرض.')
                    : uiText('لا توجد نقدية تنتظر التسليم في هذا العرض.')}
                </div>
              )}
              {pager}
            </>
          )
        )}
      </section>
    </div>
  );
}
