import { useState } from 'react'

import { oauthLogin, type WebConfig } from '../api/client'
import { externalLoginShown } from '../lib/providers'
import { GoogleButton } from './ProviderButtons'

/**
 * «Войти через Google» на странице входа (ADR 0008 бэкенда). Только для тех, кто привязал аккаунт в «Я → Мой профиль»:
 * не привязан — сервер отвечает текстом, где привязать, его и показываем. Внутри Telegram кнопки нет
 * (externalLoginShown): там вход сам, а окно Google во встроенном браузере не работает.
 */
export function ExternalLogin({ config, onDone }: { config: WebConfig; onDone: () => void }) {
  const [error, setError] = useState('')
  if (!externalLoginShown(config) || !config.googleClientId) return null
  const login = async (idToken: string) => {
    setError('')
    await oauthLogin('google', idToken)
    onDone()
  }
  return (
    <div className="login-providers" aria-label="Вход через Google" role="group">
      <GoogleButton clientId={config.googleClientId} onToken={login} onError={setError} />
      {error && <p className="error" role="alert">{error}</p>}
      <p className="hint small">Google — после привязки в «Я → Мой профиль».</p>
    </div>
  )
}
