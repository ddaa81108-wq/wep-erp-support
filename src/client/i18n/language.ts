export type Language = 'ar' | 'en';
export const LANGUAGE_KEY = 'abdo-erp-language';

export function resolveLanguage(explicit?: string | null, stored?: string | null): Language {
  if (explicit === 'ar' || explicit === 'en') return explicit;
  return stored === 'en' ? 'en' : 'ar';
}

function initialLanguage(): Language {
  if (typeof window === 'undefined') return 'ar';
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(LANGUAGE_KEY);
  } catch {
    /* Private browsing can block storage. */
  }
  return resolveLanguage(new URL(window.location.href).searchParams.get('lang'), stored);
}

// A language change uses a guarded navigation. Module-level label maps and Intl
// formatters are then initialized in the same language, including lazy sections.
export const language = initialLanguage();
export const direction = language === 'ar' ? 'rtl' : 'ltr';
export const displayLocale = language === 'ar' ? 'ar-LY' : 'en-GB';
let english: Readonly<Record<string, string>> = {};

export async function loadLanguageCatalog(forLanguage: Language = language) {
  if (forLanguage === 'en') english = (await import('./english.ts')).english;
}

export function translateFor(
  locale: Language,
  text: string,
  values: readonly unknown[] = [],
  context?: string,
): string {
  const key = text.trim().replace(/\s+/g, ' ');
  const lookup = context ? `${key}|${context}` : key;
  const translated = locale === 'en' && Object.hasOwn(english, lookup) ? english[lookup] : undefined;
  const format =
    translated === undefined ? text : text.match(/^\s*/)?.[0] + translated + text.match(/\s*$/)?.[0];
  return format.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : token,
  );
}

export const uiText = (text: string, values?: readonly unknown[], context?: string) =>
  translateFor(language, text, values, context);

if (typeof document !== 'undefined') {
  document.documentElement.lang = language;
  document.documentElement.dir = direction;
  if (language === 'en') {
    document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/manifest-en.webmanifest');
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', 'Secure customer accounts and debt management');
  }
}
