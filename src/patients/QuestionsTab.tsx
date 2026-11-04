import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { haptic } from '../lib/telegram'
import { rowClick } from '../lib/rowClick'
import { formatPhone, shortDate } from '../lib/time'
import { useClose } from '../lib/useClose'
import { EmptyState } from '../layout/EmptyState'

type Question = Schemas['PatientQuestionsQuestionView']

/** Список вопросов: ждут ответа (старые сверху) или отвеченные и закрытые. */
function useQuestions(done: boolean) {
  return useQuery({
    queryKey: ['patient-questions', 'list', done],
    queryFn: () => unwrap(api.GET('/api/patient-questions', { params: { query: { done } } })),
  })
}

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

/** Кто спросил: имя из карточки или «нет в базе» — человек написал боту впервые. */
function who(q: Question): string {
  return q.patientName ?? 'Нет в базе клиники'
}

/**
 * «Пациенты → Вопросы»: что пациенты написали боту (не запись и не отзыв). Сервер показывает только
 * тех, кого сотрудник видит: регистратура и админ — всех, врач при «независимых врачах» — своих.
 */
export function QuestionsTab({ selected, onOpen }: { selected: number | null; onOpen: (id: number) => void }) {
  const [done, setDone] = useState(false)
  const list = useQuestions(done)
  return (
    <>
      <div className="segments" role="tablist" aria-label="Какие вопросы">
        {([[false, 'Ждут ответа'], [true, 'Отвеченные']] as const).map(([key, title]) => (
          <button key={title} type="button" role="tab" aria-selected={done === key} aria-pressed={done === key} onClick={() => setDone(key)}>{title}</button>
        ))}
      </div>
      {list.isPending && <p className="hint">Загрузка…</p>}
      {list.error && <p className="error">{list.error.message}</p>}
      {list.isSuccess && !list.data.questions?.length && (
        done
          ? <EmptyState icon="💬" title="Отвеченных вопросов пока нет." />
          : <EmptyState icon="💬" title="Новых вопросов нет.">Пациент напишет боту — вопрос появится здесь, а вам придёт уведомление.</EmptyState>
      )}
      {list.isSuccess && Boolean(list.data.questions?.length) && (
        <table className="table" aria-label="Вопросы пациентов">
          <thead><tr><th>Пациент</th><th>Когда</th><th>Вопрос</th></tr></thead>
          <tbody>
            {list.data.questions!.map((q) => (
              <tr key={q.id} className={['clickable', q.id === selected ? 'active' : ''].join(' ').trim()} onClick={rowClick(() => onOpen(q.id!))}>
                <td>
                  <button type="button" className="row-link" onClick={() => onOpen(q.id!)}>{who(q)}</button>
                  {q.status === 'CLOSED' && <span className="hint small"> · без ответа</span>}
                </td>
                <td className="nowrap">{shortDate(q.createdAt!, true)}</td>
                <td className="question-preview">{q.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

/**
 * Вопрос справа: текст, «✨ Черновик ответа» (если клиника включила ИИ), поле ответа и «Отправить» —
 * ответ уходит пациенту в бот. ИИ сам ничего не отправляет: черновик попадает в поле, сотрудник
 * проверяет. Без ИИ отвечают вручную.
 */
export function QuestionPanel({ questionId, onClose, onOpenPatient }: {
  questionId: number
  onClose: () => void
  onOpenPatient: (patientId: number) => void
}) {
  const close = useClose(onClose)
  const client = useQueryClient()
  const question = useQuery({
    queryKey: ['patient-questions', 'one', questionId],
    queryFn: () => unwrap(api.GET('/api/patient-questions/{id}', { params: { path: { id: questionId } } })),
  })
  // Можно ли просить черновик — из того же списка (уже в кэше)
  const ai = useQuestions(false).data?.ai ?? false
  const [text, setText] = useState('')
  const [drafted, setDrafted] = useState(false)
  const refresh = () => client.invalidateQueries({ queryKey: ['patient-questions'] })
  const draft = useMutation<Schemas['QuestionControllerDraft'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patient-questions/{id}/draft', { params: { path: { id: questionId } } })),
    onSuccess: (d) => {
      setText(d.text ?? '')
      setDrafted(true)
    },
  })
  const answer = useMutation<Question, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patient-questions/{id}/answer', { params: { path: { id: questionId } }, body: { text } })),
    onSuccess: () => {
      haptic('success')
      void refresh()
    },
    onError: () => haptic('error'),
  })
  const dismiss = useMutation<Question, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patient-questions/{id}/close', { params: { path: { id: questionId } } })),
    onSuccess: () => void refresh(),
  })

  const q = question.data
  return (
    <aside className="panel" aria-label="Вопрос пациента">
      <header className="panel-head">
        <div>
          <strong className="patient-name">{q ? who(q) : 'Вопрос пациента'}</strong>
          {q?.patientPhone && <span className="hint num"> {formatPhone(q.patientPhone)}</span>}
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
      </header>
      {question.isPending && <p className="hint">Загрузка…</p>}
      {question.error && <p className="error">{question.error.message}</p>}
      {q && (
        <>
          <p className="hint small">
            {shortDate(q.createdAt!, true)} · в Telegram
            {q.patientId != null && <> · <button type="button" className="link" onClick={() => onOpenPatient(q.patientId!)}>Карточка пациента</button></>}
          </p>
          {q.patientId == null && <p className="hint small">Человек написал боту впервые — его ещё нет в базе клиники.</p>}
          <p className="question-text">{q.text}</p>
          {q.status === 'ANSWERED' && (
            <section aria-label="Ответ">
              <h3>Ответ · {shortDate(q.answeredAt!, true)}</h3>
              <p className="question-text">{q.answer}</p>
            </section>
          )}
          {q.status === 'CLOSED' && <p className="hint">Закрыт без ответа · {shortDate(q.answeredAt!, true)}</p>}
          {q.status === 'NEW' && (
            <>
              {ai && (
                <button type="button" className="btn" disabled={draft.isPending} onClick={() => draft.mutate()}>
                  {draft.isPending ? 'Пишем черновик…' : drafted ? '✨ Другой черновик' : '✨ Черновик ответа'}</button>
              )}
              {drafted && <p className="hint small">✨ Черновик написал ИИ — проверьте и поправьте перед отправкой.</p>}
              <textarea className="question-answer" aria-label="Ответ пациенту" rows={7} maxLength={4000} value={text} placeholder="Ответ пациенту"
                onChange={(e) => setText(e.target.value)} />
              <p className="hint small">Ответ уйдёт пациенту в Telegram от имени клиники.</p>
              <div className="actions">
                <button type="button" className="btn primary" disabled={answer.isPending || !text.trim()} onClick={() => answer.mutate()}>
                  {answer.isPending ? 'Отправляем…' : 'Отправить'}</button>
                <button type="button" className="btn ghost" disabled={dismiss.isPending}
                  onClick={() => void ask('Закрыть вопрос без ответа? Пациент ничего не получит.').then((ok) => ok && dismiss.mutate())}>
                  Закрыть без ответа</button>
              </div>
            </>
          )}
          {answer.isSuccess && <p className="tone-ok" role="status">Ответ отправлен пациенту</p>}
          {(draft.error ?? answer.error ?? dismiss.error) && (
            <p className="error" role="alert">{errorText(draft.error ?? answer.error ?? dismiss.error)}</p>
          )}
        </>
      )}
    </aside>
  )
}
