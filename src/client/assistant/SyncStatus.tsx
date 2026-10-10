import { CheckCircle2, CloudOff, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

type State = 'ready' | 'saving' | 'offline' | 'error';
export function SyncStatus({ detailed = false }: { detailed?: boolean }) {
  const [state, setState] = useState<State>(navigator.onLine ? 'ready' : 'offline');
  useEffect(() => {
    let active = 0;
    const online = () => setState(active ? 'saving' : 'ready');
    const offline = () => setState('offline');
    const start = () => { active += 1; setState('saving'); };
    const finish = () => { active = Math.max(0, active - 1); setState(navigator.onLine ? (active ? 'saving' : 'ready') : 'offline'); };
    const error = () => { active = Math.max(0, active - 1); setState(navigator.onLine ? 'error' : 'offline'); };
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    window.addEventListener('abdo:request-start', start); window.addEventListener('abdo:request-finish', finish);
    window.addEventListener('abdo:request-error', error);
    return () => {
      window.removeEventListener('online', online); window.removeEventListener('offline', offline);
      window.removeEventListener('abdo:request-start', start); window.removeEventListener('abdo:request-finish', finish);
      window.removeEventListener('abdo:request-error', error);
    };
  }, []);
  const content = state === 'saving' ? [detailed ? 'جارٍ الحفظ…' : 'جارٍ الحفظ', <LoaderCircle key="i" size={15} />]
    : state === 'offline' ? [detailed ? 'انقطع الاتصال' : 'الاتصال منقطع', <CloudOff key="i" size={15} />]
      : state === 'error' ? [detailed ? 'غير محفوظ' : 'لم يكتمل الطلب', <TriangleAlert key="i" size={15} />]
        : [detailed ? 'متصل • جميع التغييرات محفوظة' : 'متصل ومحفوظ', <CheckCircle2 key="i" size={15} />];
  return <span className={`sync-status ${state}`} title="حالة الاتصال والحفظ">{content[1]}<b>{content[0]}</b></span>;
}
