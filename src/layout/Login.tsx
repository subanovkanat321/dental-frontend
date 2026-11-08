import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { botConfig, LOGGED_OUT } from '../api/client'
import { isLoginPath } from '../lib/route'
import { telegram } from '../lib/telegram'
import { InstallHint } from '../pwa/InstallHint'
import { PhoneLogin } from './PhoneLogin'
import { Loading } from './Loading'
import { TelegramLogin } from './TelegramLogin'

/** Только что нажали «Выйти» в этой вкладке? Флаг читаем при открытии экрана, стираем после показа. */
function justLoggedOut(): boolean {
  try {
    return sessionStorage.getItem(LOGGED_OUT) === '1'
  } catch {
    return false
  }
}

/** Подсказка сразу после «Выйти»: вход закрыт; на общем компьютере — не сохранять пароль в браузере. */
function LoggedOutHint({ onClose }: { onClose: () => void }) {
  return (
    <div className="card-block logged-out" role="status">
      <p><strong>Вы вышли из Tish.</strong> Это общий компьютер?</p>
      <p>Не сохраняйте пароль в браузере, а если сохранили — удалите его в настройках браузера («Пароли»).</p>
      <p className="hint">Или входите в режиме инкогнито: браузер ничего не запомнит.</p>
      <button type="button" className="link" onClick={onClose}>Понятно</button>
    </div>
  )
}

/**
 * Страница входа на сайт: номер телефона и пароль или «Войти через Telegram» — ссылка в бота и «Подтвердить
 * вход» там (TelegramLogin; прежний Telegram Login Widget убран — сервер отвечает на него 410). Нет пароля —
 * «Забыли пароль? / Первый вход»: код в Telegram (бот сотрудников) или по SMS. В Telegram (Mini App) вход сам,
 * по initData — кнопку «Войти через Telegram» там не показываем.
 */
export function Login() {
  const client = useQueryClient()
  const bot = useQuery({ queryKey: ['bot-config'], queryFn: botConfig, staleTime: Infinity })
  const [loggedOut, setLoggedOut] = useState(justLoggedOut)
  /** Ждём «Подтвердить вход» в боте — форму номера и пароля прячем, чтобы не путать. */
  const [tgWaiting, setTgWaiting] = useState(false)
  const onWaiting = useCallback((w: boolean) => setTgWaiting(w), [])
  // Показали один раз: обновили страницу или вошли снова — подсказки уже нет
  useEffect(() => {
    try {
      sessionStorage.removeItem(LOGGED_OUT)
    } catch {
      // хранилище закрыто — нечего стирать
    }
  }, [])

  const entered = () => {
    // Вошли — в CRM с чистым адресом (/login → /)
    if (isLoginPath() || window.location.search) window.history.replaceState(null, '', `/${window.location.hash}`)
    void client.invalidateQueries({ queryKey: ['me'] })
  }
  const config = bot.data
  const viaTelegram = !!config?.telegramLogin && !telegram()
  return (
    <div className="center login">
      <div className="login-card">
      <img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="Тишка — талисман Tish" width={147} height={140} />
      {loggedOut && <LoggedOutHint onClose={() => setLoggedOut(false)} />}
      <h1>Вход для клиники</h1>
      <p className="hint">Врачи, регистратура и руководители — по номеру телефона и паролю{viaTelegram ? ' или через Telegram' : ''}.</p>
      {bot.isPending && <Loading />}
      {bot.isSuccess && !config && <p className="error">Вход сейчас недоступен: сервер не настроен или не отвечает. Обновите страницу через минуту.</p>}
      {config && !tgWaiting && (
        <PhoneLogin onDone={entered} sms={config.smsLogin} telegram={config.telegramCode} password={config.passwordLogin} />
      )}
      {viaTelegram && <TelegramLogin onDone={entered} onWaiting={onWaiting} />}
      <InstallHint />
      <p className="hint small">В Telegram приложение открывается кнопкой «Открыть» в боте клиники — там пароль не нужен.</p>
      <p className="hint small">📲 <a href="/app">Скачать Tish на телефон или компьютер</a> — как приложение, со своим значком</p>
      <p className="hint small">Пациенты записываются через бота в Telegram: <a href="/clinics">выбрать клинику</a></p>
      </div>
    </div>
  )
}
