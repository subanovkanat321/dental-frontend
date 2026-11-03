import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { shortDate, timeOf } from '../lib/time'
import { useBlobUrl } from '../lib/useBlobUrl'
import { useClose } from '../lib/useClose'
import { ticketForm } from './tickets'
import { TICKET_KINDS, TICKET_STATUS } from './texts'

type Thread = Schemas['SupportTicketsThread']

export function ShotPicker({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  return (
    <div className="actions">
      <label className="btn">{file ? `Скриншот: ${file.name}` : 'Приложить скриншот'}
        <input type="file" className="sr-only" accept="image/*" aria-label="Скриншот" onChange={(e) => onChange(e.target.files?.[0] ?? null)} /></label>
      {file && <button type="button" className="btn ghost" onClick={() => onChange(null)}>Убрать</button>}
    </div>
  )
}

/** Переписка: сообщения, скриншоты, дописать и «Закрыть — вопрос решён». */
export function TicketPanel({ id, platform = false, onClose }: { id: number; platform?: boolean; onClose: () => void }) {
  useClose(onClose)
  const client = useQueryClient()
  const base = platform ? '/api/platform/support' : '/api/support'
  const list = platform ? 'platform-tickets' : 'support-tickets'
  const thread = useQuery({
    queryKey: ['support-ticket', base, id],
    queryFn: () => unwrap(platform
      ? api.GET('/api/platform/support/tickets/{id}', { params: { path: { id } } })
      : api.GET('/api/support/tickets/{id}', { params: { path: { id } } })),
  })
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const onSaved = (t: Thread) => {
    client.setQueryData(['support-ticket', base, id], t)
    void client.invalidateQueries({ queryKey: [list] })
  }
  const send = useMutation<Thread, ApiError | Error>({
    mutationFn: async () => upload(`${base}/tickets/${id}/messages`, await ticketForm({ text }, file)),
    onSuccess: (t) => {
      setText('')
      setFile(null)
      onSaved(t)
    },
  })
  const closeTicket = useMutation<Thread, ApiError>({
    mutationFn: () => unwrap(platform
      ? api.POST('/api/platform/support/tickets/{id}/close', { params: { path: { id } } })
      : api.POST('/api/support/tickets/{id}/close', { params: { path: { id } } })),
    onSuccess: onSaved,
  })
  const t = thread.data?.ticket
  const [status, cls] = TICKET_STATUS[t?.status ?? 'OPEN'] ?? ['', 's-quiet']
  return (
    <aside className="panel" aria-label="Обращение">
      <header className="panel-head">
        <div>
          <h2>{t?.viaBot ? 'Помощь' : TICKET_KINDS[t?.kind ?? 'QUESTION']?.title ?? 'Обращение'}</h2>
          {t && <span className={`chip small ${cls}`}>{status}</span>}
          {platform && t && <span className="hint"> {t.clinicName} · {t.author}</span>}
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      {thread.isPending && <p className="hint">Загрузка…</p>}
      {thread.error && <p className="error">{thread.error.message}</p>}
      <div className="ticket-thread">
        {(thread.data?.messages ?? []).map((m) => (
          <div key={m.id} className={m.fromPlatform ? 'ticket-msg from-platform' : 'ticket-msg'}>
            <p className="hint">{m.fromBot ? '🤖 ' : ''}{m.author} · {m.createdAt ? `${shortDate(m.createdAt)} ${timeOf(m.createdAt)}` : ''}</p>
            <p>{m.text}</p>
            {m.hasImage && <MessageImage path={`${base}/messages/${m.id}/image`} />}
          </div>
        ))}
      </div>
      {t?.status === 'CLOSED' ? <p className="hint">Обращение закрыто. Новый вопрос — новым обращением.</p> : t && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); send.mutate() }}>
          <label className="field"><span>{platform ? 'Ответ клинике' : 'Дописать'}</span>
            <textarea rows={3} maxLength={2000} required value={text} onChange={(e) => setText(e.target.value)} /></label>
          <ShotPicker file={file} onChange={setFile} />
          {send.error && <p className="error" role="alert">{send.error instanceof ApiError ? send.error.fieldErrors.text ?? send.error.message : 'Это не картинка — приложите скриншот'}</p>}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={send.isPending || !text.trim()}>{platform ? 'Ответить' : 'Отправить'}</button>
            <button type="button" className="btn" disabled={closeTicket.isPending}
              onClick={() => window.confirm('Закрыть обращение — вопрос решён?') && closeTicket.mutate()}>Закрыть — вопрос решён</button>
          </div>
        </form>
      )}
    </aside>
  )
}

function MessageImage({ path }: { path: string }) {
  const img = useBlobUrl(path)
  if (!img || img === 'error') return null
  return <a href={img.url} target="_blank" rel="noopener noreferrer"><img className="receipt" src={img.url} alt="Скриншот" /></a>
}
