import { useState } from 'react'

import { oauthLogin, type WebConfig } from '../api/client'
import { externalLoginShown } from '../lib/providers'
import { AppleButton, GoogleButton } from './ProviderButtons'

/**
 * «Войти через Google» и «Войти через Apple» на странице входа (ADR 0008 бэкенда). Только для тех, кто привязал аккаунт
 * в «Я → Мой профиль»: не привязан — сервер отвечает текстом, где привязать, его и показываем. Внутри Telegram кнопок
 * нет (externalLoginShown): там вход сам, а окна Google и Apple во встроенном браузере не работают.
 */
export function ExternalLogin({ config, onDone }: { config: WebConfig; onDone: () => void }) {
  const [error, setError] = useState('')
  if (!externalLoginShown(config)) return null
  const login = (provider: 'google' | 'apple') => async (idToken: string) => {
    setError('')
    await oauthLogin(provider, idToken)
    onDone()
  }
  return (
    <div className="login-providers" aria-label="Вход через Google или Apple" role="group">
      {config.googleClientId && <GoogleButton clientId={config.googleClientId} onToken={login('google')} onError={setError} />}
      {config.appleClientId && <AppleButton clientId={config.appleClientId} onToken={login('apple')} onError={setError} />}
      {error && <p className="error" role="alert">{error}</p>}
      <p className="hint small">Google и Apple — после привязки в «Я → Мой профиль».</p>
    </div>
  )
}
