export type User = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  isOwner?: boolean;
  permissions?: string[];
  mustChangePassword?: boolean;
};

export type ManagedUser = Omit<User, 'role'> & {
  role: 'admin' | 'employee';
  isActive: boolean;
  version: number;
  email: string | null;
  mustChangePassword: boolean;
  permissions: string[];
  sectionAccess: {
    customerDebts: 'none' | 'read' | 'manage';
    companyDebts: 'none' | 'read' | 'manage';
    libyanDeposits: 'none' | 'read' | 'manage';
    egyptianDeposits: 'none' | 'read' | 'manage';
    masraweya: 'none' | 'read' | 'manage';
    purchases: 'none' | 'read' | 'manage';
    treasury: 'none' | 'read' | 'manage';
    reports: 'none' | 'read' | 'manage';
  };
  createdAt: string;
  updatedAt: string;
};

export type AccountRequest = {
  id: string;
  provider: 'google';
  email: string;
  displayName: string;
  pictureUrl: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decisionNote: string;
  requestedAt: string;
  decidedAt: string | null;
  version: number;
};

export type OrganizationSettings = {
  organizationId: string;
  systemName: string;
  timezone: 'Africa/Tripoli' | 'Africa/Cairo';
  locale: string;
  employeeSectionsVisible: boolean;
  version: number;
  updatedAt: string;
};

export type OperationsHealth = {
  integrity: string;
  schemaVersion: string;
  expectedSchemaVersion: string;
  uiVersion: string;
  activeUsers: number;
  activeSessions: number;
  technicalErrors: number;
  financialMismatches: number;
  backupPolicy: 'unverified';
  restoreStatus?: { state: string; completedAt: string | null } | null;
  backupSchedule?: {
    output: string;
    timezone: string;
    hours: number[];
    retentionCount: number;
    lastSuccess: string | null;
    lastFile: string | null;
    lastError: string | null;
  } | null;
  restoreDrillStatus: 'unverified';
  onlineOnly: boolean;
  checkedAt: string;
};

export type ManagedSession = {
  id: string;
  userId: string;
  displayName: string;
  username: string;
  role: string;
  device: string;
  remoteAddress: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  active: boolean;
  current: boolean;
};

export type TechnicalEvent = {
  id: number;
  severity: string;
  code: string;
  message: string;
  correlationId: string;
  requestMethod: string;
  requestPath: string;
  createdAt: string;
};

export type NotificationItem = {
  id: number;
  action: string;
  entityType: string;
  entityId: string | null;
  sectionKey: string | null;
  details: Record<string, unknown>;
  actorName: string;
  actorUsername: string | null;
  actorRole: string | null;
  createdAt: string;
  readAt: string | null;
};

export type NotificationPreferences = { soundEnabled: boolean; speechEnabled: boolean };
