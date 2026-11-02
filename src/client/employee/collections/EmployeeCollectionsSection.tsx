import { uiText } from '../../i18n/language.ts';
import { useUnsavedForm } from '../../dashboard/useUnsavedForm.ts';
import { OutstandingCollectionCash } from '../../sections/collections/OutstandingCollectionCash.tsx';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Phone } from 'lucide-react';
import { api, ApiError } from '../../api.ts';
import {
  readPendingCollections,
  writePendingCollections,
  type PendingCollectionRequest,
} from './pendingCollectionRequests.ts';
import {
  assignmentTone,
  collectionMoney,
  useCollectionsDashboard,
} from '../../sections/collections/useCollectionsDashboard.ts';
import { EmployeeCollectionHeader, type EmployeeCollectionTab } from './EmployeeCollectionHeader.tsx';
import { EmployeeCollectionReceipts, EmployeeAssignmentReceipts } from './EmployeeCollectionReceipts.tsx';
import { flushBeforeNavigation } from '../../dashboard/navigationGuards.ts';
import { CollectionPayrollPanel } from '../../sections/collections/CollectionPayrollPanel.tsx';

function PartialReceiptForm({
  busy,
  submit,
}: {
  busy: boolean;
  submit: (amount: number) => Promise<boolean>;
}) {
  const { bindForm, trackChanges, markSaved } = useUnsavedForm(busy);
  return (
    <form
      ref={bindForm}
      onInput={trackChanges}
      onChange={trackChanges}
      className="partial-collection-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await submit(Number(new FormData(event.currentTarget).get('amount')))) markSaved();
      }}
    >
      <label>
        {uiText('القيمة')}
        <input
          name="amount"
          inputMode="numeric"
          type="number"
          min="1"
          step="1"
          required
          placeholder={uiText('المبلغ')}
        />
      </label>
      <button disabled={busy}>{uiText('حفظ')}</button>
    </form>
  );
}

export function EmployeeCollectionsSection({ userId }: { userId: string }) {
  const { data, error, busy, setError, setBusy, load, run } = useCollectionsDashboard();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<EmployeeCollectionTab>('cards');
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  async function changeTab(next: EmployeeCollectionTab) {
    if (next !== tab && (await flushBeforeNavigation())) setTab(next);
  }
  async function changeSearch(value: string) {
    if (await flushBeforeNavigation()) setQuery(value);
  }
  const {
    bindForm: bindCreate,
    trackChanges: changeCreate,
    markSaved: savedCreate,
    confirmLeave: leaveCreate,
  } = useUnsavedForm(busy === 'unlinked-create');
  const createPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!creating || !window.matchMedia('(max-width: 560px)').matches) return;
    createPanel.current?.scrollIntoView({ block: 'center' });
    createPanel.current?.querySelector('input')?.focus({ preventScroll: true });
  }, [creating]);
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<PendingCollectionRequest[]>([]);
  const submitting = useRef(false);
  useEffect(() => {
    try {
      setPendingRequests(readPendingCollections(localStorage, userId));
    } catch {
      setError(uiText('تعذر قراءة سجل الطلبات المعلقة على هذا الجهاز. راجع الدعم قبل إرسال تحصيل جديد.'));
    }
  }, [userId, setError]);
  function keepRequests(requests: PendingCollectionRequest[]) {
    writePendingCollections(localStorage, userId, requests);
    setPendingRequests(requests);
  }
  async function sendPending(request: PendingCollectionRequest, recovering = true) {
    if (submitting.current) return false;
    submitting.current = true;
    try {
      return await run(request.assignmentId, async () => {
        try {
          await api.submitCollection(
            request.assignmentId,
            request.mode,
            request.amountUnits,
            request.requestId,
          );
          keepRequests(
            readPendingCollections(localStorage, userId).filter(
              (item) => item.requestId !== request.requestId,
            ),
          );
        } catch (caught) {
          // Network/5xx/invalid responses may hide an accepted write: retain the exact payload.
          if (
            !recovering &&
            caught instanceof ApiError &&
            [400, 401, 403, 404, 409].includes(caught.status) &&
            ![
              'REQUEST_ID_REUSED',
              'LEGACY_REQUEST_REVIEW_REQUIRED',
              'INVALID_SERVER_RESPONSE',
              'REQUEST_FAILED',
            ].includes(caught.code)
          ) {
            keepRequests(
              readPendingCollections(localStorage, userId).filter(
                (item) => item.requestId !== request.requestId,
              ),
            );
          }
          throw caught;
        }
      });
    } finally {
      submitting.current = false;
    }
  }
  async function submit(id: string, mode: 'full' | 'partial', amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setError(uiText('اكتب قيمة صحيحة أكبر من صفر.'));
      return false;
    }
    if (submitting.current) return false;
    try {
      const requests = readPendingCollections(localStorage, userId);
      const previous = requests.find((item) => item.assignmentId === id);
      if (previous && (previous.mode !== mode || previous.amountUnits !== amount)) {
        setError(uiText('توجد محاولة سابقة لم يتأكد ردها. أعد التحقق منها قبل تغيير المبلغ أو نوع التحصيل.'));
        return false;
      }
      const request = previous ?? {
        assignmentId: id,
        mode,
        amountUnits: amount,
        requestId: crypto.randomUUID(),
      };
      if (!previous) keepRequests([...requests, request]);
      return await sendPending(request, Boolean(previous));
    } catch {
      setError(uiText('تعذر حفظ مفتاح الطلب على هذا الجهاز. لم يتم إرسال تحصيل جديد.'));
      return false;
    }
  }
  async function createUnlinked(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const customerName = String(values.get('customerName') ?? '').trim();
    const amountUnits = Number(values.get('amountUnits'));
    if (customerName.length < 2) {
      setError(uiText('اكتب اسم العميل بوضوح.'));
      return;
    }
    if (!Number.isSafeInteger(amountUnits) || amountUnits <= 0) {
      setError(uiText('اكتب قيمة صحيحة أكبر من صفر.'));
      return;
    }
    setBusy('unlinked-create');
    setError('');
    try {
      await api.createUnlinkedCollectionReceipt(customerName, amountUnits, crypto.randomUUID());
      form.reset();
      savedCreate();
      setCreating(false);
      setTab('history');
      setQuery('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : uiText('تعذر تسجيل الاستلام غير المربوط.'));
    } finally {
      setBusy('');
    }
  }
  if (!data)
    return (
      <div className="empty">
        <div className="spinner" />
        <p>{uiText('جارٍ تحميل الاستلامات…')}</p>
        {error && <div className="alert error">{error}</div>}
      </div>
    );
  if (payrollOpen) {
    return (
      <div className="collections-page employee-collections-page">
        <CollectionPayrollPanel isAdmin={false} onClose={() => setPayrollOpen(false)} />
      </div>
    );
  }
  return (
    <div className="collections-page employee-collections-page">
      <div className="collection-board employee-collection-board">
        <EmployeeCollectionHeader
          data={data}
          tab={tab}
          query={query}
          creating={creating}
          onTab={(next) => void changeTab(next)}
          onSearch={(value) => void changeSearch(value)}
          onPayroll={() => {
            void flushBeforeNavigation().then((allowed) => {
              if (allowed) setPayrollOpen(true);
            });
          }}
          onCreate={() => {
            if (!creating || leaveCreate()) setCreating((value) => !value);
          }}
        />
        {error && <div className="alert error">{error}</div>}
        {pendingRequests.length > 0 && (
          <section className="collection-panel pending-collection-recovery">
            <h2>{uiText('تحصيلات تحتاج تأكيد نتيجة الإرسال')}</h2>
            <p>{uiText('أعد التحقق بنفس الطلب؛ لن يُنشأ استلام آخر إذا كان محفوظًا من قبل.')}</p>
            {pendingRequests.map((request) => (
              <button
                key={request.requestId}
                disabled={Boolean(busy)}
                onClick={() => void sendPending(request)}
              >
                {uiText('إعادة التحقق من الاستلام السابق')} — {collectionMoney.format(request.amountUnits)}{' '}
                {uiText('د.ل')}
              </button>
            ))}
          </section>
        )}
        {creating && (
          <section
            id="collection-create-form"
            ref={createPanel}
            className="collection-panel unlinked-create-panel"
          >
            <header>
              <div>
                <h2>{uiText('إنشاء عميل مستقل')}</h2>
                <p>
                  {uiText('سجّل الاسم والقيمة فقط. لن تتغير أي أرصدة حتى تربطه الإدارة بكارت أصلي وتعتمده.')}
                </p>
                <p className="muted">
                  {uiText('عملة الاستلام: دينار ليبي فقط — الربط بحسابات الدينار دون تحويل.')}
                </p>
              </div>
            </header>
            <form ref={bindCreate} onInput={changeCreate} onChange={changeCreate} onSubmit={createUnlinked}>
              <label>
                {uiText('اسم العميل')}
                <input
                  name="customerName"
                  autoComplete="off"
                  maxLength={160}
                  required
                  placeholder={uiText('اسم العميل')}
                />
              </label>
              <label>
                {uiText('القيمة المستلمة')}
                <input
                  name="amountUnits"
                  inputMode="numeric"
                  type="number"
                  min="1"
                  step="1"
                  required
                  placeholder={uiText('القيمة')}
                />
              </label>
              <button className="primary" disabled={busy === 'unlinked-create'}>
                {uiText('تسجيل كارت معلّق')}
              </button>
            </form>
          </section>
        )}
        <div id="employee-collection-content" role="tabpanel" aria-labelledby={'employee-tab-' + tab}>
          {tab === 'cash' && (
            <OutstandingCollectionCash
              items={[
                ...(data.outstandingCancelledSubmissions ?? []),
                ...(data.outstandingClosedUnlinkedReceipts ?? []).map((item) => ({
                  ...item,
                  receiptKind: 'unlinked' as const,
                })),
              ]
                .filter((item) => !data.openBatches.some((batch) => batch.id === item.batchId))
                .filter((item) => !search || item.customerName.includes(search))}
              busy={busy}
            />
          )}
          {tab !== 'cards' && (
            <EmployeeCollectionReceipts
              key={tab + ':' + search}
              cashOnly={tab === 'cash'}
              search={search}
              revision={data}
            />
          )}
          {tab === 'cards' && (
            <section className="collection-panel">
              <h2>{uiText('الكروت الموجهة إليك')}</h2>
              <div className="collection-grid">
                {data.assignments.filter(
                  (item) => !search || (item.customerName + ' ' + (item.phone ?? '')).includes(search),
                ).length === 0 ? (
                  <p className="muted">
                    {search ? uiText('لا توجد كروت مطابقة للبحث.') : uiText('لا توجد كروت موجهة حاليًا.')}
                  </p>
                ) : (
                  data.assignments
                    .filter(
                      (item) => !search || (item.customerName + ' ' + (item.phone ?? '')).includes(search),
                    )
                    .map((assignment) => {
                      const inactive = assignment.balanceUnits === 0;
                      return (
                        <article
                          className={`collection-card ${assignmentTone(assignment)}`}
                          key={assignment.id}
                        >
                          <span>{assignment.assigneeName}</span>
                          <strong>{assignment.customerName}</strong>
                          <small className="employee-balance-label">{uiText('الرصيد الحالي')}</small>
                          <b>
                            {collectionMoney.format(assignment.balanceUnits)} {uiText(' د.ل')}
                          </b>
                          <small>{assignment.phone || uiText('لا يوجد رقم هاتف')}</small>
                          <EmployeeAssignmentReceipts id={assignment.id} revision={data} />
                          <div className="collector-actions">
                            <button
                              disabled={
                                inactive ||
                                Boolean(assignment.hasPending) ||
                                busy === assignment.id ||
                                assignment.balanceUnits <= 0
                              }
                              onClick={() => void submit(assignment.id, 'full', assignment.balanceUnits)}
                            >
                              {uiText('استلام كلي')}
                            </button>
                            {inactive || Boolean(assignment.hasPendingFull) ? (
                              <button disabled>{uiText('استلام جزئي')}</button>
                            ) : (
                              <details className="partial-collection-details">
                                <summary>{uiText('استلام جزئي')}</summary>
                                <PartialReceiptForm
                                  busy={busy === assignment.id}
                                  submit={(amount) => submit(assignment.id, 'partial', amount)}
                                />
                              </details>
                            )}
                            <a
                              className={inactive || !assignment.phone ? 'disabled' : ''}
                              href={!inactive && assignment.phone ? `tel:${assignment.phone}` : undefined}
                            >
                              <Phone size={15} />
                              {uiText('اتصال')}
                            </a>
                          </div>
                        </article>
                      );
                    })
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
