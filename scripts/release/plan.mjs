// All checks run against synthetic databases; no production URL or credentials.
export const RELEASE_PLAN_VERSION = 2;
export const releaseChecks = [
  { id: 'build', npm: 'build' },
  { id: 'lint', npm: 'lint' },
  { id: 'unit-and-contracts', node: ['--test', '--test-concurrency=2', 'tests/*.test.ts'] },
  { id: 'partial-receipt-recovery', npm: 'test:partial-receipt-ui' },
  { id: 'unlinked-payroll-recovery', npm: 'test:recoverable-writes-ui' },
  { id: 'ledger-sync', npm: 'test:ledger-window-sync-ui' },
  { id: 'notification-sync', npm: 'test:notification-sync-ui' },
  { id: 'three-appearances', npm: 'test:account-cockpit-ui' },
  { id: 'section-ledger-appearance', npm: 'test:cockpit-system-ui' },
  { id: 'original-appearance-regression', npm: 'test:white-gold-ui' },
  { id: 'payroll-cancellation', npm: 'test:payroll-cancellation-ui' },
  { id: 'restore-drill', npm: 'test:restore' },
  { id: 'deployment-recovery', powershell: 'scripts/test-deployment-recovery.ps1' },
  { id: 'release-preflight', powershell: 'scripts/test-release-preflight.ps1' },
];
