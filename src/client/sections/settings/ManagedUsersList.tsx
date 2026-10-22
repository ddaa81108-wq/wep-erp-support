import { uiText } from '../../i18n/language.ts';
import { Copy, Pencil } from 'lucide-react';
import type { ManagedUser, User } from '../../api.ts';

const accessLabel = (level: 'none' | 'read' | 'manage') =>
  level === 'manage' ? uiText("إدارة") : level === 'read' ? uiText("مشاهدة") : uiText("لا");

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
                ? uiText("المالك الرئيسي — حساب محمي")
                : managed.role === 'admin'
                  ? uiText("إداري عام — جميع الصلاحيات")
                : uiText("العملاء: {0} • الشركات: {1}", [accessLabel(managed.sectionAccess.customerDebts), accessLabel(managed.sectionAccess.companyDebts)])}
            </small>
          </div>
          <em className={managed.isActive ? 'active' : 'disabled'}>{managed.isActive ? uiText("نشط") : uiText("معطّل")}</em>
          <div className="managed-user-actions">
            {managed.role === 'employee' && <button className="icon-button" onClick={() => onCopyAccess(managed)} aria-label={uiText("نسخ صلاحيات {0}", [managed.displayName])} title={uiText("إنشاء موظف جديد بنفس الصلاحيات")}><Copy size={16}/></button>}
            {!managed.isOwner && (managed.role === 'employee' || currentUser.isOwner) && <button className="icon-button" onClick={() => onEdit(managed)} aria-label={uiText("تعديل {0}", [managed.displayName])}><Pencil size={17}/></button>}
          </div>
        </article>
      ))}
    </div>
  );
}
