import { Gem } from 'lucide-react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { uiText } from '../i18n/language.ts';

const storageKey = 'abdo-shell-appearance';
type Appearance = 'original' | '03' | 'cockpit';
function readAppearance(): Appearance {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved === 'original' || saved === 'cockpit' ? saved : '03';
  } catch {
    return '03';
  }
}

/** Device-local visual preference; no API, account or financial writes. */
export function ShellAppearanceToggle() {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  useLayoutEffect(() => {
    let active = true;
    const apply = () => {
      if (!active) return;
      if (appearance !== 'original') document.documentElement.dataset.royalShell = appearance;
      else delete document.documentElement.dataset.royalShell;
    };
    // Optional appearance assets load only when selected, before applying the theme.
    if (appearance === 'cockpit') void import('../styles/cockpit-shell.css').then(apply).catch(() => { if (active) setAppearance('03'); });
    else apply();
    return () => {
      active = false;
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
  const whiteGold = appearance === '03';
  const nextAppearance: Appearance = appearance === 'original' ? '03' : whiteGold ? 'cockpit' : 'original';
  const labels = { original: 'الشكل الأصلي', '03': 'الأبيض والذهبي', cockpit: 'المقصورة المالية' };
  const next = uiText(labels[nextAppearance]);
  return (
    <button
      type="button"
      className="theme-toggle shell-appearance-toggle"
      aria-label={uiText('تبديل تنسيق الأشرطة')}
      aria-pressed={appearance !== 'original'}
      data-appearance={appearance}
      title={next}
      onClick={() => setAppearance(nextAppearance)}
    >
      <Gem size={18} />
      <span>{uiText(labels[appearance])}</span>
    </button>
  );
}
