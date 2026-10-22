import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { SectionSnapshots } from './sectionSnapshotsStore.ts';

const Context = createContext<SectionSnapshots | null>(null);

/** Owned by one authenticated dashboard; never written to browser storage. */
export function SectionSnapshotsProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new SectionSnapshots());
  useEffect(() => {
    const clear = () => store.clear();
    window.addEventListener('abdo:request-start', clear);
    window.addEventListener('abdo:request-finish', clear);
    window.addEventListener('abdo:request-error', clear);
    return () => {
      store.clear();
      window.removeEventListener('abdo:request-start', clear);
      window.removeEventListener('abdo:request-finish', clear);
      window.removeEventListener('abdo:request-error', clear);
    };
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useSectionSnapshots() {
  const shared = useContext(Context);
  const [fallback] = useState(() => new SectionSnapshots());
  return shared ?? fallback;
}
