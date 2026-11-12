import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { Loading } from '../layout/Loading'
import { useChairs, type Chair } from '../team/chairs'
import { SubHeader } from './SubHeader'
import { HelpHint } from '../help/HelpHint'

type Me = Schemas['BookingViewsMe']
type Mode = NonNullable<Chair['mode']>

const MODES: [Mode, string, string][] = [
  ['WARN', 'Предупреждать', 'Запись в часы коллеги — после вопроса «Коллега предупреждён?»; коллеге придёт уведомление'],
  ['STRICT', 'Запрещать', 'В часы коллеги записать нельзя — пока он сам не поставит себе перерыв на это время'],
]

/**
 * «Кресла» (V185, V187) — только руководитель (как PUT /api/chairs): список кресел клиники, переименовать, режим
 * записи в часы коллеги по креслу («Предупреждать» / «Запрещать») и удалить пустое. Кресло врачу назначают в его
 * карточке («Персонал» → врач → «Кресло»).
 */
export function ChairsPage({ me, onBack }: { me: Me; onBack: () => void }) {
  const chairs = useChairs()
  const nameOf = (id: number) => (me.doctors ?? []).find((d) => d.id === id)?.fullName ?? ''
  return (
    <section className="schedule-main">
      {/* Что такое кресло — в «?» у названия, а не абзацем на три строки над списком */}
      <SubHeader title="Кресла" onBack={onBack}>
        <HelpHint title="Кресла">Кресло (кабинет) могут делить несколько врачей: двух пациентов в одно кресло на одно время не записать. Если сотрудник
          записывает пациента в рабочие часы коллеги по креслу — по режиму кресла сервер спросит «Коллега предупреждён?» или не даст записать.
          Пациенты про кресла ничего не видят: в чужие часы они не записываются. Кресло врачу — в «Персонал» → врач → «Кресло».</HelpHint>
      </SubHeader>
      {chairs.isPending ? <Loading />
        : chairs.error ? <p className="error" role="alert">{chairs.error.message}</p>
          : !chairs.data?.length ? <p className="hint">Кресел пока нет — заведите первое в карточке врача («Персонал» → врач → «Кресло» → «＋ Новое кресло»).</p>
            : chairs.data.map((c) => <ChairRow key={c.id} chair={c} nameOf={nameOf} />)}
    </section>
  )
}

function ChairRow({ chair, nameOf }: { chair: Chair; nameOf: (id: number) => string }) {
  const client = useQueryClient()
  const [name, setName] = useState(chair.name ?? '')
  const doctors = (chair.doctorIds ?? []).map(nameOf).filter(Boolean)
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['chairs'] })
    // Подписи «🪑 время …» и сетка в расписании зависят от кресел
    void client.invalidateQueries({ queryKey: ['slots'] })
  }
  const rename = useMutation<Schemas['ChairsChair'], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/chairs/{id}', { params: { path: { id: chair.id } }, body: { name } })),
    onSuccess: refresh,
  })
  const mode = useMutation<Schemas['ChairsChair'], ApiError, Mode>({
    mutationFn: (value) => unwrap(api.PUT('/api/chairs/{id}/mode', { params: { path: { id: chair.id } }, body: { mode: value } })),
    onSuccess: refresh,
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
  return (
    <section className="card-block chair-item" aria-label={chair.name}>
      <form className="chair-name" aria-label={`Название: ${chair.name}`} onSubmit={submit}>
        <label className="field"><span>Название</span>
          <input value={name} required maxLength={40} onChange={(e) => { rename.reset(); setName(e.target.value) }} />
        </label>
        {name.trim() !== chair.name && <button type="submit" className="btn primary" disabled={rename.isPending || !name.trim()}>Сохранить</button>}
      </form>
      <p className="hint">{doctors.length ? `🪑 Врачи: ${doctors.join(', ')}` : 'Пустое — ни у одного врача'}</p>
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
      {!doctors.length && (
        <div className="actions">
          <button type="button" className="btn danger ghost" disabled={remove.isPending}
            onClick={() => void ask(`Удалить кресло «${chair.name}»?`).then((ok) => ok && remove.mutate())}>Удалить кресло</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error.fieldErrors.name ?? error.message}</p>}
    </section>
  )
}
