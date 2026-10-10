import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, type AccountRequest, type ManagedUser } from '../../api.ts';
import { selectedSectionAccess, selectedUserPermissions } from './userAccessModel.ts';

const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. لم تُعتمد العملية.';

export function useUsersManager() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [requests, setRequests] = useState<AccountRequest[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [creatingRole, setCreatingRole] = useState<'admin' | 'employee'>('employee');
  const [accessSource, setAccessSource] = useState<ManagedUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [managedUsers, accountRequests] = await Promise.all([api.users(), api.accountRequests()]);
    setUsers(managedUsers.items);
    setRequests(accountRequests.items);
  }, []);

  useEffect(() => {
    load().catch((caught) => setError(errorText(caught)));
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const permissions = selectedUserPermissions(form);
    const sectionAccess = selectedSectionAccess(form);
    const role = editing?.role ?? creatingRole;
    try {
      if (editing) {
        await api.updateUser(editing.id, {
          expectedVersion: editing.version,
          displayName: String(form.get('displayName') ?? ''),
          email: String(form.get('email') ?? '') || undefined,
          isActive: form.get('isActive') === 'on',
          permissions,
          ...sectionAccess,
          password: String(form.get('password') ?? '') || undefined,
        });
      } else {
        await api.createUser({
          username: String(form.get('username') ?? ''),
          displayName: String(form.get('displayName') ?? ''),
          email: String(form.get('email') ?? '') || undefined,
          role,
          password: String(form.get('password') ?? ''),
          permissions,
          ...sectionAccess,
        });
      }
      await load();
      setEditing(null);
      setAccessSource(null);
      setShowForm(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  function startCreate(role: 'admin' | 'employee') {
    setEditing(null);
    setAccessSource(null);
    setCreatingRole(role);
    setShowForm(true);
    setError('');
  }

  function edit(user: ManagedUser) {
    setEditing(user);
    setAccessSource(user);
    setCreatingRole(user.role);
    setShowForm(true);
    setError('');
  }

  function copyAccess(user: ManagedUser) {
    setEditing(null);
    setAccessSource(user);
    setCreatingRole('employee');
    setShowForm(true);
    setError('');
  }

  function cancelEditing() {
    setShowForm(false);
    setEditing(null);
    setAccessSource(null);
    setError('');
  }

  async function decide(request: AccountRequest, decision: 'approve' | 'reject') {
    setBusy(true);
    setError('');
    try {
      await api.decideAccountRequest(request.id, {
        expectedVersion: request.version,
        decision,
        customerDebtsAccess: 'none',
      });
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return {
    users,
    editing,
    creatingRole,
    accessSource,
    pendingRequests: requests.filter((request) => request.status === 'pending'),
    showForm,
    busy,
    error,
    submit,
    startCreate,
    edit,
    copyAccess,
    cancelEditing,
    decide,
  };
}
