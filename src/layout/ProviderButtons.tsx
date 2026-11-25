import { useEffect, useRef, useState } from 'react'

import { oauthNonce } from '../api/client'
import {
  appleCancelled, appleRedirectUri, loadApple, loadGoogle, POPUP_FAILED, SCRIPT_FAILED, type AppleIdentity,
} from '../lib/providers'
import { Spinner } from './Loading'

/**
 * Кнопки «Войти через Google / Apple» и «Привязать…» (ADR 0008 бэкенда). Каждая сама берёт у сервера одноразовый nonce
 * и грузит скрипт провайдера; ID-токен отдаёт в onToken — что с ним делать (войти или привязать), решает страница.
 * После каждой попытки — новый nonce (прежний сервер уже погасил).
 */
type Props = {
  clientId: string
  /** Токен от провайдера → вход или привязка; ошибку показывает страница (onError) */
  onToken: (idToken: string) => Promise<void>
  onError: (message: string) => void
}

/**
 * Кнопка Google — её рисует сам Google (Google Identity Services, фрейм accounts.google.com): своя кнопка
 * credential-токен не получит. text — «Войти через Google» или «Продолжить с Google» (для привязки).
 */
export function GoogleButton({ clientId, onToken, onError, text = 'signin_with' }: Props & { text?: 'signin_with' | 'continue_with' }) {
  const box = useRef<HTMLDivElement>(null)
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState(false)
  // Свежие обработчики — без перерисовки кнопки Google на каждый рендер страницы
  const handlers = useRef({ onToken, onError })
  useEffect(() => {
    handlers.current = { onToken, onError }
  })

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [nonce, google] = await Promise.all([oauthNonce(), loadGoogle()])
        if (!alive || !box.current) return
        google.accounts.id.initialize({
          client_id: clientId,
          nonce,
          auto_select: false,
          ux_mode: 'popup',
          itp_support: true,
          callback: (response) => {
            if (!response.credential) return
            setBusy(true)
            handlers.current.onToken(response.credential)
              .catch((e: unknown) => handlers.current.onError(e instanceof Error ? e.message : 'Не получилось — попробуйте ещё раз'))
              .finally(() => {
                setBusy(false)
                setRound((r) => r + 1)
              })
          },
        })
        box.current.replaceChildren()
        google.accounts.id.renderButton(box.current, {
          type: 'standard', theme: 'outline', size: 'large', text, shape: 'rectangular', logo_alignment: 'center',
          width: Math.min(360, box.current.clientWidth || 320), locale: 'ru',
        })
      } catch (e) {
        if (alive) handlers.current.onError(e instanceof Error && e.message !== 'script' && e.message !== 'google' ? e.message : SCRIPT_FAILED.google)
      }
    })()
    return () => {
      alive = false
    }
  }, [clientId, text, round])

  return (
    <div className="provider-button" aria-busy={busy}>
      <div ref={box} className="provider-google" data-testid="google-button" />
      {busy && <p className="hint small" role="status"><Spinner />Проверяем вход…</p>}
    </div>
  )
}

/**
 * Кнопка Apple — своя, в стиле Apple (чёрная, «Войти через Apple»): окно Apple открывается всплывающим (usePopup).
 * Скрипт и nonce готовим заранее: окно нужно открыть сразу по нажатию, иначе браузер (Safari) его заблокирует.
 */
export function AppleButton({ clientId, onToken, onError, label = 'Войти через Apple' }: Props & { label?: string }) {
  const [ready, setReady] = useState<{ apple: AppleIdentity; nonce: string } | null>(null)
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState(false)
  const handlers = useRef({ onToken, onError })
  useEffect(() => {
    handlers.current = { onToken, onError }
  })

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [nonce, apple] = await Promise.all([oauthNonce(), loadApple()])
        if (alive) setReady({ apple, nonce })
      } catch (e) {
        if (alive) handlers.current.onError(e instanceof Error && e.message !== 'script' && e.message !== 'apple' ? e.message : SCRIPT_FAILED.apple)
      }
    })()
    return () => {
      alive = false
    }
  }, [clientId, round])

  const click = () => {
    if (!ready) return
    setBusy(true)
    let signIn: Promise<{ authorization?: { id_token?: string } }>
    try {
      ready.apple.auth.init({ clientId, scope: 'email', redirectURI: appleRedirectUri(), nonce: ready.nonce, usePopup: true })
      signIn = ready.apple.auth.signIn()
    } catch {
      setBusy(false)
      handlers.current.onError(POPUP_FAILED)
      return
    }
    signIn
      .then(async (r) => {
        const token = r.authorization?.id_token
        if (!token) throw new Error('Apple не вернул вход — попробуйте ещё раз')
        await handlers.current.onToken(token)
      })
      .catch((e: unknown) => {
        if (appleCancelled(e)) return
        handlers.current.onError(e instanceof Error ? e.message : POPUP_FAILED)
      })
      .finally(() => {
        setBusy(false)
        // nonce потрачен — ждём новый, кнопка неактивна до него
        setReady(null)
        setRound((n) => n + 1)
      })
  }

  return (
    <button type="button" className="btn provider-apple" disabled={!ready || busy} onClick={click}>
      {busy ? <Spinner /> : <AppleLogo />}{label}
    </button>
  )
}

/** Логотип Apple (Simple Icons, CC0) — на всех устройствах, не только на Apple. */
function AppleLogo() {
  return (
    <svg className="provider-apple-logo" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  )
}
