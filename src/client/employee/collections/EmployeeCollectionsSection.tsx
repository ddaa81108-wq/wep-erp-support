import { useState, type FormEvent } from 'react';
import { Phone, Plus, WalletCards, X } from 'lucide-react';
import { api } from '../../api.ts';
import {
  assignmentTone,
  collectionMoney,
  useCollectionsDashboard,
} from '../../sections/collections/useCollectionsDashboard.ts';
import { CollectionPayrollPanel } from '../../sections/collections/CollectionPayrollPanel.tsx';

export function EmployeeCollectionsSection() {
  const { data, error, busy, setError, setBusy, load, run } = useCollectionsDashboard();
  const [creating, setCreating] = useState(false);
  const [payrollOpen, setPayrollOpen] = useState(false);
  async function submit(id: string, mode: 'full' | 'partial', amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setError('اكتب قيمة صحيحة أكبر من صفر.');
      return;
    }
    await run(id, () => api.submitCollection(id, mode, amount));
  }
  function submitPartial(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    void submit(id, 'partial', Number(new FormData(event.currentTarget).get('amount')));
  }
  async function createUnlinked(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const customerName = String(values.get('customerName') ?? '').trim();
    const amountUnits = Number(values.get('amountUnits'));
    if (customerName.length < 2) {
      setError('اكتب اسم العميل بوضوح.');
      return;
    }
    if (!Number.isSafeInteger(amountUnits) || amountUnits <= 0) {
      setError('اكتب قيمة صحيحة أكبر من صفر.');
      return;
    }
    setBusy('unlinked-create');
    setError('');
    try {
      await api.createUnlinkedCollectionReceipt(customerName, amountUnits, crypto.randomUUID());
      form.reset();
      setCreating(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذر تسجيل الاستلام غير المربوط.');
    } finally {
      setBusy('');
    }
  }
  if (!data)
    return (
      <div className="empty">
        <div className="spinner" />
        <p>جارٍ تحميل الاستلامات…</p>
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
      <header className="topbar">
        <div>
          <h1>قسم استلامات الديون</h1>
          <p>الكروت الموجهة إليك للاستلام</p>
        </div>
        <button className="primary compact-action" onClick={() => setCreating((value) => !value)}>
          {creating ? <X size={15} /> : <Plus size={15} />} {creating ? 'إغلاق الخانات' : 'إنشاء عميل مستقل'}
        </button>
        <button className="secondary compact-action payroll-open-button" onClick={() => setPayrollOpen(true)}><WalletCards size={15} /> المرتبات</button>
      </header>
      <section className="collection-metrics">
        <article>
          <span>إجمالي المعتمد</span>
          <strong>{collectionMoney.format(data.metrics.collectedUnits)} د.ل</strong>
        </article>
        <article>
          <span>الكروت الموجهة</span>
          <strong>{collectionMoney.format(data.assignedCount)}</strong>
        </article>
        <article>
          <span>المنفذ</span>
          <strong>{collectionMoney.format(data.metrics.executedCount)}</strong>
        </article>
        <article>
          <span>ينتظر الاعتماد</span>
          <strong>{collectionMoney.format(data.metrics.pendingCount)}</strong>
        </article>
        <article>
          <span>غير مربوط</span>
          <strong>{collectionMoney.format(data.metrics.unlinkedPendingCount)}</strong>
        </article>
      </section>
      {error && <div className="alert error">{error}</div>}
      {creating && (
        <section className="collection-panel unlinked-create-panel">
          <header>
            <div>
              <h2>إنشاء عميل مستقل</h2>
              <p>سجّل الاسم والقيمة فقط. لن تتغير أي أرصدة حتى تربطه الإدارة بكارت أصلي وتعتمده.</p>
            </div>
          </header>
          <form onSubmit={createUnlinked}>
            <label>
              اسم العميل
              <input
                name="customerName"
                autoComplete="off"
                maxLength={160}
                required
                placeholder="اسم العميل"
              />
            </label>
            <label>
              القيمة المستلمة
              <input
                name="amountUnits"
                inputMode="numeric"
                type="number"
                min="1"
                step="1"
                required
                placeholder="القيمة"
              />
            </label>
            <button className="primary" disabled={busy === 'unlinked-create'}>
              تسجيل كارت معلّق
            </button>
          </form>
        </section>
      )}
      {data.unlinkedReceipts.length > 0 && (
        <section className="collection-panel">
          <h2>استلامات سجلتها بدون كارت موجه</h2>
          <div className="collection-grid unlinked-collection-grid">
            {data.unlinkedReceipts.map((receipt) => (
              <article
                className={`collection-card unlinked-receipt-card status-${receipt.status}`}
                key={receipt.id}
              >
                <span>{receipt.collectorName}</span>
                <strong>{receipt.customerName}</strong>
                <b>{collectionMoney.format(receipt.amountUnits)} د.ل</b>
                <small>
                  {receipt.status === 'pending'
                    ? 'معلّق — لا يؤثر على الحسابات'
                    : receipt.status === 'approved'
                      ? 'تم الربط والاعتماد'
                      : 'رفضته الإدارة'}
                </small>
                {receipt.status === 'approved' && (
                  <em>{receipt.cashReceivedAt ? 'تم استلام النقدية' : 'ينتظر استلام النقدية من الإدارة'}</em>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="collection-panel">
        <h2>الكروت الموجهة إليك</h2>
        <div className="collection-grid">
          {data.assignments.length === 0 ? (
            <p className="muted">لا توجد كروت موجهة حاليًا.</p>
          ) : (
            data.assignments.map((assignment) => {
              const payments = history(assignment.id);
              let partial = 0;
              const inactive = assignment.balanceUnits === 0;
              return (
                <article
                  className={`collection-card ${assignmentTone(assignment)} ${inactive ? 'zero-collection-card' : ''}`}
                  key={assignment.id}
                >
                  <span>{assignment.assigneeName}</span>
                  <strong>{assignment.customerName}</strong>
                  <b>{collectionMoney.format(assignment.balanceUnits)} د.ل</b>
                  <small>{assignment.phone || 'لا يوجد رقم هاتف'}</small>
                  {payments.length > 0 && (
                    <div className="collection-payment-history">
                      {payments.map((item) => {
                        if (item.mode === 'partial') partial += 1;
                        return (
                          <span key={item.id}>
                            {item.mode === 'full' ? 'استلام كلي' : `استلام جزئي ${partial}`}:{' '}
                            <b>{collectionMoney.format(item.amountUnits)} د.ل</b>
                            {item.status === 'pending' && <em>ينتظر الاعتماد</em>}
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
                      استلام كلي
                    </button>
                    {inactive || Boolean(assignment.hasPending) ? (
                      <button disabled>استلام جزئي</button>
                    ) : (
                      <details className="partial-collection-details">
                        <summary>استلام جزئي</summary>
                        <form
                          className="partial-collection-form"
                          onSubmit={(event) => submitPartial(event, assignment.id)}
                        >
                          <label>
                            القيمة
                            <input
                              name="amount"
                              inputMode="numeric"
                              type="number"
                              min="1"
                              step="1"
                              required
                              placeholder="المبلغ"
                            />
                          </label>
                          <button disabled={busy === assignment.id}>حفظ</button>
                        </form>
                      </details>
                    )}
                    <a
                      className={inactive || !assignment.phone ? 'disabled' : ''}
                      href={!inactive && assignment.phone ? `tel:${assignment.phone}` : undefined}
                    >
                      <Phone size={15} />
                      اتصال
                    </a>
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
