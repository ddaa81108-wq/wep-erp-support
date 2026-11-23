import { useEffect } from 'react';
import type { CustomerFilter } from '../../api.ts';
import { displayLocale, uiText } from '../../i18n/language.ts';

const count = new Intl.NumberFormat(displayLocale, { maximumFractionDigits: 0 });

/** Presentation-specific filters; the original appearances retain their own options. */
export function CockpitAccountFilters({ filter, activeCards, pendingReviewCount, onChange }: {
  filter: CustomerFilter;
  activeCards: number;
  pendingReviewCount: number;
  onChange: (filter: CustomerFilter) => void;
}) {
  useEffect(() => {
    const sync = () => {
      const cockpit = document.documentElement.dataset.royalShell === 'cockpit';
      if (cockpit && filter !== 'all' && filter !== 'pending-review') onChange('all');
      else if (!cockpit && filter === 'all') onChange('smart');
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-royal-shell'] });
    return () => observer.disconnect();
  }, [filter, onChange]);

  return <div className="cockpit-account-filters" role="tablist" aria-label={uiText('فلترة الكروت')}>
    <button type="button" role="tab" aria-selected={filter === 'all'} onClick={() => onChange('all')}>
      <span>{uiText('الكروت النشطة')}</span><b>{count.format(activeCards)}</b>
    </button>
    <button type="button" role="tab" aria-selected={filter === 'pending-review'} onClick={() => onChange('pending-review')}>
      <span>{uiText('صفر ينتظر المراجعة')}</span><b>{count.format(pendingReviewCount)}</b>
    </button>
  </div>;
}
