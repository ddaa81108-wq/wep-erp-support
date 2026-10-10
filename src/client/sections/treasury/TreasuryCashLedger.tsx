import type { TreasuryCashEntry } from '../../api.ts';
import { treasuryNumberFormat } from './treasuryViewModel.ts';

export function TreasuryCashLedger({ entries }: { entries: readonly TreasuryCashEntry[] }) {
  return (
    <div className="treasury-ledger">
      <div className="treasury-ledger-row head">
        <span>التسلسل</span>
        <span>التاريخ</span>
        <span>الحركة</span>
        <span>القيمة</span>
        <span>البيان</span>
        <span>بواسطة</span>
        <span>الرصيد</span>
      </div>
      {entries.length === 0 ? (
        <div className="empty">لا توجد حركات فلوس نشطة حتى الآن.</div>
      ) : (
        entries.map((entry) => (
          <div className={`treasury-ledger-row ${entry.direction}`} key={entry.id}>
            <span data-label="التسلسل">{entry.sequence}</span>
            <span data-label="التاريخ">{new Date(entry.createdAt).toLocaleString('ar-LY')}</span>
            <span data-label="الحركة">{entry.direction === 'in' ? 'دخول' : 'خروج'}</span>
            <span data-label="القيمة" dir="ltr">
              {treasuryNumberFormat.format(entry.amountUnits)}
            </span>
            <span data-label="البيان">{entry.description || '—'}</span>
            <span data-label="بواسطة">{entry.actorIsOwner ? '—' : entry.actorName}</span>
            <span data-label="الرصيد" dir="ltr">
              {treasuryNumberFormat.format(entry.balanceAfterUnits)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
