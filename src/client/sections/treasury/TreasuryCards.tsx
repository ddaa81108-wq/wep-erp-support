import type { TreasuryDashboard } from '../../api.ts';
import { treasuryCards, treasuryNumberFormat } from './treasuryViewModel.ts';

export function TreasuryCards({ dashboard }: { dashboard: TreasuryDashboard }) {
  return (
    <div className="treasury-cards">
      {treasuryCards(dashboard).map(({ label, value, note, kind }) => (
        <article key={label} className={`treasury-card ${kind}`}>
          <span>{label}</span>
          <b dir="ltr">{value === null ? '—' : `${treasuryNumberFormat.format(value)} د.ل`}</b>
          <small>{note}</small>
        </article>
      ))}
    </div>
  );
}
