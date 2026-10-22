import { direction, uiText, displayLocale } from '../../i18n/language.ts';
import { useLayoutEffect, useRef } from 'react';
import type { Customer } from '../../api.ts';

const money = new Intl.NumberFormat(displayLocale, { maximumFractionDigits: 0 });

export function DebtTicker({
  customers,
  onOpenLedger,
}: {
  customers: Customer[];
  onOpenLedger: (id: string) => void;
}) {
  const viewport = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const items = [
    ...new Map(
      customers
        .filter((item) => item.balanceUnits > 0 && (item.debtAgeDays ?? 0) >= 3)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const empty = items.length === 0;

  useLayoutEffect(() => {
    const container = viewport.current;
    const content = track.current;
    if (!container || !content) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animation: Animation | undefined;
    let previousDistance = -1;
    const pause = () => animation?.pause();
    const resume = () => {
      if (!container.matches(':hover') && !container.contains(document.activeElement)) animation?.play();
    };
    const focusLeft = () => queueMicrotask(resume);
    const measure = () => {
      const distance = Math.max(0, content.scrollWidth - container.clientWidth);
      if (distance === previousDistance) return;
      previousDistance = distance;
      animation?.cancel();
      animation = undefined;
      if (distance <= 1 || reducedMotion.matches) return;
      // Follow the interface direction while exposing all cards at 24 px/s.
      animation = content.animate(
        [{ transform: 'translateX(0)' }, { transform: `translateX(${direction === 'rtl' ? distance : -distance}px)` }],
        { duration: (distance / 24) * 1000, iterations: Infinity, direction: 'alternate', easing: 'linear' },
      );
      if (container.matches(':hover') || container.contains(document.activeElement)) pause();
    };
    const preferenceChanged = () => {
      previousDistance = -1;
      measure();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(content);
    container.addEventListener('mouseenter', pause);
    container.addEventListener('mouseleave', resume);
    container.addEventListener('focusin', pause);
    container.addEventListener('focusout', focusLeft);
    reducedMotion.addEventListener('change', preferenceChanged);
    measure();
    return () => {
      observer.disconnect();
      animation?.cancel();
      container.removeEventListener('mouseenter', pause);
      container.removeEventListener('mouseleave', resume);
      container.removeEventListener('focusin', pause);
      container.removeEventListener('focusout', focusLeft);
      reducedMotion.removeEventListener('change', preferenceChanged);
    };
  }, [empty]);

  return (
    <section
      ref={viewport}
      className={`debt-ticker ${items.length === 0 ? 'empty-ticker' : ''}`}
      aria-label={uiText("تنبيهات الديون القديمة")}
    >
      {items.length === 0 ? (
        <span>{uiText("لا توجد ديون تجاوزت 3 أيام")}</span>
      ) : (
        <div ref={track} className="debt-ticker-track">
          {items.map((customer) => (
            <button
              key={customer.id}
              className={(customer.debtAgeDays ?? 0) >= 7 ? 'urgent' : 'warning'}
              onClick={() => onOpenLedger(customer.id)}
            >
              <strong>{customer.name}</strong>
              <span>{money.format(customer.balanceUnits)} {uiText(" د.ل")}</span>
              <em>{uiText("منذ ")}{money.format(customer.debtAgeDays ?? 0)} {uiText(" أيام")}</em>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
