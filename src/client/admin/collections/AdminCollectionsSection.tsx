import { direction, uiText } from '../../i18n/language.ts';
import { CollectionWorkBoard } from './CollectionWorkBoard.tsx';
import { useState } from 'react';
import { api } from '../../api.ts';
import {
  collectionError,
  collectionMoney,
  useCollectionsDashboard,
} from '../../sections/collections/useCollectionsDashboard.ts';

import { CollectionPayrollPanel } from '../../sections/collections/CollectionPayrollPanel.tsx';

export function AdminCollectionsSection() {
  const { data, error, busy, setError, setBusy, load, run } = useCollectionsDashboard();
  const [closingBatchId, setClosingBatchId] = useState('');
  const [cashException, setCashException] = useState<{
    expectedCashPendingCount: number;
    expectedCashPendingUnits: number;
  } | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const openCloseDialog = (id: string) => {
    setClosingBatchId(id);
    setCashException(null);
    setCloseReason('');
    setError('');
  };
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [payrollOpen, setPayrollOpen] = useState(false);
  async function exportPdf(batchId: string, businessDate: string) {
    setBusy(`pdf-${batchId}`);
    setError('');
    try {
      const snapshot = await api.collectionWorkspace({ batchId, state: 'all', export: '1' });
      const rows = snapshot.items.map((item) => ({
        collectorName: item.collectorName,
        customerName: item.customerName,
        phone: item.phone,
        modeLabel:
          item.kind === 'unlinked'
            ? uiText('استلام ربطته الإدارة')
            : item.mode === 'full'
              ? uiText('كلي')
              : uiText('جزئي'),
        amountUnits: item.amountUnits,
        cashReceivedAt: item.cashReceivedAt,
      }));
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
      title.textContent = uiText('كشف استلامات الديون');
      report.append(title);
      const date = document.createElement('p');
      date.textContent = uiText('يوم العمل: {0}', [businessDate]);
      report.append(date);
      const table = document.createElement('table');
      Object.assign(table.style, { width: '100%', borderCollapse: 'collapse', fontSize: '14px' });
      const header = document.createElement('tr');
      for (const value of [
        uiText('الموظف'),
        uiText('العميل'),
        uiText('الهاتف'),
        uiText('نوع الاستلام'),
        uiText('القيمة'),
        uiText('استلام الإدارة'),
      ]) {
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
          uiText('{0} د.ل', [collectionMoney.format(row.amountUnits)]),
          row.cashReceivedAt ? uiText('تم') : uiText('لم يتم'),
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
      total.textContent = uiText('إجمالي اليوم: {0} د.ل', [
        collectionMoney.format(rows.reduce((sum, row) => sum + row.amountUnits, 0)),
      ]);
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
      pdf.save(uiText('كشف-استلامات-{0}.pdf', [businessDate]));
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
      await api.closeCollectionDay(
        id,
        cashException ? { ...cashException, reason: closeReason.trim() } : undefined,
      );
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
        <p>{uiText('جارٍ تحميل الاستلامات…')}</p>
        {error && <div className="alert error">{error}</div>}
      </div>
    );
  const closingBatch = data.openBatches.find((batch) => batch.id === closingBatchId);
  const hasOutstandingCash = (closingBatch?.cashPendingCount ?? 0) > 0;
  const cashChanged =
    cashException &&
    (cashException.expectedCashPendingCount !== closingBatch?.cashPendingCount ||
      cashException.expectedCashPendingUnits !== closingBatch?.cashPendingUnits);
  if (payrollOpen) {
    return (
      <div className="collections-page admin-collections-page">
        <CollectionPayrollPanel isAdmin onClose={() => setPayrollOpen(false)} />
      </div>
    );
  }
  return (
    <div className="collections-page admin-collections-page">
      {error && !closingBatchId && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <CollectionWorkBoard
        data={data}
        busy={busy}
        selectedBatchId={selectedBatchId}
        onBatch={setSelectedBatchId}
        onPayroll={() => setPayrollOpen(true)}
        onExport={(id, date) => void exportPdf(id, date)}
        onClose={openCloseDialog}
        run={run}
        setBusy={setBusy}
        setError={setError}
        load={load}
      />
      {closingBatchId && (
        <div className="collection-confirm-shade">
          <section role="dialog" aria-modal="true">
            <h3>{uiText('تأكيد مسح دفعة العمل')}</h3>
            <p>
              {hasOutstandingCash
                ? uiText(
                    'الإغلاق العادي يتطلب استلام النقدية بالكامل. يمكن للإدارة الإغلاق الاستثنائي مع حفظ المبالغ غير المستلمة وسجلاتها.',
                  )
                : uiText(
                    'هل تم اعتماد جميع العمليات واستلام النقدية بالكامل؟ ستُمسح الدفعة نهائيًا، ولن يتأثر سجل ديون العملاء.',
                  )}
            </p>
            {(closingBatch?.pendingCount ?? 0) > 0 && (
              <p role="alert">{uiText('توجد عمليات تنتظر الاعتماد. راجعها قبل إغلاق الدفعة.')}</p>
            )}
            {hasOutstandingCash && (
              <>
                <p className="alert error">
                  {uiText('نقدية غير مستلمة: {0} د.ل — {1} استلام', [
                    collectionMoney.format(closingBatch!.cashPendingUnits ?? 0),
                    closingBatch!.cashPendingCount ?? 0,
                  ])}
                </p>
                <label className="collection-close-exception">
                  <input
                    type="checkbox"
                    checked={Boolean(cashException)}
                    disabled={busy !== '' || (closingBatch?.pendingCount ?? 0) > 0}
                    onChange={(event) => {
                      setError('');
                      setCashException(
                        event.target.checked
                          ? {
                              expectedCashPendingCount: closingBatch!.cashPendingCount!,
                              expectedCashPendingUnits: closingBatch!.cashPendingUnits!,
                            }
                          : null,
                      );
                    }}
                  />
                  {uiText('إغلاق استثنائي مع بقاء النقدية مستحقة')}
                </label>
                {cashException && (
                  <>
                    <p>
                      {uiText(
                        'ستختفي كروت الدفعة، وتبقى الاستلامات محفوظة في «نقدية سابقة لم تُسلّم» حتى استلامها فعليًا. لا تتغير أرصدة العملاء.',
                      )}
                    </p>
                    <label className="collection-close-reason">
                      {uiText('سبب الإغلاق الاستثنائي')}
                      <textarea
                        rows={2}
                        maxLength={500}
                        value={closeReason}
                        disabled={busy !== ''}
                        onChange={(event) => setCloseReason(event.target.value)}
                      />
                    </label>
                  </>
                )}
                {cashChanged && (
                  <p role="alert">
                    {uiText('تغيّرت النقدية غير المستلمة. ألغِ التحديد وراجع القيم ثم أعد التأكيد.')}
                  </p>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="alert error">
                {error}
              </p>
            )}
            <div>
              <button disabled={busy !== ''} onClick={() => setClosingBatchId('')}>
                {uiText('لا')}
              </button>
              <button
                className="danger"
                disabled={
                  busy !== '' ||
                  (closingBatch?.pendingCount ?? 0) > 0 ||
                  Boolean(cashChanged) ||
                  (hasOutstandingCash && (!cashException || closeReason.trim().length < 5))
                }
                onClick={() => void closeDay()}
              >
                {uiText(cashException ? 'نعم، أغلق استثنائيًا' : 'نعم، امسح الدفعة')}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
