import { direction, uiText } from '../../i18n/language.ts';
import { OutstandingCollectionCash } from '../../sections/collections/OutstandingCollectionCash.tsx';
import { useState } from 'react';
import { Check, WalletCards, X } from 'lucide-react';
import { api } from '../../api.ts';
import {
  assignmentTone,
  collectionError,
  collectionMoney,
  useCollectionsDashboard,
} from '../../sections/collections/useCollectionsDashboard.ts';
import { UnlinkedReceiptsPanel } from './UnlinkedReceiptsPanel.tsx';
import { CollectionsOverview } from '../../sections/collections/CollectionsOverview.tsx';
import { CollectionPayrollPanel } from '../../sections/collections/CollectionPayrollPanel.tsx';

export function AdminCollectionsSection() {
  const { data, error, busy, setError, setBusy, load, run } = useCollectionsDashboard();
  const [closingBatchId, setClosingBatchId] = useState('');
  const [cashException, setCashException] = useState<{ expectedCashPendingCount: number; expectedCashPendingUnits: number } | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const openCloseDialog = (id: string) => {
    setClosingBatchId(id); setCashException(null); setCloseReason(''); setError('');
  };
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [payrollOpen, setPayrollOpen] = useState(false);
  const decide = (id: string, decision: 'approve' | 'reject') =>
    run(id, () => api.decideCollection(id, decision));
  const cash = (id: string) => run(id, () => api.receiveCollectionCash(id));
  async function exportPdf(batchId: string, businessDate: string) {
    setBusy(`pdf-${batchId}`);
    setError('');
    const rows = [
      ...(data?.submissions
        .filter((item) => item.batchId === batchId && item.status === 'approved')
        .map((item) => ({
          collectorName: item.collectorName,
          customerName: item.customerName,
          phone: item.phone,
          modeLabel: item.mode === 'full' ? uiText("كلي") : uiText("جزئي"),
          amountUnits: item.amountUnits,
          cashReceivedAt: item.cashReceivedAt,
        })) ?? []),
      ...(data?.unlinkedReceipts
        .filter((item) => item.batchId === batchId && item.status === 'approved')
        .map((item) => ({
          collectorName: item.collectorName,
          customerName: item.customerName,
          phone: null,
          modeLabel: uiText("استلام ربطته الإدارة"),
          amountUnits: item.amountUnits,
          cashReceivedAt: item.cashReceivedAt,
        })) ?? []),
    ];
    try {
      const report = document.createElement('div');
      report.dir = direction;
      Object.assign(report.style, {
        position: 'fixed',
        right: '-10000px',
        top: '0',
        width: '800px',
        padding: '34px',
        background: '#fff',
        color: '#17221f',
        fontFamily: 'Cairo, sans-serif',
      });
      const title = document.createElement('h1');
      title.textContent = uiText("كشف استلامات الديون");
      report.append(title);
      const date = document.createElement('p');
      date.textContent = uiText("يوم العمل: {0}", [businessDate]);
      report.append(date);
      const table = document.createElement('table');
      Object.assign(table.style, { width: '100%', borderCollapse: 'collapse', fontSize: '14px' });
      const header = document.createElement('tr');
      for (const value of [uiText("الموظف"), uiText("العميل"), uiText("الهاتف"), uiText("نوع الاستلام"), uiText("القيمة"), uiText("استلام الإدارة")]) {
        const cell = document.createElement('th');
        cell.textContent = value;
        cell.style.border = '1px solid #999';
        cell.style.padding = '7px';
        header.append(cell);
      }
      table.append(header);
      for (const row of rows) {
        const line = document.createElement('tr');
        for (const value of [
          row.collectorName,
          row.customerName,
          row.phone || '—',
          row.modeLabel,
          uiText("{0} د.ل", [collectionMoney.format(row.amountUnits)]),
          row.cashReceivedAt ? uiText("تم") : uiText("لم يتم"),
        ]) {
          const cell = document.createElement('td');
          cell.textContent = value;
          cell.style.border = '1px solid #bbb';
          cell.style.padding = '7px';
          line.append(cell);
        }
        table.append(line);
      }
      report.append(table);
      const total = document.createElement('h2');
      total.textContent = uiText("إجمالي اليوم: {0} د.ل", [collectionMoney.format(rows.reduce((sum, row) => sum + row.amountUnits, 0))]);
      report.append(total);
      document.body.append(report);
      const [canvasModule, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const renderCanvas = (canvasModule.default ?? canvasModule) as unknown as (
        element: HTMLElement,
        options: Record<string, unknown>,
      ) => Promise<HTMLCanvasElement>;
      const canvas = await renderCanvas(report, { scale: 2, backgroundColor: '#ffffff' });
      report.remove();
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const width = 190;
      const height = (canvas.height * width) / canvas.width;
      const pageHeight = 277;
      const image = canvas.toDataURL('image/png');
      for (let offset = 0, page = 0; offset < height; offset += pageHeight, page += 1) {
        if (page > 0) pdf.addPage();
        pdf.addImage(image, 'PNG', 10, 10 - offset, width, height);
      }
      pdf.save(uiText("كشف-استلامات-{0}.pdf", [businessDate]));
    } catch (caught) {
      setError(collectionError(caught));
    } finally {
      setBusy('');
    }
  }
  async function closeDay() {
    const id = closingBatchId;
    if (!id) return;
    setBusy(`close-${id}`);
    setError('');
    try {
      await api.closeCollectionDay(id, cashException ? { ...cashException, reason: closeReason.trim() } : undefined);
      setClosingBatchId('');
      await load();
    } catch (caught) {
      setError(collectionError(caught));
      setCashException(null);
      await load().catch(() => undefined);
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
  const selectedBatch = data.openBatches.find(batch => batch.id === selectedBatchId) ?? data.openBatches[0];
  const closingBatch = data.openBatches.find(batch => batch.id === closingBatchId);
  const hasOutstandingCash = (closingBatch?.cashPendingCount ?? 0) > 0;
  const cashChanged = cashException && (cashException.expectedCashPendingCount !== closingBatch?.cashPendingCount || cashException.expectedCashPendingUnits !== closingBatch?.cashPendingUnits);
  const previousCash = [...(data.outstandingCancelledSubmissions ?? []), ...(data.outstandingClosedUnlinkedReceipts ?? []).map(item => ({ ...item, receiptKind: 'unlinked' as const }))];
  const batchHasCards = (id: string) => data.assignments.some(item => item.batchId === id)
    || data.unlinkedReceipts.some(item => item.batchId === id && item.status !== 'rejected');
  const history = (id: string) =>
    [...data.submissions].filter((item) => item.assignmentId === id && item.status !== 'rejected').reverse();
  if (payrollOpen) {
    return <div className="collections-page admin-collections-page"><CollectionPayrollPanel isAdmin onClose={() => setPayrollOpen(false)} /></div>;
  }
  return (
    <div className="collections-page admin-collections-page">
      <CollectionsOverview data={data} description={uiText("متابعة الموظفين، الاعتماد، واستلام النقدية")} onPayroll={() => setPayrollOpen(true)} desktopBatchActions={<div className="collection-desktop-batch-actions">
        {data.openBatches.length > 1 && <select aria-label={uiText("دفعة العمل")} value={selectedBatch.id} onChange={event => setSelectedBatchId(event.target.value)}>{data.openBatches.map(batch => <option key={batch.id} value={batch.id}>{batch.businessDate} {uiText(" • دفعة ")}{batch.batchNumber}</option>)}</select>}
        <button className={`compact-action batch-close-button ${selectedBatch && batchHasCards(selectedBatch.id) ? 'batch-occupied' : 'batch-empty'}`} disabled={busy !== '' || !selectedBatch} onClick={() => selectedBatch && openCloseDialog(selectedBatch.id)}><X size={16} aria-hidden="true" />{uiText("إغلاق ومسح الدفعة")}</button>
        <button className="compact-action" disabled={busy !== '' || !selectedBatch} onClick={() => selectedBatch && void exportPdf(selectedBatch.id, selectedBatch.businessDate)}>{uiText("كشف PDF")}</button>
      </div>} />
      {data.employeeTotals && data.employeeTotals.length > 0 && (
        <section className="collection-panel employee-totals-panel" aria-label={uiText("تفصيل إجماليات الموظفين")}>
          <div className="employee-totals-row">
            <h2>{uiText("إجماليات الموظفين")}</h2>
            <p className="muted">{uiText("تفصيل إداري")}</p>
          </div>
          <div className="employee-totals-grid">
            {data.employeeTotals.map((employee) => (
              <article className="employee-total-card" key={employee.employeeId}>
                <strong>{employee.employeeName}</strong>
                <b>{collectionMoney.format(employee.collectedUnits)} {uiText(" د.ل")}</b>
                <span>{uiText("معتمد ")}{collectionMoney.format(employee.approvedCount)} {uiText(" · ينتظر ")}{collectionMoney.format(employee.pendingCount)}</span>
              </article>
            ))}
          </div>
        </section>
      )}
      <OutstandingCollectionCash items={previousCash} busy={busy} onReceive={(id, kind) => kind === 'unlinked' ? void run(id, () => api.receiveUnlinkedCollectionCash(id)) : void cash(id)} />
      {error && <div className="alert error">{error}</div>}
      <UnlinkedReceiptsPanel
        receipts={data.unlinkedReceipts}
        busy={busy}
        setBusy={setBusy}
        setError={setError}
        load={load}
      />
      <section className="collection-panel admin-collection-panel">
        <h2>{uiText("متابعة استلامات الموظفين")}</h2>
        <div className="admin-collection-grid">
          {data.assignments.length === 0 ? (
            <p className="muted">{uiText("لا توجد كروت موجهة.")}</p>
          ) : (
            data.assignments.map((assignment) => {
              const payments = history(assignment.id);
              let partial = 0;
              return (
                <article
                  className={`admin-customer-collection-card ${assignmentTone(assignment)}`}
                  key={assignment.id}
                >
                  <header>
                    <div>
                      <strong>{assignment.customerName}</strong>
                      <span>{assignment.assigneeName}</span>
                    </div>
                    <b>{collectionMoney.format(assignment.balanceUnits)} {uiText(" د.ل")}</b>
                  </header>
                  <div className="admin-card-history">
                    {payments.length === 0 ? (
                      <small>{uiText("لم يسجل الموظف استلامًا بعد.")}</small>
                    ) : (
                      payments.map((item) => {
                        if (item.mode === 'partial') partial += 1;
                        return (
                          <article key={item.id}>
                            <div>
                              <strong>
                                {item.mode === 'full' ? uiText("استلام كلي") : uiText("استلام جزئي {0}", [partial])}
                              </strong>
                              <span>{collectionMoney.format(item.amountUnits)} {uiText(" د.ل")}</span>
                            </div>
                            {item.status === 'pending' ? (
                              <div className="admin-inline-actions">
                                <button
                                  className="approve"
                                  disabled={busy === item.id}
                                  onClick={() => void decide(item.id, 'approve')}
                                >
                                  <Check size={14} />
                                  {uiText("اعتماد")}</button>
                                <button
                                  className="reject"
                                  disabled={busy === item.id}
                                  onClick={() => void decide(item.id, 'reject')}
                                >
                                  <X size={14} />
                                  {uiText("رفض")}</button>
                              </div>
                            ) : item.cashReceivedAt ? (
                              <em>{uiText("تم استلام النقدية")}</em>
                            ) : (
                              <button
                                className="cash-button"
                                disabled={busy === item.id}
                                onClick={() => void cash(item.id)}
                              >
                                <WalletCards size={14} />
                                {uiText("تم استلام النقدية")}</button>
                            )}
                          </article>
                        );
                      })
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
      {(
        <section className="collection-panel day-actions">
          <h2>{uiText("إغلاق دفعة العمل")}</h2>
          {data.openBatches.length === 0 && <button className="batch-close-button batch-empty" disabled><X size={16} aria-hidden="true" />{uiText("إغلاق ومسح الدفعة")}</button>}
          {data.openBatches.map((batch) => (
            <article key={batch.id}>
              <strong>
                {batch.businessDate} {uiText(" • دفعة ")}{batch.batchNumber}
              </strong>
              <button disabled={busy !== ''} onClick={() => void exportPdf(batch.id, batch.businessDate)}>
                {uiText("كشف PDF اختياري")}</button>
              <button className={`batch-close-button ${batchHasCards(batch.id) ? 'batch-occupied' : 'batch-empty'}`} disabled={busy !== ''} onClick={() => openCloseDialog(batch.id)}><X size={16} aria-hidden="true" />
                {uiText("إغلاق ومسح الدفعة")}</button>
            </article>
          ))}
        </section>
      )}
      {closingBatchId && (
        <div className="collection-confirm-shade">
          <section role="dialog" aria-modal="true">
            <h3>{uiText("تأكيد مسح دفعة العمل")}</h3>
            <p>{hasOutstandingCash ? uiText("الإغلاق العادي يتطلب استلام النقدية بالكامل. يمكن للإدارة الإغلاق الاستثنائي مع حفظ المبالغ غير المستلمة وسجلاتها.") : uiText("هل تم اعتماد جميع العمليات واستلام النقدية بالكامل؟ ستُمسح الدفعة نهائيًا، ولن يتأثر سجل ديون العملاء.")}</p>
            {(closingBatch?.pendingCount ?? 0) > 0 && <p role="alert">{uiText("توجد عمليات تنتظر الاعتماد. راجعها قبل إغلاق الدفعة.")}</p>}
            {hasOutstandingCash && <>
              <p className="alert error">{uiText("نقدية غير مستلمة: {0} د.ل — {1} استلام", [collectionMoney.format(closingBatch!.cashPendingUnits ?? 0), closingBatch!.cashPendingCount ?? 0])}</p>
              <label className="collection-close-exception">
                <input type="checkbox" checked={Boolean(cashException)} disabled={busy !== '' || (closingBatch?.pendingCount ?? 0) > 0} onChange={event => { setError(''); setCashException(event.target.checked ? { expectedCashPendingCount: closingBatch!.cashPendingCount!, expectedCashPendingUnits: closingBatch!.cashPendingUnits! } : null); }} />
                {uiText("إغلاق استثنائي مع بقاء النقدية مستحقة")}
              </label>
              {cashException && <>
                <p>{uiText("ستختفي كروت الدفعة، وتبقى الاستلامات محفوظة في «نقدية سابقة لم تُسلّم» حتى استلامها فعليًا. لا تتغير أرصدة العملاء.")}</p>
                <label className="collection-close-reason">{uiText("سبب الإغلاق الاستثنائي")}
                  <textarea rows={2} maxLength={500} value={closeReason} disabled={busy !== ''} onChange={event => setCloseReason(event.target.value)} />
                </label>
              </>}
              {cashChanged && <p role="alert">{uiText("تغيّرت النقدية غير المستلمة. ألغِ التحديد وراجع القيم ثم أعد التأكيد.")}</p>}
            </>}
            {error && <p role="alert" className="alert error">{error}</p>}
            <div>
              <button disabled={busy !== ''} onClick={() => setClosingBatchId('')}>{uiText("لا")}</button>
              <button className="danger" disabled={busy !== '' || (closingBatch?.pendingCount ?? 0) > 0 || Boolean(cashChanged) || (hasOutstandingCash && (!cashException || closeReason.trim().length < 5))} onClick={() => void closeDay()}>
                {uiText(cashException ? "نعم، أغلق استثنائيًا" : "نعم، امسح الدفعة")}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
