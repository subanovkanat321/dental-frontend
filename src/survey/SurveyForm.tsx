import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { CURRENT_KEY } from './keys'
import type { Question } from './texts'

type Form = Schemas['SurveyForm']
type Answer = Schemas['SurveyAnswersAnswer']

/**
 * Опрос, как его заполняет сотрудник: вопросы по порядку, обязательные — со звёздочкой. Тот же
 * компонент — предпросмотр в редакторе владельца ({@code preview}): отправить там нельзя.
 * Обязательные проверяем и здесь (сразу под вопросом), и на сервере — он главный.
 */
export function SurveyForm({ form, preview, onDone }: { form: Form; preview?: boolean; onDone?: () => void }) {
  const client = useQueryClient()
  const [answers, setAnswers] = useState<Record<number, Answer>>({})
  const [missing, setMissing] = useState<Record<string, string>>({})
  const questions = form.questions ?? []
  const send = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/surveys/{id}/responses', { params: { path: { id: form.id } }, body: { answers: Object.values(answers) } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: CURRENT_KEY })
      onDone?.()
    },
  })
  const set = (q: Question, patch: Omit<Answer, 'questionId'>) => {
    send.reset()
    setMissing((m) => Object.fromEntries(Object.entries(m).filter(([field]) => field !== `question-${q.id}`)))
    setAnswers((a) => ({ ...a, [q.id!]: { questionId: q.id!, ...patch } }))
  }
  const submit = () => {
    const empty: Record<string, string> = {}
    for (const q of questions) {
      if (q.required && !answered(answers[q.id!])) empty[`question-${q.id}`] = 'Ответьте на этот вопрос'
    }
    setMissing(empty)
    if (Object.keys(empty).length) return
    send.mutate()
  }
  if (send.isSuccess) {
    return (
      <section className="card-block survey-thanks" role="status">
        <h2>Спасибо!</h2>
        <p>Ваш ответ получен — мы читаем каждый. Так Tish становится удобнее для вашей работы.</p>
      </section>
    )
  }
  const errors = { ...send.error?.fieldErrors, ...missing }
  const general = send.error && !Object.keys(send.error.fieldErrors).some((k) => k.startsWith('question-')) ? send.error.message : null
  return (
    <form className="card-block survey-form" aria-label={form.title} onSubmit={(e) => { e.preventDefault(); if (!preview) submit() }}>
      <h2>{form.title}</h2>
      {form.intro && <p className="survey-intro">{form.intro}</p>}
      {questions.map((q, i) => (
        <QuestionField key={q.id ?? i} q={q} number={i + 1} answer={answers[q.id!]} error={errors[`question-${q.id}`]} onChange={(patch) => set(q, patch)} />
      ))}
      {general && <p className="error" role="alert">{general}</p>}
      {preview ? <p className="hint">Предпросмотр: так опрос увидят сотрудники. Отправить отсюда нельзя.</p>
        : <button type="submit" className="btn primary" disabled={send.isPending}>Отправить ответ</button>}
    </form>
  )
}

function answered(a: Answer | undefined): boolean {
  return a != null && (a.number != null || (a.choices?.length ?? 0) > 0 || Boolean(a.text?.trim()))
}

function QuestionField({ q, number, answer, error, onChange }: {
  q: Question
  number: number
  answer: Answer | undefined
  error: string | undefined
  onChange: (patch: Omit<Answer, 'questionId'>) => void
}) {
  const title = `${number}. ${q.text}`
  const choices = answer?.choices ?? []
  return (
    <fieldset className="field survey-question" aria-invalid={error ? true : undefined}>
      <legend>{title}{q.required && <span className="survey-required" title="Обязательный вопрос"> *</span>}</legend>
      {q.type === 'RATING' && (
        <div className="survey-stars" role="group" aria-label={q.text}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={`${n} из 5`} aria-pressed={answer?.number === n}
              className={(answer?.number ?? 0) >= n ? 'on' : undefined} onClick={() => onChange({ number: n })}>★</button>
          ))}
        </div>
      )}
      {q.type === 'NPS' && (
        <>
          <div className="segments wrap survey-nps" role="group" aria-label={q.text}>
            {Array.from({ length: 11 }, (_, n) => (
              <button key={n} type="button" aria-pressed={answer?.number === n} onClick={() => onChange({ number: n })}>{n}</button>
            ))}
          </div>
          <span className="survey-scale hint"><span>0 — точно нет</span><span>10 — точно да</span></span>
        </>
      )}
      {q.type === 'CONTACT' && (
        <div className="segments survey-yes-no" role="group" aria-label={q.text}>
          <button type="button" aria-pressed={answer?.number === 1} onClick={() => onChange({ number: 1 })}>Да</button>
          <button type="button" aria-pressed={answer?.number === 0} onClick={() => onChange({ number: 0 })}>Нет</button>
        </div>
      )}
      {(q.type === 'SINGLE' || q.type === 'MULTI') && (
        <div className="survey-options">
          {(q.options ?? []).map((o, i) => (
            <label key={i} className="check">
              <input type={q.type === 'SINGLE' ? 'radio' : 'checkbox'} name={`q-${q.id}`} checked={choices.includes(i)}
                onChange={() => onChange({ choices: q.type === 'SINGLE' ? [i] : choices.includes(i) ? choices.filter((c) => c !== i) : [...choices, i] })} />
              {o}
            </label>
          ))}
        </div>
      )}
      {q.type === 'TEXT' && (
        <textarea rows={3} maxLength={2000} aria-label={q.text} value={answer?.text ?? ''} placeholder="Напишите, как есть — это читаем мы, а не ваша клиника"
          onChange={(e) => onChange({ text: e.target.value })} />
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </fieldset>
  )
}
