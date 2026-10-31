import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { botUsername } from '../api/client'

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void
  }
}

/**
 * «Войти через Telegram» на сайте: виджет Telegram подписывает данные входа, сервер проверяет
 * подпись (/web/login) и ставит cookie-сессию. Скрипт виджета — только здесь: в Mini App не нужен.
 */
export function Login() {
  const client = useQueryClient()
  const bot = useQuery({ queryKey: ['bot-username'], queryFn: botUsername, staleTime: Infinity })
  const box = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!bot.data || !box.current) return
    window.onTelegramAuth = async (user) => {
      setError('')
      const response = await fetch('/web/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(user),
      }).catch(() => null)
      if (response?.ok) {
        // Вошли — в CRM с чистым адресом (/login → /)
        if (window.location.pathname === '/login') window.history.replaceState(null, '', '/')
        void client.invalidateQueries({ queryKey: ['me'] })
        return
      }
      const problem = await response?.json().catch(() => null) as { detail?: string } | null
      setError(response?.status === 403 ? problem?.detail || 'Нет доступа'
        : response ? 'Вход не удался — попробуйте ещё раз' : 'Нет связи с сервером')
    }
    const script = document.createElement('script')
    script.async = true
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.dataset.telegramLogin = bot.data
    script.dataset.size = 'large'
    script.dataset.radius = '10'
    script.dataset.onauth = 'onTelegramAuth(user)'
    script.dataset.requestAccess = 'write'
    const target = box.current
    target.replaceChildren(script)
    return () => {
      target.replaceChildren()
      delete window.onTelegramAuth
    }
  }, [bot.data, client])
  return (
    <div className="center login">
      <img src={`${import.meta.env.BASE_URL}tooth.svg`} alt="" width={64} height={64} />
      <h1>Вход для клиники</h1>
      <p className="hint">Врачи, регистратура и администраторы. Входите тем же Telegram, что привязан в «Команда → Врачи».</p>
      {bot.isPending && <p className="hint">Загрузка…</p>}
      {bot.isSuccess && !bot.data && <p className="error">Вход сейчас недоступен: бот не настроен или не отвечает. Обновите страницу через минуту.</p>}
      <div ref={box} className="login-widget" aria-label="Войти через Telegram" />
      {error && <p className="error" role="alert">{error}</p>}
      <p className="hint small">Пациенты записываются через бота в Telegram: <a href="/clinics">выбрать клинику</a></p>
    </div>
  )
}
