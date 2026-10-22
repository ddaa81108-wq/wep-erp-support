import { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import { flushBeforeNavigation } from '../dashboard/navigationGuards.ts';
import { language, LANGUAGE_KEY } from './language.ts';
import { hasEditedForm } from './formChanges.ts';

export function LanguageToggle() {
  const [busy, setBusy] = useState(false);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    const start = () => setPendingWrites((count) => count + 1);
    const finish = () => setPendingWrites((count) => Math.max(0, count - 1));
    window.addEventListener('abdo:request-start', start);
    window.addEventListener('abdo:request-finish', finish);
    window.addEventListener('abdo:request-error', finish);
    return () => {
      window.removeEventListener('abdo:request-start', start);
      window.removeEventListener('abdo:request-finish', finish);
      window.removeEventListener('abdo:request-error', finish);
    };
  }, []);
  const next = language === 'ar' ? 'en' : 'ar';
  const label = next === 'en' ? 'Switch to English' : 'التبديل إلى العربية';
  const change = async () => {
    if (busy || pendingWrites > 0) return;
    setBusy(true);
    try {
      if (!(await flushBeforeNavigation())) return;
      if (
        hasEditedForm(document) &&
        !window.confirm(
          language === 'ar'
            ? 'تغيير اللغة سيعيد تحميل الواجهة. توجد بيانات غير محفوظة في نموذج؛ هل تريد المتابعة؟'
            : 'Changing language reloads the interface. A form contains unsaved changes. Continue?',
        )
      )
        return;
      try {
        window.localStorage.setItem(LANGUAGE_KEY, next);
      } catch {
        /* URL also carries the preference. */
      }
      const url = new URL(window.location.href);
      url.searchParams.set('lang', next);
      // Financial draft guards already asked; avoid a second browser warning for this reload.
      window.dispatchEvent(new Event('abdo:navigation-approved'));
      window.location.assign(url.href);
    } catch {
      setError(
        language === 'ar'
          ? 'تعذر إكمال الحفظ؛ لم تتغير اللغة.'
          : 'Unable to complete saving; language was not changed.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="language-toggle"
        aria-label={label}
        title={label}
        disabled={busy || pendingWrites > 0}
        onClick={() => void change()}
      >
        <Languages size={17} aria-hidden="true" />
        <span lang={next} dir={next === 'ar' ? 'rtl' : 'ltr'}>
          {next === 'en' ? 'English' : 'العربية'}
        </span>
      </button>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
