import { Activity, Clock3, ShieldCheck, Users } from 'lucide-react';
import type { AuditEntry } from '../../api.ts';

export function AuditSummary({ items }: { items: readonly AuditEntry[] }) {
  const actors = new Set(items.map((entry) => entry.actorUsername ?? entry.actorName)).size;
  const last = items[0]?.createdAt;

  return (
    <section className="audit-summary">
      <article>
        <span className="audit-summary-icon blue">
          <Activity size={18} />
        </span>
        <div>
          <small>الحركات المعروضة</small>
          <b dir="ltr">{items.length}</b>
        </div>
      </article>
      <article>
        <span className="audit-summary-icon violet">
          <Users size={18} />
        </span>
        <div>
          <small>المستخدمون</small>
          <b dir="ltr">{actors}</b>
        </div>
      </article>
      <article>
        <span className="audit-summary-icon green">
          <Clock3 size={18} />
        </span>
        <div>
          <small>آخر حركة</small>
          <b>
            {last ? new Date(last).toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' }) : '—'}
          </b>
        </div>
      </article>
      <div className="audit-readonly">
        <ShieldCheck size={17} />
        <span>
          <strong>سجل محمي للقراءة فقط</strong>
          <small>لا يمكن تعديل الحركات أو حذفها</small>
        </span>
      </div>
    </section>
  );
}
