import { collectionFixture } from './collectionFixture.ts';
import { createCustomer, addCustomerTransaction } from '../../src/server/domain/customers.ts';
import { setEgyptianDepositRate } from '../../src/server/modules/treasury/exchangeRates.ts';
import { treasuryDashboard, addTreasuryCashEntry } from '../../src/server/domain/treasury.ts';
import { listPurchases } from '../../src/server/domain/purchaseQueries.ts';
import { setPurchaseOpening } from '../../src/server/domain/purchaseDayCommands.ts';
import { createPurchaseEntry } from '../../src/server/domain/purchaseEntryCommands.ts';
import { submitCollection, decideCollection, createUnlinkedCollectionReceipt } from '../../src/server/domain/collections.ts';
import { captureFiveAmClosing, fiveAmDeadline } from '../../src/server/domain/reports/fiveAmClosing.ts';
import { currentBusinessDate } from '../../src/server/domain/reports/businessDates.ts';

/** Entirely synthetic, in-memory accounts for local review and browser acceptance. */
export function reportOverviewFixture(historyDays = 3) {
  const fixture = collectionFixture();
  const { db, admin, collector, assignments, ids } = fixture;
  for (const [index, name] of ['عميل تحصيل تجريبي', 'شركة تجريبية للتحصيل', 'حساب اختبار مستقل'].entries())
    db.prepare('UPDATE customers SET name=? WHERE id=?').run(name, ids[index]);
  const sample = createCustomer(db, admin, { requestId: 'overview-demo-customer', name: 'مؤسسة الأفق — بيانات تجريبية', openingBalance: 42000 }, 'preview');
  const customerId = String((sample.body.customer as { id: string }).id);
  addCustomerTransaction(db, admin, customerId, { requestId: 'overview-demo-debt', expectedVersion: 1,
    type: 'debt', inputValue: 1250, date: new Date().toISOString() }, 'preview');
  for (const [kind, openingBalance, name] of [
    ['company', 24000, 'شركة المدار — تجريبي'], ['depositLyd', 18000, 'أمانات ليبية — تجريبي'], ['depositEgp', 73000, 'أمانات مصرية — تجريبي'],
  ] as const) createCustomer(db, admin, { requestId: `overview-demo-${kind}`, name, openingBalance }, 'preview', kind);
  setEgyptianDepositRate(db, admin, '5.2');
  let purchase = listPurchases(db, admin, 'al_bayan', null, null);
  setPurchaseOpening(db, admin, 'al_bayan', { expectedDayVersion: purchase.day.version, previousDebtUnits: 7000, previousVodafoneUnits: 400 }, 'preview');
  purchase = listPurchases(db, admin, 'al_bayan', null, null);
  createPurchaseEntry(db, admin, 'al_bayan', { requestId: 'overview-demo-purchase', expectedDayVersion: purchase.day.version,
    itemCode: 'custom', itemLabel: 'بضاعة تجريبية', egpValueUnits: 15600, calculationMode: 'divide', exchangeRate: '5.2', paidUnits: 1000, vodafoneConsumedUnits: 0 }, 'preview');
  const today = currentBusinessDate();
  for (let index = historyDays; index >= 1; index--) {
    const day = new Date(Date.parse(`${today}T12:00:00Z`) - index * 86_400_000).toISOString().slice(0, 10);
    addTreasuryCashEntry(db, admin, { requestId: `overview-demo-cash-${index}`, expectedVersion: treasuryDashboard(db, admin.organizationId).cashVersion,
      direction: 'in', amountUnits: index === historyDays ? 12000 : 4000 }, 'preview');
    const due = fiveAmDeadline(day);
    // Synthetic historical operation time for the demonstration journal only.
    db.prepare("UPDATE audit_log SET created_at=? WHERE id=(SELECT MAX(id) FROM audit_log WHERE organization_id=?)")
      .run(new Date(due.getTime() - 1000).toISOString(), admin.organizationId);
    captureFiveAmClosing(db, admin.organizationId, due.getTime() - 1000, due);
  }
  addTreasuryCashEntry(db, admin, { requestId: 'overview-demo-cash-out', expectedVersion: treasuryDashboard(db, admin.organizationId).cashVersion,
    direction: 'out', amountUnits: 2000, description: 'خروج نقد تجريبي' }, 'preview');
  const receipt = submitCollection(db, collector, assignments[0], { requestId: 'overview-demo-approve', mode: 'partial', amountUnits: 20 }, 'preview');
  decideCollection(db, admin, receipt.id, { decision: 'approve' }, 'preview');
  submitCollection(db, collector, assignments[0], { requestId: 'overview-demo-pending', mode: 'partial', amountUnits: 30 }, 'preview');
  createUnlinkedCollectionReceipt(db, collector, { requestId: 'overview-demo-unlinked', customerName: 'استلام غير مرتبط — تجريبي', amountUnits: 150 }, 'preview');
  return { ...fixture, customerId };
}
