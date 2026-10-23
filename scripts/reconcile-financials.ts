import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { reconcileFinancials } from '../src/server/domain/financialReconciliation.ts';

// Explicit input only: never create, migrate, repair or open the production DB by default.
const args = process.argv.slice(2);
try {
  if (args.length < 1 || args.length > 2)
    throw new Error('Usage: npm run verify:financial -- <existing.sqlite> [new-report.json]');
  const path = resolve(args[0]);
  if (!existsSync(path)) throw new Error('The database must already exist.');
  const output = args[1] ? resolve(args[1]) : null;
  if (
    output &&
    (!output.toLowerCase().endsWith('.json') ||
      output.toLowerCase() === path.toLowerCase() ||
      existsSync(output))
  )
    throw new Error('Choose a new JSON report path; existing files are never overwritten.');
  const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF');
    const report = reconcileFinancials(db);
    if (output) {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    }
    // Console output contains counts only, not customer names, credentials or balances.
    console.log(
      JSON.stringify({
        status: report.status,
        checks: report.checks,
        issueCount: report.issueCount,
        warningCount: report.warningCount,
        organizations: report.organizations.length,
        report: output,
      }),
    );
    process.exitCode = report.status === 'matched' ? 0 : report.status === 'mismatch' ? 2 : 3;
  } finally {
    db.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Financial reconciliation failed.');
  process.exitCode = 1;
}
