import en from './en.json';
import sv from './sv.json';

const translations: Record<string, Record<string, string>> = { en, sv };

export type Lang = 'en' | 'sv';

export function getLangFromUrl(url: URL): Lang {
  const [, lang] = url.pathname.split('/');
  if (lang === 'sv') return 'sv';
  return 'en';
}

export function t(lang: string, key: string): string {
  return translations[lang]?.[key] ?? translations['en']?.[key] ?? key;
}

export function localePath(lang: string, path: string): string {
  if (lang === 'en') return path;
  return `/sv${path}`;
}
