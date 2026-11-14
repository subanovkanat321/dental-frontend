import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Select } from '../layout/Select'
import { HelpHint } from '../help/HelpHint'
import { ChairIcon } from './ChairBadge'
import { openClinic } from '../lib/route'
import { dayTitle, dateOf, timeOf } from '../lib/time'
import { chairOf, conflictsOf, overlapTexts, sharesText, useChairs } from './chairs'

type Me = Schemas['BookingViewsMe']

const NEW = 'new'

/**
 * «Кресло» в карточке врача (V185): несколько врачей с одним креслом не примут двух пациентов в одно
 * время — это проверяет сервер. Назначает руководитель: «— без кресла — / Кресло 1 / ＋ Новое кресло»
 * (то же — в «Клиника → Кресла»: кресло и его врачи).
 * Остальные видят, какое кресло и с кем оно общее. Если приёмы врачей уже пересекаются, сервер отвечает
 * 409 со списком — показываем его, чтобы руководитель перенёс.
 */
export function ChairField({ doctorId, me }: { doctorId: number; me: Me }) {
  const client = useQueryClient()
  const chairs = useChairs()
  const admin = Boolean(me.admin)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const nameOf = (id: number) => (me.doctors ?? []).find((d) => d.id === id)?.fullName ?? ''
  const current = chairOf(chairs.data, doctorId)
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['chairs'] })
    // Сетка свободного времени у соседей по креслу поменялась
    void client.invalidateQueries({ queryKey: ['slots'] })
  }
  const assign = useMutation<Schemas['ChairOverview'][], ApiError, number | null>({
    mutationFn: (chairId) => unwrap(api.PUT('/api/doctors/{id}/chair', { params: { path: { id: doctorId } }, body: { chairId: chairId ?? undefined } })),
    onSuccess: (list) => {
      client.setQueryData(['chairs'], list)
      refresh()
    },
  })
  const create = useMutation<Schemas['ChairsChair'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/chairs', { body: { name } })),
    onSuccess: (chair) => {
      setAdding(false)
      setName('')
      assign.mutate(chair.id)
    },
  })
  const pick = (value: string) => {
    assign.reset()
    if (value === NEW) {
      setAdding(true)
      return
    }
    setAdding(false)
    assign.mutate(value ? Number(value) : null)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate()
  }
  const shares = sharesText(current, doctorId, nameOf)

  return (
    <section className="form chair-field" aria-label="Кресло">
      <h4>Кресло <HelpHint title="Кресло">Двух пациентов в одно кресло на одно время не записать.
        {admin && <> Названия и правила кресел —{' '}
          <button type="button" className="link" onClick={() => openClinic('chairs')}>Клиника → Кресла</button>.</>}</HelpHint></h4>
      {admin ? (
        <label className="field"><span>Кресло врача</span>
          <Select value={adding ? NEW : current?.id ?? ''} disabled={assign.isPending || chairs.isPending} onChange={(e) => pick(e.target.value)}>
            <option value="">— без кресла —</option>
            {(chairs.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={NEW}>＋ Новое кресло</option>
          </Select>
        </label>
      ) : (
        <p>{current ? <span className="chair-badge"><ChairIcon /> {current.name}</span> : <span className="hint">Без кресла</span>}</p>
      )}
      {adding && (
        <form className="sub-form" aria-label="Новое кресло" onSubmit={submit}>
          <label className="field"><span>Название</span>
            <input value={name} required maxLength={40} autoFocus placeholder="Например: Кресло 1 или Кабинет 2"
              onChange={(e) => { create.reset(); setName(e.target.value) }} />
          </label>
          <div className="actions">
            <button type="submit" className="btn primary" disabled={create.isPending}>Добавить</button>
            <button type="button" className="btn ghost" onClick={() => setAdding(false)}>Отмена</button>
          </div>
          {create.error && <p className="error" role="alert">{create.error.fieldErrors.name ?? create.error.message}</p>}
        </form>
      )}
      {shares && <p className="hint">{current!.name} — {shares}</p>}
      {assign.error && <ChairAssignError error={assign.error} />}
    </section>
  )
}

/**
 * Ошибка назначения кресла: текст и, если приёмы врачей уже пересекаются (409 chair-conflicts), их список —
 * день, врачи и время, без пациентов. Один вид в карточке врача и в «Клиника → Кресла».
 */
export function ChairAssignError({ error }: { error: ApiError }) {
  const conflicts = error.code === 'chair-conflicts' ? conflictsOf(error.problem) : []
  return (
    <div className="error" role="alert">
      <p>{error.message}</p>
      {conflicts.length > 0 && (
        <ul className="chair-conflicts">
          {conflicts.map((c) => (
            <li key={`${c.startAt}-${c.otherStartAt}`}>
              {dayTitle(dateOf(c.startAt!))}: {c.doctorName} {timeOf(c.startAt!)}–{timeOf(c.endAt!)} и {c.otherDoctorName} {timeOf(c.otherStartAt!)}–{timeOf(c.otherEndAt!)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Подсказка под часами работы: часы пересекаются с соседями по креслу (не запрет). */
export function ChairHoursHint({ doctorId, me }: { doctorId: number; me: Me }) {
  const chairs = useChairs()
  const nameOf = (id: number) => (me.doctors ?? []).find((d) => d.id === id)?.fullName ?? ''
  const texts = overlapTexts(chairOf(chairs.data, doctorId), doctorId, nameOf)
  if (!texts.length) return null
  return (
    <p className="hint tone-wait" role="note" aria-label="Часы пересекаются">
      {texts.join('; ').replace(/^ч/, 'Ч')} — записи всё равно не пересекутся, но лучше развести.</p>
  )
}
