import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { createCustomer, addCustomerTransaction } from '../src/server/domain/customers.ts';
import { customerAccount, customerBalance } from '../src/server/domain/customerAccountRepository.ts';
import { operationsSnapshot } from '../src/server/domain/operationsCenter.ts';
import { SCHEMA_VERSION } from '../src/server/config.ts';
import { migrations } from '../src/server/db/migrations.ts';
import { enforcePublicHttps } from '../src/server/http/https.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

test('published schema, actual migrations, backup context and large ledger totals agree', () => {
  const db = openDatabase(':memory:');
  try {
    const actor = fixtureAdmin(db);
    assert.equal(Number(SCHEMA_VERSION), migrations.at(-1)!.version);
    assert.equal(Number(db.prepare('SELECT MAX(version) v FROM schema_migrations').get()!.v), Number(SCHEMA_VERSION));
    const created = createCustomer(db, actor, { name: 'Large test', openingBalance: 0, requestId: 'audit-create-customer' }, 'test');
    const id = (created.body.customer as { id: string }).id;
    const result = addCustomerTransaction(db, actor, id, { requestId: 'audit-test-amount', expectedVersion: 1, type: 'debt', inputValue: 8000000035, calculationMode: 'multiply', factor: '999999.123456' }, 'test');
    const account = customerAccount(db, id, actor.organizationId);
    assert.equal(result.body.balanceUnits, 7999993022647969);
    assert.equal(customerBalance(db, account.cycleId), result.body.balanceUnits);
    const status = operationsSnapshot(db, actor);
    assert.equal(status.financialMismatches, 0);
    assert.equal(status.backupSchedule, null);
  } finally { db.close(); }
});

test('public HTTP redirects to a fixed HTTPS origin, forwarded HTTPS gets HSTS, local health stays local', () => {
  function check(host: string, proto?: string, url = '/erp') {
    const result = { status: 0, headers: {} as Record<string, string> };
    const response = { writeHead(status: number, headers: Record<string,string>) { result.status=status; Object.assign(result.headers,headers); }, setHeader(name:string,value:string) { result.headers[name]=value; }, end() {} } as unknown as ServerResponse;
    const request = { headers: { host, 'x-forwarded-proto': proto }, url, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
    const redirected = enforcePublicHttps(request, response, 'https://vip2100.com');
    return { ...result, redirected };
  }
  assert.equal(check('vip2100.com','http').status, 308);
  assert.equal(check('attacker.invalid','http','//attacker.invalid/x').headers.Location,'https://vip2100.com/attacker.invalid/x');
  assert.equal(check('vip2100.com','https').headers['Strict-Transport-Security'],'max-age=15552000');
  assert.equal(check('127.0.0.1:4310').redirected,false);
});
