import test from 'node:test';
import assert from 'node:assert/strict';
import type {AddressInfo} from 'node:net';
import {accountSearchFixture} from './helpers/accountSearchFixture.ts';
import {createApp,listen} from '../src/server/app.ts';
import {loadConfig} from '../src/server/config.ts';
import {createSession} from '../src/server/security/sessions.ts';

test('unified search reports only active assignment data for readable account sections without writing',async()=>{
  const {db,admin,ids,companyId,hiddenId}=accountSearchFixture();
  const server=createApp(db,loadConfig({databasePath:':memory:',secureCookie:false,internetRequired:false,publicOrigin:''}));
  try {
    await listen(server,'127.0.0.1',0);const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
    const session=createSession(db,admin.id,'1',12);
    const search=async(token:string)=>{
      const response=await fetch(base+'/api/account-search?q='+encodeURIComponent('بحث'),{headers:{cookie:'abdo_session='+token}});
      assert.equal(response.status,200);return (await response.json()).data.items as {id:string;section:string;activeAssignmentId:string|null;activeAssigneeName:string|null}[];
    };
    const snapshot=()=>JSON.stringify(['customers','debt_assignments','debt_transactions','audit_log'].map(table=>db.prepare(`SELECT * FROM ${table}`).all()));
    const before=snapshot();const items=await search(session.token);assert.equal(snapshot(),before);
    for(const id of [ids[0],companyId]){
      assert.ok(items.find(item=>item.id===id)?.activeAssignmentId);
      assert.equal(items.find(item=>item.id===id)?.activeAssigneeName,'fixture-collector');
    }
    assert.equal(items.find(item=>item.id===hiddenId)?.activeAssignmentId,null);
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
      SELECT 'search-reader','search-reader','Search reader',password_hash,'employee',organization_id,home_branch_id,created_at,updated_at FROM users WHERE id=?`).run(admin.id);
    db.prepare("INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES('search-reader','debts.read',1,?)").run(new Date().toISOString());
    const reader=createSession(db,'search-reader','1',12);
    assert.ok((await search(reader.token)).every(item=>item.section==='customers'));
    db.prepare("UPDATE debt_assignments SET status='cancelled',cancelled_at=? WHERE customer_id=? AND status='active'").run(new Date().toISOString(),ids[0]);
    const cancelled=(await search(session.token)).find(item=>item.id===ids[0])!;
    assert.equal(cancelled.activeAssignmentId,null);assert.equal(cancelled.activeAssigneeName,null);
  }finally{server.closeRealtimeConnections();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();}
});
