import { uiText } from '../../i18n/language.ts';
import { useEffect, useState } from 'react';
import { ApiError, request } from '../../apiTransport.ts';

export function AccountSecurityManager() {
  const [status, setStatus] = useState<{ configured: boolean; enabled: boolean } | null>(null);
  const [password, setPassword] = useState(''),
    [code, setCode] = useState('');
  const [enrollment, setEnrollment] = useState<{ secret: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const load = () =>
    request<{ configured: boolean; enabled: boolean }>('/api/auth/mfa/status').then(setStatus);
  useEffect(() => {
    void load().catch((error) =>
      setNotice(error instanceof ApiError ? error.message : uiText("تعذر تحميل حالة الحماية.")),
    );
  }, []);
  async function act(action: 'begin' | 'confirm' | 'disable') {
    setBusy(true);
    setNotice('');
    try {
      if (action === 'begin') {
        setEnrollment(
          await request<{ secret: string }>('/api/auth/mfa/begin', {
            method: 'POST',
            body: JSON.stringify({ password }),
          }),
        );
        setPassword('');
      } else if (action === 'confirm') {
        const result = await request<{ recoveryCodes: string[] }>('/api/auth/mfa/confirm', {
          method: 'POST',
          body: JSON.stringify({ code }),
        });
        setCodes(result.recoveryCodes);
        setEnrollment(null);
        setCode('');
        await load();
        setNotice(uiText("تم التفعيل وإغلاق الجلسات الأخرى. احفظ رموز الاسترداد الآن؛ لن تظهر مرة أخرى."));
      } else {
        if (!window.confirm(uiText("هل تؤكد تعطيل التحقق بخطوتين لحسابك؟"))) return;
        await request('/api/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ password, code }) });
        setPassword('');
        setCode('');
        setCodes([]);
        await load();
        setNotice(uiText("تم تعطيل التحقق بخطوتين لحسابك."));
      }
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : uiText("تعذر تنفيذ العملية."));
    } finally {
      setBusy(false);
    }
  }
  function downloadCodes() {
    const url = URL.createObjectURL(
      new Blob([`Abdo ERP — recovery codes (one use each)\n${codes.join('\n')}\n`], { type: 'text/plain' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'abdo-erp-recovery-codes.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return (
    <section className="backup-panel stack" aria-label={uiText("حماية حسابي")}>
      <h3>{uiText("حماية حسابي — التحقق بخطوتين")}</h3>
      <p>
        {uiText("الحالة: ")}{status ? (status.enabled ? uiText("مفعّل") : uiText("غير مفعّل")) : uiText("جارٍ التحقق…")}{uiText(". بعد التفعيل يلزم رمز التطبيق بالإضافة إلى تسجيل الدخول، بما في ذلك الدخول بواسطة Google.")}</p>
      {notice && <p role="status">{notice}</p>}
      {status && !status.configured && <p>{uiText("يلزم تهيئة مفتاح الحماية على الخادم قبل إعداد التطبيق.")}</p>}
      {status?.configured && !codes.length && (
        <>
          {!enrollment && (
            <label>
              {uiText("كلمة مرور حسابك الحالية")}<input
                type="password"
                value={password}
                maxLength={256}
                autoComplete="current-password"
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          {enrollment && (
            <>
              <p>
                {uiText("أضف حسابًا في تطبيق المصادقة باختيار إدخال مفتاح إعداد يدويًا، واختر رمزًا يعتمد على الوقت. أدخل المفتاح التالي:")}</p>
              <code dir="ltr" style={{ overflowWrap: 'anywhere' }}>
                {enrollment.secret}
              </code>
              <p>{uiText("الإعداد صالح لعشر دقائق. لا تشارك هذا المفتاح.")}</p>
            </>
          )}
          {(enrollment || status.enabled) && (
            <label>
              {uiText("رمز التطبيق أو الاسترداد")}<input
                value={code}
                maxLength={32}
                autoComplete="one-time-code"
                dir="ltr"
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
          )}
          {enrollment ? (
            <button className="secondary" disabled={busy || !code} onClick={() => void act('confirm')}>
              {uiText("تأكيد التفعيل")}</button>
          ) : (
            <button
              className="secondary"
              disabled={busy || !password || (status.enabled && !code)}
              onClick={() => void act(status.enabled ? 'disable' : 'begin')}
            >
              {status.enabled ? uiText("تعطيل التحقق لحسابي") : uiText("ربط تطبيق المصادقة")}
            </button>
          )}
        </>
      )}
      {codes.length > 0 && (
        <>
          <p>{uiText("كل رمز يُستخدم مرة واحدة عند فقدان تطبيق المصادقة. احفظها في مكان آمن منفصل عن الجهاز.")}</p>
          <pre dir="ltr">{codes.join('\n')}</pre>
          <button className="secondary" onClick={downloadCodes}>
            {uiText("تنزيل رموز الاسترداد")}</button>
          <button
            className="secondary"
            onClick={() => {
              if (window.confirm(uiText("هل حفظت رموز الاسترداد؟ لن يمكن عرضها مجددًا."))) setCodes([]);
            }}
          >
            {uiText("حفظتها — إخفاء الرموز")}</button>
        </>
      )}
    </section>
  );
}
