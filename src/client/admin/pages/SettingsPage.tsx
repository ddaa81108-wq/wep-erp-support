import type { ReactNode } from 'react';

export function SettingsPage({ children }: { children: ReactNode }) {
  return <section className="admin-page admin-settings-page" data-admin-page="settings">{children}</section>;
}
