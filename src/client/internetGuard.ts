import { direction, uiText } from './i18n/language.ts';
const CHECK_INTERVAL_MS = 2_500;
const CHECK_TIMEOUT_MS = 2_000;
const FAILURES_BEFORE_NOTICE = 3;

async function serverConfirmsInternet() {
  try {
    const response = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function startInternetGuard(mount: () => void) {
  let mounted = false;
  let checking = false;
  let consecutiveFailures = 0;
  let notice: HTMLElement | null = null;
  const showNotice = () => {
    if (notice) return;
    notice = document.createElement('div');
    notice.className = 'connection-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('dir', direction);
    notice.textContent = uiText("الاتصال بالخادم غير مستقر. نعيد المحاولة تلقائيًا؛ لم يتم تأكيد حفظ أي عملية متعذرة.");
    document.body.append(notice);
  };

  const check = async () => {
    if (checking) return;
    checking = true;
    const available = await serverConfirmsInternet();
    checking = false;

    if (available) {
      consecutiveFailures = 0;
      notice?.remove();
      notice = null;
      if (!mounted) {
        mounted = true;
        mount();
      }
      return;
    }

    consecutiveFailures += 1;
    if (consecutiveFailures < FAILURES_BEFORE_NOTICE) return;
    // A slow tunnel health check must not hide the entire financial workspace.
    // Keep React and drafts mounted; the server still validates every operation.
    showNotice();
  };

  window.addEventListener('abdo:internet-unavailable', () => {
    // Confirm transient request failures before showing the connection notice.
    void check();
  });
  await check();
  window.setInterval(() => void check(), CHECK_INTERVAL_MS);
}
