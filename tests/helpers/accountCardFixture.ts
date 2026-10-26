import { openDatabase } from '../../src/server/db/database.ts';
import { fixtureAdmin } from './financialFixture.ts';
import { createCustomer, addCustomerTransaction } from '../../src/server/domain/customers.ts';
import type { DebtPartyKind } from '../../src/server/domain/customers.ts';

/** Disposable accounts only, isolated from installed company data. */
export function accountCardFixture(perSection = 72) {
  const db = openDatabase(':memory:');
  const admin = fixtureAdmin(db);
  const sections = [
    ['customers', 'customer', 'عميل'],
    ['companies', 'company', 'شركة'],
    ['libyan-deposits', 'depositLyd', 'أمانة ليبية'],
    ['egyptian-deposits', 'depositEgp', 'حساب مصري'],
  ] as const;
  const names = ['محمد علي', 'أحمد سالم', 'محمود حسن', 'عمر يوسف', 'خالد إبراهيم', 'حسام محمود', 'عبدالله منصور', 'وليد ناصر', 'إبراهيم جابر', 'مصطفى عادل', 'عماد فوزي', 'سعد أمين'];
  const ages = [0, 1, 2, 3, 5, 7, 12, 30];
  const accounts: Array<{ id: string; name: string; section: string; balance: number; owner: 'system' | 'customer' | 'zero' }> = [];
  for (const [section, kind, label] of sections) {
    for (let index = 0; index < perSection; index++) {
      const sign = [1, -1, 0][index % 3];
      const amount = sign * (index % 11 === 0 ? 1_234_567 : 125 + index * 137);
      const name = `${label} ${names[index % names.length]} ${String(index + 1).padStart(2, '0')}`;
      const result = createCustomer(db, admin, { requestId: `card-preview-${section}-${index}`, name, openingBalance: Math.max(0, amount) }, 'synthetic-card-preview', kind as DebtPartyKind);
      const id = String((result.body.customer as { id: string }).id);
      if (amount < 0) addCustomerTransaction(db, admin, id, {
        requestId: `card-preview-credit-${section}-${index}`, expectedVersion: 1,
        type: 'payment', paymentMode: 'partial', inputValue: -amount,
      }, 'synthetic-card-preview', kind as DebtPartyKind);
      if (amount > 0) {
        const date = new Date(Date.now() - ages[Math.floor(index / 3) % ages.length] * 86_400_000).toISOString();
        db.prepare('UPDATE customers SET debt_started_at=? WHERE id=?').run(date, id);
        db.prepare('UPDATE debt_transactions SET transaction_date=? WHERE customer_id=?').run(date, id);
      }
      const owner = amount === 0 ? 'zero' : (section === 'libyan-deposits' ? amount > 0 : amount < 0) ? 'customer' : 'system';
      accounts.push({ id, name, section, balance: amount, owner });
    }
  }
  return { db, admin, accounts };
}
