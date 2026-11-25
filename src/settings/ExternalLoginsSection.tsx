import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, WEB_CONFIG_KEY, webConfig, type Schemas } from '../api/client'
import { HelpHint } from '../help/HelpHint'
import { AppleButton, GoogleButton } from '../layout/ProviderButtons'
import { ask, notify } from '../lib/confirm'
import { PROVIDER_TITLE, type Provider } from '../lib/providers'
import { telegram } from '../lib/telegram'
import { shortDate } from '../lib/time'

type Identity = Schemas['ExternalLoginControllerIdentityView']

const IDENTITIES_KEY = ['me-identities'] as const

const HINT = 'Привяжите свой аккаунт — и на странице входа хватит одной кнопки «Войти через Google» или «Войти через Apple», '
  + 'без пароля. Аккаунт привязывается только к вам; по почте Tish никого не пускает. Отвязать можно в любой момент — '
  + 'входы через него на всех устройствах сразу закроются.'

/**
 * «Вход через Google и Apple» в «Моём профиле» (ADR 0008 бэкенда): «Привязать Google», «Привязать Apple», «Отвязать».
 * Блока нет, если владелец ни одного не подключил, и внутри Telegram (окна провайдеров там не работают — привязать
 * можно в браузере). Почта привязанного аккаунта — только на экране, не в консоли и не в localStorage.
 */
export function ExternalLoginsSection() {
  const inTelegram = Boolean(telegram())
  const list = useQuery({ queryKey: IDENTITIES_KEY, queryFn: () => unwrap(api.GET('/api/me/identities')), enabled: !inTelegram })
  const config = useQuery({ queryKey: WEB_CONFIG_KEY, queryFn: webConfig, staleTime: Infinity, enabled: !inTelegram })
  if (inTelegram || !list.data?.length) return null
  return (
    <section className="settings-group" aria-label="Вход через Google и Apple">
      <h2>Вход через Google и Apple</h2>
      <div className="card-block provider-card">
        <p className="hint">Быстрый вход на сайте без пароля{' '}<HelpHint title="Вход через Google и Apple">{HINT}</HelpHint></p>
        {list.data.map((identity) => (
          <IdentityRow key={identity.provider} identity={identity}
            clientId={identity.provider === 'google' ? config.data?.googleClientId : config.data?.appleClientId} />
        ))}
      </div>
    </section>
  )
}

function IdentityRow({ identity, clientId }: { identity: Identity; clientId: string | null | undefined }) {
  const client = useQueryClient()
  const provider = identity.provider as Provider
  const title = PROVIDER_TITLE[provider]
  const [error, setError] = useState('')
  const [linking, setLinking] = useState(false)
  const unlink = useMutation<Identity[], ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/me/identities/{provider}', { params: { path: { provider } } })),
    onSuccess: (r) => client.setQueryData(IDENTITIES_KEY, r),
  })
  const link = async (idToken: string) => {
    setError('')
    try {
      const r = await unwrap(api.POST('/api/me/identities/{provider}', { params: { path: { provider } }, body: { idToken } }))
      client.setQueryData(IDENTITIES_KEY, r)
      setLinking(false)
      void notify(`${title} привязан. Теперь на странице входа можно нажать «Войти через ${title}».`)
    } catch (e) {
      throw e instanceof ApiError ? new Error(e.fieldErrors.idToken ?? e.message) : e
    }
  }
  return (
    <div className="setting-line provider-line">
      <div className="setting-what">
        <p><b>{title}</b></p>
        <p className="hint setting-sub">
          {identity.linked
            ? <>Привязан{identity.email ? <>: {identity.email}</> : null}{identity.lastLoginAt ? ` · последний вход ${shortDate(identity.lastLoginAt, true)}` : ''}</>
            : 'Не привязан'}
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        {unlink.error && <p className="error" role="alert">{unlink.error.message}</p>}
      </div>
      <div className="setting-actions">
        {identity.linked ? (
          <button type="button" className="btn" disabled={unlink.isPending}
            onClick={() => void ask(`Отвязать ${title}? Входы через него на всех устройствах закроются, войти можно будет как обычно.`)
              .then((ok) => ok && unlink.mutate())}>Отвязать</button>
        ) : !identity.available || !clientId ? null : !linking ? (
          <button type="button" className="btn" onClick={() => setLinking(true)}>Привязать {title}</button>
        ) : provider === 'google' ? (
          <GoogleButton clientId={clientId} text="continue_with" onToken={link} onError={setError} />
        ) : (
          <AppleButton clientId={clientId} label="Продолжить с Apple" onToken={link} onError={setError} />
        )}
      </div>
    </div>
  )
}
