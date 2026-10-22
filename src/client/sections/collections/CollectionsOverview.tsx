import { uiText } from '../../i18n/language.ts';
import type { ReactNode } from 'react';
import { Plus, WalletCards, X } from 'lucide-react';
import type { CollectionsDashboard } from '../../api.ts';
import { collectionMoney } from './useCollectionsDashboard.ts';

type Props = {
  data: CollectionsDashboard;
  description: string;
  onPayroll: () => void;
  desktopBatchActions?: ReactNode;
  creating?: boolean;
  onToggleCreate?: () => void;
};

export function CollectionsOverview({ data, description, onPayroll, creating, onToggleCreate, desktopBatchActions }: Props) {
  const total = uiText("{0} د.ل", [collectionMoney.format(data.metrics.collectedUnits)]);
  return (
    <>
      <header className="topbar collection-overview-header">
        <div className="collection-heading">
          <h1>{uiText("قسم استلامات الديون")}</h1>
          <p>{description}</p>
        </div>
        <div className="collection-mobile-total" aria-label={uiText("إجمالي المعتمد: {0}", [total])}>
          <span>{uiText("الإجمالي")}</span>
          <strong>{total}</strong>
        </div>
        <div className="collection-toolbar-actions">
          {onToggleCreate && (
            <button
              className="primary compact-action"
              aria-label={creating ? uiText("إغلاق الخانات") : uiText("إنشاء عميل مستقل")}
              aria-expanded={Boolean(creating)}
              aria-controls="collection-create-form"
              onClick={onToggleCreate}
            >
              {creating ? <X size={15} /> : <Plus size={15} />}
              <span className="collection-desktop-label">
                {creating ? uiText("إغلاق الخانات") : uiText("إنشاء عميل مستقل")}
              </span>
              <span className="collection-mobile-label">{creating ? uiText("إغلاق الخانات") : uiText("إنشاء عميل")}</span>
            </button>
          )}
          <button className="secondary compact-action payroll-open-button" onClick={onPayroll}>
            <WalletCards size={15} /> {uiText(" المرتبات")}</button>
          {desktopBatchActions}
        </div>
      </header>
      <section className="collection-metrics" aria-label={uiText("ملخص استلامات الديون")}>
        <article>
          <span>{uiText("إجمالي المعتمد")}</span>
          <strong>{total}</strong>
        </article>
        <article>
          <span>{uiText("الكروت الموجهة")}</span>
          <strong>{collectionMoney.format(data.assignedCount)}</strong>
        </article>
        <article>
          <span>{uiText("المنفذ")}</span>
          <strong>{collectionMoney.format(data.metrics.executedCount)}</strong>
        </article>
        <article>
          <span>{uiText("ينتظر الاعتماد")}</span>
          <strong>{collectionMoney.format(data.metrics.pendingCount)}</strong>
        </article>
        <article>
          <span>{uiText("غير مربوط")}</span>
          <strong>{collectionMoney.format(data.metrics.unlinkedPendingCount)}</strong>
        </article>
      </section>
    </>
  );
}
