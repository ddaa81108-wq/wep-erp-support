import type { CollectionsDashboard } from '../../api.ts';
import { uiText } from '../../i18n/language.ts';
import { collectionMoney } from '../../sections/collections/useCollectionsDashboard.ts';

export type EmployeeCollectionTab = 'cards' | 'history' | 'cash';
export function EmployeeCollectionHeader({
  data,
  tab,
  query,
  creating,
  onTab,
  onSearch,
  onCreate,
  onPayroll,
}: {
  data: CollectionsDashboard;
  tab: EmployeeCollectionTab;
  query: string;
  creating: boolean;
  onTab: (tab: EmployeeCollectionTab) => void;
  onSearch: (value: string) => void;
  onCreate: () => void;
  onPayroll: () => void;
}) {
  return (
    <>
      <header className="topbar collection-overview-header">
        <div className="collection-heading">
          <span className="board-eyebrow">{uiText('متابعة التحصيل خطوة بخطوة')}</span>
          <h1>{uiText('قسم استلامات الديون')}</h1>
          <p>{uiText('كروتك وحالة تحصيلاتك في مكان واحد.')}</p>
        </div>
        <div className="collection-toolbar-actions">
          <button
            className="primary compact-action"
            aria-label={creating ? uiText('إغلاق الخانات') : uiText('إنشاء عميل مستقل')}
            aria-expanded={creating}
            aria-controls="collection-create-form"
            onClick={onCreate}
          >
            {creating ? uiText('إغلاق الخانات') : uiText('إنشاء عميل مستقل')}
          </button>
          <button className="secondary compact-action payroll-open-button" onClick={onPayroll}>
            {uiText('المرتبات')}
          </button>
        </div>
      </header>
      <section
        className="collection-board-summary employee-board-summary"
        aria-label={uiText('ملخص تحصيلاتي')}
      >
        <article data-metric="assigned">
          <span>{uiText('الكروت الموجهة إليك')}</span>
          <strong>
            {collectionMoney.format(data.assignedCount)}
            <small>{uiText('كارت')}</small>
          </strong>
        </article>
        <article data-metric="pending">
          <span>{uiText('بانتظار الاعتماد')}</span>
          <strong>
            {collectionMoney.format(data.metrics.pendingCount + data.metrics.unlinkedPendingCount)}
            <small>{uiText('عملية')}</small>
          </strong>
        </article>
        <article data-metric="outstanding">
          <span>{uiText('النقدية المطلوب تسليمها')}</span>
          <strong>
            {collectionMoney.format(data.metrics.cashOutstandingUnits)}
            <small>{uiText('د.ل')}</small>
          </strong>
          <small>{uiText('تشمل أي نقدية سابقة لم تُسلّم')}</small>
        </article>
      </section>
      <div className="employee-board-navigation">
        <div className="board-tabs" role="tablist" aria-label={uiText('تنظيم تحصيلاتي')}>
          {(['cards', 'history', 'cash'] as const).map((name) => (
            <button
              key={name}
              id={'employee-tab-' + name}
              role="tab"
              aria-selected={tab === name}
              aria-controls="employee-collection-content"
              onClick={() => onTab(name)}
            >
              {uiText(name === 'cards' ? 'كروتي' : name === 'history' ? 'تحصيلاتي' : 'النقدية')}
            </button>
          ))}
        </div>
        <label className="employee-board-search">
          {uiText('بحث بالاسم أو الهاتف')}
          <input
            aria-label={uiText('بحث بالاسم أو الهاتف')}
            placeholder={uiText('اسم العميل أو رقم الهاتف')}
            value={query}
            onChange={(event) => onSearch(event.target.value)}
          />
        </label>
      </div>
      <p className="board-scope-note">
        {uiText(
          'البحث يغيّر العرض فقط؛ ملخصك يشمل كل تحصيلاتك. اعتماد التحصيل واستلام النقدية من اختصاص الإدارة.',
        )}
      </p>
    </>
  );
}
