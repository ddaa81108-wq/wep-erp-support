import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { loadLanguageCatalog } from './i18n/language.ts';
import { syncPushLanguage } from './i18n/pushLanguage.ts';
import { startInternetGuard } from './internetGuard.ts';
import './styles/foundation-auth.css';
import './styles/workspace.css';
import './styles/backup-center.css';
import './styles/collections.css';
import './styles/financial-operations.css';
import './styles/purchases.css';
import './styles/reports.css';
import './styles/assistant.css';
import './styles.css';
import './styles/customer-toolbar.css';
import './styles/night-theme.css';
import './styles/company-toolbar.css';
import './styles/notifications.css';
import './styles/treasury-desktop.css';
import './styles/customer-card-compact.css';
import './styles/customer-ledger-desktop.css';
import './styles/purchases-presentation.css';
import './styles/debt-summary-desktop.css';
import './styles/sidebar-gold.css';
import './styles/customer-header-gold.css';
import './styles/customer-ledger-gold.css';
import './styles/purchases-compact-gold.css';
import './styles/company-royal-blue.css';
import './styles/designed-section-themes.css';
import './styles/egypt-pink.css';
import './styles/company-gold.css';
import './styles/libyan-gold.css';
import './styles/collections-gold.css';
import './styles/masraweya-gold.css';
import './styles/treasury-gold.css';
import './styles/reports-gold.css';
import './styles/settings-gold.css';
import './styles/purchases-unified-gold.css';
import './styles/account-balance-colors.css';
import './styles/mobile-toolbar-refinement.css';
import './styles/readability.css';
import './styles/auth-l01.css';
import './styles/languages.css';
import './styles/duplicate-warning.css';
import './styles/emerald-shell.css';

let root: Root | undefined;
void loadLanguageCatalog()
  .then(async () => {
    syncPushLanguage();
    const { default: App } = await import('./App.tsx');
    return startInternetGuard(() => {
      root ??= createRoot(document.getElementById('root')!);
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });
  })
  .catch(() => {
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent =
      document.documentElement.lang === 'en'
        ? 'Unable to load the application. Check your connection and reload the page.'
        : 'تعذر تحميل المنظومة. تحقق من الاتصال وأعد تحميل الصفحة.';
    document.getElementById('root')?.replaceChildren(message);
  });
