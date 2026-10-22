import { uiText } from '../../i18n/language.ts';
import type { FormEvent } from 'react';
import type { ManagedUser } from '../../api.ts';
import { UserAccessFields } from './UserAccessFields.tsx';

type UserEditorFormProps = {
  editing: ManagedUser | null;
  creatingRole: 'admin' | 'employee';
  accessSource: ManagedUser | null;
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
};

export function UserEditorForm({ editing, creatingRole, accessSource, busy, error, onSubmit, onCancel }: UserEditorFormProps) {
  const role = editing?.role ?? creatingRole;
  return (
    <form className="stack user-form" onSubmit={onSubmit}>
      <div className="account-form-heading">
        <h4>{editing ? uiText("تعديل {0}", [editing.displayName]) : role === 'admin' ? uiText("إنشاء إداري عام") : uiText("إنشاء حساب موظف")}</h4>
        <span className={`account-role-badge ${role}`}>{role === 'admin' ? uiText("صلاحية إدارية كاملة") : uiText("صلاحيات أقسام محددة")}</span>
      </div>
      <div className="two-cols">
        <label>
          {uiText("الاسم الظاهر")}<input
            name="displayName"
            defaultValue={editing?.displayName ?? ''}
            minLength={2}
            required
            autoFocus
          />
        </label>
        <label>
          {uiText("اسم المستخدم")}<input
            name="username"
            defaultValue={editing?.username ?? ''}
            disabled={Boolean(editing)}
            minLength={3}
            required={!editing}
            dir="ltr"
          />
        </label>
      </div>
      <label>
        {uiText("البريد الإلكتروني ")}{role === 'admin' ? uiText("(إلزامي للإداري)") : uiText("(اختياري)")}
        <input
          name="email"
          type="email"
          defaultValue={editing?.email ?? ''}
          required={role === 'admin'}
          dir="ltr"
          autoComplete="email"
        />
      </label>
      <label>
        {editing ? uiText("كلمة مرور جديدة (اتركها فارغة دون تغيير)") : uiText("كلمة المرور")}
        <input
          name="password"
          type="password"
          minLength={10}
          required={!editing}
          dir="ltr"
          autoComplete="new-password"
        />
      </label>
      {role === 'employee' ? (
        <UserAccessFields editing={accessSource} />
      ) : (
        <div className="admin-full-access-note">
          {uiText("الإداري العام يرى ويدير كل أقسام المنظومة والإعدادات. إنشاء أو تعديل الإداريين يظل مقصورًا على المالك الرئيسي.")}</div>
      )}
      {editing && (
        <label className="check active-check">
          <input name="isActive" type="checkbox" defaultChecked={editing.isActive} />
          <span>{uiText("الحساب نشط ويمكنه تسجيل الدخول")}</span>
        </label>
      )}
      {error && <div className="alert error">{error}</div>}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          {uiText("إلغاء")}</button>
        <button className="primary" disabled={busy}>
          {busy ? uiText("جارٍ الحفظ…") : role === 'admin' ? uiText("حفظ الإداري") : uiText("حفظ الموظف")}
        </button>
      </div>
    </form>
  );
}
