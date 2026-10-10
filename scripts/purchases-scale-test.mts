import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { openDatabase } from '../src/server/db/database.ts';

const rows = Number(process.argv[2] ?? 1_000_000);
if (!Number.isSafeInteger(rows) || rows < 1 || rows > 1_000_000) throw new Error('Row count must be between 1 and 1,000,000.');
const directory=mkdtempSync(join(tmpdir(),'abdo-purchases-scale-'));const path=join(directory,'scale.sqlite');const db=openDatabase(path);
try{
  const at=new Date().toISOString();
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
    VALUES('scale-admin','scale-admin','Scale','disabled','admin','org-default','branch-main',?,?)`).run(at,at);
  db.prepare(`INSERT INTO purchase_merchants(id,organization_id,merchant_key,display_name,next_sequence,next_day_number,created_at)
    VALUES('scale-merchant','org-default','al_bayan','البيان',?,2,?)`).run(rows+1,at);
  db.prepare(`INSERT INTO purchase_days(id,organization_id,merchant_id,day_number,business_date,status,previous_debt_units,today_result_units,
    total_debt_units,created_by_user_id,opened_at,updated_at) VALUES('scale-day','org-default','scale-merchant',1,'2026-10-01','draft',0,?,?, 'scale-admin',?,?)`).run(rows,rows,at,at);
  const insert=db.prepare(`INSERT INTO purchase_entries(id,organization_id,merchant_id,day_id,sequence,item_code,item_label,egp_value_units,
    calculation_mode,exchange_rate_micros,result_units,paid_units,remaining_units,vodafone_consumed_units,actor_user_id,created_at,updated_at)
    VALUES(?,'org-default','scale-merchant','scale-day',?,'cairo','القاهرة',1,'multiply',1000000,1,0,1,0,'scale-admin',?,?)`);
  const started=performance.now();db.exec('BEGIN IMMEDIATE');
  for(let sequence=1;sequence<=rows;sequence++)insert.run(`scale-${sequence}`,sequence,at,at);
  db.exec('COMMIT');const insertMs=performance.now()-started;
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const readStarted=performance.now();
  const page=db.prepare(`SELECT e.sequence,e.result_units,d.day_number,u.display_name FROM purchase_entries e
    JOIN purchase_days d ON d.id=e.day_id JOIN users u ON u.id=e.actor_user_id
    WHERE e.organization_id=? AND e.merchant_id=? AND e.deleted_at IS NULL AND e.sequence<? ORDER BY e.sequence DESC LIMIT 101`)
    .all('org-default','scale-merchant',Number.MAX_SAFE_INTEGER);const readMs=performance.now()-readStarted;
  const summaryStarted=performance.now();const summary=db.prepare('SELECT total_debt_units,today_result_units FROM purchase_days WHERE id=?').get('scale-day');const summaryMs=performance.now()-summaryStarted;
  const plan=db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM purchase_entries WHERE organization_id=? AND merchant_id=? AND deleted_at IS NULL AND sequence<? ORDER BY sequence DESC LIMIT 101`).all('org-default','scale-merchant',Number.MAX_SAFE_INTEGER);
  process.stdout.write(`${JSON.stringify({rows,insertSeconds:Number((insertMs/1000).toFixed(2)),latestPageMs:Number(readMs.toFixed(3)),summaryMs:Number(summaryMs.toFixed(3)),pageRows:page.length,summary,databaseMb:Number((statSync(path).size/1024/1024).toFixed(2)),usesFeedIndex:plan.some((step)=>String(step.detail).includes('idx_purchase_entries_feed'))},null,2)}\n`);
}finally{db.close();rmSync(directory,{recursive:true,force:true});}
