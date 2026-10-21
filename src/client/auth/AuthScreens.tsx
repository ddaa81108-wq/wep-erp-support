import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { ShieldCheck, UserPlus, Mail, Eye, EyeOff } from 'lucide-react';
import { api, ApiError, type User } from '../api.ts';

const errorText = (error: unknown) => error instanceof ApiError
  ? error.message
  : 'حدث خطأ غير متوقع. لم تُعتمد العملية.';

function AuthShell({ title, subtitle, children, premium = false }: { title: string; subtitle: string; children: ReactNode; premium?: boolean }) {
  if (premium) return <main className="auth-l01" dir="ltr">
    <section className="auth-l01-scene" aria-hidden="true" />
    <section className="auth-l01-panel" dir="rtl">
      <div className="auth-l01-brand" dir="ltr"><strong>VIB</strong><span>ABDO COMPANY</span></div>
      <p className="auth-l01-tagline">حلول مالية تنمو مع أعمالك</p>
      <div className="auth-l01-welcome"><h1>مرحبًا بك</h1><p>في نظام <bdi>VIB Abdo Company</bdi> المالي المتكامل</p></div>
      <div className="auth-l01-card"><h2>{title}</h2>{children}</div>
    </section>
  </main>;
  return (
    <main className="auth-page auth-split-reference">
      <section className="auth-showcase" aria-hidden="true" />
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-reference-brand"><strong dir="ltr" translate="no">VIB <b>Abdo Company</b></strong><span>إدارة أسهل .. لعمل أكثر نجاحًا</span></div>
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
    if (password !== String(form.get('confirm') ?? '')) { setError('كلمتا المرور غير متطابقتين.'); setBusy(false); return; }
    try {
      await api.setupAdmin({ username, displayName: String(form.get('displayName') ?? ''), password });
      onComplete(username);
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }
  return <AuthShell title="تهيئة المدير الأول" subtitle="أنشئ حساب الإدارة لهذا الجهاز. لن تظهر هذه الخطوة مرة أخرى.">
    <form className="stack" onSubmit={submit}>
      <label>الاسم الظاهر<input name="displayName" minLength={2} maxLength={120} required autoFocus placeholder="مثال: عبدالله" /></label>
      <label>اسم المستخدم<input name="username" minLength={3} maxLength={80} required dir="ltr" autoComplete="username" placeholder="admin" /></label>
      <label>كلمة المرور<input name="password" type="password" minLength={10} required dir="ltr" autoComplete="new-password" /></label>
      <label>تأكيد كلمة المرور<input name="confirm" type="password" minLength={10} required dir="ltr" autoComplete="new-password" /></label>
      {error && <div className="alert error">{error}</div>}
      <button className="primary wide" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'إنشاء حساب المدير'}</button>
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
  if (mfaStep) return <AuthShell premium title="التحقق بخطوتين" subtitle="">
    <form className="stack" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('');
      api.verifyMfa(String(form.get('code') ?? '').trim()).then(result => onLogin(result.user))
        .catch(caught => setError(errorText(caught))).finally(() => setBusy(false));
    }}>
      <p>أدخل الرمز من تطبيق المصادقة، أو أحد رموز الاسترداد المحفوظة.</p>
      <label>رمز التحقق<input name="code" required maxLength={32} autoComplete="one-time-code" autoFocus dir="ltr" /></label>
      {error && <div className="alert error">{error}</div>}
      <button className="primary wide" disabled={busy}>{busy ? 'جارٍ التحقق…' : 'تأكيد الدخول'}</button>
      <button type="button" className="secondary wide" disabled={busy} onClick={() => { setMfaStep(false); setError(''); }}>العودة لتسجيل الدخول</button>
    </form>
  </AuthShell>;
  if (mode === 'register') return <AuthShell title="إنشاء حساب موظف" subtitle="استخدم بريد Google الخاص بك. لن تدخل المنظومة قبل موافقة الإدارة.">
    <div className="stack external-register">
      <div className="approval-steps"><span>1</span><p><strong>تأكيد بريد Google</strong><small>تتحقق Google من هويتك، ولا نستلم كلمة مرورك.</small></p></div>
      <div className="approval-steps"><span>2</span><p><strong>موافقة الإدارة</strong><small>يظهر طلبك للإدارة لتحديد القسم والصلاحية.</small></p></div>
      <div className="approval-steps"><span>3</span><p><strong>الدخول إلى القسم</strong><small>بعد الموافقة تدخل بنفس حساب Google.</small></p></div>
      {googleConfigured ? <a className="google-button" href="/api/auth/google/start?mode=register"><b>G</b><span>متابعة وإنشاء الحساب بواسطة Google</span></a> : <><button className="google-button" disabled><b>G</b><span>متابعة بواسطة Google</span></button><div className="alert warning">زر Google جاهز في المنظومة، وينتظر إضافة بيانات الربط من الإدارة.</div></>}
      <button className="secondary wide" onClick={() => setMode('login')}>العودة لتسجيل الدخول</button>
    </div>
  </AuthShell>;
  return <AuthShell premium title="تسجيل الدخول" subtitle="">
    <form className="stack" onSubmit={submit}>
      {googleResult === 'pending' && <div className="alert success">تم إرسال طلب حسابك إلى الإدارة. ستتمكن من الدخول بعد الموافقة.</div>}
      {googleResult === 'rejected' && <div className="alert error">لم توافق الإدارة على طلب هذا البريد.</div>}
      {googleResult === 'disabled' && <div className="alert error">هذا الحساب موقوف. راجع الإدارة.</div>}
      {googleResult === 'cancelled' && <div className="alert warning">أُلغيت محاولة Google ولم يُرسل أي طلب.</div>}
      <label>البريد الإلكتروني<span className="auth-l01-field"><input name="username" defaultValue={initialUsername} required dir="ltr" autoComplete="username" autoFocus /><Mail size={18} aria-hidden="true" /></span></label>
      <label>كلمة المرور<span className="auth-l01-field"><input name="password" type={passwordVisible ? 'text' : 'password'} required dir="ltr" autoComplete="current-password" /><button type="button" className="auth-l01-eye" aria-label={passwordVisible ? 'إخفاء الأحرف' : 'إظهار الأحرف'} onClick={() => setPasswordVisible(value => !value)}>{passwordVisible ? <Eye size={18} /> : <EyeOff size={18} />}</button></span></label>
      {error && <div className="alert error">{error}</div>}
      <button className="primary wide" aria-label="تسجيل الدخول" disabled={busy}>{busy ? 'جارٍ التحقق…' : 'دخول'}</button>
      <div className="auth-divider"><span>أو</span></div>
      {googleConfigured ? <a className="google-button" href="/api/auth/google/start?mode=login"><b>G</b><span>المتابعة باستخدام Google</span></a> : <button type="button" className="google-button" disabled title="ينتظر إعداد Google OAuth"><b>G</b><span>المتابعة باستخدام Google</span></button>}
      <button type="button" className="secondary wide create-account-button" onClick={() => setMode('register')}><UserPlus size={17} />إنشاء حساب موظف</button>
      <div className="local-note"><ShieldCheck size={18} /><span>بيانات الدخول تُرسل إلى جهاز الخادم داخل شبكتك فقط.</span></div>
    </form>
  </AuthShell>;
}

export function RequiredPasswordChangeScreen({ onComplete }: { onComplete: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    const next = String(form.get('newPassword') ?? '');
    if (next !== String(form.get('confirm') ?? '')) { setError('كلمتا المرور الجديدتان غير متطابقتين.'); setBusy(false); return; }
    try { await api.changePassword(String(form.get('currentPassword') ?? ''), next); onComplete(); }
    catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }
  return <AuthShell title="غيّر كلمة المرور المؤقتة" subtitle="أنشأت الإدارة حسابك بكلمة مؤقتة. اختر كلمة خاصة بك قبل دخول المنظومة."><form className="stack" onSubmit={submit}>
    <label>كلمة المرور المؤقتة<input name="currentPassword" type="password" required autoFocus dir="ltr" /></label>
    <label>كلمة المرور الجديدة<input name="newPassword" type="password" minLength={10} required dir="ltr" /></label>
    <label>تأكيد كلمة المرور الجديدة<input name="confirm" type="password" minLength={10} required dir="ltr" /></label>
    {error && <div className="alert error">{error}</div>}
    <button className="primary wide" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ ودخول المنظومة'}</button>
  </form></AuthShell>;
}
