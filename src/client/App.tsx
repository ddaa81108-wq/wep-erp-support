import { uiText } from './i18n/language.ts';
import { lazy, Suspense, useEffect, useState } from 'react';
import { api, type User } from './api.ts';
import { LoginScreen, RequiredPasswordChangeScreen, SetupScreen } from './auth/AuthScreens.tsx';
import { ThemeToggle, type Theme } from './components/ThemeToggle.tsx';
import { Readability } from './components/Readability.tsx';
import { LanguageToggle } from './i18n/LanguageToggle.tsx';

const Dashboard = lazy(() => import('./dashboard/Dashboard.tsx').then((module) => ({ default: module.Dashboard })));

const DatabaseMonitor = lazy(() => import('./database-monitor/DatabaseMonitor.tsx').then(module => ({ default: module.DatabaseMonitor })));
const isDatabaseMonitor = window.location.pathname.replace(/\/$/, '') === '/database-monitor';

type Screen = 'boot' | 'setup' | 'login' | 'change-password' | 'app';

const THEME_KEY = 'abdo-erp-theme';
const storedTheme = (): Theme => {
  if (typeof window === 'undefined') return 'light';
  return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
};

if (typeof document !== 'undefined') document.documentElement.dataset.theme = storedTheme();

function Loading() {
  return <div className="loading-page"><span className="brand-mark">{uiText("ع")}</span><div className="spinner" /><p>{uiText("جارٍ الاتصال بالخادم المحلي…")}</p></div>;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('boot');
  const [user, setUser] = useState<User | null>(null);
  const [initialUsername, setInitialUsername] = useState('');
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    void (async () => {
      try {
        const status = await api.setupStatus();
        if (status.setupRequired) {
          setScreen('setup');
          return;
        }
        try {
          const me = await api.resume();
          setUser(me.user);
          if (!isDatabaseMonitor && window.location.pathname !== '/erp') window.history.replaceState({}, '', '/erp');
          setScreen(me.user.mustChangePassword ? 'change-password' : 'app');
        } catch {
          setScreen('login');
        }
      } catch {
        setScreen('login');
      }
    })();
  }, []);

  const toggleTheme = () => setTheme((current) => current === 'light' ? 'dark' : 'light');
  let content: React.ReactNode;
  if (screen === 'boot') content = <Loading />;
  else if (screen === 'setup') content = <SetupScreen onComplete={(username) => { setInitialUsername(username); setScreen('login'); }} />;
  else if (screen === 'login' || !user) content = <LoginScreen initialUsername={initialUsername} onLogin={(next) => { setUser(next); if (!isDatabaseMonitor && window.location.pathname !== '/erp') window.history.replaceState({}, '', '/erp'); setScreen(next.mustChangePassword ? 'change-password' : 'app'); }} />;
  else if (screen === 'change-password') content = <RequiredPasswordChangeScreen onComplete={() => { setUser({ ...user, mustChangePassword: false }); setScreen('app'); }} />;
  else if (isDatabaseMonitor) content = <Suspense fallback={<Loading />}><DatabaseMonitor user={user} theme={theme} onThemeToggle={toggleTheme} onLogout={() => { setUser(null); setScreen('login'); }} /></Suspense>;
  else content = <Suspense fallback={<Loading />}><Dashboard user={user} theme={theme} onThemeToggle={toggleTheme} onLogout={() => { setUser(null); setScreen('login'); }} /></Suspense>;

  return <>{screen === 'app' && isDatabaseMonitor && <Readability />}{screen !== 'app' && <><div className="auth-language-position"><LanguageToggle /></div><div className="auth-theme-position"><ThemeToggle theme={theme} onToggle={toggleTheme} /></div></>}{content}</>;
}
