import { uiText } from '../i18n/language.ts';
import { lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Customer, Ledger, ConfirmedLedgerWrite } from '../api.ts';
import type { DebtSection } from '../sections/debts/sectionConfig.ts';

const CustomerForm = lazy(() => import('../sections/debts/CustomerDialogs.tsx').then((module) => ({ default: module.CustomerForm })));
const LedgerWorkspace = lazy(() => import('../sections/debts/LedgerWorkspace.tsx').then((module) => ({ default: module.LedgerWorkspace })));
const AuditLogManager = lazy(() => import('../sections/settings/AuditLogManager.tsx').then((module) => ({ default: module.AuditLogManager })));
const FinancialLedgerManager = lazy(() => import('../sections/settings/FinancialLedgerManager.tsx').then((module) => ({ default: module.FinancialLedgerManager })));
const SystemSettingsManager = lazy(() => import('../sections/settings/SystemSettingsManager.tsx').then((module) => ({ default: module.SystemSettingsManager })));

function OverlayLoading() {
  return <div className="settings-loading"><div className="spinner" /> {uiText(" جارٍ فتح النافذة…")}</div>;
}

type Notice = { kind: 'success' | 'error'; text: string } | null;

type Props = {
  section: DebtSection;
  ledger: Ledger | null;
  dialog: 'customer' | 'audit' | 'financial-ledger' | 'system-settings' | null;
  canWrite: boolean;
  onCloseLedger: () => void;
  onRefreshLedger: (saved?: ConfirmedLedgerWrite) => Promise<void>;
  onLoadOlder: () => Promise<void>;
  onNotice: (notice: Notice) => void;
  onCloseDialog: () => void;
  onCustomerCreated: (customer: Customer) => void;
  onExistingCustomer: (customerId: string) => void;
};

export function DashboardOverlays({
  section,
  ledger,
  dialog,
  canWrite,
  onCloseLedger,
  onRefreshLedger,
  onLoadOlder,
  onNotice,
  onCloseDialog,
  onCustomerCreated,
  onExistingCustomer,
}: Props) {
  return (
    <>
      <AnimatePresence>
        {ledger && (
          <motion.div
            className="ledger-shade"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={onCloseLedger}
          >
            <Suspense fallback={<OverlayLoading />}>
              <LedgerWorkspace
                section={section}
                ledger={ledger}
                canWrite={canWrite && !ledger.customer.systemManaged}
                onClose={onCloseLedger}
                onRefresh={onRefreshLedger}
                onLoadOlder={onLoadOlder}
                onNotice={onNotice}
              />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        <Suspense fallback={dialog ? <OverlayLoading /> : null}>
          {dialog === 'customer' && (
            <CustomerForm
              section={section}
              onClose={onCloseDialog}
              onCreated={onCustomerCreated}
              onExisting={onExistingCustomer}
            />
          )}
          {dialog === 'audit' && <AuditLogManager onClose={onCloseDialog} />}
          {dialog === 'financial-ledger' && <FinancialLedgerManager onClose={onCloseDialog} />}
          {dialog === 'system-settings' && <SystemSettingsManager onClose={onCloseDialog} />}
        </Suspense>
      </AnimatePresence>
    </>
  );
}
