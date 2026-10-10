import { Copy, Pencil } from 'lucide-react';
import type { ManagedUser, User } from '../../api.ts';

const accessLabel = (level: 'none' | 'read' | 'manage') =>
  level === 'manage' ? 'إدارة' : level === 'read' ? 'مشاهدة' : 'لا';

export function ManagedUsersList({
  users,
  currentUser,
  onEdit,
  onCopyAccess,
}: {
  users: readonly ManagedUser[];
  currentUser: User;
  onEdit: (user: ManagedUser) => void;
  onCopyAccess: (user: ManagedUser) => void;
}) {
  return (
    <div className="managed-users">
      {users.map((managed) => (
        <article key={managed.id}>
          <div className="avatar customer-avatar">{managed.displayName.slice(0, 1)}</div>
          <div>
            <strong>{managed.displayName}</strong>
            <span dir="ltr">@{managed.username}</span>
            <small>
              {managed.isOwner
                ? 'المالك الرئيسي — حساب محمي'
                : managed.role === 'admin'
                  ? 'إداري عام — جميع الصلاحيات'
                : `العملاء: ${accessLabel(managed.sectionAccess.customerDebts)} • الشركات: ${accessLabel(managed.sectionAccess.companyDebts)}`}
            </small>
          </div>
          <em className={managed.isActive ? 'active' : 'disabled'}>{managed.isActive ? 'نشط' : 'معطّل'}</em>
          <div className="managed-user-actions">
            {managed.role === 'employee' && <button className="icon-button" onClick={() => onCopyAccess(managed)} aria-label={`نسخ صلاحيات ${managed.displayName}`} title="إنشاء موظف جديد بنفس الصلاحيات"><Copy size={16}/></button>}
            {!managed.isOwner && (managed.role === 'employee' || currentUser.isOwner) && <button className="icon-button" onClick={() => onEdit(managed)} aria-label={`تعديل ${managed.displayName}`}><Pencil size={17}/></button>}
          </div>
        </article>
      ))}
    </div>
  );
}
