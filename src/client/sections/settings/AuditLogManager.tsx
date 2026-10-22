import { uiText } from '../../i18n/language.ts';
import { RefreshCw, Search } from 'lucide-react';
import { Modal } from '../../components/Modal.tsx';
import { auditNumberFormat } from './auditLogModel.ts';
import { AuditEntries } from './AuditEntries.tsx';
import { AuditSummary } from './AuditSummary.tsx';
import { useAuditLog } from './useAuditLog.ts';

export function AuditLogManager({ onClose }: { onClose: () => void }) {
  const { items, visible, nextBefore, busy, error, query, setQuery, filter, setFilter, load } = useAuditLog();
  return (
    <Modal title={uiText("سجل التدقيق")} className="audit-modal" onClose={onClose}>
      <div className="audit-manager">
        <AuditSummary items={items} />
        <section className="audit-toolbar">
          <label className="audit-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={uiText("ابحث باسم الموظف أو نوع الحركة…")}
              aria-label={uiText("البحث في سجل التدقيق")}
            />
          </label>
          <div className="audit-filters" role="group" aria-label={uiText("تصفية سجل التدقيق")}>
            {(
              [
                ['all', uiText("الكل")],
                ['financial', uiText("العمليات المالية")],
                ['accounts', uiText("الحسابات")],
                ['system', uiText("الأمان")],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? 'active' : ''}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="audit-refresh"
            title={uiText("تحديث السجل")}
            aria-label={uiText("تحديث سجل التدقيق")}
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw size={17} />
          </button>
        </section>
        {error && <div className="alert error">{error}</div>}
        <AuditEntries entries={visible} busy={busy} />
        <footer className="audit-footer">
          <span>{uiText("يظهر أحدث ")}{auditNumberFormat.format(items.length)} {uiText(" سجل")}</span>
          {nextBefore && (
            <button className="secondary" disabled={busy} onClick={() => void load(nextBefore)}>
              {uiText("عرض سجلات أقدم")}</button>
          )}
          {busy && <span>{uiText("جارٍ التحديث…")}</span>}
        </footer>
      </div>
    </Modal>
  );
}
