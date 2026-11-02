import { useState } from 'react'

import { telegram } from '../lib/telegram'
import { ShareIcon } from './InstallApp'
import { install, isIos, isMobile, isStandalone, usePwa } from './pwa'
import './pwa.css'

const DISMISSED = 'crm.installHintDismissed'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1'
  } catch {
    return false
  }
}

/** Подсказка на странице входа в браузере телефона: «установите Tish». Закрыли — больше не показываем. */
export function InstallHint() {
  const { prompt } = usePwa()
  const [hidden, setHidden] = useState(() => wasDismissed() || telegram() != null || isStandalone() || !isMobile())
  if (hidden) return null
  const close = () => {
    try {
      localStorage.setItem(DISMISSED, '1')
    } catch {
      // нет хранилища — просто скрыть
    }
    setHidden(true)
  }
  return (
    <div className="pwa-hint" role="note">
      <p><strong>📲 Tish на экране телефона</strong> — откроется как приложение.{' '}
        {prompt ? null : isIos()
          ? <>Safari: <ShareIcon /> Поделиться → На экран «Домой».</>
          : <>Chrome: меню ⋮ → «Установить приложение».</>}
      </p>
      {prompt && <button type="button" className="btn primary small" onClick={() => void install()}>Установить</button>}
      <button type="button" className="btn ghost small" aria-label="Скрыть подсказку" onClick={close}>✕</button>
    </div>
  )
}
