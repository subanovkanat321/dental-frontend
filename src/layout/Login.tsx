import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { botConfig, LOGGED_OUT } from '../api/client'
import { isLoginPath } from '../lib/route'
import { InstallHint } from '../pwa/InstallHint'
import { PhoneLogin } from './PhoneLogin'
import { Loading } from './Loading'

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
 * Страница входа на сайт: только номер телефона и пароль (кнопку «Войти через Telegram» убрали — сервер
 * отвечает на неё 410). Нет пароля — «Забыли пароль? / Первый вход»: код в Telegram (бот сотрудников)
 * или по SMS. В Telegram (Mini App) этой страницы нет: там вход сам, по initData.
 */
export function Login() {
  const client = useQueryClient()
  const bot = useQuery({ queryKey: ['bot-config'], queryFn: botConfig, staleTime: Infinity })
  const [loggedOut, setLoggedOut] = useState(justLoggedOut)
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
  return (
    <div className="center login">
      <div className="login-card">
      <img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="Тишка — талисман Tish" width={147} height={140} />
      {loggedOut && <LoggedOutHint onClose={() => setLoggedOut(false)} />}
      <h1>Вход для клиники</h1>
      <p className="hint">Врачи, регистратура и руководители — по номеру телефона и паролю.</p>
      {bot.isPending && <Loading />}
      {bot.isSuccess && !config && <p className="error">Вход сейчас недоступен: сервер не настроен или не отвечает. Обновите страницу через минуту.</p>}
      {config && (
        <PhoneLogin onDone={entered} sms={config.smsLogin} telegram={config.telegramCode} password={config.passwordLogin} />
      )}
      <InstallHint />
      <p className="hint small">В Telegram приложение открывается кнопкой «Открыть» в боте клиники — там пароль не нужен.</p>
      <p className="hint small">Пациенты записываются через бота в Telegram: <a href="/clinics">выбрать клинику</a></p>
      </div>
    </div>
  )
}
