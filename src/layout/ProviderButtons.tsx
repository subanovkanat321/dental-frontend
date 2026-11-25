import { useEffect, useRef, useState } from 'react'

import { oauthNonce } from '../api/client'
import { loadGoogle, SCRIPT_FAILED } from '../lib/providers'
import { Spinner } from './Loading'

/**
 * Кнопка «Войти через Google» и «Привязать…» (ADR 0008 бэкенда; «Войти через Apple» убран). Сама берёт у сервера одноразовый nonce
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
        if (alive) handlers.current.onError(e instanceof Error && e.message !== 'script' && e.message !== 'google' ? e.message : SCRIPT_FAILED)
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
