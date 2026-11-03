import { request } from '../apiTransport.ts';
import type { CollectionLinkCandidate, CollectionPayrollDashboard, CollectionsDashboard, CollectionWorkspace } from '../apiTypes.ts';

export const collectionsApi = {
  collections: () => request<CollectionsDashboard>('/api/collections'),
  cancelCollectionAssignment: (id: string) => request<{ id: string; cancelled: boolean }>(
    `/api/collections/assignments/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' },
  ),
  cancelCollectionApproval: (kind: 'linked' | 'unlinked', id: string, input: { requestId: string; reason: string; expectedTransactionId: string }) =>
    request<{ id: string; cancelled: boolean }>(`/api/collections/${kind === 'linked' ? 'submissions' : 'unlinked-receipts'}/${encodeURIComponent(id)}/cancel-approval`, { method: 'POST', body: JSON.stringify(input) }),
  myCollectionReceipts: (options: { state: 'all' | 'cash'; q?: string; page?: number; assignmentId?: string }, signal?: AbortSignal) => {
    const params = new URLSearchParams(Object.entries(options).map(([key, value]) => [key, String(value ?? '')]));
    return request<CollectionWorkspace>('/api/collections/mine?' + params.toString(), { signal });
  },
  collectionWorkspace: (options: { batchId: string; employeeId?: string; state: 'review' | 'cash' | 'all'; q?: string; page?: number; assignmentId?: string; export?: '1' }, signal?: AbortSignal) => {
    const params = new URLSearchParams(Object.entries(options).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]));
    return request<CollectionWorkspace>('/api/collections/workspace?' + params.toString(), { signal });
  },
  collectionPayroll: () => request<CollectionPayrollDashboard>('/api/collections/payroll'),
  createCollectionPayrollEntry: (
    employeeUserId: string,
    kind: 'withdrawal' | 'commission',
    amountUnits: number,
    reason: string,
    requestId: string,
  ) => request<{ id: string }>('/api/collections/payroll/entries', {
    method: 'POST',
    body: JSON.stringify({ employeeUserId, kind, amountUnits, reason, requestId }),
  }),
  updateCollectionPayrollSalary: (employeeUserId: string, baseSalaryUnits: number) =>
    request<{ employeeId: string; baseSalaryUnits: number }>(
      `/api/collections/payroll/employees/${encodeURIComponent(employeeUserId)}/salary`,
      { method: 'PUT', body: JSON.stringify({ baseSalaryUnits }) },
    ),
  confirmCollectionPayrollEntry: (entryId: string) =>
    request<{ id: string; confirmedAt: string }>(
      `/api/collections/payroll/entries/${encodeURIComponent(entryId)}/confirm`,
      { method: 'POST', body: '{}' },
    ),
  collectionAssignees: () =>
    request<{ items: Array<{ id: string; username: string; displayName: string }> }>(
      '/api/collections/assignees',
    ),
  assignCollections: (
    customerIds: string[],
    assigneeUserId: string,
    section: 'customers' | 'companies' = 'customers',
  ) =>
    request<{ assignmentIds: string[] }>('/api/collections/assignments', {
      method: 'POST',
      body: JSON.stringify({ customerIds, assigneeUserId, section }),
    }),
  submitCollection: (assignmentId: string, mode: 'full' | 'partial', amountUnits: number | undefined, requestId: string) =>
    request<{ id: string; status: 'pending'; amountUnits: number; replayed: boolean }>(
      `/api/collections/assignments/${encodeURIComponent(assignmentId)}/submissions`,
      { method: 'POST', body: JSON.stringify({ mode, amountUnits, requestId }) },
    ),
  createUnlinkedCollectionReceipt: (customerName: string, amountUnits: number, requestId: string) =>
    request<{id:string;status:'pending';amountUnits:number;currency:'LYD'}>('/api/collections/unlinked-receipts',{
      method:'POST',body:JSON.stringify({customerName,amountUnits,requestId,currency:'LYD'}),
    }),
  collectionLinkCandidates: (query:string) =>
    request<{items:CollectionLinkCandidate[]}>(`/api/collections/link-candidates?q=${encodeURIComponent(query)}`),
  decideUnlinkedCollectionReceipt: (
    receiptId:string,
    decision:'approve'|'reject',
    customerId?:string,
    entryType?:'debt'|'payment',
    note='',
    newAccountKind?:'customer'|'company',
  ) => request<{id:string;status:string;balanceUnits?:number}>(
    `/api/collections/unlinked-receipts/${encodeURIComponent(receiptId)}/decision`,
    {method:'POST',body:JSON.stringify({decision,customerId,entryType,note,newAccountKind})},
  ),
  receiveUnlinkedCollectionCash: (receiptId:string) =>
    request<{id:string;cashReceivedAt:string}>(
      `/api/collections/unlinked-receipts/${encodeURIComponent(receiptId)}/cash-received`,
      {method:'POST',body:'{}'},
    ),
  decideCollection: (submissionId: string, decision: 'approve' | 'reject', note = '') =>
    request<{ id: string; status: string; balanceUnits?: number }>(
      `/api/collections/submissions/${encodeURIComponent(submissionId)}/decision`,
      { method: 'POST', body: JSON.stringify({ decision, note }) },
    ),
  receiveCollectionCash: (submissionId: string) =>
    request<{ id: string; cashReceivedAt: string }>(
      `/api/collections/submissions/${encodeURIComponent(submissionId)}/cash-received`,
      { method: 'POST', body: '{}' },
    ),
  closeCollectionDay: (batchId: string, exception?: { reason: string; expectedCashPendingCount: number; expectedCashPendingUnits: number }) =>
    request<{
      batchId: string;
      businessDate: string;
      closed: true;
      deletedAssignments: number;
      deletedSubmissions: number;
    }>('/api/collections/days/close', {
      method: 'POST',
      body: JSON.stringify({ batchId, confirmed: true, ...(exception ? { ...exception, allowOutstandingCash: true } : {}) }),
    }),
};
