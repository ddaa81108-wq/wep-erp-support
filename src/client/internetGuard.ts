const CHECK_INTERVAL_MS = 2_500;
const CHECK_TIMEOUT_MS = 2_000;
const FAILURES_BEFORE_HIDE = 3;

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
  let blanked = false;
  let checking = false;
  let consecutiveFailures = 0;

  const check = async () => {
    if (checking) return;
    checking = true;
    const available = await serverConfirmsInternet();
    checking = false;

    if (available) {
      consecutiveFailures = 0;
      if (blanked) document.documentElement.style.visibility = '';
      blanked = false;
      if (!mounted) {
        mounted = true;
        mount();
      }
      return;
    }

    consecutiveFailures += 1;
    if (consecutiveFailures < FAILURES_BEFORE_HIDE) return;
    // لا نفك React ولا نمسح DOM: تظل كل المسودات في الذاكرة وتعود كما هي.
    blanked = true;
    document.documentElement.style.visibility = 'hidden';
  };

  window.addEventListener('abdo:internet-unavailable', () => {
    // فشل طلب واحد قد يكون لحظيًا؛ نؤكده من مسار الصحة قبل إخفاء الصفحة.
    void check();
  });
  await check();
  window.setInterval(() => void check(), CHECK_INTERVAL_MS);
}
