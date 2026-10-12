import { useRealtimeRefresh } from '../../realtime/useRealtimeRefresh.ts';
import type { DebtSection, MainSection } from './sectionConfig.ts';

type Props = {
  activeSection: MainSection;
  canRead: boolean;
  debtSection: DebtSection;
  openLedgerId: { current: string | null };
  loadCustomers: () => Promise<void>;
  refreshLedgerWhenIdle: (id: string) => void;
};
const prefixes = {
  customers: 'customer',
  companies: 'company',
  'libyan-deposits': 'libyan-deposit',
  'egyptian-deposits': 'egyptian-deposit',
} as const;

export function useDebtRealtime({
  activeSection,
  canRead,
  debtSection,
  openLedgerId,
  loadCustomers,
  refreshLedgerWhenIdle,
}: Props) {
  const prefix = prefixes[debtSection];
  useRealtimeRefresh({
    topics: [prefix + '.changed', prefix + '.ledger.changed'],
    cursorKey: 'abdo:debt-events:' + debtSection,
    enabled: canRead && activeSection === debtSection,
    fallbackIntervalMs: 2500,
    onChange: async (changes, fullResync) => {
      // The list response owns the section-wide totals and active-card definition.
      await loadCustomers();
      const id = openLedgerId.current;
      if (id && (fullResync || changes.some((change) => change.aggregateId === id)))
        refreshLedgerWhenIdle(id);
    },
  });
}
