import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { useAnamnesis } from '../api/anamnesis'
import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { shortDate } from '../lib/time'

type Anamnesis = Schemas['AnamnesisView']
type Item = Schemas['AnamnesisItem']

const SECTIONS: [string, string][] = [['QUESTION', 'Вопросы'], ['DISEASE', 'Болезни']]

/**
 * Плашка «перед лечением»: аллергия, лекарства, болезни — что отмечено «да» у вопросов «в плашке».
 * compact — в карточке приёма: без текстовых полей, только главное.
 */
export function MedAlerts({ an, compact = false }: { an?: Anamnesis; compact?: boolean }) {
  const shown = (an?.items ?? []).filter((i) => i.alert && (i.yes || i.text) && !(compact && i.kind === 'TEXT'))
  if (!shown.length) return null
  const allergy = shown.some((i) => i.code === 'ALLERGY')
  return (
    <div className={allergy ? 'med-alert danger' : 'med-alert'} role="note" aria-label="Важно перед лечением">
      {shown.map((i) => <div key={i.questionId}>{i.label || (i.title ?? '').replace(/\?$/, '')}{i.text ? `: ${i.text}` : ''}</div>)}
    </div>
  )
}

type Answer = { yes: boolean; text: string }

/**
 * Анкета в медкарте: вопросы клиники галочками, «да» открывает «что именно». Одна на пациента —
 * врачи клиники видят одно и то же. Вопросы настраивают в «Клиника → Анкета».
 */
export function AnamnesisBlock({ patientId }: { patientId: number }) {
  const an = useAnamnesis(patientId)
  return (
    <section className="card-block">
      <h2>Анкета: аллергии, болезни, лекарства</h2>
      {an.isPending && <p className="hint">Загрузка…</p>}
      {an.error && <p className="error">{an.error.message}</p>}
      {an.data && <AnamnesisForm patientId={patientId} an={an.data} />}
    </section>
  )
}

function AnamnesisForm({ patientId, an }: { patientId: number; an: Anamnesis }) {
  const client = useQueryClient()
  const items = an.items ?? []
  const [answers, setAnswers] = useState<Record<number, Answer>>(() =>
    Object.fromEntries(items.map((i) => [i.questionId, { yes: Boolean(i.yes), text: i.text ?? '' }])))
  const save = useMutation<Anamnesis, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/patients/{patientId}/anamnesis', {
      params: { path: { patientId } },
      body: {
        answers: items.map((i) => {
          const a = answers[i.questionId!]!
          return { questionId: i.questionId, yes: i.kind === 'TEXT' ? false : a.yes, text: i.kind === 'CHECK' ? undefined : a.text }
        }),
      },
    })),
    onSuccess: (saved) => client.setQueryData(['anamnesis', patientId], saved),
  })
  const set = (id: number, patch: Partial<Answer>) => {
    save.reset()
    setAnswers({ ...answers, [id]: { ...answers[id]!, ...patch } })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  if (!items.length) return <p className="hint">В анкете клиники нет вопросов — добавьте их в «Клиника → Анкета».</p>

  const field = (i: Item) => {
    const a = answers[i.questionId!]!
    if (i.kind === 'TEXT') {
      return (
        <label key={i.questionId} className="field"><span>{i.title}</span>
          <textarea rows={2} maxLength={500} placeholder={i.hint ?? ''} value={a.text} onChange={(e) => set(i.questionId!, { text: e.target.value })} /></label>
      )
    }
    return (
      <div key={i.questionId} className="question">
        <label className="check"><input type="checkbox" checked={a.yes} onChange={(e) => set(i.questionId!, { yes: e.target.checked })} /> {i.title}</label>
        {i.kind === 'CHECK_TEXT' && a.yes && (
          <input aria-label={`${i.title} — что именно`} placeholder={i.hint || 'Что именно'} maxLength={500} value={a.text}
            onChange={(e) => set(i.questionId!, { text: e.target.value })} />
        )}
      </div>
    )
  }

  return (
    <form className="anamnesis" aria-label="Анкета пациента" onSubmit={submit}>
      <MedAlerts an={an} />
      <div className="anamnesis-grid">
        {SECTIONS.map(([code, name]) => {
          const list = items.filter((i) => i.section === code)
          return list.length ? (
            <fieldset key={code} className="anamnesis-col">
              <legend>{name}</legend>
              {list.map(field)}
            </fieldset>
          ) : null
        })}
      </div>
      {an.updatedAt && <p className="hint">Обновлено {shortDate(an.updatedAt)}{an.updatedBy ? ` · ${an.updatedBy}` : ''}</p>}
      {save.error && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
      {save.isSuccess && <p className="tone-ok" role="status">Анкета сохранена</p>}
      <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить анкету</button>
    </form>
  )
}
