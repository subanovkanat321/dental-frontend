import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { MultiToothPanel } from '../medical/MultiTeeth'
import { SurfacePicker } from '../medical/SurfaceDiagram'
import { ToothFormula } from '../medical/ToothFormula'
import { ToothFullscreen } from '../medical/ToothFullscreen'
import { ToothFigure } from '../medical/ToothGlyph'
import { TOOTH_STATES, hasSurfaces, stateText, visitToothText, type Surface, type ToothState } from '../medical/toothStates'

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
  // «Несколько»: отметить сразу несколько зубов одним действием
  const [multi, setMulti] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const [full, setFull] = useState(false)
  // Что сейчас на карте пациента — подсказка в редакторе («На карте: кариес») и «На весь экран»; тот же ключ, что у медкарты
  const chart = useQuery({
    queryKey: ['teeth', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/teeth', { params: { path: { patientId: patientId! } } })),
    enabled: patientId != null && (open != null || full),
    retry: false,
  })
  const many = useMutation<VisitTooth[], ApiError, { state: ToothState; surfaces: Surface[] }>({
    mutationFn: ({ state, surfaces }) => unwrap(api.POST('/api/appointments/{id}/teeth/batch', {
      params: { path: { id: a.id! } }, body: { numbers: picked, state, surfaces },
    })),
    onSuccess: (fresh) => saved(fresh),
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
    setMulti(false)
    setPicked([])
  }
  const cancelPicking = () => {
    setPicking(false)
    setMulti(false)
    setPicked([])
    many.reset()
  }

  const tooth = (n: number) => {
    const t = byNumber.get(n)
    const state = t?.state
    const label = state ? stateText(n, state, t?.surfaces) : 'не отмечен'
    const isPicked = picked.includes(n)
    return (
      <button key={n} type="button" className={`tooth${open === n ? ' active' : ''}${isPicked ? ' picked' : ''}`} data-state={state ?? 'HEALTHY'}
        aria-label={`Зуб ${n}: ${label}`} aria-pressed={multi ? isPicked : open === n}
        onClick={() => (multi ? setPicked(isPicked ? picked.filter((x) => x !== n) : [...picked, n]) : setOpen(open === n ? null : n))}>
        {isPicked && <span aria-hidden="true" className="tooth-check">✓</span>}
        <ToothFigure number={n} state={state} surfaces={t?.surfaces} />
      </button>
    )
  }

  return (
    <section className="visit-teeth" aria-label="Зубы этого приёма">
      <div className="chart-head">
      <h3>Зубы этого приёма</h3>
        {patientId != null && <button type="button" className="btn small" onClick={() => setFull(true)}>⛶ На весь экран</button>}
      </div>
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
          <div className="chart-head">
            <p className="hint small">{multi ? 'Отметьте галочками зубы, которые лечили.' : 'Нажмите зуб, который лечили. Номера — FDI, как на карте зубов.'}</p>
            <button type="button" className="btn small" aria-pressed={multi}
              onClick={() => { setMulti(!multi); setPicked([]); many.reset() }}>{multi ? '☑' : '☐'} Несколько</button>
          </div>
          <ToothFormula className="visit-formula" render={tooth} />
          {multi && (
            <MultiToothPanel key={picked.length === 0 ? 'empty' : 'picked'} numbers={picked} states={STATES} patientId={patientId}
              onApply={(state, surfaces) => many.mutate({ state, surfaces })} applying={many.isPending} error={many.error}
              onClear={() => { setPicked([]); many.reset() }} />
          )}
          <button type="button" className="btn ghost" onClick={cancelPicking}>Отмена</button>
        </>
      )}
      {!readOnly && open != null && (
        <VisitToothEditor key={open} appointmentId={a.id!} number={open} marked={byNumber.get(open)}
          onChart={chart.data?.find((t) => t.number === open)?.state}
          onSaved={saved} onCancel={() => { setOpen(null); setPicking(false) }} />
      )}
      {full && (
        <ToothFullscreen teeth={chart.data ?? marked} highlight={marked.map((t) => t.number!)} patientName={a.patient?.fullName}
          onClose={() => setFull(false)} />
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
  const [surfaces, setSurfaces] = useState<Surface[]>(marked?.surfaces ?? [])
  const path = { params: { path: { id: appointmentId, number } } }
  const save = useMutation<VisitTooth[], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/appointments/{id}/teeth/{number}', {
      ...path, body: { state: state!, surfaces: hasSurfaces(state) ? surfaces : [], note: note.trim() || undefined },
    })),
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
      {hasSurfaces(state) && <SurfacePicker number={number} value={surfaces} onChange={setSurfaces} state={state} />}
      <label className="field"><span>Заметка — необязательно</span>
        <input maxLength={500} value={note} placeholder="Материал" onChange={(e) => setNote(e.target.value)} />
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
