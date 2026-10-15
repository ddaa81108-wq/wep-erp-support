import { useEffect, useState } from 'react';
import { sidebarPaletteAt } from './sidebarPalette.ts';

export function useSidebarPalette() {
  const [palette, setPalette] = useState(() => sidebarPaletteAt(new Date()).palette);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const next = sidebarPaletteAt(new Date());
      setPalette(next.palette);
      timer = setTimeout(refresh, next.untilMidnight + 50);
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return palette;
}
