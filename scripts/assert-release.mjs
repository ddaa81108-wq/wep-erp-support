import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import console from 'node:console';
import process from 'node:process';
import { sourceIdentity, buildIdentity, assertReleaseEvidence } from './release/evidence.mjs';

try {
  const root = resolve(process.argv[2] || '.');
  const report = JSON.parse(readFileSync(resolve(root, 'var/release-verification/latest.json'), 'utf8'));
  assertReleaseEvidence(report, sourceIdentity(root), buildIdentity(root));
  console.log(`Verified release: ${report.source.commit}`);
} catch (error) {
  console.error(
    `Deployment preflight failed: ${error.message}\nRun npm run verify:release before deploying.`,
  );
  process.exitCode = 1;
}
