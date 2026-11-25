import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { OFFER } from '../lib/brand'
import { DEMO_SIGNUP, isDemoSession } from '../lib/demo'
import './demo.css'

type Role = Schemas['DemoControllerSession']['role']

/**
 * Плашка на каждом экране демо: «вымышленные данные», «Начать бесплатно →», «Смотреть как» (руководитель /
 * регистратура / врач) и «Выйти из демо». Вне демо (нет метки tish_demo) — ничего и ни одного запроса.
 */
export function DemoBanner() {
  const [demo] = useState(isDemoSession)
  if (!demo) return null
  return <Banner />
}

function Banner() {
  const session = useQuery({ queryKey: ['demo-session'], queryFn: () => unwrap(api.GET('/api/demo/session')), staleTime: Infinity, retry: false })
  const [busy, setBusy] = useState(false)
  const switchTo = async (role: Role) => {
    setBusy(true)
    try {
      await unwrap(api.POST('/api/demo/role', { body: { role } }))
      window.location.reload()
    } catch {
      setBusy(false)
    }
  }
  const exit = async () => {
    setBusy(true)
    await globalThis.fetch(new Request(new URL('/web/logout', window.location.origin), {
      method: 'POST', credentials: 'same-origin', headers: { 'X-Dental-Web': '1' },
    })).catch(() => null)
    window.location.replace('/about')
  }
  const s = session.data
  return (
    <div className="demo-banner" role="note" aria-label="Демо-клиника">
      <span className="demo-banner-text">
        Это демо-клиника с вымышленными данными · <a className="demo-banner-cta" href={DEMO_SIGNUP}>{OFFER} →</a>
      </span>
      <span className="demo-banner-tools">
        {s && (
          <label>
            <span>Смотреть как</span>
            <select aria-label="Смотреть как" value={s.role} disabled={busy} onChange={(e) => void switchTo(e.target.value as Role)}>
              {s.roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="btn ghost small" disabled={busy} onClick={() => void exit()}>Выйти из демо</button>
      </span>
    </div>
  )
}
