import { uiText } from '../../i18n/language.ts';
import { useUnsavedForm } from '../../dashboard/useUnsavedForm.ts';
import { OutstandingCollectionCash } from '../../sections/collections/OutstandingCollectionCash.tsx';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Phone } from 'lucide-react';
import { api, ApiError } from '../../api.ts';
import { readPendingCollections, writePendingCollections, type PendingCollectionRequest } from './pendingCollectionRequests.ts';
import {
  assignmentTone,
  collectionMoney,
  useCollectionsDashboard,
} from '../../sections/collections/useCollectionsDashboard.ts';
import { CollectionsOverview } from '../../sections/collections/CollectionsOverview.tsx';
import { CollectionPayrollPanel } from '../../sections/collections/CollectionPayrollPanel.tsx';

function PartialReceiptForm({ busy, submit }: { busy: boolean; submit: (amount: number) => Promise<boolean> }) {
  const { bindForm, trackChanges, markSaved } = useUnsavedForm(busy);
  return <form ref={bindForm} onInput={trackChanges} onChange={trackChanges} className="partial-collection-form"
    onSubmit={async event => {
      event.preventDefault();
      if (await submit(Number(new FormData(event.currentTarget).get('amount')))) markSaved();
    }}>
    <label>{uiText("القيمة")}<input name="amount" inputMode="numeric" type="number" min="1" step="1" required placeholder={uiText("المبلغ")} /></label>
    <button disabled={busy}>{uiText("حفظ")}</button>
  </form>;
}

export function EmployeeCollectionsSection({ userId }: { userId: string }) {
  const { data, error, busy, setError, setBusy, load, run } = useCollectionsDashboard();
  const [creating, setCreating] = useState(false);
  const { bindForm: bindCreate, trackChanges: changeCreate, markSaved: savedCreate, confirmLeave: leaveCreate } = useUnsavedForm(busy === 'unlinked-create');
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
    try { setPendingRequests(readPendingCollections(localStorage, userId)); }
    catch { setError(uiText('تعذر قراءة سجل الطلبات المعلقة على هذا الجهاز. راجع الدعم قبل إرسال تحصيل جديد.')); }
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
          await api.submitCollection(request.assignmentId, request.mode, request.amountUnits, request.requestId);
          keepRequests(readPendingCollections(localStorage, userId).filter(item => item.requestId !== request.requestId));
        } catch (caught) {
          // Network/5xx/invalid responses may hide an accepted write: retain the exact payload.
          if (!recovering && caught instanceof ApiError && [400, 401, 403, 404, 409].includes(caught.status)
            && !['REQUEST_ID_REUSED', 'LEGACY_REQUEST_REVIEW_REQUIRED', 'INVALID_SERVER_RESPONSE', 'REQUEST_FAILED'].includes(caught.code)) {
            keepRequests(readPendingCollections(localStorage, userId).filter(item => item.requestId !== request.requestId));
          }
          throw caught;
        }
      });
    } finally { submitting.current = false; }
  }
  async function submit(id: string, mode: 'full' | 'partial', amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setError(uiText("اكتب قيمة صحيحة أكبر من صفر."));
      return false;
    }
    if (submitting.current) return false;
    try {
      const requests = readPendingCollections(localStorage, userId);
      const previous = requests.find(item => item.assignmentId === id);
      if (previous && (previous.mode !== mode || previous.amountUnits !== amount)) {
        setError(uiText('توجد محاولة سابقة لم يتأكد ردها. أعد التحقق منها قبل تغيير المبلغ أو نوع التحصيل.'));
        return false;
      }
      const request = previous ?? { assignmentId: id, mode, amountUnits: amount, requestId: crypto.randomUUID() };
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
      setError(uiText("اكتب اسم العميل بوضوح."));
      return;
    }
    if (!Number.isSafeInteger(amountUnits) || amountUnits <= 0) {
      setError(uiText("اكتب قيمة صحيحة أكبر من صفر."));
      return;
    }
    setBusy('unlinked-create');
    setError('');
    try {
      await api.createUnlinkedCollectionReceipt(customerName, amountUnits, crypto.randomUUID());
      form.reset();
      savedCreate();
      setCreating(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : uiText("تعذر تسجيل الاستلام غير المربوط."));
    } finally {
      setBusy('');
    }
  }
  if (!data)
    return (
      <div className="empty">
        <div className="spinner" />
        <p>{uiText("جارٍ تحميل الاستلامات…")}</p>
        {error && <div className="alert error">{error}</div>}
      </div>
    );
  const history = (id: string) =>
    [...data.submissions].filter((item) => item.assignmentId === id && item.status !== 'rejected').reverse();
  if (payrollOpen) {
    return <div className="collections-page employee-collections-page"><CollectionPayrollPanel isAdmin={false} onClose={() => setPayrollOpen(false)} /></div>;
  }
  return (
    <div className="collections-page employee-collections-page">
      <CollectionsOverview data={data} description={uiText("الكروت الموجهة إليك للاستلام")} onPayroll={() => { if (leaveCreate()) setPayrollOpen(true); }} creating={creating} onToggleCreate={() => { if (!creating || leaveCreate()) setCreating((value) => !value); }} />
      <OutstandingCollectionCash items={[...(data.outstandingCancelledSubmissions ?? []), ...(data.outstandingClosedUnlinkedReceipts ?? []).map(item => ({ ...item, receiptKind: 'unlinked' as const }))]} busy={busy} />
      {error && <div className="alert error">{error}</div>}
      {pendingRequests.length > 0 && <section className="collection-panel pending-collection-recovery">
        <h2>{uiText('تحصيلات تحتاج تأكيد نتيجة الإرسال')}</h2>
        <p>{uiText('أعد التحقق بنفس الطلب؛ لن يُنشأ استلام آخر إذا كان محفوظًا من قبل.')}</p>
        {pendingRequests.map(request => <button key={request.requestId} disabled={Boolean(busy)}
          onClick={() => void sendPending(request)}>
          {uiText('إعادة التحقق من الاستلام السابق')} — {collectionMoney.format(request.amountUnits)} {uiText('د.ل')}
        </button>)}
      </section>}
      {creating && (
        <section id="collection-create-form" ref={createPanel} className="collection-panel unlinked-create-panel">
          <header>
            <div>
              <h2>{uiText("إنشاء عميل مستقل")}</h2>
              <p>{uiText("سجّل الاسم والقيمة فقط. لن تتغير أي أرصدة حتى تربطه الإدارة بكارت أصلي وتعتمده.")}</p>
              <p className="muted">{uiText('عملة الاستلام: دينار ليبي فقط — الربط بحسابات الدينار دون تحويل.')}</p>
            </div>
          </header>
          <form ref={bindCreate} onInput={changeCreate} onChange={changeCreate} onSubmit={createUnlinked}>
            <label>
              {uiText("اسم العميل")}<input
                name="customerName"
                autoComplete="off"
                maxLength={160}
                required
                placeholder={uiText("اسم العميل")}
              />
            </label>
            <label>
              {uiText("القيمة المستلمة")}<input
                name="amountUnits"
                inputMode="numeric"
                type="number"
                min="1"
                step="1"
                required
                placeholder={uiText("القيمة")}
              />
            </label>
            <button className="primary" disabled={busy === 'unlinked-create'}>
              {uiText("تسجيل كارت معلّق")}</button>
          </form>
        </section>
      )}
      {data.unlinkedReceipts.length > 0 && (
        <section className="collection-panel">
          <h2>{uiText("استلامات سجلتها بدون كارت موجه")}</h2>
          <div className="collection-grid unlinked-collection-grid">
            {data.unlinkedReceipts.map((receipt) => (
              <article
                className={`collection-card unlinked-receipt-card status-${receipt.status}`}
                key={receipt.id}
              >
                <span>{receipt.collectorName}</span>
                <strong>{receipt.customerName}</strong>
                <b>{collectionMoney.format(receipt.amountUnits)} {uiText(" د.ل")}</b>
                <small>
                  {receipt.status === 'pending'
                    ? uiText("معلّق — لا يؤثر على الحسابات")
                    : receipt.status === 'approved'
                      ? uiText("تم الربط والاعتماد")
                      : uiText("رفضته الإدارة")}
                </small>
                {receipt.status === 'approved' && (
                  <em>{receipt.cashReceivedAt ? uiText("تم استلام النقدية") : uiText("ينتظر استلام النقدية من الإدارة")}</em>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="collection-panel">
        <h2>{uiText("الكروت الموجهة إليك")}</h2>
        <div className="collection-grid">
          {data.assignments.length === 0 ? (
            <p className="muted">{uiText("لا توجد كروت موجهة حاليًا.")}</p>
          ) : (
            data.assignments.map((assignment) => {
              const payments = history(assignment.id);
              let partial = 0;
              const inactive = assignment.balanceUnits === 0;
              return (
                <article
                  className={`collection-card ${assignmentTone(assignment)}`}
                  key={assignment.id}
                >
                  <span>{assignment.assigneeName}</span>
                  <strong>{assignment.customerName}</strong>
                  <b>{collectionMoney.format(assignment.balanceUnits)} {uiText(" د.ل")}</b>
                  <small>{assignment.phone || uiText("لا يوجد رقم هاتف")}</small>
                  {payments.length > 0 && (
                    <div className="collection-payment-history">
                      {payments.map((item) => {
                        if (item.mode === 'partial') partial += 1;
                        return (
                          <span key={item.id}>
                            {item.mode === 'full' ? uiText("استلام كلي") : uiText("استلام جزئي {0}", [partial])}:{' '}
                            <b>{collectionMoney.format(item.amountUnits)} {uiText(" د.ل")}</b>
                            {item.status === 'pending' && <em>{uiText("ينتظر الاعتماد")}</em>}
                          </span>
                        );
                      })}
                    </div>
                  )}
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
                      {uiText("استلام كلي")}</button>
                    {inactive || Boolean(assignment.hasPendingFull) ? (
                      <button disabled>{uiText("استلام جزئي")}</button>
                    ) : (
                      <details className="partial-collection-details">
                        <summary>{uiText("استلام جزئي")}</summary>
                        <PartialReceiptForm busy={busy === assignment.id} submit={amount => submit(assignment.id, 'partial', amount)} />
                      </details>
                    )}
                    <a
                      className={inactive || !assignment.phone ? 'disabled' : ''}
                      href={!inactive && assignment.phone ? `tel:${assignment.phone}` : undefined}
                    >
                      <Phone size={15} />
                      {uiText("اتصال")}</a>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
