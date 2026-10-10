import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App.tsx';
import { startInternetGuard } from './internetGuard.ts';
import './styles/foundation-auth.css';
import './styles/workspace.css';
import './styles/collections.css';
import './styles/financial-operations.css';
import './styles/purchases.css';
import './styles/reports.css';
import './styles/assistant.css';
import './styles.css';

let root: Root | undefined;
void startInternetGuard(() => {
  root ??= createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
