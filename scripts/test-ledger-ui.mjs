import { spawnSync } from 'node:child_process';
import process from 'node:process';

const section = process.argv[2];
const scripts = {
  customers: 'tests/customer-ledger-pills-ui.ts',
  companies: 'tests/customer-ledger-pills-ui.ts',
  libyan: 'tests/libyan-ledger-pills-ui.ts',
  egyptian: 'tests/egyptian-ledger-presentation-ui.ts',
};
if (!Object.hasOwn(scripts, section)) throw new Error('Choose customers, companies, libyan or egyptian');
const result = spawnSync(process.execPath, [scripts[section]], {
  stdio: 'inherit',
  env: { ...process.env, LEDGER_UI_SECTION: section },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
