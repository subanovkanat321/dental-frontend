import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../../lib/confirm'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../../api/client'
import { EmptyState } from '../../layout/EmptyState'
import { confirmLeave } from '../../lib/unsaved'
import { shortDate } from '../../lib/time'
import { SurveyForm } from '../../survey/SurveyForm'
import { rolesText, STATUS } from '../../survey/texts'
import { definitionOf } from './definition'
import { SurveyEditor } from './SurveyEditor'
import { SurveyResults } from './SurveyResults'
import { Loading } from '../../layout/Loading'

type Details = Schemas['SurveyDetails']
type View = 'edit' | 'preview' | 'results'

/**
 * «Опросы» (владелец и менеджеры платформы): спросить сотрудников клиник, что им удобно и чего не
 * хватает. Список → опрос: редактор, предпросмотр (как увидит сотрудник) и итоги.
 */
export function SurveysTab() {
  const client = useQueryClient()
  const list = useQuery({ queryKey: ['platform-surveys'], queryFn: () => unwrap(api.GET('/api/platform/surveys')) })
  const [opened, setOpened] = useState<number | null>(null)
  const create = useMutation<Details, ApiError, 'template' | 'empty'>({
    mutationFn: async (kind) => {
      const body = kind === 'template' ? await unwrap(api.GET('/api/platform/surveys/template')) : { title: 'Новый опрос', intro: '', questions: [] }
      return unwrap(api.POST('/api/platform/surveys', { body }))
    },
    onSuccess: (s) => {
      client.setQueryData(['platform-survey', s.id], s)
      void client.invalidateQueries({ queryKey: ['platform-surveys'] })
      setOpened(s.id!)
    },
  })
  if (opened != null) {
    return <SurveyView key={opened} id={opened} onBack={() => confirmLeave() && setOpened(null)} onOpen={setOpened} />
  }
  const surveys = list.data ?? []
  return (
    <section className="card-block">
      <h2>Опросы сотрудников</h2>
      <p className="hint">Спросите врачей, руководителей, регистратуру и ассистентов, что им удобно и чего не хватает. Сотрудник видит приглашение на «Расписании»
        и отвечает один раз; итоги — по ролям и клиникам, без данных пациентов.</p>
      {list.error && <p className="error">{list.error.message}</p>}
      {list.isPending ? <Loading /> : surveys.length ? (
        <table className="table" aria-label="Опросы">
          <thead><tr><th>Опрос</th><th>Кому</th><th>Статус</th><th>Ответов</th><th>Создан</th></tr></thead>
          <tbody>
            {surveys.map((s) => {
              const [status, cls] = STATUS[s.status ?? 'DRAFT']
              return (
                <tr key={s.id}>
                  <td><button type="button" className="row-link" onClick={() => setOpened(s.id!)}>{s.title}</button></td>
                  <td>{rolesText(s.roles)}</td>
                  <td><span className={`chip small ${cls}`}>{status}</span></td>
                  <td className="num">{s.responses}</td>
                  <td className="hint nowrap">{s.createdAt ? shortDate(s.createdAt) : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : <EmptyState title="Опросов пока нет">Начните с готового «Как вам Tish?» — 7 вопросов, его можно поправить.</EmptyState>}
      {create.error && <p className="error" role="alert">{create.error.message}</p>}
      <div className="actions">
        <button type="button" className="btn primary" disabled={create.isPending} onClick={() => create.mutate('template')}>Создать из шаблона</button>
        <button type="button" className="btn" disabled={create.isPending} onClick={() => create.mutate('empty')}>Пустой опрос</button>
      </div>
    </section>
  )
}

function SurveyView({ id, onBack, onOpen }: { id: number; onBack: () => void; onOpen: (id: number) => void }) {
  const client = useQueryClient()
  const survey = useQuery({ queryKey: ['platform-survey', id], queryFn: () => unwrap(api.GET('/api/platform/surveys/{id}', { params: { path: { id } } })) })
  // Пока не выбрали сами: с ответами — сразу «Итоги», без них — «Вопросы»
  const [chosen, setView] = useState<View | null>(null)
  const refresh = (s: Details) => {
    client.setQueryData(['platform-survey', id], s)
    void client.invalidateQueries({ queryKey: ['platform-surveys'] })
  }
  const start = useMutation<Details, ApiError>({ mutationFn: () => unwrap(api.POST('/api/platform/surveys/{id}/start', { params: { path: { id } } })), onSuccess: refresh })
  const stop = useMutation<Details, ApiError>({ mutationFn: () => unwrap(api.POST('/api/platform/surveys/{id}/stop', { params: { path: { id } } })), onSuccess: refresh })
  const copy = useMutation<Details, ApiError>({
    mutationFn: () => {
      const s = survey.data!
      const body = definitionOf({ ...s, title: `${s.title} (копия)`.slice(0, 200) }, (s.questions ?? []).map((q) => ({ ...q, id: undefined })))
      return unwrap(api.POST('/api/platform/surveys', { body }))
    },
    onSuccess: (s) => {
      client.setQueryData(['platform-survey', s.id], s)
      void client.invalidateQueries({ queryKey: ['platform-surveys'] })
      onOpen(s.id!)
    },
  })
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/platform/surveys/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['platform-surveys'] })
      onBack()
    },
  })
  const s = survey.data
  if (!s) {
    return (
      <section className="card-block">
        <button type="button" className="btn ghost back" onClick={onBack}>‹ Все опросы</button>
        {survey.error ? <p className="error">{survey.error.message}</p> : <Loading />}
      </section>
    )
  }
  const view = chosen ?? ((s.responses ?? 0) > 0 ? 'results' : 'edit')
  const [status, cls] = STATUS[s.status ?? 'DRAFT']
  const error = start.error ?? stop.error ?? copy.error ?? remove.error
  return (
    <div className="survey-view">
      <div className="survey-view-head">
        <button type="button" className="btn ghost back" onClick={onBack}>‹ Все опросы</button>
        <h2>{s.title}</h2>
        <span className={`chip small ${cls}`}>{status}</span>
        <span className="hint">ответов: {s.responses}</span>
      </div>
      <div className="actions">
        {s.active ? (
          <button type="button" className="btn" disabled={stop.isPending}
            onClick={() => void ask('Остановить опрос? Приглашение пропадёт, ответы и итоги останутся.').then((ok) => ok && stop.mutate())}>Остановить</button>
        ) : (
          <button type="button" className="btn primary" disabled={start.isPending}
            onClick={() => void ask(`Запустить опрос? Его увидят: ${rolesText(s.roles)}${s.announce && !s.announcedAt ? '; в бот придёт приглашение' : ''}.`).then((ok) => ok && start.mutate())}>
            Запустить</button>
        )}
        <button type="button" className="btn" disabled={copy.isPending} onClick={() => copy.mutate()}>Копия</button>
        {!s.responses && (
          <button type="button" className="btn danger" disabled={remove.isPending} onClick={() => void ask('Удалить опрос?').then((ok) => ok && remove.mutate())}>Удалить</button>
        )}
      </div>
      {error && <p className="error" role="alert">{error.fieldErrors.questions ?? error.message}</p>}
      <div className="segments tabs" role="tablist" aria-label="Опрос">
        {([['edit', 'Вопросы'], ['preview', 'Как увидят'], ['results', `Итоги (${s.responses})`]] as [View, string][]).map(([key, title]) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} aria-pressed={view === key}
            onClick={() => (view !== 'edit' || confirmLeave()) && setView(key)}>{title}</button>
        ))}
      </div>
      {view === 'edit' && <SurveyEditor survey={s} />}
      {view === 'preview' && <SurveyForm form={{ id: s.id, title: s.title, intro: s.intro, questions: s.questions }} preview />}
      {view === 'results' && <SurveyResults survey={s} />}
    </div>
  )
}
