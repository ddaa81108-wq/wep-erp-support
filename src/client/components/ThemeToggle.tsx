import { Moon, Sun } from 'lucide-react';

export type Theme = 'light' | 'dark';

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const nextLabel = theme === 'light' ? 'المظهر الليلي' : 'المظهر النهاري';
  return <button className="theme-toggle" onClick={onToggle} aria-label={nextLabel} title={nextLabel}>
    {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
    <span>{nextLabel}</span>
  </button>;
}
