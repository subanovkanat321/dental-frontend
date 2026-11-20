import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Dictation, type DictationHandle } from './Dictation'
import { ProposalReview } from './ProposalReview'
import { asSections, cleanSections, hasText, joinText, mergeSections, renderSections, sameSections, SECTION_TITLE, SECTIONS, type SectionKey, type Sections } from './noteSections'
import { reviewOf, type Review } from './review'
import { PreviousSheet, SaveTemplateSheet, TemplateSheet } from './VisitNoteSheets'
import { DiagnosisPicker } from './DiagnosisPicker'

type Appointment = Schemas['AppointmentView']
type Me = Schemas['BookingViewsMe']
type NoteView = Schemas['ChartControllerNoteView']

function errorText(e: ApiError | null): string | null {
  if (!e) return null
  return Object.values(e.fieldErrors)[0] ?? e.message
}

/** Прошлые заметки пациента — до этого приёма, новые сверху (тот же запрос, что «Заметки о визитах» медкарты). */
function usePreviousNotes(a: Appointment, enabled: boolean) {
  const patientId = a.patient.id
  const notes = useQuery({
    queryKey: ['notes', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/notes', { params: { path: { patientId: patientId! } } })),
    enabled: enabled && patientId != null,
    retry: false,
  })
  const at = a.startAt ? Date.parse(a.startAt) : Infinity
  return (notes.data ?? []).filter((n) => n.appointmentId !== a.id && (!n.startAt || Date.parse(n.startAt) < at))
}

/**
 * «Заметка о приёме»: что сделали, что дальше — медданные. Пишут врач приёма и админ; ассистент и
 * другие врачи пациента только читают (`editable: false` — без поля и диктовки, с «Врач: …»);
 * регистратуре сервер не отдаёт (403 — нет блока). В медкарте пациента — в «Заметках о визитах».
 *
 * Шаг 2 (опыт Dentist Plus): разделы заметки (Жалобы · Объективно · Диагноз · Лечение · Рекомендации) — если клиника
 * их включила или заметка уже с разделами; пустые разделы не занимают места — «＋ Жалобы» чипом. Рядом с подписью —
 * «🎤» (надиктовать), «📄 Шаблон» и «↩ Прошлый» (из прошлого визита), под полем — «Сохранить как шаблон». Прошлые визиты — в
 * «Продолжении лечения» (UX-аудит 2026-11-20: одно место вместо трёх); поле — на всю ширину сразу под подписью.
 */
export function VisitNote({ appointment: a, me }: { appointment: Appointment; me?: Me }) {
  const client = useQueryClient()
  const note = useQuery({
    queryKey: ['note', a.id],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/note', { params: { path: { id: a.id } } })),
    retry: false,
  })
  const [text, setText] = useState<string | null>(null)
  const [draft, setDraft] = useState<Sections | null>(null)
  const [opened, setOpened] = useState<SectionKey[]>([])
  const [sheet, setSheet] = useState<'template' | 'previous' | 'save' | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [done, setDone] = useState('')
  // Пока идёт диктовка, поле заметки прячем: заметка — в экране «Проверьте», чтобы не было двух полей
  const [dictating, setDictating] = useState(false)
  const dictation = useRef<DictationHandle>(null)
  const editable = note.data?.editable !== false && note.isSuccess
  const previous = usePreviousNotes(a, editable)

  const sectionsMode = !!note.data && (note.data.sectionsOn === true || !!note.data.sections)
  const base = asSections(note.data?.note, note.data?.sections)
  const sections = draft ?? base
  const plain = text ?? note.data?.note ?? ''
  const changed = sectionsMode ? draft != null && !sameSections(draft, base) : text != null && text.trim() !== (note.data?.note ?? '')

  const save = useMutation<NoteView, ApiError>({
    mutationFn: () => {
      const clean = cleanSections(sections)
      const body = sectionsMode
        ? (hasText(clean) ? { note: renderSections(clean), sections: clean } : { note: '' })
        : { note: plain.trim() }
      return unwrap(api.PUT('/api/appointments/{id}/note', { params: { path: { id: a.id } }, body }))
    },
    onSuccess: (saved) => {
      client.setQueryData(['note', a.id], saved)
      void client.invalidateQueries({ queryKey: ['notes'] })
      setText(null)
      setDraft(null)
      setOpened([])
    },
  })

  if (note.isPending || note.error) return null
  if (note.data.editable === false) {
    // Чужой приём: только прочитать — менять заметку может врач приёма или админ (сервер ответит 403)
    if (!note.data.note) return null
    return (
      <section className="form" aria-label="Заметка о приёме">
        <span className="hint">Заметка о приёме{note.data.doctorName ? ` · Врач: ${note.data.doctorName}` : ''}</span>
        <p className="continue-note">{note.data.note}</p>
      </section>
    )
  }

  const current = { note: plain, sections: sectionsMode ? sections : null, sectionsMode }
  const insert = (parts: Sections) => {
    setDone('')
    if (sectionsMode) setDraft(mergeSections(sections, parts))
    else setText(joinText(plain, renderSections(parts)))
  }
  const hasNote = sectionsMode ? hasText(sections) : plain.trim() !== ''
  const canTemplate = a.patient.id != null

  if (review) {
    return (
      <ProposalReview appointment={a} initial={review}
        onSaved={(t) => { setReview(null); setText(null); setDraft(null); setDone(t) }} onCancel={() => setReview(null)} />
    )
  }

  const hasCodes = (sections.diagnosisCodes ?? []).length > 0
  const shownKeys = SECTIONS.map(([k]) => k).filter((k) => (sections[k] ?? '').trim() || opened.includes(k) || (k === 'diagnosis' && hasCodes))
  const hiddenKeys = SECTIONS.filter(([k]) => !shownKeys.includes(k))
  const setPart = (k: SectionKey | 'other', v: string) => setDraft((d) => ({ ...(d ?? base), [k]: v }))

  return (
    <>
    {/* Диктовка: кнопка — в строке подписи; врач говорит, ИИ раскладывает по зубам, плану и заметке (и по её разделам) */}
    {a.patient.id != null && <Dictation ref={dictation} appointment={a} current={current} onActive={setDictating} />}
    {!dictating && <form className="form visit-note" aria-label="Заметка о приёме" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <div className="note-head">
        <span className="note-head-title" id={`note-${a.id}`}>Заметка о приёме</span>
        {canTemplate && (
          <span className="note-tools">
            {/* Одной строкой с подписью и на телефоне 390px: микрофон — значком, «из прошлого визита» — коротко; полные
                названия — для скринридера (aria-label) и подсказкой при наведении */}
            <button type="button" className="btn small ghost note-mic" aria-label="Надиктовать"
              title="Надиктовать: скажите по шагам — зуб → что сделали → следующий визит. Шпаргалка будет на экране."
              onClick={() => dictation.current?.start()}><span aria-hidden="true">🎤</span></button>
            <button type="button" className="btn small ghost" aria-label="Шаблон" title="Вставить шаблон приёма" onClick={() => setSheet('template')}>
              <span aria-hidden="true">📄 </span>Шаблон</button>
            {previous.length > 0 && (
              <button type="button" className="btn small ghost" aria-label="Из прошлого визита" title="Взять из прошлого визита" onClick={() => setSheet('previous')}>
                <span aria-hidden="true">↩ </span>Прошлый</button>
            )}
          </span>
        )}
      </div>
      {sectionsMode ? (
        <div className="note-sections">
          {shownKeys.map((k) => k === 'diagnosis' ? (
            // «Диагноз» (шаг 3): МКБ-10 и свои формулировки подсказками, зуб — в чипе, и текст своими словами
            <div key={k} className="field note-section" role="group" aria-label="Диагноз"><span>{SECTION_TITLE[k]}</span>
              <DiagnosisPicker codes={sections.diagnosisCodes ?? []} text={sections.diagnosis ?? ''}
                autoFocus={opened.includes(k) && !(sections.diagnosis ?? '') && !hasCodes}
                onCodes={(codes) => setDraft((d) => ({ ...(d ?? base), diagnosisCodes: codes }))} onText={(v) => setPart('diagnosis', v)} />
            </div>
          ) : (
            <label key={k} className="field note-section"><span>{SECTION_TITLE[k]}</span>
              <textarea rows={rowsFor(sections[k])} maxLength={2000} value={sections[k] ?? ''} autoFocus={opened.includes(k) && !(sections[k] ?? '')}
                onChange={(e) => setPart(k, e.target.value)} />
            </label>
          ))}
          {(sections.other ?? '').trim() !== '' && (
            <label className="field note-section"><span>Заметка</span>
              <textarea rows={rowsFor(sections.other)} maxLength={2000} value={sections.other ?? ''} onChange={(e) => setPart('other', e.target.value)} />
            </label>
          )}
          {hiddenKeys.length > 0 && (
            <div className="note-add" role="group" aria-label="Добавить раздел заметки">
              {hiddenKeys.map(([k, t]) => (
                <button key={k} type="button" className="chip" onClick={() => setOpened([...opened, k])}>＋ {t}</button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <textarea aria-labelledby={`note-${a.id}`} rows={3} maxLength={2000} value={plain} placeholder="Что сделали, что дальше — видят врач и руководитель"
          onChange={(e) => setText(e.target.value)} />
      )}
      <div className="note-foot">
        {changed && <button type="submit" className="btn" disabled={save.isPending}>Сохранить заметку</button>}
        {save.isSuccess && !changed && <span className="tone-ok small" role="status">Сохранено</span>}
        {done && !changed && !save.isSuccess && <span className="tone-ok small" role="status">{done}</span>}
        {/* «Сохранить как шаблон» — из сохранённой заметки: что сохранили, то и станет шаблоном */}
        {hasNote && !changed && canTemplate && (me?.admin || me?.doctorId != null || !me) && (
          <button type="button" className="link small" onClick={() => setSheet('save')}>Сохранить как шаблон</button>
        )}
      </div>
      {save.error && <p className="error" role="alert">{errorText(save.error)}</p>}
    </form>}
    {sheet === 'template' && (
      <TemplateSheet appointment={a} onClose={() => setSheet(null)}
        onProposal={(p, title) => { setSheet(null); setDone(''); setReview(reviewOf(p, current, false, `Шаблон «${title}»`)) }} />
    )}
    {sheet === 'previous' && <PreviousSheet notes={previous} onClose={() => setSheet(null)} onInsert={(parts) => { setSheet(null); insert(parts) }} />}
    {sheet === 'save' && (
      <SaveTemplateSheet appointment={a} me={me} note={sectionsMode ? null : plain} sections={sectionsMode ? cleanSections(sections) : null}
        onClose={() => setSheet(null)} onSaved={(title) => { setSheet(null); setDone(`Шаблон «${title}» сохранён`) }} />
    )}
    </>
  )
}

/** Высота поля раздела по тексту: короткий — одна строка, длинный — до пяти (карточка не растёт зря). */
function rowsFor(text: string | undefined): number {
  const t = text ?? ''
  const lines = t.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 40)), 0)
  return Math.min(5, Math.max(1, lines))
}
