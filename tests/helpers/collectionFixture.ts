import { fixtureAdmin } from './financialFixture.ts';
import { openDatabase } from '../../src/server/db/database.ts';
import { createCustomer } from '../../src/server/domain/customers.ts';
import { assignCustomers } from '../../src/server/domain/collections.ts';

export function collectionFixture(path = ':memory:') {
  const db = openDatabase(path);
  const admin = fixtureAdmin(db);
  const now = new Date().toISOString();
  const employee = (id: string) => {
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
      VALUES(?,?,?,'test-only','employee',?,?,?,?)`).run(id,id,id,admin.organizationId,admin.homeBranchId,now,now);
    for (const permission of ['collections.read','collections.write'])
      db.prepare('INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,?,1,?)').run(id,permission,now);
    return {...admin,id,username:id,displayName:id,role:'employee' as const,permissions:new Set(['collections.read','collections.write'])};
  };
  const collector = employee('fixture-collector');
  const other = employee('fixture-other');
  const ids = ['Recovery customer','Second customer','Other collector customer'].map((name,i) => {
    const result = createCustomer(db,admin,{name,openingBalance:100,requestId:`recovery-customer-${i}`},'test');
    return String((result.body.customer as {id:string}).id);
  });
  const assignments = ids.map((id,i) => assignCustomers(db,admin,{customerIds:[id],assigneeUserId:i===2?other.id:collector.id},'test').assignmentIds[0]);
  return {db,admin,collector,other,ids,assignments};
}
