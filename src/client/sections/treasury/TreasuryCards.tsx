import { uiText } from '../../i18n/language.ts';
import type { TreasuryDashboard } from '../../api.ts';
import { treasuryCards, treasuryNumberFormat } from './treasuryViewModel.ts';

export function TreasuryCards({ dashboard }: { dashboard: TreasuryDashboard }) {
  return (
    <div className="treasury-cards">
      {treasuryCards(dashboard).map(({ label, value, note, kind }) => (
        <article key={label} className={`treasury-card ${kind}${kind === 'active-cash' && value !== null ? value > 0 ? ' cash-positive' : value < 0 ? ' cash-negative' : '' : ''}`}>
          <span>{label}</span>
          <b dir="ltr">{value === null ? '—' : uiText("{0} د.ل", [treasuryNumberFormat.format(value)])}</b>
          <small>{note}</small>
        </article>
      ))}
    </div>
  );
}
