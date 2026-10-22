import { uiText } from '../../i18n/language.ts';
import {
  ArrowRight,
  BookOpenCheck,
  ClipboardList,
  DatabaseBackup,
  Settings2,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { useState } from 'react';
import type { User } from '../../api.ts';
import { OperationsCenterManager } from './OperationsCenterManager.tsx';
import { UsersManager } from './UsersManager.tsx';
import { BackupCenterManager } from './BackupCenterManager.tsx';
import { AccountSecurityManager } from './AccountSecurityManager.tsx';
import { SETTINGS_MODULES, type SettingsModuleKey } from './settingsCatalog.ts';

const ICONS = {
  accounts: UsersRound,
  general: Settings2,
  audit: ClipboardList,
  ledger: BookOpenCheck,
  security: ShieldCheck,
  backup: DatabaseBackup,
} satisfies Record<SettingsModuleKey, typeof UsersRound>;

export function SettingsOverview({
  user,
  onOpenAudit,
  onOpenFinancialLedger,
  onOpenSystemSettings,
}: {
  user: User;
  onOpenAudit: () => void;
  onOpenFinancialLedger: () => void;
  onOpenSystemSettings: () => void;
}) {
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  if (accountsOpen) {
    return (
      <section className="settings-section settings-accounts-shell">
        <header className="topbar settings-topbar">
          <div>
            <h1>{uiText("الموظفون والإداريون")}</h1>
            <p>{uiText("إنشاء الحسابات وإدارة الإداريين والصلاحيات والوصول إلى الأقسام")}</p>
          </div>
          <button className="secondary compact" onClick={() => setAccountsOpen(false)}>
            <ArrowRight size={16} /> {uiText(" العودة إلى الإعدادات")}</button>
        </header>
        <div className="settings-accounts-page">
          <UsersManager currentUser={user} embedded onClose={() => setAccountsOpen(false)} />
        </div>
      </section>
    );
  }
  if (operationsOpen) {
    return (
      <section className="settings-section settings-operations-shell">
        <header className="topbar settings-topbar">
          <div>
            <h1>{uiText("مركز التشغيل والأمان")}</h1>
            <p>{uiText("قاعدة البيانات والجلسات والأجهزة والأخطاء التشغيلية في صفحة واحدة")}</p>
          </div>
          <button className="secondary compact" onClick={() => setOperationsOpen(false)}>
            <ArrowRight size={16} /> {uiText(" العودة إلى الإعدادات")}</button>
        </header>
        <AccountSecurityManager />
        <OperationsCenterManager embedded onClose={() => setOperationsOpen(false)} />
      </section>
    );
  }
  if (backupOpen) {
    return (
      <section className="settings-section settings-backup-shell">
        <header className="topbar settings-topbar">
          <div>
            <h1>{uiText("النسخ الاحتياطي والاستعادة")}</h1>
            <p>{uiText("مركز مستقل لحماية قاعدة البيانات والتحقق واختبار الاستعادة")}</p>
          </div>
          <button className="secondary compact" onClick={() => setBackupOpen(false)}>
            <ArrowRight size={16} /> {uiText(" العودة إلى الإعدادات")}</button>
        </header>
        <BackupCenterManager />
      </section>
    );
  }
  const actions: Partial<Record<SettingsModuleKey, () => void>> = {
    accounts: () => setAccountsOpen(true),
    general: onOpenSystemSettings,
    audit: onOpenAudit,
    ledger: onOpenFinancialLedger,
    security: () => setOperationsOpen(true),
    backup: () => setBackupOpen(true),
  };
  return (
    <section className="settings-section">
      <header className="topbar settings-topbar">
        <div>
          <h1>{uiText("الإعدادات")}</h1>
          <p>{uiText("إدارة مركزية للحسابات والصلاحيات والتدقيق وسياسات المنظومة")}</p>
        </div>
        <div className={`settings-authority ${user.isOwner ? 'owner' : 'admin'}`}>
          <span>{user.isOwner ? uiText("المالك الرئيسي") : uiText("إداري عام")}</span>
          <strong>{user.displayName}</strong>
        </div>
      </header>
      <div className="settings-security-strip">
        <span><b>3</b> {uiText(" مستويات حسابات")}</span>
        <span><b>9</b> {uiText(" أقسام قابلة للتخصيص")}</span>
        <span><b>100%</b> {uiText(" توثيق إداري")}</span>
      </div>
      <div className="settings-tools-grid">
        {SETTINGS_MODULES.map((module) => {
          const Icon = ICONS[module.key];
          const action = actions[module.key];
          const content = (
            <>
              <div className="settings-tool-icon"><Icon size={22} /></div>
              <div>
                <strong>{module.title}</strong>
                <span>{module.description}</span>
              </div>
              <em>{module.state === 'ready' ? uiText("فتح") : uiText("مفعّل")}</em>
            </>
          );
          return action ? (
            <button key={module.key} className="settings-tool-card" onClick={action}>{content}</button>
          ) : (
            <article key={module.key} className="settings-tool-card protected">{content}</article>
          );
        })}
      </div>
    </section>
  );
}
