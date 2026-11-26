import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { LOGGED_OUT, loginConfig, WEB_CONFIG_KEY, webConfig } from '../api/client'
import { externalLoginShown } from '../lib/providers'
import { isLoginPath } from '../lib/route'
import { telegram } from '../lib/telegram'
import { InstallHint } from '../pwa/InstallHint'
import { PhoneLogin } from './PhoneLogin'
import { ExternalLogin } from './ExternalLogin'
import { Loading } from './Loading'
import { TelegramLogin } from './TelegramLogin'

/** Свёрнутая ссылка: запасные способы входа (Google, если подключён) — главное на странице только Telegram и пароль. */
export const OTHER_WAYS = 'Другие способы входа'

/** Строка под заголовком — видна на компьютере (на телефоне экран входа короткий, как был). */
export const LEAD = 'Tish бесплатный: запись пациентов, расписание, карты, касса и склад — для всей клиники, на компьютере и в Telegram.'

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
 * Страница входа на сайт — максимально просто (решение владельца 2026-11-25), всего две вещи:
 * <ol>
 * <li>большая кнопка «Войти через Telegram» — главный способ (ссылка в бота и «Подтвердить вход» там, на компьютере —
 * ещё и QR-код; TelegramLogin). В Telegram (Mini App) вход сам, по initData, — кнопки там нет;</li>
 * <li>под ней — компактная форма «Логин или телефон» + «Пароль» + «Войти» и ссылка «Забыли пароль?» (PhoneLogin).</li>
 * </ol>
 * Остальное — под свёрнутой ссылкой «Другие способы входа»: «Войти через Google» (только если владелец подключил,
 * ExternalLogin). Регистрация клиники — как раньше через Telegram (/join), здесь её нет.
 */
export function Login() {
  const client = useQueryClient()
  const bot = useQuery({ queryKey: WEB_CONFIG_KEY, queryFn: webConfig, staleTime: Infinity })
  const [loggedOut, setLoggedOut] = useState(justLoggedOut)
  /** Ждём «Подтвердить вход» в боте — форму пароля прячем, чтобы не путать. */
  const [tgWaiting, setTgWaiting] = useState(false)
  const onWaiting = useCallback((w: boolean) => setTgWaiting(w), [])
  const [others, setOthers] = useState(false)
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
  const config = loginConfig(bot.data)
  const viaTelegram = !!config?.telegramLogin && !telegram()
  const hasOthers = externalLoginShown(config)
  return (
    <div className="center login staff-login">
      <div className="login-card">
        {/* Компьютер (от 900px) — две колонки: слева Тишка и о Tish, справа Telegram и форма; телефон — одной колонкой, как был */}
        <div className="login-intro">
          <img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="Тишка — талисман Tish" width={147} height={140} />
          {loggedOut && <LoggedOutHint onClose={() => setLoggedOut(false)} />}
          <h1>Вход для клиники</h1>
          <p className="login-lead">{LEAD}</p>
          <a className="login-about" href="/about">Подробнее о Tish →</a>
        </div>
        <div className="login-main">
          {bot.isPending && <Loading />}
          {bot.isSuccess && !config && <p className="error">Вход сейчас недоступен: сервер не настроен или не отвечает. Обновите страницу через минуту.</p>}
          {viaTelegram && <TelegramLogin onDone={entered} onWaiting={onWaiting} />}
          {config && !tgWaiting && (
            <>
              {viaTelegram && <p className="login-or"><span>или логин и пароль</span></p>}
              <PhoneLogin onDone={entered} sms={config.smsLogin} telegram={config.telegramCode} password={config.passwordLogin}
                mail={config.mailCode} secondary={viaTelegram} />
              {hasOthers && !others && (
                <button type="button" className="link login-others" aria-expanded={false} onClick={() => setOthers(true)}>{OTHER_WAYS}</button>
              )}
              {hasOthers && others && (
                <div className="login-others-open" role="group" aria-label={OTHER_WAYS}>
                  <ExternalLogin config={config} onDone={entered} />
                </div>
              )}
            </>
          )}
          <InstallHint />
          <p className="hint small">Пациенты записываются через бота в Telegram: <a href="/clinics">выбрать клинику</a></p>
        </div>
      </div>
    </div>
  )
}
