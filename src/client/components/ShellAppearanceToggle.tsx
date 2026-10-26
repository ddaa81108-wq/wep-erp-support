import { Gem } from 'lucide-react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { uiText } from '../i18n/language.ts';

const storageKey = 'abdo-shell-appearance';
type Appearance = 'original' | '03';
function readAppearance(): Appearance {
  try {
    return localStorage.getItem(storageKey) === 'original' ? 'original' : '03';
  } catch {
    return '03';
  }
}

/** Device-local visual preference; no API, account or financial writes. */
export function ShellAppearanceToggle() {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  useLayoutEffect(() => {
    if (appearance === '03') document.documentElement.dataset.royalShell = '03';
    else delete document.documentElement.dataset.royalShell;
    return () => {
      delete document.documentElement.dataset.royalShell;
    };
  }, [appearance]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, appearance);
    } catch {
      /* Appearance still works without storage. */
    }
  }, [appearance]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === storageKey || event.key === null))
        setAppearance(readAppearance());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const emerald = appearance === '03';
  const next = uiText(emerald ? 'الرجوع إلى الشكل الأصلي' : 'تفعيل الزمردي الملكي اللامع');
  return (
    <button
      type="button"
      className="theme-toggle shell-appearance-toggle"
      aria-label={uiText('تبديل تنسيق الأشرطة')}
      aria-pressed={emerald}
      title={next}
      onClick={() => setAppearance(emerald ? 'original' : '03')}
    >
      <Gem size={18} />
      <span>{uiText(emerald ? 'الزمردي اللامع' : 'الشكل الأصلي')}</span>
    </button>
  );
}
