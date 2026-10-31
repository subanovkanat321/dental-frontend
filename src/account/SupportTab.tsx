import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { useClose } from '../lib/useClose'
import { formatPhone, shortDate, timeOf } from '../lib/time'
import { useBlobUrl } from '../lib/useBlobUrl'
import { resizePhoto } from '../medical/thumb'
import { DeveloperContacts } from './Contacts'
import { TICKET_KINDS, TICKET_STATUS } from './texts'

type Me = Schemas['BookingViewsMe']
type Thread = Schemas['SupportTicketsThread']

/** Частые вопросы врачей — ответ сразу, без звонка в поддержку. */
const FAQ: [string, string][] = [
  ['Не появилась кнопка «Открыть»', 'Нажмите /start в чате с ботом. Если кнопки всё равно нет — попросите администратора проверить ваш Telegram в «Команда → Врачи».'],
  ['Вижу старую версию', 'Закройте приложение (свайп вниз) и откройте снова из бота; на компьютере — обновите страницу.'],
  ['Не приходят уведомления', 'Проверьте, что чат с ботом не на «Без звука» и вы нажимали /start. Уведомления приходят врачу его приёмов.'],
  ['Пациенту не дошло напоминание в Telegram', 'Пациент мог удалить чат с ботом. Напомните в WhatsApp или позвоните — кнопки в карточке приёма.'],
  ['«Время занято», хотя окно пустое', 'Его только что занял другой пациент или заявка. Обновите расписание — сетка покажет свободное.'],
]

/**
 * Тело обращения — полями формы, а не в адресе: текст не попадает в логи сервера и прокси.
 * Скриншот — до 1600 px: текст на экране читается, а файл лёгкий.
 */
async function ticketForm(fields: Record<string, string>, file: File | null): Promise<FormData> {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  if (file) form.append('file', await resizePhoto(file, 1600, 0.85), 'screenshot.jpg')
  return form
}

/**
 * «Техподдержка»: написать команде Tish (вопрос, идея, проблема) и переписка — справа; контакты
 * поддержки клиники и разработчиков; частые вопросы.
 */
export function SupportTab({ me, clinic, header, onPanel }: {
  me: Me
  clinic?: Schemas['ClinicView']
  header: ReactNode
  onPanel: (open: boolean) => void
}) {
  const list = useQuery({ queryKey: ['support-tickets'], queryFn: () => unwrap(api.GET('/api/support/tickets')) })
  const [opened, setOpenedState] = useState<number | string | null>(null)
  const setOpened = useCallback((next: number | string | null) => {
    setOpenedState(next)
    onPanel(next != null)
  }, [onPanel])
  const close = useCallback(() => setOpened(null), [setOpened])

  return (
    <>
      <section className="schedule-main">
        {header}
        <section className="card-block">
          <div className="block-head">
            <h2>Написать команде Tish</h2>
            <span className="actions">
              {Object.entries(TICKET_KINDS).map(([kind, k]) => <button key={kind} type="button" className="btn" onClick={() => setOpened(kind)}>{k.button}</button>)}
            </span>
          </div>
          {list.error && <p className="error">{list.error.message}</p>}
          {list.isPending ? <p className="hint">Загрузка…</p> : list.data?.length ? (
            <table className="table" aria-label="Ваши обращения">
              <thead><tr><th>Обращение</th><th>Статус</th><th>Обновлено</th></tr></thead>
              <tbody>
                {list.data.map((t) => {
                  const [status, cls] = TICKET_STATUS[t.status ?? 'OPEN'] ?? ['', 's-quiet']
                  return (
                    <tr key={t.id} className={t.id === opened ? 'active' : undefined}>
                      <td><button type="button" className="row-link" onClick={() => setOpened(t.id!)}>{TICKET_KINDS[t.kind ?? 'QUESTION']?.title}</button>
                        <span className="hint"> · {t.preview}</span></td>
                      <td><span className={`chip small ${cls}`}>{status}</span></td>
                      <td className="hint nowrap">{t.updatedAt ? shortDate(t.updatedAt) : ''}{t.author ? ` · ${t.author}` : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : <p className="hint">Пока нет обращений.</p>}
        </section>
        <section className="card-block">
          <h2>Поддержка клиники</h2>
          <p>Не открывается приложение, не приходят уведомления или что-то работает не так — можно и позвонить.</p>
          {clinic?.supportUrl || clinic?.supportPhone ? (
            <div className="actions">
              {clinic.supportUrl && <a className="btn primary" href={clinic.supportUrl} target="_blank" rel="noopener noreferrer">Написать в Telegram</a>}
              {clinic.supportPhone && <a className="btn" href={`tel:+${clinic.supportPhone}`}>Позвонить: {formatPhone(clinic.supportPhone)}</a>}
            </div>
          ) : <p className="hint">{me.admin ? 'Контакты поддержки не заданы — добавьте их в «Клиника → О клинике».' : 'Контакты поддержки пока не заданы — спросите администратора.'}</p>}
          <h3>Разработчики напрямую</h3>
          <DeveloperContacts />
        </section>
        <section className="card-block">
          <h2>Частые вопросы</h2>
          {FAQ.map(([q, a]) => <details key={q} className="faq"><summary>{q}</summary><p>{a}</p></details>)}
        </section>
      </section>
      {typeof opened === 'string' && <NewTicketPanel key={opened} kind={opened} onClose={close} onSent={(id) => setOpened(id)} />}
      {typeof opened === 'number' && <TicketPanel key={opened} id={opened} onClose={close} />}
    </>
  )
}

function ShotPicker({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  return (
    <div className="actions">
      <label className="btn">{file ? `Скриншот: ${file.name}` : 'Приложить скриншот'}
        <input type="file" className="sr-only" accept="image/*" aria-label="Скриншот" onChange={(e) => onChange(e.target.files?.[0] ?? null)} /></label>
      {file && <button type="button" className="btn ghost" onClick={() => onChange(null)}>Убрать</button>}
    </div>
  )
}

function NewTicketPanel({ kind, onClose, onSent }: { kind: string; onClose: () => void; onSent: (id: number) => void }) {
  useClose(onClose)
  const client = useQueryClient()
  const k = TICKET_KINDS[kind]!
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const send = useMutation<Thread, ApiError | Error>({
    mutationFn: async () => upload('/api/support/tickets', await ticketForm({ kind, text }, file)),
    onSuccess: (t) => {
      void client.invalidateQueries({ queryKey: ['support-tickets'] })
      onSent(t.ticket!.id!)
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    send.mutate()
  }
  return (
    <aside className="panel" aria-label={k.button}>
      <header className="panel-head">
        <h2>{k.button}</h2>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Напишите команде Tish</span>
          <textarea rows={6} maxLength={2000} required autoFocus placeholder={k.hint} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <ShotPicker file={file} onChange={setFile} />
        <p className="hint">Не пишите имён и телефонов пациентов и не прикладывайте их снимки — для разбора они не нужны.</p>
        {send.error && <p className="error" role="alert">{send.error instanceof ApiError ? send.error.fieldErrors.text ?? send.error.fieldErrors.file ?? send.error.message : 'Это не картинка — приложите скриншот'}</p>}
        <button type="submit" className="btn primary" disabled={send.isPending || !text.trim()}>Отправить</button>
      </form>
    </aside>
  )
}

/** Переписка: сообщения, скриншоты, дописать и «Закрыть — вопрос решён». */
function TicketPanel({ id, onClose }: { id: number; onClose: () => void }) {
  useClose(onClose)
  const client = useQueryClient()
  const thread = useQuery({ queryKey: ['support-ticket', id], queryFn: () => unwrap(api.GET('/api/support/tickets/{id}', { params: { path: { id } } })) })
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const onSaved = (t: Thread) => {
    client.setQueryData(['support-ticket', id], t)
    void client.invalidateQueries({ queryKey: ['support-tickets'] })
  }
  const send = useMutation<Thread, ApiError | Error>({
    mutationFn: async () => upload(`/api/support/tickets/${id}/messages`, await ticketForm({ text }, file)),
    onSuccess: (t) => {
      setText('')
      setFile(null)
      onSaved(t)
    },
  })
  const closeTicket = useMutation<Thread, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/support/tickets/{id}/close', { params: { path: { id } } })),
    onSuccess: onSaved,
  })
  const t = thread.data?.ticket
  const [status, cls] = TICKET_STATUS[t?.status ?? 'OPEN'] ?? ['', 's-quiet']
  return (
    <aside className="panel" aria-label="Обращение">
      <header className="panel-head">
        <div>
          <h2>{TICKET_KINDS[t?.kind ?? 'QUESTION']?.title ?? 'Обращение'}</h2>
          {t && <span className={`chip small ${cls}`}>{status}</span>}
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      {thread.isPending && <p className="hint">Загрузка…</p>}
      {thread.error && <p className="error">{thread.error.message}</p>}
      <div className="ticket-thread">
        {(thread.data?.messages ?? []).map((m) => (
          <div key={m.id} className={m.fromPlatform ? 'ticket-msg from-platform' : 'ticket-msg'}>
            <p className="hint">{m.author} · {m.createdAt ? `${shortDate(m.createdAt)} ${timeOf(m.createdAt)}` : ''}</p>
            <p>{m.text}</p>
            {m.hasImage && <MessageImage id={m.id!} />}
          </div>
        ))}
      </div>
      {t?.status === 'CLOSED' ? <p className="hint">Обращение закрыто. Новый вопрос — новым обращением.</p> : t && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); send.mutate() }}>
          <label className="field"><span>Дописать</span>
            <textarea rows={3} maxLength={2000} required value={text} onChange={(e) => setText(e.target.value)} /></label>
          <ShotPicker file={file} onChange={setFile} />
          {send.error && <p className="error" role="alert">{send.error instanceof ApiError ? send.error.fieldErrors.text ?? send.error.message : 'Это не картинка — приложите скриншот'}</p>}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={send.isPending || !text.trim()}>Отправить</button>
            <button type="button" className="btn" disabled={closeTicket.isPending}
              onClick={() => window.confirm('Закрыть обращение — вопрос решён?') && closeTicket.mutate()}>Закрыть — вопрос решён</button>
          </div>
        </form>
      )}
    </aside>
  )
}

function MessageImage({ id }: { id: number }) {
  const img = useBlobUrl(`/api/support/messages/${id}/image`)
  if (!img || img === 'error') return null
  return <a href={img.url} target="_blank" rel="noopener noreferrer"><img className="receipt" src={img.url} alt="Скриншот" /></a>
}
