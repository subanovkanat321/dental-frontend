import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { Fragment, useCallback, useState, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { useClose } from '../lib/useClose'
import { useDirty } from '../lib/unsaved'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'
import { SubHelp } from '../layout/PageHead'
import { rowOpen } from '../lib/rowClick'

type Me = Schemas['BookingViewsMe']
type Question = Schemas['AnamnesisQuestion']

const KINDS: [string, string][] = [['CHECK', 'Галочка'], ['CHECK_TEXT', 'Галочка + «что именно»'], ['TEXT', 'Поле для текста']]
const SECTIONS: [string, string][] = [['QUESTION', 'Вопросы'], ['DISEASE', 'Болезни']]

const kindName = (k?: string) => KINDS.find(([code]) => code === k)?.[1] ?? k ?? ''

/**
 * «Анкета пациента»: вопросы, которые врач отмечает у пациента, — свои у клиники. Добавить,
 * поменять порядок, скрыть. «В плашке» — ответ «да» видно красной плашкой перед лечением.
 * Меняют админ и врачи; регистратура — только смотрит.
 */
export function QuestionsTab({ me, header, onPanel }: { me: Me; header: ReactNode; onPanel: (open: boolean) => void }) {
  const client = useQueryClient()
  const list = useQuery({ queryKey: ['anamnesis-questions'], queryFn: () => unwrap(api.GET('/api/anamnesis/questions')) })
  const editable = Boolean(me.admin || me.doctorId != null)
  const [opened, setOpenedState] = useState<Partial<Question> | null>(null)
  const setOpened = useCallback((q: Partial<Question> | null) => {
    setOpenedState(q)
    onPanel(q != null)
  }, [onPanel])
  const close = useCallback(() => setOpened(null), [setOpened])
  const move = useMutation<Question[], ApiError, { id: number; direction: number }>({
    mutationFn: ({ id, direction }) => unwrap(api.POST('/api/anamnesis/questions/{id}/move', { params: { path: { id } }, body: { direction } })),
    onSuccess: (all) => client.setQueryData(['anamnesis-questions'], all),
  })
  const questions = list.data ?? []

  return (
    <>
      <section className="schedule-main">
        {header}
        <SubHelp title="Анкета пациента">Вопросы, которые врач отмечает у пациента. Свои у вашей клиники: добавьте нужные, ненужные скройте.
            «В плашке» — ответ «да» видно красной плашкой перед лечением.</SubHelp>
        <section className="card-block">
          {list.error && <p className="error">{list.error.message}</p>}
          {move.error && <p className="error" role="alert">{move.error.message}</p>}
          {list.isPending ? <Loading /> : (
            <table className="table" aria-label="Анкета пациента">
              <thead><tr><th>Вопрос</th><th>Как отвечают</th><th /><th /></tr></thead>
              <tbody>
                {SECTIONS.map(([code, name]) => {
                  const items = questions.filter((q) => q.section === code)
                  return (
                    <Fragment key={code}>
                      <tr className="group-row"><th colSpan={3} scope="colgroup">{name}</th>
                        <th className="r">{editable && <button type="button" className="btn small" onClick={() => setOpened({ section: code, kind: 'CHECK', active: true })}>+ Добавить</button>}</th></tr>
                      {items.map((q, i) => (
                        <tr key={q.id} {...rowOpen(editable && (() => setOpened(q)), q.id === opened?.id && 'active', q.active === false && 'inactive')}>
                          <td>{editable ? <button type="button" className="row-link" onClick={() => setOpened(q)}>{q.title}</button> : q.title}</td>
                          <td className="hint">{kindName(q.kind)}</td>
                          <td className="hint">{[q.alert ? 'в плашке' : null, q.active === false ? 'скрыт' : null, q.answers ? `ответов: ${q.answers}` : null].filter(Boolean).join(' · ')}</td>
                          <td className="r nowrap">{editable && (
                            <>
                              <button type="button" className="btn small ghost" aria-label={`Выше: ${q.title}`} disabled={i === 0 || move.isPending}
                                onClick={() => move.mutate({ id: q.id, direction: -1 })}>↑</button>
                              <button type="button" className="btn small ghost" aria-label={`Ниже: ${q.title}`} disabled={i === items.length - 1 || move.isPending}
                                onClick={() => move.mutate({ id: q.id, direction: 1 })}>↓</button>
                            </>
                          )}</td>
                        </tr>
                      ))}
                      {!items.length && <tr><td colSpan={4}><EmptyState compact title="Вопросов в этой группе нет" /></td></tr>}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      </section>
      {opened && <QuestionPanel key={opened.id ?? `new-${opened.section}`} question={opened} onClose={close} />}
    </>
  )
}

/** Вопрос: новый (без id) или существующий. Удалить — пока никто не ответил; иначе только скрыть. */
function QuestionPanel({ question: q, onClose }: { question: Partial<Question>; onClose: () => void }) {
  const close = useClose(onClose)
  const client = useQueryClient()
  const [f, setF] = useState({ title: q.title ?? '', label: q.label ?? '', hint: q.hint ?? '', kind: q.kind ?? 'CHECK', alert: Boolean(q.alert), active: q.active !== false })
  const { dirty, commit } = useDirty(f)
  const section = SECTIONS.find(([code]) => code === q.section)?.[1]
  const onSaved = (all: Question[]) => client.setQueryData(['anamnesis-questions'], all)
  const save = useMutation<Question[], ApiError>({
    mutationFn: () => {
      const body = { section: q.section, ...f, hint: f.kind === 'CHECK' ? '' : f.hint }
      return unwrap(q.id
        ? api.PUT('/api/anamnesis/questions/{id}', { params: { path: { id: q.id } }, body })
        : api.POST('/api/anamnesis/questions', { body }))
    },
    onSuccess: (all) => {
      commit()
      onSaved(all)
      if (!q.id) onClose()
    },
  })
  const remove = useMutation<Question[], ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/anamnesis/questions/{id}', { params: { path: { id: q.id! } } })),
    onSuccess: (all) => {
      onSaved(all)
      onClose()
    },
  })
  const err = (k: string) => save.error?.fieldErrors[k]
  const set = (k: 'title' | 'label' | 'hint') => (e: { target: { value: string } }) => {
    save.reset()
    setF({ ...f, [k]: e.target.value })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <aside className="panel" aria-label={q.id ? 'Вопрос анкеты' : 'Новый вопрос'}>
      <header className="panel-head">
        <div>
          <h2>{q.id ? 'Вопрос анкеты' : 'Новый вопрос'}</h2>
          <span className="hint">Раздел: {section}</span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
      </header>
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Вопрос</span>
          <input value={f.title} required maxLength={120} autoFocus placeholder="Например: Носит брекеты?" onChange={set('title')} /></label>
        {err('title') && <p className="error">{err('title')}</p>}
        <div className="field"><span>Как отвечают</span>
          <div className="segments wrap" role="group" aria-label="Как отвечают">
            {KINDS.map(([code, name]) => <button key={code} type="button" aria-pressed={f.kind === code} onClick={() => { save.reset(); setF({ ...f, kind: code }) }}>{name}</button>)}
          </div>
        </div>
        {f.kind !== 'CHECK' && (
          <label className="field"><span>Подсказка в поле ответа</span>
            <input value={f.hint} maxLength={120} placeholder="Например: с какого года" onChange={set('hint')} /></label>
        )}
        {err('hint') && <p className="error">{err('hint')}</p>}
        <label className="check"><input type="checkbox" checked={f.alert} onChange={(e) => { save.reset(); setF({ ...f, alert: e.target.checked }) }} /> Показывать ответ «да» в плашке перед лечением</label>
        <label className="field"><span>Коротко для плашки — необязательно</span>
          <input value={f.label} maxLength={60} placeholder="Например: Брекеты" onChange={set('label')} /></label>
        {err('label') && <p className="error">{err('label')}</p>}
        {q.id != null && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => { save.reset(); setF({ ...f, active: e.target.checked }) }} /> Показывать в анкете</label>}
        <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label={q.id ? 'Сохранить' : 'Добавить'} savedText="Вопрос сохранён"
          error={save.error && (['title', 'hint', 'label'].map((k) => err(k)).find(Boolean) ?? save.error.message)} />
      </form>
      {q.id != null && (
        <div className="danger-zone">
          <p className="hint">{q.answers ? `Пациенты уже ответили (${q.answers}) — вопрос можно только скрыть: снимите «Показывать в анкете».`
            : 'Вопрос ещё никто не заполнял — его можно удалить.'}</p>
          {!q.answers && <button type="button" className="btn danger" disabled={remove.isPending}
            onClick={() => void ask(`Удалить вопрос «${q.title}»?`).then((ok) => ok && remove.mutate())}>Удалить вопрос</button>}
          {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
        </div>
      )}
    </aside>
  )
}
