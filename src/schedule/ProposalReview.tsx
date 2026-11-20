import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Select } from '../layout/Select'
import { haptic } from '../lib/telegram'
import { TOOTH_STATES, hasSurfaces, surfacesText, type ToothState } from '../medical/toothStates'
import { Spinner } from '../layout/Loading'
import { cleanSections, dxLabel, hasText, renderSections, SECTION_TITLE, SECTIONS, type Sections } from './noteSections'
import type { Review } from './review'
import { refreshAppointmentData } from './useAppointmentAction'

type Appointment = Schemas['AppointmentView']
type NoteView = Schemas['ChartControllerNoteView']

type ToothRow = Review['teeth'][number]
type StepRow = Review['plan'][number]

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

export function ProposalReview({ appointment: a, initial, onSaved, onCancel }: {
  appointment: Appointment
  initial: Review
  onSaved: (text: string) => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const [r, setReview] = useState<Review>(initial)

  const apply = useMutation<Schemas['VisitDictationApplied'], ApiError>({
    mutationFn: () => {
      const sections = r.sections ? cleanSections(r.sections) : null
      return unwrap(api.POST('/api/appointments/{id}/dictation/apply', {
        params: { path: { id: a.id } },
        body: {
          teeth: r.teeth.filter((t) => t.on).map((t) => ({
            tooth: Number(t.tooth), state: t.state, surfaces: hasSurfaces(t.state) ? t.surfaces : [], note: t.note.trim() || undefined,
          })),
          plan: r.plan.filter((s) => s.on).map((s) => ({ tooth: s.tooth.trim() ? Number(s.tooth) : undefined, title: s.title.trim() })),
          note: sections ? renderSections(sections) : r.note.trim(),
          sections: sections && hasText(sections) ? sections : undefined,
          services: r.services.some((x) => x.on) ? r.services.filter((x) => x.on).map((x) => ({ serviceTypeId: x.id, teeth: x.teeth })) : undefined,
        },
      }))
    },
    onSuccess: (done) => {
      haptic('success')
      const patientId = a.patient.id
      client.setQueryData<NoteView>(['note', a.id], (old) => ({ editable: true, sectionsOn: false, ...old, note: done.note, sections: done.sections }))
      if (patientId != null) {
        client.setQueryData(['teeth', patientId], done.teeth)
        void client.invalidateQueries({ queryKey: ['plan', patientId] })
      }
      void client.invalidateQueries({ queryKey: ['notes'] })
      // Зубы ложатся и за этим приёмом — «Зубы этого приёма» и история по визитам
      void client.invalidateQueries({ queryKey: ['visit-teeth', a.id] })
      void client.invalidateQueries({ queryKey: ['teeth-history'] })
      // Услуга приёма из шаблона — карточка и расписание покажут новую
      if (r.services.some((x) => x.on)) refreshAppointmentData(client, ['appointment'])
      const teeth = r.teeth.filter((t) => t.on).length
      const steps = r.plan.filter((s) => s.on).length
      onSaved(['Сохранено в медкарту', teeth ? `зубов: ${teeth}` : '', steps ? `шагов плана: ${steps}` : ''].filter(Boolean).join(' · '))
    },
    onError: () => haptic('error'),
  })

  const setTooth = (i: number, change: Partial<ToothRow>) =>
    setReview((x) => ({ ...x, teeth: x.teeth.map((t, j) => (j === i ? { ...t, ...change } : t)) }))
  const setStepRow = (i: number, change: Partial<StepRow>) =>
    setReview((x) => ({ ...x, plan: x.plan.map((s, j) => (j === i ? { ...s, ...change } : s)) }))
  const codes = r.sections?.diagnosisCodes ?? []
  const setSection = (k: Exclude<keyof Sections, 'diagnosisCodes'>, v: string) => setReview((x) => ({ ...x, sections: { ...x.sections, [k]: v } }))

  return (
    <section className="dictation" aria-label={r.source ? 'Проверьте шаблон' : 'Проверьте диктовку'}>
      <h3>{r.source ?? 'Проверьте'}</h3>
      {r.source ? <p className="hint small">Поправьте и снимите лишнее. Ничего не сохранится без «Сохранить».</p>
        : r.ai ? <p className="hint small">Разобрал ИИ — снимите лишнее и поправьте. Ничего не сохранится без «Сохранить».</p>
          : <p className="tone-wait small" role="status">{r.problem} Текст добавлен в заметку.</p>}
      {/* Услуги шаблона — добавятся в приём (которых там ещё нет); снимите лишние */}
      {r.services.map((x, i) => (
        <label key={x.id} className="check dictation-service">
          <input type="checkbox" checked={x.on}
            onChange={(e) => setReview({ ...r, services: r.services.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)) })} />
          <span>Услуга приёма: <b>{x.name}</b>{x.teeth.length ? <span className="hint"> · {x.teeth.join(', ')}{x.teeth.length > 1 ? ` · × ${x.teeth.length}` : ''}</span> : null}</span>
        </label>
      ))}
      {r.teeth.length > 0 && (
        <fieldset className="dictation-group">
          <legend>Карта зубов</legend>
          {r.teeth.map((t, i) => (
            <div key={i} className="dictation-row">
              <label className="check"><input type="checkbox" checked={t.on} aria-label={`Зуб ${t.tooth}: применить`}
                onChange={(e) => setTooth(i, { on: e.target.checked })} /></label>
              <input className="num dictation-tooth" aria-label="Номер зуба" inputMode="numeric" maxLength={2} value={t.tooth}
                disabled={!t.on} onChange={(e) => setTooth(i, { tooth: e.target.value.replace(/\D/g, '') })} />
              <Select aria-label={`Состояние зуба ${t.tooth}`} value={t.state} disabled={!t.on}
                onChange={(e) => setTooth(i, { state: e.target.value as ToothState })}>
                {Object.entries(TOOTH_STATES).map(([k, [label, icon]]) => <option key={k} value={k}>{`${icon} ${label}`}</option>)}
              </Select>
              {/* Поверхности, которые назвал врач («36 МО пломба»): видно и можно убрать, если ИИ ошибся */}
              {hasSurfaces(t.state) && t.surfaces.length > 0 && (
                <button type="button" className="chip" disabled={!t.on} aria-label={`Убрать поверхности зуба ${t.tooth}: ${surfacesText(Number(t.tooth), t.surfaces)}`}
                  onClick={() => setTooth(i, { surfaces: [] })}>{surfacesText(Number(t.tooth), t.surfaces)} ✕</button>
              )}
              <input aria-label={`Пометка к зубу ${t.tooth}`} maxLength={500} value={t.note} placeholder="пометка" disabled={!t.on}
                onChange={(e) => setTooth(i, { note: e.target.value })} />
              {t.was && t.was !== 'HEALTHY' && t.was !== t.state && <span className="hint small">было: {TOOTH_STATES[t.was][0].toLowerCase()}</span>}
            </div>
          ))}
        </fieldset>
      )}
      {r.plan.length > 0 && (
        <fieldset className="dictation-group">
          <legend>План лечения</legend>
          {r.plan.map((s, i) => (
            <div key={i} className="dictation-row">
              <label className="check"><input type="checkbox" checked={s.on} aria-label={`В план: ${s.title}`}
                onChange={(e) => setStepRow(i, { on: e.target.checked })} /></label>
              <input className="num dictation-tooth" aria-label="Зуб в плане" inputMode="numeric" maxLength={2} value={s.tooth}
                placeholder="—" disabled={!s.on} onChange={(e) => setStepRow(i, { tooth: e.target.value.replace(/\D/g, '') })} />
              <input aria-label="Шаг плана" maxLength={200} value={s.title} disabled={!s.on}
                onChange={(e) => setStepRow(i, { title: e.target.value })} />
            </div>
          ))}
        </fieldset>
      )}
      {r.sections ? (
        <fieldset className="dictation-group note-sections-review">
          <legend>Заметка о приёме</legend>
          {/* Только разделы с текстом: пустые не занимают место (добавить — в самой заметке) */}
          {[...SECTIONS.map(([k]) => k), 'other' as const].filter((k) => (r.sections?.[k] ?? '').trim() || (initial.sections?.[k] ?? '').trim()).map((k) => (
            <label key={k} className="field"><span>{SECTION_TITLE[k]}</span>
              <textarea aria-label={`${SECTION_TITLE[k]} — из ${r.source ? 'шаблона' : 'диктовки'}`} rows={2} maxLength={2000}
                value={r.sections?.[k] ?? ''} onChange={(e) => setSection(k, e.target.value)} />
            </label>
          ))}
          {/* Диагноз МКБ от ИИ или шаблона — только из списка (сервер проверил); лишний — ✕ */}
          {codes.length > 0 && (
            <ul className="dx-chips" aria-label="Диагнозы МКБ-10">
              {codes.map((d, i) => (
                <li key={`${d.code}-${d.tooth ?? ''}`} className="chip dx-chip"><span>{dxLabel(d)}</span>
                  <button type="button" className="dx-remove" aria-label={`Убрать диагноз ${dxLabel(d)}`}
                    onClick={() => setReview((x) => ({ ...x, sections: { ...x.sections, diagnosisCodes: codes.filter((_, j) => j !== i) } }))}>✕</button>
                </li>
              ))}
            </ul>
          )}
          {!hasText(r.sections) && <p className="hint small">Текста для заметки нет.</p>}
        </fieldset>
      ) : (
        <label className="field"><span>Заметка о приёме</span>
          <textarea aria-label={r.source ? 'Заметка из шаблона' : 'Заметка из диктовки'} rows={4} maxLength={2000} value={r.note}
            onChange={(e) => setReview({ ...r, note: e.target.value })} />
        </label>
      )}
      {r.next && <p className="hint small">Следующий визит: {r.next} — запишите пациента, если нужно (сам не записывается).</p>}
      <div className="actions">
        <button type="button" className="btn primary" disabled={apply.isPending} onClick={() => apply.mutate()}>
          {apply.isPending ? <><Spinner />Сохраняем…</> : 'Сохранить'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>
      </div>
      {apply.error && <p className="error" role="alert">{errorText(apply.error)}</p>}
    </section>
  )
}
