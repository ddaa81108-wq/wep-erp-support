import { collectionFixture } from './collectionFixture.ts';
import { createCustomer } from '../../src/server/domain/customers.ts';
import { assignCustomers } from '../../src/server/domain/collections.ts';

export function accountSearchFixture() {
  const fixture = collectionFixture();
  const { db, admin, collector, ids } = fixture;
  db.prepare('UPDATE customers SET name=?,normalized_name=? WHERE id=?').run('عميل بحث موجه', 'عميل بحث موجه', ids[0]);
  const company = createCustomer(db, admin, { name: 'شركة بحث موجهة', openingBalance: 875, requestId: 'search-company' }, 'test', 'company');
  const companyId = String((company.body.customer as { id: string }).id);
  assignCustomers(db, admin, { customerIds: [companyId], assigneeUserId: collector.id, section: 'companies' }, 'test');
  const hidden = createCustomer(db, admin, { name: 'عميل بحث مخفي', openingBalance: 0, requestId: 'search-hidden' }, 'test');
  const hiddenId = String((hidden.body.customer as { id: string }).id);
  db.prepare('UPDATE customers SET inactive_since=? WHERE id=?').run('2020-01-01T00:00:00.000Z', hiddenId);
  for (let i = 0; i < 105; i++) createCustomer(db, admin, { name: 'كارت معاينة ' + i, openingBalance: 10 + i, requestId: 'search-page-' + i }, 'test');
  db.prepare('UPDATE customers SET updated_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z', ids[0]);
  return { ...fixture, companyId, hiddenId };
}
