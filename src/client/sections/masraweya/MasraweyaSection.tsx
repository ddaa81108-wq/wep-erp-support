import { direction, uiText } from '../../i18n/language.ts';
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
          {state.loading ? uiText("جارٍ تحميل المصراوية…") : state.error}
          {!state.loading && state.error && (
            <button onClick={() => void state.goToday()}>{uiText("إعادة المحاولة")}</button>
          )}
        </div>
      </section>
    );
  return (
    <section
      className="masraweya-page"
      dir={direction}
      onBlurCapture={() => {
        if (state.dirty && !state.error) void state.flush();
      }}
    >
      <header className="masraweya-header">
        <div>
          <h1>{uiText("صفحة المصراوية")}</h1>
          <p>{uiText("دفتر يومي بالجنيه المصري — يبدأ اليوم الساعة 4 صباحًا بتوقيت ليبيا")}</p>
        </div>
        <label>
          {uiText("تاريخ العمل")}<input
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
          {uiText("اليوم الحالي")}</button>
        <span className="masraweya-status">{state.accessLabel}</span>
      </header>
      {state.incompatible && (
        <div className="alert error" role="alert">
          {uiText("الواجهة متصلة بخادم قديم لا يدعم المصراوية الجديدة. يلزم تحديث الخادم والواجهة معًا؛ اليوم ليس مقفلًا بسبب التاريخ.")}</div>
      )}
      {state.error && (
        <div className="alert error" role="alert">
          {state.error} {state.dirty && <span>{uiText("لم تُحذف مسودتك.")}</span>}
          <button onClick={() => void (state.dirty ? state.flush() : state.reload())} disabled={state.busy || state.loading}>
            {uiText("إعادة المحاولة")}</button>
          <button
            onClick={() => {
              if (window.confirm(uiText("تحميل النسخة المحفوظة سيستبدل المسودة غير المحفوظة. هل تريد المتابعة؟")))
                void state.reload();
            }}
          >
            {uiText("تحميل النسخة المحفوظة")}</button>
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
          {state.loading
            ? uiText("جارٍ تحميل اليوم…")
            : state.error
            ? state.dirty ? uiText("توجد تعديلات غير محفوظة") : state.error
            : state.busy
              ? uiText("جارٍ الحفظ…")
              : state.dirty
                ? uiText("سيتم الحفظ تلقائيًا")
                : uiText("محفوظ تلقائيًا")}
        </span>
        <small>{uiText("بداية اليوم 4 صباحًا • تعديل آخر 7 أيام لمن لديه صلاحية الكتابة")}</small>
      </footer>
    </section>
  );
}
