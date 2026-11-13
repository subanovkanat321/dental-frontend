import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { Loading } from '../layout/Loading'
import { Select } from '../layout/Select'
import { EmptyState } from '../layout/EmptyState'
import { chairOf, useChairs, type Chair } from '../team/chairs'
import { ChairAssignError } from '../team/ChairField'
import { SubHeader } from './SubHeader'
import { SubHelp } from '../layout/PageHead'

type Me = Schemas['BookingViewsMe']
type Mode = NonNullable<Chair['mode']>

const MODES: [Mode, string, string][] = [
  ['WARN', 'Предупреждать', 'Запись в часы коллеги — после вопроса «Коллега предупреждён?»; коллеге придёт уведомление'],
  ['STRICT', 'Запрещать', 'В часы коллеги записать нельзя — пока он сам не поставит себе перерыв на это время'],
]

/** Кресла и подписи «🪑 время …» в расписании зависят от кресел — перечитать вместе. */
function useRefreshChairs() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: ['chairs'] })
    void client.invalidateQueries({ queryKey: ['slots'] })
  }
}

/**
 * «Клиника → Кресла» (V185, V187) — только руководитель (как PUT /api/chairs): «+ Добавить кресло» (название и
 * режим), у каждого кресла — название, его врачи (назначение то же, что в карточке врача: пересекаются приёмы —
 * 409 со списком), режим записи в часы коллеги и удаление (врачи остаются без кресла). Пациентам кресла не видны.
 */
export function ChairsPage({ me, onBack }: { me: Me; onBack: () => void }) {
  const chairs = useChairs()
  const [adding, setAdding] = useState(false)
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  return (
    <section className="schedule-main">
      {/* Что такое кресло — в «?» у названия, а не абзацем на три строки над списком */}
      <SubHeader title="Кресла" onBack={onBack}>
        <SubHelp title="Кресла">Кресло (кабинет) могут делить несколько врачей: двух пациентов в одно кресло на одно время не записать. Если сотрудник
          записывает пациента в рабочие часы коллеги по креслу — по режиму кресла сервер спросит «Коллега предупреждён?» или не даст записать.
          Кресло врача — его основное: при записи можно выбрать другое свободное (поле «Кресло»). Пациенты про кресла ничего не видят: если
          кресло врача занято, а другое свободно — запись сама встанет в свободное. Врачей кресла выбирают здесь или в карточке врача
          («Персонал» → врач → «Кресло»).</SubHelp>
        {!adding && <button type="button" className="btn primary head-end" onClick={() => setAdding(true)}>+ Добавить кресло</button>}
      </SubHeader>
      {adding && <NewChair onDone={() => setAdding(false)} />}
      {chairs.isPending ? <Loading />
        : chairs.error ? <p className="error" role="alert">{chairs.error.message}</p>
          : !chairs.data?.length ? (!adding && <EmptyState title="Кресел пока нет">Врачи, которые делят кресло, не примут двух пациентов в одно время.
            Добавьте кресло и выберите его врачей.</EmptyState>)
            : (
              <>
                <Unseated chairs={chairs.data} doctors={doctors} />
                {chairs.data.map((c) => <ChairRow key={c.id} chair={c} chairs={chairs.data} doctors={doctors} />)}
              </>
            )}
    </section>
  )
}

/**
 * «Без кресла: Нурболот — назначить ›» (V210): у врача без кресла запрет «два пациента в одно кресло» не действует,
 * и выбрать ему свободное кресло при записи не из чего сравнить. Подсказка — по строке на врача; первым в списке —
 * кресло, где меньше всего врачей (простое распределение).
 */
function Unseated({ chairs, doctors }: { chairs: Chair[]; doctors: Schemas['DoctorView'][] }) {
  const client = useQueryClient()
  const refresh = useRefreshChairs()
  const free = doctors.filter((d) => !chairOf(chairs, d.id))
  const assign = useMutation<Schemas['ChairOverview'][], ApiError, { doctorId: number; chairId: number }>({
    mutationFn: ({ doctorId, chairId }) => unwrap(api.PUT('/api/doctors/{id}/chair', { params: { path: { id: doctorId } }, body: { chairId } })),
    onSuccess: (list) => {
      client.setQueryData(['chairs'], list)
      refresh()
    },
  })
  if (!free.length) return null
  const nameOf = (id: number) => doctors.find((d) => d.id === id)?.fullName ?? ''
  const byLoad = [...chairs].sort((a, b) => (a.doctorIds?.length ?? 0) - (b.doctorIds?.length ?? 0))
  return (
    <section className="card-block chair-unseated" aria-label="Врачи без кресла">
      <p className="hint">Кресло врача — его основное; при записи можно выбрать и другое свободное.</p>
      <ul className="chair-unseated-list">
        {free.map((d) => (
          <li key={d.id}>
            <span>Без кресла: <strong>{d.fullName}</strong></span>
            <Select aria-label={`Назначить кресло: ${d.fullName}`} value="" disabled={assign.isPending}
              onChange={(e) => { assign.reset(); if (e.target.value) assign.mutate({ doctorId: d.id, chairId: Number(e.target.value) }) }}>
              <option value="">назначить ›</option>
              {byLoad.map((c) => {
                const who = (c.doctorIds ?? []).map(nameOf).filter(Boolean)
                return <option key={c.id} value={c.id}>{c.name}{who.length ? ` (${who.join(', ')})` : ' (пустое)'}</option>
              })}
            </Select>
          </li>
        ))}
      </ul>
      {assign.error && <ChairAssignError error={assign.error} />}
    </section>
  )
}

/** «+ Добавить кресло»: название и режим; врачей — потом, в строке кресла. */
function NewChair({ onDone }: { onDone: () => void }) {
  const refresh = useRefreshChairs()
  const [name, setName] = useState('')
  const [mode, setMode] = useState<Mode>('WARN')
  const create = useMutation<Schemas['ChairsChair'], ApiError>({
    mutationFn: async () => {
      const chair = await unwrap(api.POST('/api/chairs', { body: { name } }))
      return mode === 'WARN' ? chair : unwrap(api.PUT('/api/chairs/{id}/mode', { params: { path: { id: chair.id } }, body: { mode } }))
    },
    onSuccess: () => {
      refresh()
      onDone()
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate()
  }
  return (
    <form className="card-block form chair-item" aria-label="Новое кресло" onSubmit={submit}>
      <h2>Новое кресло</h2>
      <label className="field"><span>Название</span>
        <input value={name} required maxLength={40} autoFocus placeholder="Например: Кресло 1 или Кабинет 2"
          onChange={(e) => { create.reset(); setName(e.target.value) }} />
      </label>
      <fieldset className="chair-mode">
        <legend>В рабочие часы коллеги по креслу</legend>
        {MODES.map(([value, title, hint]) => (
          <label key={value} className="check">
            <input type="radio" name="chair-mode-new" value={value} checked={mode === value} onChange={() => setMode(value)} />
            <span><strong>{title}</strong><span className="hint"> — {hint}</span></span>
          </label>
        ))}
      </fieldset>
      {create.error && <p className="error" role="alert">{create.error.fieldErrors.name ?? create.error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={create.isPending || !name.trim()}>Добавить</button>
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
      </div>
    </form>
  )
}

function ChairRow({ chair, chairs, doctors }: { chair: Chair; chairs: Chair[]; doctors: Schemas['DoctorView'][] }) {
  const client = useQueryClient()
  const refresh = useRefreshChairs()
  const [name, setName] = useState(chair.name ?? '')
  const nameOf = (id: number) => doctors.find((d) => d.id === id)?.fullName ?? ''
  const seated = (chair.doctorIds ?? []).filter((id) => nameOf(id))
  const rename = useMutation<Schemas['ChairsChair'], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/chairs/{id}', { params: { path: { id: chair.id } }, body: { name } })),
    onSuccess: refresh,
  })
  const mode = useMutation<Schemas['ChairsChair'], ApiError, Mode>({
    mutationFn: (value) => unwrap(api.PUT('/api/chairs/{id}/mode', { params: { path: { id: chair.id } }, body: { mode: value } })),
    onSuccess: refresh,
  })
  // Врач на кресло или с кресла — то же назначение, что в карточке врача (пересечения приёмов — 409 со списком)
  const assign = useMutation<Schemas['ChairOverview'][], ApiError, { doctorId: number; chairId: number | null }>({
    mutationFn: ({ doctorId, chairId }) => unwrap(api.PUT('/api/doctors/{id}/chair', { params: { path: { id: doctorId } }, body: { chairId: chairId ?? undefined } })),
    onSuccess: (list) => {
      client.setQueryData(['chairs'], list)
      refresh()
    },
  })
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/chairs/{id}', { params: { path: { id: chair.id } } })),
    onSuccess: refresh,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    rename.mutate()
  }
  const current = mode.isPending ? mode.variables : chair.mode ?? 'WARN'
  const error = rename.error ?? mode.error ?? remove.error
  const others = doctors.filter((d) => !seated.includes(d.id))
  const removeText = seated.length
    ? `Удалить кресло «${chair.name}»? Врачи останутся без кресла: ${seated.map(nameOf).join(', ')} — их записи и часы не изменятся, но запрет «два пациента в одно кресло» перестанет действовать.`
    : `Удалить кресло «${chair.name}»?`
  return (
    <section className="card-block chair-item" aria-label={chair.name}>
      <form className="chair-name" aria-label={`Название: ${chair.name}`} onSubmit={submit}>
        <label className="field"><span>Название</span>
          <input value={name} required maxLength={40} onChange={(e) => { rename.reset(); setName(e.target.value) }} />
        </label>
        {name.trim() !== chair.name && <button type="submit" className="btn primary" disabled={rename.isPending || !name.trim()}>Сохранить</button>}
      </form>
      <div className="field chair-doctors"><span>Врачи на кресле</span>
        {seated.length ? (
          <ul className="chair-doctor-list" aria-label={`Врачи: ${chair.name}`}>
            {seated.map((id) => (
              <li key={id} className="chip">🪑 {nameOf(id)}
                <button type="button" className="link" aria-label={`Снять с кресла: ${nameOf(id)}`} disabled={assign.isPending}
                  onClick={() => { assign.reset(); assign.mutate({ doctorId: id, chairId: null }) }}>✕</button>
              </li>
            ))}
          </ul>
        ) : <span className="hint">Пустое — ни у одного врача</span>}
        {others.length > 0 && (
          <Select aria-label={`Добавить врача: ${chair.name}`} value="" disabled={assign.isPending}
            onChange={(e) => { assign.reset(); if (e.target.value) assign.mutate({ doctorId: Number(e.target.value), chairId: chair.id }) }}>
            <option value="">＋ Врач на это кресло</option>
            {others.map((d) => {
              const now = chairOf(chairs, d.id)
              return <option key={d.id} value={d.id}>{d.fullName}{now ? ` (сейчас: ${now.name})` : ''}</option>
            })}
          </Select>
        )}
      </div>
      {assign.error && <ChairAssignError error={assign.error} />}
      <fieldset className="chair-mode">
        <legend>В рабочие часы коллеги по креслу</legend>
        {MODES.map(([value, title, hint]) => (
          <label key={value} className="check">
            <input type="radio" name={`chair-mode-${chair.id}`} value={value} checked={current === value} disabled={mode.isPending}
              onChange={() => mode.mutate(value)} />
            <span><strong>{title}</strong><span className="hint"> — {hint}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="actions">
        <button type="button" className="btn danger ghost" disabled={remove.isPending}
          onClick={() => void ask(removeText, seated.length ? { ok: 'Удалить кресло', danger: true } : {}).then((ok) => ok && remove.mutate())}>Удалить кресло</button>
      </div>
      {error && <p className="error" role="alert">{error.fieldErrors.name ?? error.message}</p>}
    </section>
  )
}
