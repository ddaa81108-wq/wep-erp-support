import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { SCHEMA_VERSION } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';

test('Windows PowerShell worker restores, waits, revokes sessions, rolls back failures and resolves interrupted jobs', { skip: process.platform !== 'win32' }, () => {
  mkdirSync(resolve('artifacts'),{recursive:true});
  const root=mkdtempSync(resolve('artifacts/restore-worker-test-'));
  const quote=(value:string)=>"'"+value.replaceAll("'","''")+"'";
  try {
    for(const mode of ['success','startup-failure','interrupted','interrupted-replacing'] as const) {
      const data=join(root,mode), install=join(data,'install'), queue=join(data,'restore'), candidate=join(queue,'restore-test1/database.sqlite');
      mkdirSync(join(data,'data'),{recursive:true});mkdirSync(join(install,'scripts'),{recursive:true});mkdirSync(join(queue,'restore-test1'),{recursive:true});
      for(const file of ['backup-database.mjs','verify-database.mjs','reset-restored-sessions.mjs']) copyFileSync(resolve('scripts',file),join(install,'scripts',file));
      const live=join(data,'data/abdo-erp.sqlite');
      const db=openDatabase(live);const actor=fixtureAdmin(db);createSession(db,actor.id,'1',12);db.exec("CREATE TABLE worker_probe(value TEXT);INSERT INTO worker_probe VALUES('original');");db.close();
      copyFileSync(live,candidate);
      const copy=openDatabase(candidate);copy.exec("UPDATE worker_probe SET value='restored';");copy.close();
      const bytes=readFileSync(candidate),sha256=createHash('sha256').update(bytes).digest('hex');
      writeFileSync(candidate+'.json',JSON.stringify({manifestVersion:1,file:'database.sqlite',fileSizeBytes:bytes.length,sha256,schemaVersion:Number(SCHEMA_VERSION)}));
      writeFileSync(join(queue,'pending.json'),JSON.stringify({path:candidate,sha256}));
      if(mode.startsWith('interrupted'))renameSync(join(queue,'pending.json'),join(queue,'processing.json'));
      if(mode==='interrupted-replacing')writeFileSync(join(queue,'journal.json'),JSON.stringify({phase:'replacing',backupEnabled:true,rescue:live}));
      const enabled=join(data,'backup-enabled.txt');
      const harness=join(data,'harness.ps1');
      writeFileSync(harness,`
function Stop-Service { param($Name,[switch]$Force,$ErrorAction) }
function Start-Service { param($Name) ${mode==='startup-failure'?"if ($Name -eq 'AbdoErpLocal') { throw 'Simulated startup failure' }":''} }
function Get-NetTCPConnection { param($LocalPort,$State,$ErrorAction) }
function Disable-ScheduledTask { param($TaskName) }
function Enable-ScheduledTask { param($TaskName) [IO.File]::WriteAllText(${quote(enabled)},'enabled') }
function Get-ScheduledTask { param($TaskName) return [pscustomobject]@{State='Ready';Settings=[pscustomobject]@{Enabled=$true}} }
$script:checks=0
function Invoke-RestMethod { param($Uri,$TimeoutSec) $script:checks++;if($script:checks -lt 3){throw 'Warming up'}; return @{data=@{status='ready'}} }
& ${quote(resolve('scripts/run-pending-restore.ps1'))} -DataRoot ${quote(data)} -InstallRoot ${quote(install)} -NodePath ${quote(process.execPath)}
`);
      const run=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',harness],{encoding:'utf8',timeout:90_000});
      assert.equal(run.error,undefined,run.stderr);
      const result=JSON.parse(readFileSync(join(queue,'last-result.json'),'utf8'));
      assert.equal(result.success,mode==='success',JSON.stringify(result)+run.stdout+run.stderr);
      assert.equal(existsSync(join(queue,'processing.json')),false);
      if(mode!=='interrupted')assert.equal(existsSync(enabled),true);
      const actual=openDatabase(live);
      assert.equal(actual.prepare('SELECT value FROM worker_probe').get()!.value,mode==='success'?'restored':'original');
      assert.equal(actual.prepare('SELECT COUNT(*) n FROM sessions').get()!.n,mode==='success'?0:1);actual.close();
      if(mode==='startup-failure'||mode==='interrupted-replacing')assert.equal(existsSync(join(queue,'recovery-required.json')),true);
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});
