import type { CollectionAssignment } from '../../api.ts';
import { uiText } from '../../i18n/language.ts';
import { collectionMoney } from './useCollectionsDashboard.ts';

/** The assigned debt is a fixed snapshot; the current balance remains authoritative. */
export function CollectionCardAmounts({ assignment }: { assignment: CollectionAssignment }) {
  return (
    <div className="collection-card-amounts">
      {[
        ['assigned', uiText('قيمة التوجيه'), assignment.assignedBalanceUnits],
        ['current', uiText('الرصيد الحالي'), assignment.balanceUnits],
      ].map(([key, label, value]) => {
        const amount = typeof value === 'number' ? collectionMoney.format(value) : null;
        return (
          <div key={String(key)} data-amount={key}>
            <small>{label}</small>
            <b
              style={{
                fontSize:
                  amount && amount.length > 16 ? '10px' : amount && amount.length > 12 ? '12px' : undefined,
              }}
            >
              {amount === null ? (
                <span>{uiText('غير مسجلة')}</span>
              ) : (
                <>
                  <bdi dir="ltr">{amount}</bdi>
                  <span>{uiText('د.ل')}</span>
                </>
              )}
            </b>
          </div>
        );
      })}
    </div>
  );
}
