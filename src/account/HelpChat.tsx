import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { shortDate, timeOf } from '../lib/time'
import { useClose } from '../lib/useClose'
import { Spinner } from '../layout/Loading'

type Thread = Schemas['SupportTicketsThread']

/**
 * «💬 Помощь»: чат с помощником Tish. Отвечает бот по базе знаний; не уверен или нужен человек —
 * вопрос уходит команде Tish, их ответ придёт сюда же и в Telegram. Без ключа ИИ на сервере —
 * каждый вопрос сразу команде (так и пишем). Переписка — обычное обращение: видна в списке
 * «Ваши обращения».
 */
export function HelpChatPanel({ ticketId, onClose }: {
  /** Продолжить эту переписку; нет — новый вопрос. */
  ticketId?: number
  onClose: () => void
}) {
  useClose(onClose)
  const client = useQueryClient()
  const [id, setId] = useState<number | undefined>(ticketId)
  const [text, setText] = useState('')
  const info = useQuery({ queryKey: ['support-chat'], queryFn: () => unwrap(api.GET('/api/support/chat')) })
  const thread = useQuery({
    queryKey: ['support-ticket', '/api/support', id],
    queryFn: () => unwrap(api.GET('/api/support/tickets/{id}', { params: { path: { id: id! } } })),
    enabled: id != null,
  })
  const ask = useMutation<Thread, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/support/chat', { body: { ticketId: id, text: text.trim() } })),
    onSuccess: (t) => {
      const newId = t.ticket!.id!
      client.setQueryData(['support-ticket', '/api/support', newId], t)
      void client.invalidateQueries({ queryKey: ['support-tickets'] })
      void client.invalidateQueries({ queryKey: ['support-chat'] })
      setText('')
      if (id == null) setId(newId)
    },
  })
  const t = thread.data?.ticket
  const messages = id == null ? [] : thread.data?.messages ?? []
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [messages.length, ask.isPending])
  const left = info.data ? Math.max(0, (info.data.dailyLimit ?? 0) - (info.data.usedToday ?? 0)) : null
  const closed = t?.status === 'CLOSED'
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (text.trim()) ask.mutate()
  }
  const newQuestion = () => {
    setId(undefined)
    setText('')
    ask.reset()
  }
  return (
    <aside className="panel help-chat" aria-label="Помощь">
      <header className="panel-head">
        <h2>Помощь</h2>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      {info.data && !info.data.ai && (
        <p className="hint" role="note">Помощник сейчас не отвечает сам — вопрос сразу уйдёт команде Tish, ответ придёт сюда и в Telegram.</p>
      )}
      {id == null && info.data?.ai && (
        <p className="hint">Спросите, как что-то сделать в Tish: записать, принять оплату, настроить склад. Не знает ответа — передаст вопрос команде Tish.</p>
      )}
      {thread.error && <p className="error">{thread.error.message}</p>}
      <div className="ticket-thread" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={m.fromPlatform ? 'ticket-msg from-platform' : 'ticket-msg'}>
            <p className="hint">{m.fromBot ? '🤖 ' : ''}{m.author} · {m.createdAt ? `${shortDate(m.createdAt)} ${timeOf(m.createdAt)}` : ''}</p>
            <p>{m.text}</p>
          </div>
        ))}
        {ask.isPending && <p className="hint"><Spinner />{info.data?.ai === false ? 'Отправляем…' : 'Помощник думает…'}</p>}
        <div ref={end} />
      </div>
      {t?.escalated && !closed && (
        <p className="tone-wait" role="status">Вопрос передан команде Tish — ответ придёт сюда и в Telegram.</p>
      )}
      {closed ? (
        <div className="actions">
          <p className="hint">Вопрос закрыт.</p>
          <button type="button" className="btn primary" onClick={newQuestion}>Новый вопрос</button>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <label className="field"><span>{id == null ? 'Ваш вопрос' : 'Дописать'}</span>
            <textarea rows={3} maxLength={info.data?.maxLength ?? 1000} required autoFocus value={text}
              placeholder="Например: как принять доплату?" onChange={(e) => setText(e.target.value)} /></label>
          <p className="hint">Не пишите имён, телефонов и других данных пациентов — для вопроса они не нужны.</p>
          {ask.error && <p className="error" role="alert">{ask.error.fieldErrors?.text ?? ask.error.message}</p>}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={ask.isPending || !text.trim() || left === 0}>Спросить</button>
            {id != null && <button type="button" className="btn" onClick={newQuestion}>Новый вопрос</button>}
            {left != null && info.data?.ai && <span className="hint">{left === 0 ? 'Вопросы на сегодня закончились' : `Осталось сегодня: ${left}`}</span>}
          </div>
        </form>
      )}
    </aside>
  )
}
