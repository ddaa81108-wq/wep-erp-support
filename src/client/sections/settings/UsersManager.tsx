import { ShieldPlus, UserPlus } from 'lucide-react';
import type { User } from '../../api.ts';
import { Modal } from '../../components/Modal.tsx';
import { AccountRequestsList } from './AccountRequestsList.tsx';
import { ManagedUsersList } from './ManagedUsersList.tsx';
import { UserEditorForm } from './UserEditorForm.tsx';
import { useUsersManager } from './useUsersManager.ts';

export function UsersManager({ currentUser, onClose, embedded = false }: { currentUser: User; onClose: () => void; embedded?: boolean }) {
  const {
    users,
    editing,
    creatingRole,
    accessSource,
    pendingRequests,
    showForm,
    busy,
    error,
    submit,
    startCreate,
    edit,
    copyAccess,
    cancelEditing,
    decide,
  } = useUsersManager();

  const content = (
      <div className={`users-manager ${embedded ? 'embedded' : ''}`}>
        {!showForm && (
          <AccountRequestsList
            requests={pendingRequests}
            busy={busy}
            onDecide={(request, decision) => void decide(request, decision)}
          />
        )}
        {!showForm && (
          <div className="users-manager-actions">
            <button className="primary" onClick={() => startCreate('employee')}>
              <UserPlus size={18} />
              موظف جديد
            </button>
            {currentUser.isOwner && (
              <button className="secondary" onClick={() => startCreate('admin')}>
                <ShieldPlus size={18} />
                إداري عام جديد
              </button>
            )}
          </div>
        )}
        {showForm && (
          <UserEditorForm
            editing={editing}
            creatingRole={creatingRole}
            accessSource={accessSource}
            busy={busy}
            error={error}
            onSubmit={submit}
            onCancel={cancelEditing}
          />
        )}
        {!showForm && <ManagedUsersList currentUser={currentUser} users={users} onEdit={edit} onCopyAccess={copyAccess} />}
        {!showForm && error && <div className="alert error">{error}</div>}
      </div>
  );
  return embedded ? content : <Modal title="الموظفون والصلاحيات" onClose={onClose}>{content}</Modal>;
}
