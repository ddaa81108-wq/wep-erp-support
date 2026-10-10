import { Search } from 'lucide-react';
import type { AuditEntry } from '../../api.ts';
import { auditActionLabel, auditCategory, auditDetailText, auditEntityLabel } from './auditLogModel.ts';

export function AuditEntries({ entries, busy }: { entries: readonly AuditEntry[]; busy: boolean }) {
  return (
    <section className="audit-table-wrap">
      <div className="audit-table-head">
        <span>التاريخ والوقت</span>
        <span>المستخدم</span>
        <span>الحركة</span>
        <span>القسم / التفاصيل</span>
        <span>الحالة</span>
      </div>
      <div className="audit-list">
        {entries.map((entry) => {
          const kind = auditCategory(entry);
          const date = new Date(entry.createdAt);
          return (
            <article key={entry.id} className={`audit-entry ${kind}`}>
              <div className="audit-date">
                <b dir="ltr">{date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</b>
                <small dir="ltr">{date.toLocaleDateString('en-GB')}</small>
              </div>
              <div className="audit-actor">
                <span>{entry.actorName.slice(0, 1)}</span>
                <div>
                  <strong>{entry.actorName}</strong>
                  <small dir="ltr">{entry.actorUsername ? `@${entry.actorUsername}` : 'SYSTEM'}</small>
                </div>
              </div>
              <div>
                <strong className={`audit-action ${kind}`}>{auditActionLabel(entry.action)}</strong>
                <small className="audit-reference" dir="ltr">
                  # {entry.id}
                </small>
              </div>
              <div className="audit-details">
                <strong>{auditEntityLabel(entry.entityType)}</strong>
                <small>{auditDetailText(entry)}</small>
              </div>
              <span className={`audit-status ${entry.outcome}`}>
                {entry.outcome === 'success' ? 'تم بنجاح' : entry.outcome === 'denied' ? 'مرفوض' : 'فشل'}
              </span>
            </article>
          );
        })}
        {!busy && entries.length === 0 && (
          <div className="empty compact">
            <Search size={27} />
            <h3>لا توجد نتائج</h3>
            <p>غيّر البحث أو نوع الحركة.</p>
          </div>
        )}
      </div>
    </section>
  );
}
