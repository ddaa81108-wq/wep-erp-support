import type { User } from '../../api.ts';
import { MasraweyaSummary } from './MasraweyaSummary.tsx';
import { MasraweyaWorkTable } from './MasraweyaWorkTable.tsx';
import { useMasraweyaDay } from './useMasraweyaDay.ts';

export function MasraweyaSection({ user }: { user: User }) {
  const isAdmin = user.role === 'admin';
  const canWrite = isAdmin || user.permissions?.includes('masraweya.write') === true;
  const state = useMasraweyaDay(canWrite);
  if (!state.day)
    return (
      <section className="masraweya-page">
        <div className="empty">
          {state.loading ? 'جارٍ تحميل المصراوية…' : state.error}
          <button onClick={() => void state.goToday()}>إعادة المحاولة</button>
        </div>
      </section>
    );
  return (
    <section
      className="masraweya-page"
      dir="rtl"
      onBlurCapture={() => {
        if (state.dirty && !state.error) void state.flush();
      }}
    >
      <header className="masraweya-header">
        <div>
          <h1>صفحة المصراوية</h1>
          <p>دفتر يومي بالجنيه المصري — يبدأ اليوم الساعة 4 صباحًا بتوقيت ليبيا</p>
        </div>
        <label>
          تاريخ العمل
          <input
            type="date"
            dir="ltr"
            value={state.date}
            max={state.day.today}
            disabled={state.loading}
            onChange={(event) => {
              if (event.target.value) void state.changeDate(event.target.value);
            }}
          />
        </label>
        <button className="secondary compact" onClick={() => void state.goToday()} disabled={state.loading}>
          اليوم الحالي
        </button>
        <span className="masraweya-status">{state.accessLabel}</span>
      </header>
      {state.incompatible && (
        <div className="alert error" role="alert">
          الواجهة متصلة بخادم قديم لا يدعم المصراوية الجديدة. يلزم تحديث الخادم والواجهة معًا؛ اليوم ليس
          مقفلًا بسبب التاريخ.
        </div>
      )}
      {state.error && (
        <div className="alert error" role="alert">
          {state.error} <span>لم تُحذف مسودتك.</span>
          <button onClick={() => void state.flush()} disabled={state.busy}>
            إعادة المحاولة
          </button>
          <button
            onClick={() => {
              if (window.confirm('تحميل النسخة المحفوظة سيستبدل المسودة غير المحفوظة. هل تريد المتابعة؟'))
                void state.reload();
            }}
          >
            تحميل النسخة المحفوظة
          </button>
        </div>
      )}
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
          openingEditable={canWrite && state.day.openingEditable}
          busy={state.busy}
          onPreviousChange={state.editPrevious}
          onPurchasesChange={state.editPurchases}
          onFlush={state.flush}
        />
      </div>
      <footer className="masraweya-actions">
        <span className={`masraweya-autosave-state ${state.error ? 'failed' : ''}`} role="status">
          {state.error
            ? 'توجد تعديلات غير محفوظة'
            : state.busy
              ? 'جارٍ الحفظ…'
              : state.dirty
                ? 'سيتم الحفظ تلقائيًا'
                : 'محفوظ تلقائيًا'}
        </span>
        <small>بداية اليوم 4 صباحًا • تعديل آخر 7 أيام لمن لديه صلاحية الكتابة</small>
      </footer>
    </section>
  );
}
