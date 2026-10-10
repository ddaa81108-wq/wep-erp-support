import { financialLedgerPath } from '../apiPaths.ts';
import { request } from '../apiTransport.ts';
import type { AccountRequest, AuditEntry, FinancialLedgerEntry, ManagedSession, ManagedUser, NotificationItem, NotificationPreferences, OperationsHealth, OrganizationSettings, TechnicalEvent } from '../apiTypes.ts';

type Access = 'none' | 'read' | 'manage';
type UserAccess = {
  customerDebtsAccess: Access;
  companyDebtsAccess: Access;
  libyanDepositsAccess: Access;
  egyptianDepositsAccess: Access;
  masraweyaAccess: Access;
  purchasesAccess: Access;
  treasuryAccess: Access;
  reportsAccess: Access;
};

export const administrationApi = {
  notifications: (before?: number|null) => request<{items:NotificationItem[];unreadCount:number;nextBefore:number|null}>(`/api/notifications${before?`?before=${before}`:''}`),
  markNotificationRead: (id:number) => request<{id:number;read:true}>(`/api/notifications/${id}/read`,{method:'PATCH'}),
  markAllNotificationsRead: () => request<{read:number}>('/api/notifications/read-all',{method:'POST'}),
  notificationPreferences: () => request<NotificationPreferences>('/api/notification-preferences'),
  updateNotificationPreferences: (body:NotificationPreferences) => request<NotificationPreferences>('/api/notification-preferences',{method:'PATCH',body:JSON.stringify(body)}),
  operationsHealth: () => request<OperationsHealth>('/api/operations/health'),
  managedSessions: () => request<{ items: ManagedSession[] }>('/api/operations/sessions'),
  technicalEvents: () => request<{ items: TechnicalEvent[] }>('/api/operations/errors'),
  revokeManagedSession: (sessionId: string) => request<{ revoked: boolean; current: boolean }>(
    `/api/operations/sessions/${encodeURIComponent(sessionId)}/revoke`, { method: 'POST' },
  ),
  organizationSettings: () =>
    request<{ settings: OrganizationSettings }>('/api/organization-settings'),
  updateOrganizationSettings: (body: {
    expectedVersion: number;
    systemName: string;
    timezone: OrganizationSettings['timezone'];
    employeeSectionsVisible: boolean;
  }) => request<{ settings: OrganizationSettings }>('/api/organization-settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }),
  auditLog: (before?: number | null) =>
    request<{ items: AuditEntry[]; nextBefore: number | null }>(
      `/api/audit-log${before ? `?before=${before}` : ''}`,
    ),
  financialLedger: (
    options: {
      before?: string | null;
      section?: string;
      currency?: '' | 'LYD' | 'EGP';
      query?: string;
    } = {},
  ) =>
    request<{
      items: FinancialLedgerEntry[];
      pageTotals: { LYD: number; EGP: number };
      nextBefore: string | null;
    }>(financialLedgerPath(options)),
  users: () => request<{ items: ManagedUser[]; assignablePermissions: readonly string[] }>('/api/users'),
  accountRequests: () => request<{ items: AccountRequest[] }>('/api/account-requests'),
  decideAccountRequest: (
    requestId: string,
    body: {
      expectedVersion: number;
      decision: 'approve' | 'reject';
      customerDebtsAccess: Access;
      note?: string;
    },
  ) =>
    request<{ request: AccountRequest }>(`/api/account-requests/${encodeURIComponent(requestId)}/decision`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createUser: (
    body: {
      username: string;
      displayName: string;
      email?: string;
      role: 'admin' | 'employee';
      password: string;
      permissions: string[];
    } & UserAccess,
  ) => request<{ user: ManagedUser }>('/api/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (
    userId: string,
    body: {
      expectedVersion: number;
      displayName: string;
      email?: string;
      isActive: boolean;
      permissions: string[];
      password?: string;
    } & UserAccess,
  ) =>
    request<{ user: ManagedUser }>(`/api/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};
