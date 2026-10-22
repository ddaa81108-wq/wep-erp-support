import { direction, uiText } from '../../i18n/language.ts';
import type { User } from '../../api.ts';
import { PurchaseActionDock } from './PurchaseActionDock.tsx';
import { PurchaseOpening } from './PurchaseOpening.tsx';
import { PurchaseMetrics } from './PurchaseMetrics.tsx';
import { PurchaseRegister } from './PurchaseRegister.tsx';
import { usePurchasesPage } from './usePurchasesPage.ts';

export function PurchasesSection({ user }: { user: User }) {
  const canWrite = user.role === 'admin' || user.permissions?.includes('purchases.write') === true;
  const canFinalize = user.role === 'admin' || user.permissions?.includes('purchases.finalize') === true;
  const purchases = usePurchasesPage();
  const { merchant, setMerchant, page, busy, message, setMessage, load, finalize } = purchases;
  if (!page)
    return (
      <section className="purchases-page">
        <div className="empty">{busy ? uiText("جارٍ التحميل…") : message}</div>
      </section>
    );
  const firstDay = page.day.dayNumber === 1 && purchases.entries.length === 0;
  return (
    <section className="purchases-page" dir={direction}>
      <h1 className="purchase-section-title">{uiText("قسم المشتريات")}</h1>
      <PurchaseRegister purchases={purchases} canWrite={canWrite} canFinalize={canFinalize} />
      {message && <div className="purchase-message">{message}</div>}
      {firstDay && canWrite && (
        <PurchaseOpening
          key={merchant}
          page={page}
          merchant={merchant}
          reload={() => load(merchant, true)}
          setMessage={setMessage}
        />
      )}
      <div className="purchase-workbar"><PurchaseMetrics day={page.day} />
      <PurchaseActionDock
        merchant={merchant}
        busy={busy}
        canWrite={canWrite}
        canFinalize={canFinalize}
        dayNumber={page.day.dayNumber}
        selectMerchant={setMerchant}
        finalize={finalize}
      />
      </div>
    </section>
  );
}

