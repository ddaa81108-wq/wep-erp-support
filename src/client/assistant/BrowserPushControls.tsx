import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { request } from '../apiTransport.ts';

type Config = { ready: boolean; publicKey: string | null; endpoints: string[] };
function capabilityMessage() {
  if (!window.isSecureContext) return 'إشعارات المتصفح تحتاج رابط HTTPS آمنًا.';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'المتصفح لا يدعم إشعارات الخلفية هنا. على iPhone أضف المنظومة للشاشة الرئيسية وافتحها من الأيقونة.';
  return '';
}
const keyBytes = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
export function BrowserPushControls() {
  const [config, setConfig] = useState<Config | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const unsupported = capabilityMessage();
  useEffect(() => {
    let active = true;
    if (unsupported) return;
    void (async () => {
      try {
        const next = await request<Config>('/api/browser-push/config');
        const registration = await navigator.serviceWorker.getRegistration('/');
        if (registration) void registration.update().catch(() => {});
        const subscription = await registration?.pushManager.getSubscription();
        if (active) {
          setConfig(next);
          setEnabled(
            Boolean(
              subscription &&
              Notification.permission === 'granted' &&
              next.endpoints.includes(subscription.endpoint),
            ),
          );
        }
      } catch {
        if (active) setMessage('تعذر التحقق من إعدادات إشعارات المتصفح. أعد تحميل الصفحة.');
      }
    })();
    return () => {
      active = false;
    };
  }, [unsupported]);
  async function toggle() {
    if (busy || !config?.ready || !config.publicKey) return;
    setBusy(true);
    setMessage('');
    try {
      if (enabled) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await request('/api/browser-push/subscription', {
            method: 'DELETE',
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          setEnabled(false);
          await subscription.unsubscribe();
        } else setEnabled(false);
        setMessage('تم إيقاف إشعارات الخلفية لهذا الجهاز.');
      } else {
        // Permission must be requested directly from the user's click, including on iOS.
        const permission = await Notification.requestPermission();
        if (permission !== 'granted')
          throw new Error(
            permission === 'denied'
              ? 'الإشعارات محظورة. اسمح بها من إعدادات الموقع في المتصفح ثم حاول مرة أخرى.'
              : 'لم يُمنح إذن الإشعارات. يمكنك التفعيل لاحقًا.',
          );
        const registration = await navigator.serviceWorker.register('/erp-push-sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const existing = subscription.options.applicationServerKey;
          const expected = keyBytes(config.publicKey);
          if (
            existing &&
            (existing.byteLength !== expected.length ||
              new Uint8Array(existing).some((byte, index) => byte !== expected[index]))
          ) {
            await subscription.unsubscribe();
            subscription = null;
          }
        }
        subscription ??= await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(config.publicKey),
        });
        await request('/api/browser-push/subscription', {
          method: 'POST',
          body: JSON.stringify(subscription.toJSON()),
        });
        setEnabled(true);
        setMessage('تم تفعيل إشعارات الخلفية لهذا الجهاز. جرّب إرسال إشعار.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تغيير إعدادات إشعارات المتصفح.');
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setMessage('');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription || Notification.permission !== 'granted') {
        setEnabled(false);
        throw new Error('فعّل إشعارات المتصفح من جديد.');
      }
      await request('/api/browser-push/test', {
        method: 'POST',
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      setMessage('أُضيف إشعار التجربة للإرسال. تحقق من إشعارات الجهاز؛ قبول الطلب لا يؤكد وصوله.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر إرسال التجربة.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="browser-push-controls" aria-label="إشعارات الخلفية">
      <button
        className="browser-push-toggle"
        aria-pressed={enabled}
        disabled={Boolean(unsupported) || !config?.ready || busy}
        onClick={() => void toggle()}
      >
        <BellRing size={17} />
        <span>
          إشعارات المتصفح{' '}
          <strong>
            {busy ? 'جارٍ التنفيذ…' : enabled ? 'مفعّلة على هذا الجهاز' : 'تفعيل على هذا الجهاز'}
          </strong>
        </span>
      </button>
      {enabled && (
        <button className="browser-push-test" disabled={busy} onClick={() => void test()}>
          إرسال إشعار تجريبي
        </button>
      )}
      {unsupported ? (
        <p>{unsupported}</p>
      ) : config && !config.ready ? (
        <p>إشعارات الخلفية تحتاج تجهيز الإرسال على الخادم.</p>
      ) : (
        <p>
          تصل والصفحة مغلقة بحسب دعم الجهاز. تتوقف عند تسجيل الخروج أو انتهاء الجلسة؛ أعد التفعيل بعد الدخول.
          على iPhone افتح المنظومة من الشاشة الرئيسية.
        </p>
      )}
      <details><summary>معلومات الصوت والنطق</summary><small>صوت إشعار الخلفية تحدده إعدادات الجهاز؛ النطق يعمل داخل الصفحة فقط.</small></details>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
