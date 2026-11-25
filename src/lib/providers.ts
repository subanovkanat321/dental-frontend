/**
 * «Войти через Google» (ADR 0008 бэкенда): скрипт Google и его окно. Скрипт грузим лениво — только на странице входа и
 * в «Моём профиле», только когда вход подключён (Client ID в /web/config), и никогда в Telegram: во встроенном браузере
 * Telegram окно Google не работает, а вход там и так сам (initData). «Войти через Apple» убран (2026-11-25).
 * Google отдаёт ID-токен (подписанный JWT) — его проверяет сервер; токен не сохраняем нигде.
 * В тестах скрипт не грузится: тест кладёт подставной window.google, и загрузчик берёт его.
 */

import type { WebConfig } from '../api/client'
import { telegram } from './telegram'

export type Provider = 'google'

/** Кнопка Google подключена (Client ID в /web/config) и мы не в Telegram. */
export function externalLoginShown(config: WebConfig | null | undefined): boolean {
  return Boolean(config?.googleClientId && !telegram())
}

export const PROVIDER_TITLE: Record<Provider, string> = { google: 'Google' }

type GoogleButtonOptions = {
  type?: 'standard' | 'icon'
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  size?: 'large' | 'medium' | 'small'
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
  shape?: 'rectangular' | 'pill'
  logo_alignment?: 'left' | 'center'
  width?: number
  locale?: string
}

export type GoogleIdentity = {
  accounts: {
    id: {
      initialize(config: {
        client_id: string
        callback: (response: { credential?: string }) => void
        nonce?: string
        auto_select?: boolean
        ux_mode?: 'popup' | 'redirect'
        itp_support?: boolean
        use_fedcm_for_button?: boolean
      }): void
      renderButton(parent: HTMLElement, options: GoogleButtonOptions): void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentity
  }
}

const GOOGLE_SRC = 'https://accounts.google.com/gsi/client'

const loading = new Map<string, Promise<void>>()

/** Один скрипт — один раз на страницу; не загрузился — следующая попытка начнёт заново. */
function loadScript(src: string): Promise<void> {
  const known = loading.get(src)
  if (known) return known
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      loading.delete(src)
      script.remove()
      reject(new Error('script'))
    }
    document.head.appendChild(script)
  })
  loading.set(src, promise)
  return promise
}

export async function loadGoogle(): Promise<GoogleIdentity> {
  if (!window.google?.accounts?.id) await loadScript(GOOGLE_SRC)
  if (!window.google?.accounts?.id) throw new Error('google')
  return window.google
}

export const SCRIPT_FAILED = 'Кнопка Google не загрузилась — проверьте интернет или блокировщик рекламы и обновите страницу'
