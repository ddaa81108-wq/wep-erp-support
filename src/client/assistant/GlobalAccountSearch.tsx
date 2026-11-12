import { uiText } from '../i18n/language.ts';
import { Search, X } from 'lucide-react';
import { useEffect, useState,useRef,useId } from 'react';
import type { AccountSuggestion } from '../api.ts';
import { debtSectionText, type DebtSection } from '../sections/debts/sectionConfig.ts';
import { currencyLabel } from '../sections/debts/debtSectionUtils.ts';
import { request } from '../apiTransport.ts';

type Result = AccountSuggestion & { section: DebtSection;activeAssignmentId?:string|null;activeAssigneeName?:string|null };
export type SearchAccountTarget='ledger'|'card';
export type SearchAccountSelect=(section:DebtSection,id:string,target:SearchAccountTarget)=>void|boolean|Promise<void|boolean>;

export function GlobalAccountSearch({ onSelect, desktopLabel }: { onSelect: SearchAccountSelect; desktopLabel?: string }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected,setSelected]=useState(0);
  const [opening,setOpening]=useState(false);
  const [error,setError]=useState('');
  const openingRef=useRef(false),results=useRef<HTMLDivElement>(null);
  const resultsId=useId();
  async function choose(item:Result,target:SearchAccountTarget) {
    if(openingRef.current)return;
    openingRef.current=true;setOpening(true);setError('');
    try {if(await onSelect(item.section,item.id,target)!==false)setQuery('');}
    catch {setError(uiText('تعذر فتح الحساب. حاول مرة أخرى.'));}
    finally {openingRef.current=false;setOpening(false);}
  }
  useEffect(()=>{results.current?.querySelector(`[data-result-index="${selected}"]`)?.scrollIntoView({block:'nearest'});},[selected]);
  useEffect(() => {
    if (query.trim().length < 2) { setItems([]); setLoading(false); return; }
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void request<{items:Result[]}>(`/api/account-search?q=${encodeURIComponent(query)}`).then(result=>{
        if(active){setItems(result.items);setSelected(0);}
      }).catch(()=>{if(active)setItems([]);}).finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);
  return <div className="global-account-search">
    <Search size={16} />
    {desktopLabel && !query && <span className="global-search-desktop-label" aria-hidden="true">{desktopLabel}</span>}
    <input aria-label={uiText("البحث الموحد")} aria-controls={resultsId} value={query}
      onChange={(event) => {setQuery(event.target.value);setItems([]);setSelected(0);setError('');}}
      onKeyDown={event=>{
        if(event.key==='Escape'){setQuery('');return;}
        if(loading||!items.length||opening)return;
        if(event.key==='ArrowDown'){event.preventDefault();setSelected(index=>Math.min(index+1,items.length-1));}
        if(event.key==='ArrowUp'){event.preventDefault();setSelected(index=>Math.max(index-1,0));}
        if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();void choose(items[selected]??items[0],'ledger');}
      }} placeholder={uiText("بحث موحد في كل الحسابات…")} />
    {query && <button aria-label={uiText("مسح البحث")} onClick={() => setQuery('')}><X size={14} /></button>}
    {query.trim().length >= 2 && <div className="global-search-results" id={resultsId} ref={results}>
      {error&&<p role="alert">{error}</p>}
      {loading && <p>{uiText("جارٍ البحث…")}</p>}
      {!loading && items.length === 0 && <p>{uiText("لا توجد حسابات مشابهة.")}</p>}
      {items.map((item,index) => <div className="global-search-result" key={`${item.section}-${item.id}`}
        data-result-index={index} data-selected={selected===index?'true':undefined}>
        <button type="button" className="global-search-open-ledger" disabled={opening}
          aria-label={uiText('فتح سجل {0}',[item.name])} onClick={()=>void choose(item,'ledger')}>
          <span className="global-search-result-info"><strong>{item.name}</strong><small>{debtSectionText[item.section].title}</small>
            {(item.section==='customers'||item.section==='companies')&&<small className="global-search-assignment" data-assigned={Boolean(item.activeAssignmentId)}>
              {item.activeAssignmentId?uiText('موجّه إلى: {0}',[item.activeAssigneeName??uiText('موظف التحصيل')]):uiText('غير موجّه')}
            </small>}
          </span>
          <b>{Math.abs(item.balanceUnits).toLocaleString('en-US')}<small>{currencyLabel(item.section)}</small></b>
        </button>
        {(item.section==='customers'||item.section==='companies')&&<button type="button" className="global-search-show-card"
          disabled={opening} aria-label={uiText('عرض كارت {0}',[item.name])} onClick={()=>void choose(item,'card')}>{uiText('عرض الكارت')}</button>}
      </div>)}
    </div>}
  </div>;
}
