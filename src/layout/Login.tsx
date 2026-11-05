import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { botConfig } from '../api/client'
import { isLoginPath } from '../lib/route'
import { InstallHint } from '../pwa/InstallHint'
import { PhoneLogin } from './PhoneLogin'

/**
 * «Войти через Telegram» на сайте: окно входа Telegram (Telegram.Login.auth из telegram-widget.js)
 * подписывает данные входа, сервер проверяет подпись (/web/login) и ставит cookie-сессию.
 * Своя кнопка вместо готового виджета: виджет — iframe и data-onauth, который Telegram выполняет
 * как код (eval), — политика источников (CSP) их не пускает, и кнопка пропадала. Окно входа —
 * отдельное окно Telegram, ответ приходит сообщением (postMessage). Скрипт — только здесь.
 */
/** Браузер внутри Instagram, Facebook и т. п.: окно входа Telegram там часто не открывается. */
function inAppBrowser(): boolean {
  return /Instagram|FBAN|FBAV|Line\/|TikTok|musical_ly/i.test(navigator.userAgent)
}

const WIDGET = 'https://telegram.org/js/telegram-widget.js?22'

/** Скрипт окна входа — один раз на страницу. */
function loadWidget(): Promise<void> {
  if (window.Telegram?.Login) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.async = true
    script.src = WIDGET
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('widget'))
    document.head.append(script)
  })
}

export function Login() {
  const client = useQueryClient()
  const bot = useQuery({ queryKey: ['bot-config'], queryFn: botConfig, staleTime: Infinity })
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Вход по номеру (пароль или SMS) — для сотрудников без Telegram (если сервер его включил)
  const [byPhone, setByPhone] = useState(false)
  const phoneLogin = Boolean(bot.data?.smsLogin || bot.data?.passwordLogin)
  useEffect(() => {
    if (!bot.data?.id) return
    loadWidget().then(() => setReady(true), () => setError('Не загрузилось окно входа Telegram — проверьте интернет и обновите страницу'))
  }, [bot.data?.id])

  const entered = () => {
    // Вошли — в CRM с чистым адресом (/login → /)
    if (isLoginPath() || window.location.search) window.history.replaceState(null, '', `/${window.location.hash}`)
    void client.invalidateQueries({ queryKey: ['me'] })
  }
  const send = async (user: Record<string, unknown>) => {
    setBusy(true)
    const response = await fetch('/web/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(user),
    }).catch(() => null)
    setBusy(false)
    if (response?.ok) {
      entered()
      return
    }
    const problem = await response?.json().catch(() => null) as { detail?: string } | null
    setError(response?.status === 403 ? problem?.detail || 'Нет доступа'
      : response ? 'Вход не удался — попробуйте ещё раз' : 'Нет связи с сервером')
  }
  const login = () => {
    setError('')
    // Окно открывается сразу по нажатию — иначе браузер его заблокирует
    window.Telegram?.Login?.auth({ bot_id: bot.data!.id!, request_access: 'write', lang: 'ru' }, (user) => {
      if (user) void send(user)
    })
  }
  return (
    <div className="center login">
      <div className="login-card">
      <img src={`${import.meta.env.BASE_URL}tishka.svg`} alt="Тишка — талисман Tish" width={147} height={140} />
      <h1>Вход для клиники</h1>
      <p className="hint">Врачи, регистратура и администраторы. {byPhone
        ? 'Номер — тот, что администратор указал в «Настройки → Персонал».'
        : 'Входите тем же Telegram, что привязан в «Настройки → Персонал».'}</p>
      {bot.isPending && <p className="hint">Загрузка…</p>}
      {bot.isSuccess && !bot.data?.id && !phoneLogin && <p className="error">Вход сейчас недоступен: бот не настроен или не отвечает. Обновите страницу через минуту.</p>}
      {(byPhone || bot.data?.id == null) && phoneLogin
        && <PhoneLogin onDone={entered} sms={bot.data?.smsLogin === true} password={bot.data?.passwordLogin === true} />}
      {!byPhone && bot.data?.id != null && (
        <button type="button" className="btn tg-login" disabled={!ready || busy} onClick={login}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M9.8 15.3 9.6 19c.4 0 .6-.2.8-.4l2-1.9 4.1 3c.8.4 1.3.2 1.5-.7l2.7-12.7c.3-1.1-.4-1.6-1.1-1.3L3.7 10.8c-1.1.4-1.1 1-.2 1.3l4.1 1.3 9.5-6c.4-.3.9-.1.5.2"/></svg>
          {busy ? 'Входим…' : 'Войти через Telegram'}
        </button>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {phoneLogin && bot.data?.id != null && (
        <button type="button" className="link" onClick={() => { setByPhone(!byPhone); setError('') }}>
          {byPhone ? 'Назад: вход через Telegram' : 'Нет Telegram? Войти по номеру телефона'}</button>
      )}
      <InstallHint />
      {!byPhone && inAppBrowser() && (
        <p className="tone-wait">Вы во встроенном браузере приложения (Instagram и т. п.) — вход через Telegram здесь может не открыться.
          Нажмите «⋯» вверху и выберите «Открыть в браузере».</p>
      )}
      {!byPhone && bot.data?.username && (
        <p className="hint">Окно не открылось или пишет «Bot domain invalid»? Войдите через бота:{' '}
          <a href={`https://t.me/${bot.data.username}`} target="_blank" rel="noopener noreferrer">@{bot.data.username}</a> → кнопка «Открыть» внизу чата.</p>
      )}
      <p className="hint small">Работать можно в Telegram и на сайте — с телефона и компьютера.</p>
      <p className="hint small">Пациенты записываются через бота в Telegram: <a href="/clinics">выбрать клинику</a></p>
      </div>
    </div>
  )
}
