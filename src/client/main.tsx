import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App.tsx';
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

let root: Root | undefined;
void startInternetGuard(() => {
  root ??= createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});



