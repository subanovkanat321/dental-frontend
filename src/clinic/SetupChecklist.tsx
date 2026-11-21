import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { isDemoSession } from '../lib/demo'
import { openSettings } from '../lib/route'
import { clinicRequest } from '../settings/clinicUpdate'
import { SETUP_HINT_CLOSED, useSetupSteps, type Step } from './setupSteps'

type Me = Schemas['BookingViewsMe']

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="setup-steps">
      {steps.map((s) => (
        <li key={s.key} className={s.done ? 'done' : s.optional ? 'optional' : 'todo'}>
          <span className="setup-mark" aria-label={s.done ? 'готово' : s.optional ? 'по желанию' : 'не сделано'}>{s.done ? '✓' : s.optional ? '+' : '✗'}</span>
          <button type="button" className="link" onClick={s.open}>{s.title}</button>
          <span className="hint"> — {s.hint}</span>
        </li>
      ))}
    </ol>
  )
}

function readClosed(): boolean {
  try {
    return localStorage.getItem(SETUP_HINT_CLOSED) === '1'
  } catch {
    return false
  }
}

/**
 * Над расписанием — одна сворачиваемая строка «Что настроить · 2 из 5» вместо большого блока: расписание видно
 * сразу, и на телефоне. Раскрыть — пункты ссылками; ✕ — больше не показывать на этом устройстве. Всё сделано —
 * строки нет. Клинике с платформы, ещё не показанной пациентам, — пункт «Показать пациентам» (в «О клинике»).
 */
export function SetupHint({ me }: { me: Me }) {
  const { shown, steps, done } = useSetupSteps(me)
  const [closed, setClosed] = useState(readClosed)
  const settingUp = Boolean(me.clinic?.settingUp)
  if (isDemoSession() || !shown || closed || (done === steps.length && !settingUp)) return null
  const close = () => {
    try {
      localStorage.setItem(SETUP_HINT_CLOSED, '1')
    } catch {
      // нет хранилища — просто скрыть до перезагрузки
    }
    setClosed(true)
  }
  return (
    <div className="setup-hint" role="region" aria-label="Что настроить">
      <details>
        <summary>Что настроить · {done} из {steps.length}{settingUp && <span className="tone-wait"> · клиника не видна пациентам</span>}</summary>
        <Steps steps={steps} />
        {settingUp && <p className="hint">Клиника пока не видна пациентам — <button type="button" className="link" onClick={() => openSettings('about')}>«О клинике» → «Показать пациентам»</button>.</p>}
        <p className="hint">Пациенты и цены в таблице? <button type="button" className="link" onClick={() => openSettings('data')}>Загрузить из Excel</button></p>
      </details>
      <button type="button" className="btn ghost small" aria-label="Скрыть «Что настроить»" onClick={close}>✕</button>
    </div>
  )
}

/**
 * «О клинике» — «Что настроить» списком (пока не всё сделано) и, у клиники с платформы, которую ещё не показали
 * пациентам (V95), — кнопка «Показать пациентам» (без работающего врача выключена: записаться не к кому).
 */
export function SetupChecklist({ me }: { me: Me }) {
  const client = useQueryClient()
  const { shown, steps, done, clinic, doctors } = useSetupSteps(me)
  const settingUp = Boolean(me.clinic?.settingUp)
  const open = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/clinic', { body: clinicRequest(clinic.data!, { listed: true }) })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['clinic'] })
      void client.invalidateQueries({ queryKey: ['me'] })
    },
  })
  // Гостю демо-клиники настраивать нечего — клиника уже заполнена и каждую ночь перезаливается
  if (isDemoSession() || !shown || (done === steps.length && !settingUp)) return null
  const error = open.error ? Object.values(open.error.fieldErrors)[0] ?? open.error.message : null
  return (
    <section className="card-block setup-checklist" aria-label="Настройка клиники">
      <h2>{settingUp ? 'Клиника пока не видна пациентам' : 'Что настроить'}</h2>
      {settingUp && <p className="hint">Нажмите «Показать пациентам» — клиника появится в каталоге и в боте, по ссылке клиники можно будет записаться.</p>}
      <Steps steps={steps} />
      {settingUp && (
        <p>
          <button type="button" className="btn primary" disabled={!doctors || !clinic.data || open.isPending} onClick={() => open.mutate()}>
            Показать пациентам
          </button>
          {!doctors && <span className="hint"> — сначала добавьте врача</span>}
        </p>
      )}
      <p className="hint">Ссылка для пациентов: «О клинике» → «Страница для Instagram» → «Скопировать» (Instagram, 2ГИС, WhatsApp).</p>
      <p className="hint">Пациенты и цены уже в таблице?{' '}
        <button type="button" className="link" onClick={() => openSettings('data')}>Загрузить из Excel</button> — перенесём без ручного ввода.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  )
}
