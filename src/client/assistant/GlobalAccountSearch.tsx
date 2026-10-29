import { uiText } from '../i18n/language.ts';
import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AccountSuggestion } from '../api.ts';
import { debtSectionText, type DebtSection } from '../sections/debts/sectionConfig.ts';
import { request } from '../apiTransport.ts';

type Result = AccountSuggestion & { section: DebtSection };

export function GlobalAccountSearch({ onSelect, desktopLabel }: { onSelect: (section: DebtSection, id: string) => void; desktopLabel?: string }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (query.trim().length < 2) { setItems([]); setLoading(false); return; }
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void request<{items:Result[]}>(`/api/account-search?q=${encodeURIComponent(query)}`).then(result=>{
        if(active)setItems(result.items);
      }).catch(()=>{if(active)setItems([]);}).finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);
  return <div className="global-account-search">
    <Search size={16} />
    {desktopLabel && !query && <span className="global-search-desktop-label" aria-hidden="true">{desktopLabel}</span>}
    <input aria-label={uiText("البحث الموحد")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText("بحث موحد في كل الحسابات…")} />
    {query && <button aria-label={uiText("مسح البحث")} onClick={() => setQuery('')}><X size={14} /></button>}
    {query.trim().length >= 2 && <div className="global-search-results">
      {loading && <p>{uiText("جارٍ البحث…")}</p>}
      {!loading && items.length === 0 && <p>{uiText("لا توجد حسابات مشابهة.")}</p>}
      {items.map((item) => <button key={`${item.section}-${item.id}`} onClick={() => {
        onSelect(item.section, item.id); setQuery('');
      }}>
        <span><strong>{item.name}</strong><small>{debtSectionText[item.section].title}</small></span>
        <b>{Math.abs(item.balanceUnits).toLocaleString('en-US')}</b>
      </button>)}
    </div>}
  </div>;
}
