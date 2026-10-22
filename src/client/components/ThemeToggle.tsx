import { uiText } from '../i18n/language.ts';
import { Moon, Sun } from 'lucide-react';

export type Theme = 'light' | 'dark';

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const nextLabel = theme === 'light' ? uiText("المظهر الليلي") : uiText("المظهر النهاري");
  return <button className="theme-toggle" onClick={onToggle} aria-label={nextLabel} title={nextLabel}>
    {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
    <span>{nextLabel}</span>
  </button>;
}
