import { Plus, WalletCards, X } from 'lucide-react';
import type { CollectionsDashboard } from '../../api.ts';
import { collectionMoney } from './useCollectionsDashboard.ts';

type Props = {
  data: CollectionsDashboard;
  description: string;
  onPayroll: () => void;
  creating?: boolean;
  onToggleCreate?: () => void;
};

export function CollectionsOverview({ data, description, onPayroll, creating, onToggleCreate }: Props) {
  const total = `${collectionMoney.format(data.metrics.collectedUnits)} د.ل`;
  return (
    <>
      <header className="topbar collection-overview-header">
        <div className="collection-heading">
          <h1>قسم استلامات الديون</h1>
          <p>{description}</p>
        </div>
        <div className="collection-mobile-total" aria-label={`إجمالي المعتمد: ${total}`}>
          <span>الإجمالي</span>
          <strong>{total}</strong>
        </div>
        <div className="collection-toolbar-actions">
          {onToggleCreate && (
            <button
              className="primary compact-action"
              aria-label={creating ? 'إغلاق الخانات' : 'إنشاء عميل مستقل'}
              aria-expanded={Boolean(creating)}
              aria-controls="collection-create-form"
              onClick={onToggleCreate}
            >
              {creating ? <X size={15} /> : <Plus size={15} />}
              <span className="collection-desktop-label">
                {creating ? 'إغلاق الخانات' : 'إنشاء عميل مستقل'}
              </span>
              <span className="collection-mobile-label">{creating ? 'إغلاق الخانات' : 'إنشاء عميل'}</span>
            </button>
          )}
          <button className="secondary compact-action payroll-open-button" onClick={onPayroll}>
            <WalletCards size={15} /> المرتبات
          </button>
        </div>
      </header>
      <section className="collection-metrics" aria-label="ملخص استلامات الديون">
        <article>
          <span>إجمالي المعتمد</span>
          <strong>{total}</strong>
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
    </>
  );
}
