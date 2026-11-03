import { useEffect, useState } from 'react'

import type { Schemas } from '../api/client'
import { translator } from '../patient/i18n'
import { PlanView } from '../patient/PlanView'
import { getJson, postJson, useSiteLang } from './web'

type Plan = Schemas['PlanOffersPatientPlan']

/**
 * План лечения по ссылке из WhatsApp (V140): /plan#<секрет>. Секрет — во фрагменте: он не уходит ни
 * в журнал nginx, ни в Referer; данные — GET /web/plan/<секрет> (там журнал выключен). Имени пациента
 * на странице нет — пересланная ссылка ПДн не раскрывает. Неизвестный, истёкший или заменённый новым
 * план — одно и то же «не найден»: позвоните в клинику.
 */
export function PlanPage() {
  const token = window.location.hash.slice(1)
  const [lang, setLang] = useSiteLang()
  const t = translator(lang)
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token)
  const [plan, setPlan] = useState<Plan | null>(null)
  // Не похоже на секрет — сразу «не найден», без запроса
  const [state, setState] = useState<'loading' | 'ok' | 'gone' | 'offline'>(valid ? 'loading' : 'gone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!valid) return
    void getJson<Plan>(`/web/plan/${token}`).then(({ status, data }) => {
      setPlan(data)
      setState(data ? 'ok' : status === 0 ? 'offline' : 'gone')
    })
  }, [token, valid])

  const answer = async (kind: 'agree' | 'question') => {
    setBusy(true)
    setError(null)
    const { status, data } = await postJson<Plan>(`/web/plan/${token}/${kind}`, {})
    setBusy(false)
    if (data) setPlan(data)
    else setError(status === 404 ? t('planGone') : t('noConnection'))
  }

  return (
    <main className="site-page plan-page">
      <div className="lang-switch" role="group" aria-label="Тил / Язык">
        <button type="button" aria-pressed={lang === 'ru'} onClick={() => setLang('ru')}>Русский</button>
        <button type="button" aria-pressed={lang === 'ky'} onClick={() => setLang('ky')}>Кыргызча</button>
      </div>
      {state === 'loading' && <p className="hint">…</p>}
      {state === 'gone' && <p role="alert">{t('planGone')}</p>}
      {state === 'offline' && <p role="alert">{t('noConnection')}</p>}
      {plan && <PlanView plan={plan} t={t} busy={busy} error={error}
        onAgree={() => void answer('agree')} onAsk={() => void answer('question')} />}
    </main>
  )
}
