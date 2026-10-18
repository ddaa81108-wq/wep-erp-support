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
          modeLabel: item.mode === 'full' ? 'كلي' : 'جزئي',
          amountUnits: item.amountUnits,
          cashReceivedAt: item.cashReceivedAt,
        })) ?? []),
      ...(data?.unlinkedReceipts
        .filter((item) => item.batchId === batchId && item.status === 'approved')
        .map((item) => ({
          collectorName: item.collectorName,
          customerName: item.customerName,
          phone: null,
          modeLabel: 'استلام ربطته الإدارة',
          amountUnits: item.amountUnits,
          cashReceivedAt: item.cashReceivedAt,
        })) ?? []),
    ];
    try {
      const report = document.createElement('div');
      report.dir = 'rtl';
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
      title.textContent = 'كشف استلامات الديون';
      report.append(title);
      const date = document.createElement('p');
      date.textContent = `يوم العمل: ${businessDate}`;
      report.append(date);
      const table = document.createElement('table');
      Object.assign(table.style, { width: '100%', borderCollapse: 'collapse', fontSize: '14px' });
      const header = document.createElement('tr');
      for (const value of ['الموظف', 'العميل', 'الهاتف', 'نوع الاستلام', 'القيمة', 'استلام الإدارة']) {
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
          `${collectionMoney.format(row.amountUnits)} د.ل`,
          row.cashReceivedAt ? 'تم' : 'لم يتم',
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
      total.textContent = `إجمالي اليوم: ${collectionMoney.format(rows.reduce((sum, row) => sum + row.amountUnits, 0))} د.ل`;
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
      pdf.save(`كشف-استلامات-${businessDate}.pdf`);
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
      await api.closeCollectionDay(id);
      setClosingBatchId('');
      await load();
    } catch (caught) {
      setError(collectionError(caught));
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
  const selectedBatch = data.openBatches.find(batch => batch.id === selectedBatchId) ?? data.openBatches[0];
  const batchHasCards = (id: string) => data.assignments.some(item => item.batchId === id)
    || data.unlinkedReceipts.some(item => item.batchId === id && item.status !== 'rejected');
  const history = (id: string) =>
    [...data.submissions].filter((item) => item.assignmentId === id && item.status !== 'rejected').reverse();
  if (payrollOpen) {
    return <div className="collections-page admin-collections-page"><CollectionPayrollPanel isAdmin onClose={() => setPayrollOpen(false)} /></div>;
  }
  return (
    <div className="collections-page admin-collections-page">
      <CollectionsOverview data={data} description="متابعة الموظفين، الاعتماد، واستلام النقدية" onPayroll={() => setPayrollOpen(true)} desktopBatchActions={<div className="collection-desktop-batch-actions">
        {data.openBatches.length > 1 && <select aria-label="دفعة العمل" value={selectedBatch.id} onChange={event => setSelectedBatchId(event.target.value)}>{data.openBatches.map(batch => <option key={batch.id} value={batch.id}>{batch.businessDate} • دفعة {batch.batchNumber}</option>)}</select>}
        <button className={`compact-action batch-close-button ${selectedBatch && batchHasCards(selectedBatch.id) ? 'batch-occupied' : 'batch-empty'}`} disabled={busy !== '' || !selectedBatch} onClick={() => selectedBatch && setClosingBatchId(selectedBatch.id)}><X size={16} aria-hidden="true" />إغلاق ومسح الدفعة</button>
        <button className="compact-action" disabled={busy !== '' || !selectedBatch} onClick={() => selectedBatch && void exportPdf(selectedBatch.id, selectedBatch.businessDate)}>كشف PDF</button>
      </div>} />
      {data.employeeTotals && data.employeeTotals.length > 0 && (
        <section className="collection-panel employee-totals-panel" aria-label="تفصيل إجماليات الموظفين">
          <h2>إجماليات الموظفين</h2>
          <p className="muted">تفصيل إداري للمتابعة، مع بقاء الإجمالي العام أعلاه كما هو.</p>
          <div className="employee-totals-grid">
            {data.employeeTotals.map((employee) => (
              <article className="employee-total-card" key={employee.employeeId}>
                <strong>{employee.employeeName}</strong>
                <b>{collectionMoney.format(employee.collectedUnits)} د.ل</b>
                <span>معتمد: {collectionMoney.format(employee.approvedCount)} · ينتظر: {collectionMoney.format(employee.pendingCount)}</span>
              </article>
            ))}
          </div>
        </section>
      )}
      <OutstandingCollectionCash items={data.outstandingCancelledSubmissions ?? []} busy={busy} onReceive={(id) => void cash(id)} />
      {error && <div className="alert error">{error}</div>}
      <UnlinkedReceiptsPanel
        receipts={data.unlinkedReceipts}
        busy={busy}
        setBusy={setBusy}
        setError={setError}
        load={load}
      />
      <section className="collection-panel admin-collection-panel">
        <h2>متابعة استلامات الموظفين</h2>
        <div className="admin-collection-grid">
          {data.assignments.length === 0 ? (
            <p className="muted">لا توجد كروت موجهة.</p>
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
                    <b>{collectionMoney.format(assignment.balanceUnits)} د.ل</b>
                  </header>
                  <div className="admin-card-history">
                    {payments.length === 0 ? (
                      <small>لم يسجل الموظف استلامًا بعد.</small>
                    ) : (
                      payments.map((item) => {
                        if (item.mode === 'partial') partial += 1;
                        return (
                          <article key={item.id}>
                            <div>
                              <strong>
                                {item.mode === 'full' ? 'استلام كلي' : `استلام جزئي ${partial}`}
                              </strong>
                              <span>{collectionMoney.format(item.amountUnits)} د.ل</span>
                            </div>
                            {item.status === 'pending' ? (
                              <div className="admin-inline-actions">
                                <button
                                  className="approve"
                                  disabled={busy === item.id}
                                  onClick={() => void decide(item.id, 'approve')}
                                >
                                  <Check size={14} />
                                  اعتماد
                                </button>
                                <button
                                  className="reject"
                                  disabled={busy === item.id}
                                  onClick={() => void decide(item.id, 'reject')}
                                >
                                  <X size={14} />
                                  رفض
                                </button>
                              </div>
                            ) : item.cashReceivedAt ? (
                              <em>تم استلام النقدية</em>
                            ) : (
                              <button
                                className="cash-button"
                                disabled={busy === item.id}
                                onClick={() => void cash(item.id)}
                              >
                                <WalletCards size={14} />
                                تم استلام النقدية
                              </button>
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
          <h2>إغلاق دفعة العمل</h2>
          {data.openBatches.length === 0 && <button className="batch-close-button batch-empty" disabled><X size={16} aria-hidden="true" />إغلاق ومسح الدفعة</button>}
          {data.openBatches.map((batch) => (
            <article key={batch.id}>
              <strong>
                {batch.businessDate} • دفعة {batch.batchNumber}
              </strong>
              <button disabled={busy !== ''} onClick={() => void exportPdf(batch.id, batch.businessDate)}>
                كشف PDF اختياري
              </button>
              <button className={`batch-close-button ${batchHasCards(batch.id) ? 'batch-occupied' : 'batch-empty'}`} disabled={busy !== ''} onClick={() => setClosingBatchId(batch.id)}><X size={16} aria-hidden="true" />
                إغلاق ومسح الدفعة
              </button>
            </article>
          ))}
        </section>
      )}
      {closingBatchId && (
        <div className="collection-confirm-shade">
          <section role="dialog" aria-modal="true">
            <h3>تأكيد مسح دفعة العمل</h3>
            <p>
              هل تم اعتماد جميع العمليات واستلام النقدية بالكامل؟ ستُمسح الدفعة نهائيًا، ولن يتأثر سجل ديون
              العملاء.
            </p>
            <div>
              <button onClick={() => setClosingBatchId('')}>لا</button>
              <button className="danger" disabled={busy !== ''} onClick={() => void closeDay()}>
                نعم، امسح الدفعة
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
