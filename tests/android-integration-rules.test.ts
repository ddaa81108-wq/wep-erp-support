import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { createCustomer } from '../src/server/domain/customerAccountCommands.ts';
import { addCustomerTransaction } from '../src/server/domain/customerTransactions.ts';
import { customerLedger, listCustomers } from '../src/server/domain/customerQueries.ts';
import { calculateCustomerAmount } from '../src/server/domain/customerMoney.ts';
import { roundedResult } from '../src/server/domain/purchaseSupport.ts';
import { assignCustomers, submitCollection, decideCollection } from '../src/server/domain/collections.ts';
import { treasuryDashboard } from '../src/server/domain/treasuryQueries.ts';
import { HttpError } from '../src/server/http/errors.ts';

test('Android contract: whole units, overpayment, full payment and global summary follow actual server policy', () => {
  const db=openDatabase(':memory:');
  try {
    const admin=fixtureAdmin(db);
    const created=createCustomer(db,admin,{name:'مطابقة السياسة',openingBalance:10,requestId:'android-rule-create'},'test');
    const id=String((created.body.customer as {id:string}).id);
    const over=addCustomerTransaction(db,admin,id,{requestId:'android-rule-over',expectedVersion:1,type:'payment',paymentMode:'partial',inputValue:11},'test');
    assert.equal(over.body.balanceUnits,-1,'Overpayment is allowed; do not document a nonexistent rejection.');
    assert.throws(()=>addCustomerTransaction(db,admin,id,{requestId:'android-rule-full-negative',expectedVersion:2,type:'payment',paymentMode:'full',inputValue:1},'test'),(error:unknown)=>error instanceof HttpError&&error.status===400&&error.code==='FULL_PAYMENT_NOT_ALLOWED');
    const filtered=listCustomers(db,new URL('http://localhost/api/customers?q=missing'),admin.organizationId);
    assert.equal(filtered.items.length,0);
    assert.equal(filtered.summary.netBalance,-1);
    assert.equal(filtered.summary.totalDebt,0);
    assert.equal(customerLedger(db,id,new URL('http://localhost/api/customers/x/ledger'),admin.organizationId).customer.balanceUnits,-1);
    assert.throws(()=>calculateCustomerAmount(0.5,'direct',null));
    assert.equal(calculateCustomerAmount(11,'divide','2').amountUnits,5);
    assert.equal(roundedResult(11,2000000,'divide').result,6);
  } finally {db.close();}
});

test('Android contract: linked submissions replay before and after approval',()=>{
  const db=openDatabase(':memory:');
  try {
    const admin=fixtureAdmin(db), now=new Date().toISOString();
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
      VALUES('android-rule-collector','android-rule-collector','محصل السياسة','test','employee',?,?,?,?)`).run(admin.organizationId,admin.homeBranchId,now,now);
    db.prepare("INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES('android-rule-collector','collections.write',1,?)").run(now);
    const collector={...admin,id:'android-rule-collector',role:'employee' as const,permissions:new Set(['collections.read','collections.write'])};
    const result=createCustomer(db,admin,{name:'مطابقة التحصيل',openingBalance:100,requestId:'android-rule-assigned'},'test');
    const id=String((result.body.customer as {id:string}).id);
    const assignmentId=assignCustomers(db,admin,{customerIds:[id],assigneeUserId:collector.id},'test').assignmentIds[0];
    const body={mode:'partial',amountUnits:110,requestId:'android-rule-request'};
    const first=submitCollection(db,collector,assignmentId,body,'test');
    assert.equal(submitCollection(db,collector,assignmentId,body,'test').id,first.id);
    assert.equal(treasuryDashboard(db,admin.organizationId).sources.customers,100,'Pending has no ledger effect.');
    decideCollection(db,admin,first.id,{decision:'approve'},'test');
    assert.equal(treasuryDashboard(db,admin.organizationId).sources.customers,-10,'Approval allows negative balance.');
    const second=submitCollection(db,collector,assignmentId,body,'test');
    assert.equal(first.id,second.id,'Retry replays the original acknowledgement after approval.');
    assert.equal(second.replayed,true);
    assert.equal(treasuryDashboard(db,admin.organizationId).activeCashUnits,0,'Approval does not move active cash.');
  } finally {db.close();}
});

test('Android contract: absent EGP rate preserves null rather than inventing a zero conversion',()=>{
  const db=openDatabase(':memory:');
  try {
    const admin=fixtureAdmin(db);
    createCustomer(db,admin,{name:'أمانة بلا سعر',openingBalance:10,requestId:'android-rule-egp'},'test','depositEgp');
    const result=treasuryDashboard(db,admin.organizationId);
    assert.equal(result.egyptianRate,null);
    assert.equal(result.egyptianConvertedUnits,null);
    assert.equal(result.netUnits,null);
  } finally {db.close();}
});
