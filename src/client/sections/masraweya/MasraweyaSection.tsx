import { CheckCircle2, LockKeyholeOpen } from 'lucide-react';
import type { User } from '../../api.ts';
import { MasraweyaSummary } from './MasraweyaSummary.tsx';
import { MasraweyaWorkTable } from './MasraweyaWorkTable.tsx';
import { useMasraweyaDay } from './useMasraweyaDay.ts';

export function MasraweyaSection({ user }: { user: User }) {
  const canWrite = user.role === 'admin' || user.permissions?.includes('masraweya.write') === true;
  const state = useMasraweyaDay(canWrite);

  if (!state.day) {
    return (
      <section className="masraweya-page">
        <div className="empty">{state.busy ? 'جارٍ تحميل صفحة المصراوية…' : state.message}</div>
      </section>
    );
  }

  return (
    <section className="masraweya-page" dir="rtl">
      <header className="masraweya-header">
        <div>
          <h1>صفحة المصراوية</h1>
          <p>حساب يومي بالجنيه المصري — الناتج ينتقل تلقائيًا إلى الأمانات المصرية</p>
        </div>
        <label>
          تاريخ العمل
          <input
            type="date"
            dir="ltr"
            value={state.date}
            onChange={(event) => state.changeDate(event.target.value)}
          />
        </label>
        <span className={`masraweya-status ${state.day.status}`}>
          {state.day.status === 'finalized' ? state.day.correctionOpen ? 'تعديل مفتوح' : 'يوم مُعتمد' : 'مسودة اليوم'}
        </span>
      </header>

      {state.message && <div className="masraweya-message">{state.message}</div>}

      <div className="masraweya-layout">
        <MasraweyaWorkTable
          rows={state.rows}
          workTotal={state.workTotal}
          locked={state.locked}
          onAppend={state.appendRow}
          onEdit={state.editRow}
        />
        <MasraweyaSummary
          day={state.day}
          previous={state.previous}
          purchases={state.purchases}
          workTotal={state.workTotal}
          final={state.final}
          locked={state.locked}
          busy={state.busy}
          onPreviousChange={state.editPrevious}
          onPurchasesChange={state.editPurchases}
          onApplyCarry={state.applyCarry}
          onBusyChange={state.setBusy}
          onMessageChange={state.setMessage}
        />
      </div>

      {canWrite && (
        <footer className="masraweya-actions">
          <span className="masraweya-autosave-state">{state.busy ? 'جارٍ الحفظ…' : state.dirty ? 'سيتم الحفظ تلقائيًا' : 'محفوظ تلقائيًا'}</span>
          {state.day.status === 'finalized' && !state.day.correctionOpen && (
            <button className="secondary" disabled={state.busy || user.isOwner !== true} title={user.isOwner === true ? 'فتح التعديل' : 'فتح التعديل للإدارة العليا فقط'} onClick={() => void state.setCorrection(true, 'تصحيح يوم المصراوية')}>
              <LockKeyholeOpen size={17} /> تعديل اليوم
            </button>
          )}
          {state.day.status === 'finalized' && state.day.correctionOpen && (
            <button className="secondary" disabled={state.busy} onClick={() => void state.setCorrection(false)}>
              إغلاق التعديل
            </button>
          )}
          {(state.day.status === 'draft' || state.day.correctionOpen) && <button
            className="primary"
            disabled={state.busy}
            onClick={() => void state.finalize()}
          ><CheckCircle2 size={17} /> اعتماد اليوم</button>}
        </footer>
      )}
    </section>
  );
}
