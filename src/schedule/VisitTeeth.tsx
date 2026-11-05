import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ToothFormula } from '../medical/ToothFormula'
import { ToothFigure } from '../medical/ToothGlyph'
import { TOOTH_STATES, visitToothText, type ToothState } from '../medical/toothStates'

type Appointment = Schemas['AppointmentView']
type VisitTooth = Schemas['VisitToothView']

/** Что делают на приёме — в порядке частоты; «Здоров» не нужен: здоровый зуб не отмечают. */
const STATES: ToothState[] = ['TREATING', 'FILLING', 'CROWN', 'MISSING', 'IMPLANT', 'CARIES']

/**
 * «Зубы этого приёма»: врач прямо в карточке отмечает, какие зубы лечил и что сделал. Сервер в одной
 * транзакции обновляет карту зубов пациента и запоминает отметку за приёмом — из этого «История по
 * визитам» в медкарте. Ассистент видит список, отмечает врач приёма или админ (проверяет сервер).
 *
 * Формула — та же, что карта зубов в медкарте (ToothFormula), но открывается по кнопке: в карточке
 * приёма много всего, а зубы отмечают раз-другой за визит.
 */
export function VisitTeeth({ appointment: a, readOnly }: { appointment: Appointment; readOnly: boolean }) {
  const client = useQueryClient()
  const patientId = a.patient?.id
  const teeth = useQuery({
    queryKey: ['visit-teeth', a.id],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/teeth', { params: { path: { id: a.id! } } })),
    retry: false,
  })
  const [picking, setPicking] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  // Что сейчас на карте пациента — подсказка в редакторе («На карте: кариес»); тот же ключ, что у медкарты
  const chart = useQuery({
    queryKey: ['teeth', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/teeth', { params: { path: { patientId: patientId! } } })),
    enabled: patientId != null && open != null,
    retry: false,
  })
  // «убрать» прямо из списка — отметили не тот зуб
  const unmark = useMutation<VisitTooth[], ApiError, number>({
    mutationFn: (number) => unwrap(api.DELETE('/api/appointments/{id}/teeth/{number}', { params: { path: { id: a.id!, number } } })),
    onSuccess: (fresh) => saved(fresh),
  })
  if (teeth.error || !teeth.data) return null
  const marked = teeth.data
  if (readOnly && marked.length === 0) return null
  const byNumber = new Map(marked.map((t) => [t.number, t]))

  function saved(fresh: VisitTooth[]) {
    client.setQueryData(['visit-teeth', a.id], fresh)
    // Карта зубов и история пациента изменились на сервере — перечитать, где открыты
    void client.invalidateQueries({ queryKey: ['teeth', patientId] })
    void client.invalidateQueries({ queryKey: ['teeth-history', patientId] })
    setOpen(null)
    setPicking(false)
  }

  const tooth = (n: number) => {
    const t = byNumber.get(n)
    const state = t?.state
    const label = state ? TOOTH_STATES[state][0] : 'не отмечен'
    return (
      <button key={n} type="button" className={`tooth${open === n ? ' active' : ''}`} data-state={state ?? 'HEALTHY'}
        aria-label={`Зуб ${n}: ${label}`} aria-pressed={open === n} onClick={() => setOpen(open === n ? null : n)}>
        <ToothFigure number={n} state={state} />
      </button>
    )
  }

  return (
    <section className="visit-teeth" aria-label="Зубы этого приёма">
      <h3>Зубы этого приёма</h3>
      {marked.length > 0 && (
        <ul className="marked-teeth" aria-label="Отмеченные зубы приёма">
          {marked.map((t) => (
            <li key={t.number} className="line-edit">
              <span>{visitToothText(t)}</span>
              {!readOnly && (
                <button type="button" className="link" aria-label={`Изменить зуб ${t.number}`}
                  onClick={() => { setPicking(true); setOpen(t.number!) }}>изменить</button>
              )}
              {!readOnly && (
                <button type="button" className="link" aria-label={`Убрать зуб ${t.number} из приёма`} disabled={unmark.isPending}
                  onClick={() => unmark.mutate(t.number!)}>убрать</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {unmark.error && <p className="error" role="alert">{unmark.error.message}</p>}
      {!readOnly && !picking && open == null && (
        <button type="button" className="btn" onClick={() => setPicking(true)}>{marked.length ? '＋ Ещё зуб' : 'Отметить зуб'}</button>
      )}
      {!readOnly && picking && open == null && (
        <>
          <p className="hint small">Нажмите зуб, который лечили. Номера — FDI, как на карте зубов.</p>
          <ToothFormula className="visit-formula" render={tooth} />
          <button type="button" className="btn ghost" onClick={() => setPicking(false)}>Отмена</button>
        </>
      )}
      {!readOnly && open != null && (
        <VisitToothEditor key={open} appointmentId={a.id!} number={open} marked={byNumber.get(open)}
          onChart={chart.data?.find((t) => t.number === open)?.state}
          onSaved={saved} onCancel={() => { setOpen(null); setPicking(false) }} />
      )}
    </section>
  )
}

function VisitToothEditor({ appointmentId, number, marked, onChart, onSaved, onCancel }: {
  appointmentId: number
  number: number
  marked?: VisitTooth
  onChart?: ToothState
  onSaved: (teeth: VisitTooth[]) => void
  onCancel: () => void
}) {
  const [state, setState] = useState<ToothState | null>(marked?.state ?? null)
  const [note, setNote] = useState(marked?.note ?? '')
  const path = { params: { path: { id: appointmentId, number } } }
  const save = useMutation<VisitTooth[], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/appointments/{id}/teeth/{number}', { ...path, body: { state: state!, note: note.trim() || undefined } })),
    onSuccess: onSaved,
  })
  const remove = useMutation<VisitTooth[], ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/appointments/{id}/teeth/{number}', path)),
    onSuccess: onSaved,
  })
  const error = save.error ?? remove.error
  const busy = save.isPending || remove.isPending
  return (
    <form className="form tooth-editor" aria-label={`Зуб ${number}`} onSubmit={(e) => { e.preventDefault(); if (state) save.mutate() }}>
      <h3>Зуб {number}{onChart && onChart !== 'HEALTHY' && !marked ? <span className="hint"> · на карте: {TOOTH_STATES[onChart][0].toLowerCase()}</span> : null}</h3>
      <div className="segments wrap" role="group" aria-label="Что сделали">
        {STATES.map((k) => (
          <button key={k} type="button" aria-pressed={state === k} onClick={() => setState(k)}>{TOOTH_STATES[k][1]} {TOOTH_STATES[k][0]}</button>
        ))}
      </div>
      <label className="field"><span>Заметка — необязательно</span>
        <input maxLength={500} value={note} placeholder="Материал, поверхность" onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{Object.values(error.fieldErrors)[0] ?? error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={busy || !state}>Сохранить</button>
        {/* Отметили по ошибке: на карте вернётся, как было до приёма (если её с тех пор не меняли) */}
        {marked && <button type="button" className="btn" disabled={busy} onClick={() => remove.mutate()}>Убрать</button>}
        <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  )
}
