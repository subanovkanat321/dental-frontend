/**
 * Встроенный браузер соцсети (Instagram, Facebook/Messenger, TikTok, Threads): ссылка из директа или профиля открывается
 * в нём, а не в Safari/Chrome. Вход, сохранённый там, теряется, как только человек закроет приложение, — а врачи
 * приходят на /start именно из Instagram. Узнаём по userAgent: приложения сами пишут себя туда
 * («Instagram 350.0…», «FBAN/FBIOS», «FB_IAB», «musical_ly», «Barcelona» — так Threads зовётся внутри).
 */
export type InAppBrowser = {
  /** Как назвать приложение в тексте: «Instagram» */
  app: string
  /** Телефон: на Android можно открыть Chrome ссылкой intent://, на iPhone Safari программно не открыть */
  os: 'ios' | 'android' | 'other'
}

const APPS: [RegExp, string][] = [
  // Threads — раньше Instagram: в его userAgent есть и «Instagram», и «Barcelona»
  [/Barcelona|Threads/i, 'Threads'],
  [/Instagram/i, 'Instagram'],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A|MessengerForiOS|Orca-Android/i, 'Facebook'],
  [/musical_ly|TikTok|BytedanceWebview|trill_/i, 'TikTok'],
]

export function inAppBrowser(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): InAppBrowser | null {
  const found = APPS.find(([re]) => re.test(ua))
  if (!found) return null
  const os = /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : 'other'
  return { app: found[1], os }
}

/**
 * Android: ссылка, которая открывает адрес в Chrome (а нет Chrome — тот же адрес в браузере по умолчанию).
 * @param url https-адрес
 */
export function chromeIntent(url: string): string {
  const u = new URL(url)
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;`
    + `S.browser_fallback_url=${encodeURIComponent(url)};end`
}
