/**
 * «Войти через Google / Apple» (ADR 0008 бэкенда): скрипты провайдеров и их окна. Скрипты грузим лениво — только на
 * странице входа и в «Моём профиле», только когда провайдер подключён (Client ID в /web/config), и никогда в Telegram:
 * во встроенном браузере Telegram окна Google и Apple не работают, а вход там и так сам (initData).
 * Провайдер отдаёт ID-токен (подписанный JWT) — его проверяет сервер; токен не сохраняем нигде.
 * В тестах скрипты не грузятся: тест кладёт подставные window.google / window.AppleID, и загрузчик берёт их.
 */

import type { WebConfig } from '../api/client'
import { telegram } from './telegram'

export type Provider = 'google' | 'apple'

/** Кнопки Google и Apple подключены (Client ID в /web/config) и мы не в Telegram. */
export function externalLoginShown(config: WebConfig | null | undefined): boolean {
  return Boolean((config?.googleClientId || config?.appleClientId) && !telegram())
}

export const PROVIDER_TITLE: Record<Provider, string> = { google: 'Google', apple: 'Apple' }

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

export type AppleSignInResponse = { authorization?: { id_token?: string; code?: string; state?: string } }

export type AppleIdentity = {
  auth: {
    init(config: { clientId: string; scope?: string; redirectURI: string; state?: string; nonce?: string; usePopup?: boolean }): void
    signIn(): Promise<AppleSignInResponse>
  }
}

declare global {
  interface Window {
    google?: GoogleIdentity
    AppleID?: AppleIdentity
  }
}

const GOOGLE_SRC = 'https://accounts.google.com/gsi/client'
const APPLE_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/ru_RU/appleid.auth.js'

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

export async function loadApple(): Promise<AppleIdentity> {
  if (!window.AppleID?.auth) await loadScript(APPLE_SRC)
  if (!window.AppleID?.auth) throw new Error('apple')
  return window.AppleID
}

/**
 * Адрес возврата Apple: окно входа всплывающее (usePopup), но Apple сверяет адрес с «Return URLs» Services ID —
 * RUNBOOK бэкенда, раздел 20: https://<домен>/login.
 */
export const appleRedirectUri = () => `${window.location.origin}/login`

/** Человек сам закрыл окно Apple — не ошибка. */
export function appleCancelled(e: unknown): boolean {
  const code = typeof e === 'object' && e !== null && 'error' in e ? String((e as { error: unknown }).error) : ''
  return code === 'popup_closed_by_user' || code === 'user_cancelled_authorize'
}

export const SCRIPT_FAILED: Record<Provider, string> = {
  google: 'Кнопка Google не загрузилась — проверьте интернет или блокировщик рекламы и обновите страницу',
  apple: 'Вход Apple не загрузился — проверьте интернет или блокировщик рекламы и обновите страницу',
}

export const POPUP_FAILED = 'Окно Apple не открылось — разрешите всплывающие окна для этого сайта и нажмите ещё раз'
