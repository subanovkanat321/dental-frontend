import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { useClose } from '../lib/useClose'
import { formatPhone, shortDate } from '../lib/time'
import { DeveloperContacts } from './Contacts'
import { HelpChatPanel } from './HelpChat'
import { ShotPicker, TicketPanel } from './TicketThread'
import { ticketForm } from './tickets'
import { TICKET_KINDS, TICKET_STATUS } from './texts'
import { EmptyState } from '../layout/EmptyState'
import { Loading } from '../layout/Loading'

type Me = Schemas['BookingViewsMe']
type Thread = Schemas['SupportTicketsThread']

/** Чат с помощником — вместо вида обращения в состоянии «что открыто справа». */
const HELP = 'help'

/** Частые вопросы врачей — ответ сразу, без звонка в поддержку. */
const FAQ: [string, string][] = [
  ['Не появилась кнопка «Открыть»', 'Нажмите /start в чате с ботом. Если кнопки всё равно нет — попросите руководителя проверить ваш Telegram в «Настройки → Персонал».'],
  ['Вижу старую версию', 'Закройте приложение (свайп вниз) и откройте снова из бота; на компьютере — обновите страницу.'],
  ['Не приходят уведомления', 'Проверьте, что чат с ботом не на «Без звука» и вы нажимали /start. Уведомления приходят врачу его приёмов.'],
  ['Пациенту не дошло напоминание в Telegram', 'Пациент мог удалить чат с ботом. Напомните в WhatsApp или позвоните — кнопки в карточке приёма.'],
  ['«Время занято», хотя окно пустое', 'Его только что занял другой пациент или заявка. Обновите расписание — сетка покажет свободное.'],
]

/**
 * «Техподдержка»: написать команде Tish (вопрос, идея, проблема) и переписка — справа; контакты
 * поддержки клиники и разработчиков; частые вопросы.
 */
export function SupportTab({ me, clinic, header, onPanel, initialTicket, initialHelp = false }: {
  me: Me
  clinic?: Schemas['ClinicView']
  header: ReactNode
  onPanel: (open: boolean) => void
  /** Кнопка бота «Открыть ответ»: сразу переписка по обращению. */
  initialTicket?: number
  /** «Настройки → Помощь и техподдержка» и «Памятка»: сразу чат с помощником. */
  initialHelp?: boolean
}) {
  const list = useQuery({ queryKey: ['support-tickets'], queryFn: () => unwrap(api.GET('/api/support/tickets')) })
  const [opened, setOpenedState] = useState<number | string | null>(initialTicket ?? (initialHelp ? HELP : null))
  const setOpened = useCallback((next: number | string | null) => {
    setOpenedState(next)
    onPanel(next != null)
  }, [onPanel])
  const close = useCallback(() => setOpened(null), [setOpened])
  // Переписку из чата помощи открываем снова чатом, а не обычным обращением
  const openedTicket = typeof opened === 'number' ? list.data?.find((t) => t.id === opened) : undefined

  return (
    <>
      <section className="schedule-main">
        {header}
        <section className="card-block" aria-label="Помощь">
          <div className="block-head">
            <h2>Помощь</h2>
            <span className="actions"><button type="button" className="btn primary" onClick={() => setOpened(HELP)}>Спросить помощника</button></span>
          </div>
          <p className="hint">Помощник сразу подскажет, как что-то сделать в Tish. Не знает ответа — передаст вопрос команде Tish.</p>
        </section>
        <section className="card-block">
          <div className="block-head">
            <h2>Написать команде Tish</h2>
            <span className="actions">
              {Object.entries(TICKET_KINDS).map(([kind, k]) => <button key={kind} type="button" className="btn" onClick={() => setOpened(kind)}>{k.button}</button>)}
            </span>
          </div>
          {list.error && <p className="error">{list.error.message}</p>}
          {list.isPending ? <Loading /> : list.data?.length ? (
            <table className="table" aria-label="Ваши обращения">
              <thead><tr><th>Обращение</th><th>Статус</th><th>Обновлено</th></tr></thead>
              <tbody>
                {list.data.map((t) => {
                  const [status, cls] = TICKET_STATUS[t.status ?? 'OPEN'] ?? ['', 's-quiet']
                  return (
                    <tr key={t.id} className={t.id === opened ? 'active' : undefined}>
                      <td><button type="button" className="row-link" onClick={() => setOpened(t.id!)}>{t.viaBot ? '💬 Помощь' : TICKET_KINDS[t.kind ?? 'QUESTION']?.title}</button>
                        <span className="hint"> · {t.preview}</span></td>
                      <td><span className={`chip small ${cls}`}>{status}</span></td>
                      <td className="hint nowrap">{t.updatedAt ? shortDate(t.updatedAt) : ''}{t.author ? ` · ${t.author}` : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : <EmptyState compact title="Пока нет обращений" />}
        </section>
        <section className="card-block">
          <h2>Поддержка клиники</h2>
          <p>Не открывается приложение, не приходят уведомления или что-то работает не так — можно и позвонить.</p>
          {clinic?.supportUrl || clinic?.supportPhone ? (
            <div className="actions">
              {clinic.supportUrl && <a className="btn primary" href={clinic.supportUrl} target="_blank" rel="noopener noreferrer">Написать в Telegram</a>}
              {clinic.supportPhone && <a className="btn" href={`tel:+${clinic.supportPhone}`}>Позвонить: {formatPhone(clinic.supportPhone)}</a>}
            </div>
          ) : <p className="hint">{me.admin ? 'Контакты поддержки не заданы — добавьте их в «Настройки → О клинике».' : 'Контакты поддержки пока не заданы — спросите руководителя.'}</p>}
          <h3>Разработчики напрямую</h3>
          <DeveloperContacts />
        </section>
        <section className="card-block">
          <h2>Частые вопросы</h2>
          {FAQ.map(([q, a]) => <details key={q} className="faq"><summary>{q}</summary><p>{a}</p></details>)}
        </section>
      </section>
      {opened === HELP && <HelpChatPanel key="help" onClose={close} />}
      {typeof opened === 'string' && opened !== HELP && <NewTicketPanel key={opened} kind={opened} onClose={close} onSent={(id) => setOpened(id)} />}
      {typeof opened === 'number' && !list.isPending && (openedTicket?.viaBot
        ? <HelpChatPanel key="help" ticketId={opened} onClose={close} />
        : <TicketPanel key={opened} id={opened} onClose={close} />)}
    </>
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
