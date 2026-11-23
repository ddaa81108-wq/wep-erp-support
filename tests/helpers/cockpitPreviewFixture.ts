import { reportOverviewFixture } from './reportOverviewFixture.ts';
import { addCustomerTransaction } from '../../src/server/domain/customers.ts';
import { listPurchases } from '../../src/server/domain/purchaseQueries.ts';
import { createPurchaseEntry } from '../../src/server/domain/purchaseEntryCommands.ts';
import { getMasraweyaDay, saveMasraweyaDay } from '../../src/server/domain/masraweya.ts';
import { createCollectionPayrollEntry } from '../../src/server/domain/collectionPayroll.ts';

/** Representative synthetic operations. Only called by isolated previews and UI tests. */
export function cockpitPreviewFixture() {
  const fixture = reportOverviewFixture(20);
  const { db, admin, collector, customerId } = fixture;
  const ledgerAccounts = db.prepare(`SELECT id,section_key FROM customers WHERE system_link_key IS NULL
    AND current_balance_units>0 AND (id=? OR section_key<>'customer_debts') ORDER BY created_at,id`)
    .all(customerId) as { id: string; section_key: string }[];
  const kinds = { customer_debts: 'customer', company_debts: 'company', libyan_deposits: 'depositLyd', egyptian_deposits: 'depositEgp' } as const;
  for (const account of ledgerAccounts) {
    for (let index = 0; index < 6; index++) {
      const version = Number(db.prepare('SELECT version FROM customers WHERE id=?').get(account.id)!.version);
      addCustomerTransaction(db, admin, account.id, {
        requestId: `cockpit-preview-${account.id}-${index}`, expectedVersion: version,
        type: index % 3 === 2 ? 'payment' : 'debt', paymentMode: index % 3 === 2 ? 'partial' : undefined,
        inputValue: index % 3 === 2 ? 350 : 650 + index * 75,
        note: index % 3 === 2 ? 'دفعة تجريبية للمراجعة' : 'معاملة تجريبية لعرض السجل',
      }, 'preview', kinds[account.section_key as keyof typeof kinds]);
    }
  }
  for (let index = 0; index < 6; index++) {
    const page = listPurchases(db, admin, 'al_bayan', null, null);
    createPurchaseEntry(db, admin, 'al_bayan', { requestId: `cockpit-purchase-${index}`, expectedDayVersion: page.day.version,
      itemCode: 'custom', itemLabel: ['توريد بضاعة', 'شراء معدات', 'مستلزمات تشغيل'][index % 3], egpValueUnits: 5200 + index * 520,
      calculationMode: 'divide', exchangeRate: '5.2', paidUnits: index % 2 ? 500 : 0, vodafoneConsumedUnits: 0 }, 'preview');
  }
  const day = getMasraweyaDay(db, admin.organizationId);
  saveMasraweyaDay(db, admin, { businessDate: day.businessDate, expectedVersion: day.version, previousValueUnits: 120000,
    purchasesUnits: 16000, entries: Array.from({ length: 12 }, (_, index) => ({ valueUnits: 1250 + index * 275, commissionUnits: 25 + index * 5 })) }, 'preview');
  for (const kind of ['withdrawal', 'commission'] as const) createCollectionPayrollEntry(db, admin, {
    employeeUserId: collector.id, kind, amountUnits: kind === 'withdrawal' ? 100 : 500,
    reason: 'معاملة اختبار مستقلة', requestId: `cockpit-payroll-${kind}`,
  }, 'preview');
  return { ...fixture, ledgerAccounts };
}
