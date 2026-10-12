import { useCallback, useState } from 'react';
import { api } from '../api.ts';
import type { DebtSection } from '../sections/debts/sectionConfig.ts';
import { dashboardErrorText } from './dashboardModel.ts';

type RoutingNotice = { kind: 'success' | 'error'; text: string };

type CollectionRoutingOptions = {
  debtSection: DebtSection;
  refreshAccounts: () => Promise<void>;
  onNotice: (notice: RoutingNotice) => void;
};

export function useCollectionRouting({ debtSection, refreshAccounts, onNotice }: CollectionRoutingOptions) {
  const [routing, setRouting] = useState(false);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<Array<{ id: string; username: string; displayName: string }>>(
    [],
  );
  const [assigneeId, setAssigneeId] = useState('');

  async function startRouting() {
    setRouting(true);
    setSelectedCustomers([]);
    try {
      const result = await api.collectionAssignees();
      setAssignees(result.items);
      setAssigneeId(result.items[0]?.id ?? '');
    } catch (error) {
      onNotice({ kind: 'error', text: dashboardErrorText(error) });
    }
  }

  function cancelRouting() {
    setRouting(false);
    setSelectedCustomers([]);
  }

  function selectCustomer(id: string, selected: boolean) {
    setSelectedCustomers((current) =>
      selected ? [...new Set([...current, id])] : current.filter((item) => item !== id),
    );
  }

  async function confirmRouting() {
    if (!assigneeId || selectedCustomers.length === 0) return;
    try {
      const routedCustomers = [...selectedCustomers];
      await api.assignCollections(
        routedCustomers,
        assigneeId,
        debtSection === 'companies' ? 'companies' : 'customers',
      );
    } catch (error) {
      onNotice({ kind: 'error', text: dashboardErrorText(error) });
      return;
    }
    setRouting(false);
    setSelectedCustomers([]);
    onNotice({ kind: 'success', text: 'تم توجيه الكروت إلى الموظف.' });
    try {
      await refreshAccounts();
    } catch {
      onNotice({ kind: 'success', text: 'تم توجيه الكروت إلى الموظف. تعذر تحديث العرض مؤقتًا؛ ستعيد المزامنة المحاولة تلقائيًا.' });
    }
  }

  const resetRouting = useCallback(() => {
    setRouting(false);
    setSelectedCustomers([]);
    setAssignees([]);
    setAssigneeId('');
  }, []);

  return {
    routing,
    selectedCustomers,
    assignees,
    assigneeId,
    setAssigneeId,
    startRouting,
    cancelRouting,
    selectCustomer,
    confirmRouting,
    resetRouting,
  };
}
