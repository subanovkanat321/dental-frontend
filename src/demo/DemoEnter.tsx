import { useCallback, useEffect, useRef, useState } from 'react'

import { api, ApiError, unwrap } from '../api/client'
import { OFFER } from '../lib/brand'
import { DEMO_SIGNUP } from '../lib/demo'
import './demo.css'

type Role = 'OWNER' | 'RECEPTION' | 'DOCTOR'

/** /demo?as=reception — сразу нужной ролью; без параметра — руководитель и врач (видно всё). */
function roleFromUrl(search = window.location.search): Role {
  const as = new URLSearchParams(search).get('as')?.toLowerCase()
  return as === 'reception' ? 'RECEPTION' : as === 'doctor' ? 'DOCTOR' : 'OWNER'
}

/**
 * «Посмотреть демо»: вход гостем в вымышленную клинику на 2 часа (POST /web/demo/enter) и сразу — в CRM. Без
 * Telegram и номера. Не вышло (демо выключено, лимит входов) — понятный текст и «Начать бесплатно».
 */
export function DemoEnter() {
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)
  const enter = useCallback(async () => {
    setError(null)
    try {
      await unwrap(api.POST('/web/demo/enter', { body: { role: roleFromUrl() } }))
      window.location.replace('/')
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'Демо-клиника сейчас выключена — загляните позже.'
        : e instanceof Error && e.message ? e.message : 'Не получилось открыть демо — попробуйте ещё раз.')
    }
  }, [])
  useEffect(() => {
    // StrictMode зовёт эффект дважды — вход один
    if (started.current) return
    started.current = true
    void enter()
  }, [enter])
  return (
    <main className="demo-enter">
      <h1>Демо-клиника Tish</h1>
      {error ? (
        <>
          <p className="error" role="alert">{error}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={() => void enter()}>Попробовать ещё раз</button>
            <a className="btn primary" href={DEMO_SIGNUP}>{OFFER}</a>
          </div>
        </>
      ) : (
        <p className="hint" role="status">Открываем вымышленную клинику — нажимайте что угодно, ничего не сломаете…</p>
      )}
    </main>
  )
}
