import { uiText, displayLocale } from '../../i18n/language.ts';
import { useLayoutEffect, useRef, useState } from 'react';
import type { TreasuryCashEntry } from '../../api.ts';
import { treasuryNumberFormat } from './treasuryViewModel.ts';

const desktopDate = new Intl.DateTimeFormat(displayLocale, {
  timeZone: 'Africa/Tripoli', weekday: 'long', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export function TreasuryCashLedger({
  entries,
  scrollRequest = 0,
}: {
  entries: readonly TreasuryCashEntry[];
  scrollRequest?: number;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const position = useRef({ following: true, sequence: '', offset: 0, latest: 0, request: 0 });
  const [hasNew, setHasNew] = useState(false);

  function rememberPosition() {
    const element = viewport.current;
    if (!element || !window.matchMedia('(min-width: 901px)').matches) return;
    const top = element.getBoundingClientRect().top + (element.firstElementChild?.clientHeight ?? 0);
    const anchor = Array.from(element.querySelectorAll<HTMLElement>('[data-sequence]')).find(
      (row) => row.getBoundingClientRect().bottom > top,
    );
    position.current.following = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    position.current.sequence = anchor?.dataset.sequence ?? '';
    position.current.offset = anchor ? anchor.getBoundingClientRect().top - top : 0;
    if (position.current.following) setHasNew(false);
  }

  function goToLatest() {
    const element = viewport.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    position.current.following = true;
    setHasNew(false);
  }

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !window.matchMedia('(min-width: 901px)').matches) return;
    const saved = position.current;
    const latest = entries.at(-1)?.sequence ?? 0;
    if (saved.following || saved.request !== scrollRequest) {
      goToLatest();
    } else {
      const anchor = element.querySelector<HTMLElement>(`[data-sequence="${saved.sequence}"]`);
      if (anchor) {
        const top = element.getBoundingClientRect().top + (element.firstElementChild?.clientHeight ?? 0);
        element.scrollTop += anchor.getBoundingClientRect().top - top - saved.offset;
      }
      if (latest > saved.latest) setHasNew(true);
    }
    saved.latest = latest;
    saved.request = scrollRequest;
  }, [entries, scrollRequest]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (window.matchMedia('(min-width: 901px)').matches && position.current.following) goToLatest();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {hasNew && (
        <button className="treasury-new-movements" onClick={goToLatest}>
          {uiText("حركات جديدة — انتقل لآخر السجل ↓")}</button>
      )}
      <div className="treasury-ledger" ref={viewport} onScroll={rememberPosition}>
        <div className="treasury-ledger-row head">
          <span><b>{uiText("التسلسل")}</b></span>
          <span><b>{uiText("التاريخ")}</b></span>
          <span><b>{uiText("الحركة")}</b></span>
          <span><b>{uiText("القيمة")}</b></span>
          <span><b>{uiText("البيان")}</b></span>
          <span><b>{uiText("بواسطة")}</b></span>
          <span><b>{uiText("الرصيد")}</b></span>
        </div>
        {entries.length === 0 ? (
          <div className="empty">{uiText("لا توجد حركات فلوس نشطة حتى الآن.")}</div>
        ) : (
          entries.map((entry) => (
            <div
              className={`treasury-ledger-row ${entry.direction}`}
              key={entry.id}
              data-sequence={entry.sequence}
            >
              <span data-label={uiText("التسلسل")}>{entry.sequence}</span>
              <span data-label={uiText("التاريخ")}>
                <time className="treasury-date-phone" dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString(displayLocale)}</time>
                <time className="treasury-date-desktop" dateTime={entry.createdAt}>{desktopDate.format(new Date(entry.createdAt))}</time>
              </span>
              <span data-label={uiText("الحركة")}>{entry.direction === 'in' ? uiText("دخول") : uiText("خروج")}</span>
              <span data-label={uiText("القيمة")} dir="ltr">
                {treasuryNumberFormat.format(entry.amountUnits)}
              </span>
              <span data-label={uiText("البيان")}>{entry.description || '—'}</span>
              <span data-label={uiText("بواسطة")}>{entry.actorIsOwner ? '—' : entry.actorName}</span>
              <span data-label={uiText("الرصيد")} dir="ltr">
                {treasuryNumberFormat.format(entry.balanceAfterUnits)}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
