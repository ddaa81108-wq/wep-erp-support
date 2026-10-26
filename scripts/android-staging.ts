/** Isolated synthetic sandbox. Never reads the installed/production database. */
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { hashPassword } from '../src/server/security/password.ts';
import { createCustomer } from '../src/server/domain/customerAccountCommands.ts';
import { listPurchases } from '../src/server/domain/purchaseQueries.ts';
import { setPurchaseOpening } from '../src/server/domain/purchaseDayCommands.ts';
import { createPurchaseEntry } from '../src/server/domain/purchaseEntryCommands.ts';
import { setEgyptianDepositRate } from '../src/server/modules/treasury/exchangeRates.ts';
import { addTreasuryCashEntry } from '../src/server/domain/treasury.ts';
import { assignCustomers, submitCollection, decideCollection, createUnlinkedCollectionReceipt } from '../src/server/domain/collections.ts';
import type { AuthenticatedUser } from '../src/server/security/sessions.ts';

const sandboxRoot = resolve('var/android-staging');
mkdirSync(sandboxRoot, { recursive: true });
// Restrict before writing credentials or the database. Fail closed on ACL failure.
if (process.platform === 'win32') {
  const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).match(/S-1-[\d-]+/)?.[0];
  if (!sid) throw new Error('Cannot determine the Windows account SID');
  execFileSync('icacls', [sandboxRoot, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { stdio: 'pipe' });
}
const publicMode = process.argv.includes('--public');
const resume = process.argv.slice(2).find(arg=>arg !== '--public');
const run = resume ? resolve(resume) : join(sandboxRoot, new Date().toISOString().replace(/[:.]/g, '-'));
if (!run.startsWith(sandboxRoot + sep)) throw new Error('Sandbox directory must be inside var/android-staging');
mkdirSync(run, { recursive: true });
const dbPath = join(run, 'synthetic.sqlite');
const manifestPath = join(run, 'manifest.json');
if (resume && (!existsSync(manifestPath) || !existsSync(dbPath))) throw new Error('Existing sandbox is incomplete');
if (!resume && existsSync(dbPath)) throw new Error('Refusing to overwrite an existing sandbox');
const db = openDatabase(dbPath);
if (!resume) {
  const sourceCommit = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  execFileSync('git',['diff','--quiet','HEAD','--','src'],{stdio:'pipe'});
  const accounts: Array<{ id: string; username: string; password: string; role: 'admin' | 'employee'; displayName: string; permissions: string[] }> = [
    {id: randomUUID(), username: 'android-admin', password: randomBytes(24).toString('base64url'), role: 'admin', displayName: 'مدير الاختبار', permissions: []},
    {id: randomUUID(), username: 'android-limited', password: randomBytes(24).toString('base64url'), role: 'employee', displayName: 'مشرف اختبار محدود', permissions: ['debts.read','companies.read','libyan_deposits.read','egyptian_deposits.read','purchases.read','treasury.read','reports.read','collections.read']},
    {id: randomUUID(), username: 'android-collector', password: randomBytes(24).toString('base64url'), role: 'employee', displayName: 'محصل الاختبار', permissions: ['collections.read','collections.write']},
  ];
  const now = new Date().toISOString();
  for (const [index, account] of accounts.entries()) {
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,is_owner,created_at,updated_at)
      VALUES(?,?,?,?,?,'org-default','branch-main',?,?,?)`).run(account.id, account.username, account.displayName, await hashPassword(account.password), account.role, index === 0 ? 1 : 0, now, now);
    for (const permission of account.permissions) db.prepare('INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,?,1,?)').run(account.id, permission, now);
  }
  db.prepare("UPDATE organization_settings SET system_name='اختبار Android — بيانات مصطنعة',timezone='Africa/Tripoli' WHERE organization_id='org-default'").run();
  const actor = (index: number): AuthenticatedUser => ({...accounts[index], organizationId:'org-default', homeBranchId:'branch-main', isOwner:index===0, mustChangePassword:false, permissions:new Set(accounts[index].permissions), sessionTokenHash:'',csrfHash:''});
  const admin = actor(0), collector = actor(2);
  const make = (name: string, openingBalance: number, kind: 'customer'|'company'|'depositLyd'|'depositEgp' = 'customer') => {
    const result = createCustomer(db, admin, {name, openingBalance, requestId:randomUUID()}, 'android-fixture', kind);
    return String((result.body.customer as {id:string}).id);
  };
  const customerId = make('عميل المطابقة ألف',1000);
  make('عميل المطابقة باء',250);
  const collectionCustomerId = make('عميل تحصيل الاختبار',400);
  const companyId = make('شركة المطابقة',2000,'company');
  make('أمانة ليبية اختبار',300,'depositLyd');
  make('أمانة مصرية اختبار',10000,'depositEgp');
  setEgyptianDepositRate(db,admin,10);
  let purchases = listPurchases(db,admin,'al_bayan',null,null);
  setPurchaseOpening(db,admin,'al_bayan',{expectedDayVersion:purchases.day.version,previousDebtUnits:0,previousVodafoneUnits:5000},'android-fixture');
  purchases = listPurchases(db,admin,'al_bayan',null,null);
  createPurchaseEntry(db,admin,'al_bayan',{requestId:randomUUID(),expectedDayVersion:purchases.day.version,itemCode:'custom',itemLabel:'مشتريات اختبار',egpValueUnits:1000,calculationMode:'divide',exchangeRate:'10',paidUnits:20,vodafoneConsumedUnits:100},'android-fixture');
  listPurchases(db,admin,'simsim',null,null);
  addTreasuryCashEntry(db,admin,{requestId:randomUUID(),expectedVersion:0,direction:'in',amountUnits:500,description:'نقدية اختبار مصطنعة'},'android-fixture');
  const assignmentId = assignCustomers(db,admin,{customerIds:[collectionCustomerId],assigneeUserId:collector.id,section:'customers'},'android-fixture').assignmentIds[0];
  const submission = submitCollection(db,collector,assignmentId,{requestId:'android-seed-approved',mode:'partial',amountUnits:100},'android-fixture');
  decideCollection(db,admin,submission.id,{decision:'approve'},'android-fixture');
  submitCollection(db,collector,assignmentId,{requestId:'android-seed-pending',mode:'partial',amountUnits:50},'android-fixture');
  createUnlinkedCollectionReceipt(db,collector,{customerName:'استلام مستقل للاختبار',amountUnits:75,requestId:randomUUID()},'android-fixture');
  writeFileSync(join(run,'credentials.private.json'),JSON.stringify({accounts},null,2),{mode:0o600});
  writeFileSync(manifestPath,JSON.stringify({synthetic:true,sourceCommit,serverMode:'unbundled source; health.build.commit is null',createdAt:now,customerId,companyId,collectionCustomerId,assignmentId,initialCustomerBalanceUnits:1000,partialPaymentUnits:250,fullPaymentUnits:750},null,2));
}
const manifest = JSON.parse(readFileSync(manifestPath,'utf8'));
if (manifest.synthetic !== true) throw new Error('Not a synthetic sandbox');
// Explicit overrides isolate all outbound integrations and ignore production env config.
const config = loadConfig({host:'127.0.0.1',port:4311,databasePath:dbPath,secureCookie:publicMode,internetRequired:false,publicOrigin:publicMode?'https://staging.vip2100.com':'',backupDirectory:join(run,'backups'),pushPublicKey:'',pushPrivateKey:'',pushSubject:'',googleClientId:'',googleClientSecret:'',googleRedirectUri:'',setupToken:randomBytes(32).toString('hex')});
const server = createApp(db,config);
await listen(server,config.host,config.port);
writeFileSync(join(sandboxRoot,'current.json'),JSON.stringify({run,baseUrl:'http://127.0.0.1:4311',pid:process.pid},null,2));
console.log(`Synthetic staging: http://127.0.0.1:4311/erp\nPrivate files: ${run}\nNo production database or service was modified.`);
const shutdown = () => { server.closeRealtimeConnections(); server.closeAllConnections(); server.close(() => {db.close();process.exit(0);}); };
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
