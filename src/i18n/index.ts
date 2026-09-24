// Centralized localization. All user-visible text comes from the resource
// files in this folder; components never contain Chinese or English strings.
//
// - Language: 'zh-CN' (Simplified Chinese) or 'en-US' (English).
// - Initial language: saved preference if the user chose one, otherwise the
//   browser/device language (any Chinese locale -> zh-CN, else en-US).
// - Switching language updates the UI immediately through subscribers.

import { enUS } from './en-US';
import { zhCN } from './zh-CN';
import type { CoachingMessageKey } from '../coaching/messageKeys';

export type Messages = typeof enUS;

export const LANGUAGES = ['zh-CN', 'en-US'] as const;
export type Language = (typeof LANGUAGES)[number];

const RESOURCES: Record<Language, Messages> = { 'zh-CN': zhCN, 'en-US': enUS };

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);
}

export function getMessages(lang: Language): Messages {
  return RESOURCES[lang];
}

/** Browser/device language -> app language. Any Chinese variant maps to zh-CN. */
export function detectLanguage(preferred: readonly string[]): Language {
  const first = preferred.find((l) => typeof l === 'string' && l.length > 0);
  return first && /^(zh|cmn)\b/i.test(first) ? 'zh-CN' : 'en-US';
}

/** A saved preference always wins over the device language. */
export function resolveLanguage(saved: unknown, preferred: readonly string[]): Language {
  return isLanguage(saved) ? saved : detectLanguage(preferred);
}

export function browserLanguages(): string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? [...navigator.languages] : navigator.language ? [navigator.language] : [];
}

/** Replaces {name} placeholders. Unknown placeholders are left as-is. */
export function fmt(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Text of a coaching message in the given language. */
export function coachingText(key: CoachingMessageKey, lang: Language): string {
  const c = RESOURCES[lang].coaching;
  switch (key.type) {
    case 'issue':
      return c.issues[key.issue][key.variant];
    case 'praise':
      return c.praise[key.category];
    case 'goodStroke':
      return c.goodStroke;
    case 'okStroke':
      return c.okStroke;
    case 'visibility':
      return key.repeated ? c.visibilityRepeated : c.visibility;
  }
}

/** Current language with change notifications (UI and speech subscribe). */
export class I18n {
  private listeners = new Set<(lang: Language) => void>();

  constructor(private _lang: Language) {}

  get lang(): Language {
    return this._lang;
  }

  get t(): Messages {
    return RESOURCES[this._lang];
  }

  setLanguage(lang: Language): void {
    if (lang === this._lang) return;
    this._lang = lang;
    for (const l of this.listeners) l(lang);
  }

  subscribe(listener: (lang: Language) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
