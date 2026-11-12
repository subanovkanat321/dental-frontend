import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../../api/client'
import { DateInput } from '../../layout/DateInput'
import { SaveBar } from '../../layout/SaveBar'
import { Select } from '../../layout/Select'
import { useDirty } from '../../lib/unsaved'
import { hasOptions, ROLES, TYPES, type Question, type QuestionType, type Role } from '../../survey/texts'
import { definitionOf } from './definition'

type Details = Schemas['SurveyDetails']

/** Вопрос в редакторе: key — для React (у нового вопроса ещё нет id), saved — сколько вариантов уже в базе. */
type Draft = Question & { key: string; saved: number }

let counter = 0
const newKey = () => `new-${++counter}`

function draftOf(q: Question): Draft {
  return { ...q, options: q.options ?? [], required: Boolean(q.required), key: `q-${q.id}`, saved: q.id != null ? (q.options?.length ?? 0) : 0 }
}

function headOf(s: Details) {
  return { title: s.title ?? '', intro: s.intro ?? '', roles: s.roles ?? [], startsOn: s.startsOn ?? '', endsOn: s.endsOn ?? '', announce: s.announce }
}

/**
 * Редактор опроса (владелец): название, вступление, кому и когда, вопросы. Когда ответы уже есть,
 * вид вопроса, удаление вопроса и уже собранных вариантов закрыты — сервер всё равно ответит 409,
 * а здесь их просто нет: тексты править можно, добавлять — тоже.
 */
export function SurveyEditor({ survey }: { survey: Details }) {
  const client = useQueryClient()
  const locked = survey.responses > 0
  const [head, setHead] = useState(() => headOf(survey))
  const [questions, setQuestions] = useState<Draft[]>(() => (survey.questions ?? []).map(draftOf))
  const body = definitionOf(head, questions)
  const { dirty, commit } = useDirty(body)
  // После сохранения форма берёт ответ сервера (у новых вопросов появились id, пробелы обрезаны) —
  // и считает его сохранённым, когда он отрисуется: иначе «Есть несохранённые изменения» сразу после «Сохранить»
  const [saves, setSaves] = useState(0)
  useEffect(() => {
    if (saves) commit()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- commit — новая функция на каждый рендер, нужен только счётчик
  }, [saves])
  const save = useMutation<Details, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/surveys/{id}', { params: { path: { id: survey.id } }, body })),
    onSuccess: (saved) => {
      // Новые вопросы получили id — сохранённые варианты теперь защищены от удаления
      setHead(headOf(saved))
      setQuestions((saved.questions ?? []).map(draftOf))
      setSaves((n) => n + 1)
      client.setQueryData(['platform-survey', survey.id], saved)
      void client.invalidateQueries({ queryKey: ['platform-surveys'] })
    },
  })
  const edit = (patch: Partial<typeof head>) => {
    save.reset()
    setHead((h) => ({ ...h, ...patch }))
  }
  const change = (key: string, patch: Partial<Draft>) => {
    save.reset()
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...patch } : q)))
  }
  const move = (index: number, by: number) => {
    save.reset()
    setQuestions((qs) => {
      const next = [...qs]
      const [q] = next.splice(index, 1)
      next.splice(index + by, 0, q!)
      return next
    })
  }
  const add = () => {
    save.reset()
    setQuestions((qs) => [...qs, { key: newKey(), saved: 0, type: 'RATING', text: '', options: [], required: false }])
  }
  const toggleRole = (role: Role) => edit({ roles: head.roles.includes(role) ? head.roles.filter((r) => r !== role) : [...head.roles, role] })
  const errors = save.error?.fieldErrors ?? {}
  const error = save.error && (errors.title ?? errors.intro ?? errors.endsOn ?? errors.questions ?? save.error.message)
  return (
    <div className="form survey-editor" aria-label="Редактор опроса">
      {locked && (
        <p className="notice tone-wait">На опрос уже ответили: {survey.responses}. Тексты можно поправить, вопросы и варианты — добавить в конец;
          удалить вопрос, сменить его вид или убрать вариант нельзя — ответы потеряли бы смысл. Нужна другая анкета — «Копия».</p>
      )}
      <label className="field"><span>Название</span>
        <input value={head.title} maxLength={200} onChange={(e) => edit({ title: e.target.value })} /></label>
      <label className="field"><span>Вступление — зачем опрос и сколько займёт</span>
        <textarea rows={3} maxLength={2000} value={head.intro} onChange={(e) => edit({ intro: e.target.value })} /></label>
      <fieldset className="field">
        <legend>Кому — ни одной галочки: всем сотрудникам клиник</legend>
        <div className="chips-pick">
          {ROLES.map(([role, title]) => (
            <button key={role} type="button" className="chip" aria-pressed={head.roles.includes(role)} onClick={() => toggleRole(role)}>{title}</button>
          ))}
        </div>
      </fieldset>
      <div className="survey-dates">
        <label className="field"><span>С какого дня (пусто — сразу)</span>
          <DateInput value={head.startsOn} max={head.endsOn || undefined} onChange={(e) => edit({ startsOn: e.target.value })} /></label>
        <label className="field"><span>По какой день (пусто — пока не остановите)</span>
          <DateInput value={head.endsOn} min={head.startsOn || undefined} onChange={(e) => edit({ endsOn: e.target.value })} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={head.announce} disabled={Boolean(survey.announcedAt)}
        onChange={(e) => edit({ announce: e.target.checked })} />
        {survey.announcedAt ? `Приглашение в бот отправлено — дошло ${survey.invited}` : 'Пригласить в бот один раз, когда опрос откроется'}</label>

      <h3>Вопросы</h3>
      {questions.map((q, i) => (
        <QuestionEditor key={q.key} q={q} number={i + 1} locked={locked && q.id != null} first={i === 0} last={i === questions.length - 1}
          onChange={(patch) => change(q.key, patch)} onMove={(by) => move(i, by)}
          onRemove={() => { save.reset(); setQuestions((qs) => qs.filter((x) => x.key !== q.key)) }} />
      ))}
      {questions.length < 30 && <button type="button" className="btn" onClick={add}>+ Вопрос</button>}
      <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} savedText="Опрос сохранён" error={error} onSave={() => save.mutate()} />
    </div>
  )
}

function QuestionEditor({ q, number, locked, first, last, onChange, onMove, onRemove }: {
  q: Draft
  number: number
  locked: boolean
  first: boolean
  last: boolean
  onChange: (patch: Partial<Draft>) => void
  onMove: (by: number) => void
  onRemove: () => void
}) {
  const options = q.options ?? []
  const setType = (type: QuestionType) => onChange({ type, options: hasOptions(type) && options.length < 2 ? ['', ''] : options })
  return (
    <section className="card-block survey-q-edit" aria-label={`Вопрос ${number}`}>
      <div className="survey-q-head">
        <strong>{number}.</strong>
        <Select aria-label={`Вид вопроса ${number}`} value={q.type} disabled={locked} onChange={(e) => setType(e.target.value as QuestionType)}>
          {TYPES.map(([type, title]) => <option key={type} value={type}>{title}</option>)}
        </Select>
        <div className="actions">
          <button type="button" className="btn ghost small" aria-label="Выше" disabled={first} onClick={() => onMove(-1)}>↑</button>
          <button type="button" className="btn ghost small" aria-label="Ниже" disabled={last} onClick={() => onMove(1)}>↓</button>
          {!locked && <button type="button" className="btn ghost small" aria-label={`Удалить вопрос ${number}`} onClick={onRemove}>✕</button>}
        </div>
      </div>
      <input aria-label={`Текст вопроса ${number}`} value={q.text ?? ''} maxLength={500}
        placeholder={q.type === 'NPS' ? 'Порекомендуете ли Tish коллегам?' : 'Текст вопроса'} onChange={(e) => onChange({ text: e.target.value })} />
      {hasOptions(q.type) && (
        <div className="survey-options-edit">
          {options.map((o, i) => (
            <div key={i} className="survey-option-row">
              <input aria-label={`Вариант ${i + 1} вопроса ${number}`} value={o} maxLength={100}
                onChange={(e) => onChange({ options: options.map((x, k) => (k === i ? e.target.value : x)) })} />
              {/* Вариант, который уже могли выбрать, не убрать — только поправить текст */}
              {!(locked && i < q.saved) && (
                <button type="button" className="btn ghost small" aria-label={`Убрать вариант ${i + 1}`}
                  onClick={() => onChange({ options: options.filter((_, k) => k !== i) })}>✕</button>
              )}
            </div>
          ))}
          {options.length < 12 && <button type="button" className="btn small" onClick={() => onChange({ options: [...options, ''] })}>+ Вариант</button>}
        </div>
      )}
      <label className="check"><input type="checkbox" checked={Boolean(q.required)} onChange={(e) => onChange({ required: e.target.checked })} /> Обязательный</label>
    </section>
  )
}
