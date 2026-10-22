import { direction, uiText } from '../i18n/language.ts';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { ShieldCheck, UserPlus, Mail, Eye, EyeOff } from 'lucide-react';
import { api, ApiError, type User } from '../api.ts';

const errorText = (error: unknown) => error instanceof ApiError
  ? error.message
  : uiText("حدث خطأ غير متوقع. لم تُعتمد العملية.");

function AuthShell({ title, subtitle, children, premium = false }: { title: string; subtitle: string; children: ReactNode; premium?: boolean }) {
  if (premium) return <main className="auth-l01" dir="ltr">
    <section className="auth-l01-scene" aria-hidden="true" />
    <section className="auth-l01-panel" dir={direction}>
      <div className="auth-l01-brand" dir="ltr"><strong>VIB</strong><span>ABDO COMPANY</span></div>
      <p className="auth-l01-tagline">{uiText("حلول مالية تنمو مع أعمالك")}</p>
      <div className="auth-l01-welcome"><h1>{uiText("مرحبًا بك")}</h1><p>{uiText("في نظام ")}<bdi>VIB Abdo Company</bdi> {uiText(" المالي المتكامل")}</p></div>
      <div className="auth-l01-card"><h2>{title}</h2>{children}</div>
    </section>
  </main>;
  return (
    <main className="auth-page auth-split-reference">
      <section className="auth-showcase" aria-hidden="true" />
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-reference-brand"><strong dir="ltr" translate="no">VIB <b>Abdo Company</b></strong><span>{uiText("إدارة أسهل .. لعمل أكثر نجاحًا")}</span></div>
          <h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}
          {children}
        </div>
      </section>
    </main>
  );
}

export function SetupScreen({ onComplete }: { onComplete: (username: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const username = String(form.get('username') ?? '').trim();
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirm') ?? '')) { setError(uiText("كلمتا المرور غير متطابقتين.")); setBusy(false); return; }
    try {
      await api.setupAdmin({ username, displayName: String(form.get('displayName') ?? ''), password });
      onComplete(username);
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }
  return <AuthShell title={uiText("تهيئة المدير الأول")} subtitle={uiText("أنشئ حساب الإدارة لهذا الجهاز. لن تظهر هذه الخطوة مرة أخرى.")}>
    <form className="stack" onSubmit={submit}>
      <label>{uiText("الاسم الظاهر")}<input name="displayName" minLength={2} maxLength={120} required autoFocus placeholder={uiText("مثال: عبدالله")} /></label>
      <label>{uiText("اسم المستخدم")}<input name="username" minLength={3} maxLength={80} required dir="ltr" autoComplete="username" placeholder="admin" /></label>
      <label>{uiText("كلمة المرور")}<input name="password" type="password" minLength={10} required dir="ltr" autoComplete="new-password" /></label>
      <label>{uiText("تأكيد كلمة المرور")}<input name="confirm" type="password" minLength={10} required dir="ltr" autoComplete="new-password" /></label>
      {error && <div className="alert error">{error}</div>}
      <button className="primary wide" disabled={busy}>{busy ? uiText("جارٍ الحفظ…") : uiText("إنشاء حساب المدير")}</button>
    </form>
  </AuthShell>;
}

export function LoginScreen({ initialUsername, onLogin }: { initialUsername: string; onLogin: (user: User) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const googleResult = new URLSearchParams(window.location.search).get('google');
  const [mfaStep, setMfaStep] = useState(googleResult === 'mfa');
  useEffect(() => { api.googleAuthStatus().then((status) => setGoogleConfigured(status.configured)).catch(() => setGoogleConfigured(false)); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api.login(String(form.get('username') ?? ''), String(form.get('password') ?? ''));
      onLogin(result.user);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'MFA_REQUIRED') { setMfaStep(true); setError(''); }
      else setError(errorText(caught));
    } finally { setBusy(false); }
  }
  if (mfaStep) return <AuthShell premium title={uiText("التحقق بخطوتين")} subtitle="">
    <form className="stack" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('');
      api.verifyMfa(String(form.get('code') ?? '').trim()).then(result => onLogin(result.user))
        .catch(caught => setError(errorText(caught))).finally(() => setBusy(false));
    }}>
      <p>{uiText("أدخل الرمز من تطبيق المصادقة، أو أحد رموز الاسترداد المحفوظة.")}</p>
      <label>{uiText("رمز التحقق")}<input name="code" required maxLength={32} autoComplete="one-time-code" autoFocus dir="ltr" /></label>
      {error && <div className="alert error">{error}</div>}
      <button className="primary wide" disabled={busy}>{busy ? uiText("جارٍ التحقق…") : uiText("تأكيد الدخول")}</button>
      <button type="button" className="secondary wide" disabled={busy} onClick={() => { setMfaStep(false); setError(''); }}>{uiText("العودة لتسجيل الدخول")}</button>
    </form>
  </AuthShell>;
  if (mode === 'register') return <AuthShell title={uiText("إنشاء حساب موظف")} subtitle={uiText("استخدم بريد Google الخاص بك. لن تدخل المنظومة قبل موافقة الإدارة.")}>
    <div className="stack external-register">
      <div className="approval-steps"><span>1</span><p><strong>{uiText("تأكيد بريد Google")}</strong><small>{uiText("تتحقق Google من هويتك، ولا نستلم كلمة مرورك.")}</small></p></div>
      <div className="approval-steps"><span>2</span><p><strong>{uiText("موافقة الإدارة")}</strong><small>{uiText("يظهر طلبك للإدارة لتحديد القسم والصلاحية.")}</small></p></div>
      <div className="approval-steps"><span>3</span><p><strong>{uiText("الدخول إلى القسم")}</strong><small>{uiText("بعد الموافقة تدخل بنفس حساب Google.")}</small></p></div>
      {googleConfigured ? <a className="google-button" href="/api/auth/google/start?mode=register"><b>G</b><span>{uiText("متابعة وإنشاء الحساب بواسطة Google")}</span></a> : <><button className="google-button" disabled><b>G</b><span>{uiText("متابعة بواسطة Google")}</span></button><div className="alert warning">{uiText("زر Google جاهز في المنظومة، وينتظر إضافة بيانات الربط من الإدارة.")}</div></>}
      <button className="secondary wide" onClick={() => setMode('login')}>{uiText("العودة لتسجيل الدخول")}</button>
    </div>
  </AuthShell>;
  return <AuthShell premium title={uiText("تسجيل الدخول")} subtitle="">
    <form className="stack" onSubmit={submit}>
      {googleResult === 'pending' && <div className="alert success">{uiText("تم إرسال طلب حسابك إلى الإدارة. ستتمكن من الدخول بعد الموافقة.")}</div>}
      {googleResult === 'rejected' && <div className="alert error">{uiText("لم توافق الإدارة على طلب هذا البريد.")}</div>}
      {googleResult === 'disabled' && <div className="alert error">{uiText("هذا الحساب موقوف. راجع الإدارة.")}</div>}
      {googleResult === 'cancelled' && <div className="alert warning">{uiText("أُلغيت محاولة Google ولم يُرسل أي طلب.")}</div>}
      <label>{uiText("البريد الإلكتروني")}<span className="auth-l01-field"><input name="username" defaultValue={initialUsername} required dir="ltr" autoComplete="username" autoFocus /><Mail size={18} aria-hidden="true" /></span></label>
      <label>{uiText("كلمة المرور")}<span className="auth-l01-field"><input name="password" type={passwordVisible ? 'text' : 'password'} required dir="ltr" autoComplete="current-password" /><button type="button" className="auth-l01-eye" aria-label={passwordVisible ? uiText("إخفاء الأحرف") : uiText("إظهار الأحرف")} onClick={() => setPasswordVisible(value => !value)}>{passwordVisible ? <Eye size={18} /> : <EyeOff size={18} />}</button></span></label>
      {error && <div className="alert error">{error}</div>}
      <button className="primary wide" aria-label={uiText("تسجيل الدخول")} disabled={busy}>{busy ? uiText("جارٍ التحقق…") : uiText("دخول")}</button>
      <div className="auth-divider"><span>{uiText("أو")}</span></div>
      {googleConfigured ? <a className="google-button" href="/api/auth/google/start?mode=login"><b>G</b><span>{uiText("المتابعة باستخدام Google")}</span></a> : <button type="button" className="google-button" disabled title={uiText("ينتظر إعداد Google OAuth")}><b>G</b><span>{uiText("المتابعة باستخدام Google")}</span></button>}
      <button type="button" className="secondary wide create-account-button" onClick={() => setMode('register')}><UserPlus size={17} />{uiText("إنشاء حساب موظف")}</button>
      <div className="local-note"><ShieldCheck size={18} /><span>{uiText("بيانات الدخول تُرسل إلى جهاز الخادم داخل شبكتك فقط.")}</span></div>
    </form>
  </AuthShell>;
}

export function RequiredPasswordChangeScreen({ onComplete }: { onComplete: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    const next = String(form.get('newPassword') ?? '');
    if (next !== String(form.get('confirm') ?? '')) { setError(uiText("كلمتا المرور الجديدتان غير متطابقتين.")); setBusy(false); return; }
    try { await api.changePassword(String(form.get('currentPassword') ?? ''), next); onComplete(); }
    catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }
  return <AuthShell title={uiText("غيّر كلمة المرور المؤقتة")} subtitle={uiText("أنشأت الإدارة حسابك بكلمة مؤقتة. اختر كلمة خاصة بك قبل دخول المنظومة.")}><form className="stack" onSubmit={submit}>
    <label>{uiText("كلمة المرور المؤقتة")}<input name="currentPassword" type="password" required autoFocus dir="ltr" /></label>
    <label>{uiText("كلمة المرور الجديدة")}<input name="newPassword" type="password" minLength={10} required dir="ltr" /></label>
    <label>{uiText("تأكيد كلمة المرور الجديدة")}<input name="confirm" type="password" minLength={10} required dir="ltr" /></label>
    {error && <div className="alert error">{error}</div>}
    <button className="primary wide" disabled={busy}>{busy ? uiText("جارٍ الحفظ…") : uiText("حفظ ودخول المنظومة")}</button>
  </form></AuthShell>;
}
