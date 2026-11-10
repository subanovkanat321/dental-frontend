import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap } from '../api/client'
import { openMine } from '../lib/route'

const HIDDEN = 'crm.password-notice.hidden'

function readHidden(): boolean {
  try {
    return sessionStorage.getItem(HIDDEN) === '1'
  } catch {
    return false
  }
}

/**
 * «Чтобы входить без Telegram, задайте пароль» — сотруднику с Telegram без пароля (в том числе сразу после
 * «Войти через Telegram» на сайте): с паролем можно входить и без телефона под рукой. «Задать» ведёт в «Изменить профиль»: там телефон
 * («Подтвердить через Telegram») и «Пароль и вход». Скрыть ✕ — до конца сеанса (sessionStorage, без
 * личных данных). Задали пароль — баннер пропадает сам (тот же запрос, что у «Пароль и вход»).
 */
export function PasswordNotice() {
  const state = useQuery({ queryKey: ['me-password'], queryFn: () => unwrap(api.GET('/api/me/password')), staleTime: 10 * 60_000 })
  const [hidden, setHidden] = useState(readHidden)
  const s = state.data
  if (!s || !s.telegram || s.passwordSet || hidden) return null
  const hide = () => {
    setHidden(true)
    try {
      sessionStorage.setItem(HIDDEN, '1')
    } catch {
      // приватный режим — скрыто до перезагрузки
    }
  }
  return (
    <div className="notices" role="status">
      <div className="notice tone-wait">
        <span className="notice-ico" aria-hidden="true">i</span>
        <button type="button" className="notice-text" onClick={() => openMine('me', 'profile')}>
          Чтобы входить без Telegram, задайте пароль в «Моём профиле».{' '}
          <span className="notice-open" aria-hidden="true">Задать ›</span>
        </button>
        <button type="button" className="notice-close" aria-label="Скрыть до конца сеанса" title="Скрыть до конца сеанса" onClick={hide}>✕</button>
      </div>
    </div>
  )
}
