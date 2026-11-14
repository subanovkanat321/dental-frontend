import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { openHelpChat } from '../lib/helpChat'
import { useClose } from '../lib/useClose'
import { formatPhone, shortDate } from '../lib/time'
import { DeveloperContacts } from './Contacts'
import { ShotPicker, TicketPanel } from './TicketThread'
import { ticketForm } from './tickets'
import { TICKET_KINDS, TICKET_STATUS } from './texts'
import { EmptyState } from '../layout/EmptyState'
import { Icon } from '../layout/Icon'
import { Loading } from '../layout/Loading'
import { rowOpen } from '../lib/rowClick'
import { Fold } from '../layout/Fold'
import { openMine } from '../lib/route'
import './support.css'

type Me = Schemas['BookingViewsMe']
type Thread = Schemas['SupportTicketsThread']

/** Частые вопросы врачей — ответ сразу, без звонка в поддержку. */
const FAQ: [string, string][] = [
  ['Не появилась кнопка «Открыть»', 'Нажмите /start в чате с ботом. Если кнопки всё равно нет — попросите руководителя проверить ваш Telegram в «Клиника → Персонал».'],
  ['Вижу старую версию', 'Закройте приложение (свайп вниз) и откройте снова из бота; на компьютере — обновите страницу.'],
  ['Не приходят уведомления', 'Проверьте, что чат с ботом не на «Без звука» и вы нажимали /start. Уведомления приходят врачу его приёмов.'],
  ['Пациенту не дошло напоминание в Telegram', 'Пациент мог удалить чат с ботом. Напомните в WhatsApp или позвоните — кнопки в карточке приёма.'],
  ['«Время занято», хотя окно пустое', 'Его только что занял другой пациент или заявка. Обновите расписание — сетка покажет свободное.'],
]

/**
 * «Помощь → Написать в Tish» — одно место для обращений к команде Tish (с 2026-11-13 вместо «Техподдержки»,
 * «Написать разработчикам» и «Предложить идею»). На всю ширину сеткой `.page-grid` (2026-11-14): одна карточка с двумя
 * действиями — главное «Написать» (одна форма, тип: вопрос / что-то не работает / идея — справа панелью) и «Спросить
 * помощника» (ответит сразу, окном Shell), рядом «Мои обращения» с ответами; ниже частые вопросы и прямые контакты
 * (поддержка клиники и команда Tish) — свёрнуто: обычно хватает обращения.
 */
export function SupportTab({ me, clinic, header, onPanel, initialTicket, initialHelp = false }: {
  me: Me
  clinic?: Schemas['ClinicView']
  header: ReactNode
  onPanel: (open: boolean) => void
  /** Кнопка бота «Открыть ответ»: сразу переписка по обращению. */
  initialTicket?: number
  /** Старые ссылки «Спросить помощника» (#/help/chat): сразу чат с помощником. */
  initialHelp?: boolean
}) {
  const list = useQuery({ queryKey: ['support-tickets'], queryFn: () => unwrap(api.GET('/api/support/tickets')) })
  /** Что открыто справа: новое обращение ('new') или обращение (id). Чат с помощником — не здесь, а окном Shell. */
  const [opened, setOpened] = useState<number | 'new' | null>(initialTicket ?? null)
  const close = () => setOpened(null)
  // Чат с помощником — то же окно, что из меню «Помощь» (lib/helpChat.ts), а не панель этой страницы
  // Один раз: скрытый раздел (Activity в App.tsx) снимает эффекты и при возврате запускает их снова
  const shownOnce = useRef(false)
  useEffect(() => {
    if (initialHelp && !shownOnce.current) openHelpChat()
    shownOnce.current = true
  }, [initialHelp])
  // Переписку из чата помощи открываем снова чатом, а не обычным обращением (кнопка бота «Открыть ответ» — по id)
  const openedTicket = typeof opened === 'number' ? list.data?.find((t) => t.id === opened) : undefined
  const botThread = openedTicket?.viaBot ? openedTicket.id : null
  const botShown = useRef<number | null>(null)
  useEffect(() => {
    if (botThread == null || botShown.current === botThread) return
    botShown.current = botThread
    openHelpChat(botThread)
  }, [botThread])
  /** Ассистент — окном чата (панель справа закрываем, чтобы окна не легли друг на друга), остальное — панелью справа. */
  const askHelper = (ticketId?: number) => {
    setOpened(null)
    openHelpChat(ticketId)
  }
  const openTicket = (t: Schemas['SupportTicketsTicket']) => (t.viaBot ? askHelper(t.id) : setOpened(t.id))
  // Колонка справа — по тому, что в ней на самом деле: и при открытии по адресу (обращение из бота), не только по кнопке
  const panel = opened === 'new' || (typeof opened === 'number' && !list.isPending && !openedTicket?.viaBot)
  useEffect(() => { onPanel(panel) }, [panel, onPanel])
  const answered = list.data?.filter((t) => t.status === 'ANSWERED').length ?? 0

  return (
    <>
      <section className="schedule-main support-page">
        {header}
        <div className="page-grid">
          <section className="card-block support-contact" aria-label="Написать в Tish">
            <h2>Написать команде Tish</h2>
            <div className="support-actions">
              <div className="support-action">
                <button type="button" className="btn primary" onClick={() => setOpened('new')}><WriteIcon />Написать</button>
                <p className="hint">Вопрос, что-то не работает или идея — ответ придёт сюда и в Telegram.</p>
              </div>
              <div className="support-action">
                <button type="button" className="btn support-helper" onClick={() => askHelper()}><Icon name="help" />Спросить помощника</button>
                <p className="hint">Ответит сразу; не знает — сам передаст вопрос команде Tish.</p>
              </div>
            </div>
          </section>
          <section className="card-block" aria-label="Мои обращения">
            <div className="block-head">
              <h2>Мои обращения</h2>
              {answered > 0 && <span className="chip small s-ok">Есть ответ: {answered}</span>}
            </div>
            {list.error && <p className="error">{list.error.message}</p>}
            {list.isPending ? <Loading /> : list.data?.length ? (
              <table className="table support-tickets" aria-label="Мои обращения">
                <thead><tr><th>Обращение</th><th>Статус</th><th>Обновлено</th></tr></thead>
                <tbody>
                  {list.data.map((t) => {
                    const [status, cls] = TICKET_STATUS[t.status ?? 'OPEN'] ?? ['', 's-quiet']
                    // «Помощник: в чём разница…» — откуда обращение мелким чипом, затем текст; строка нажимается целиком
                    return (
                      <tr key={t.id} {...rowOpen(() => openTicket(t), panel && t.id === opened && 'active')}>
                        <td><button type="button" className="row-link ticket-row-link" onClick={() => openTicket(t)}>
                          <span className="chip small s-quiet ticket-src">{t.viaBot ? 'Помощник' : kindTitle(t.kind)}</span>
                          <span className="ticket-preview">{t.preview}</span>
                        </button></td>
                        <td><span className={`chip small ${cls}`}>{status}</span></td>
                        <td className="hint nowrap">{t.updatedAt ? shortDate(t.updatedAt) : ''}{t.author && <span className="ticket-author">{t.author}</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : !list.error && <EmptyState compact title="Пока нет обращений" />}
          </section>
          <section className="card-block">
            <h2>Частые вопросы</h2>
            {FAQ.map(([q, a]) => <details key={q} className="faq"><summary>{q}</summary><p>{a}</p></details>)}
          </section>
          <section className="card-block">
            <Fold title="Срочно — позвонить или написать напрямую">
              <h3>Поддержка вашей клиники</h3>
              {clinic?.supportUrl || clinic?.supportPhone ? (
                <div className="actions">
                  {clinic.supportUrl && <a className="btn" href={clinic.supportUrl} target="_blank" rel="noopener noreferrer">Написать в Telegram</a>}
                  {clinic.supportPhone && <a className="btn" href={`tel:+${clinic.supportPhone}`}>Позвонить: {formatPhone(clinic.supportPhone)}</a>}
                </div>
              ) : <p className="hint">{me.admin ? 'Контакты не заданы — добавьте их в «Клиника → О клинике».' : 'Контакты пока не заданы — спросите руководителя.'}</p>}
              <h3>Команда Tish</h3>
              <DeveloperContacts />
            </Fold>
          </section>
        </div>
        {/* Опрос команды Tish — сотрудникам клиник (команда платформы его составляет); бывший пункт меню «Отзыв о Tish» */}
        {!me.platform && (
          <p className="hint support-survey">Есть 2–3 минуты? <button type="button" className="link" onClick={() => openMine('help', 'survey')}>Ответьте на опрос команды Tish</button> — так мы решаем, что делать дальше.</p>
        )}
      </section>
      {opened === 'new' && <NewTicketPanel onClose={close} onSent={(id) => setOpened(id)} />}
      {typeof opened === 'number' && panel && <TicketPanel key={opened} id={opened} onClose={close} />}
    </>
  )
}

/** Тип обращения без эмодзи — для чипа в «Мои обращения». */
function kindTitle(kind?: string | null): string {
  return (TICKET_KINDS[kind ?? 'QUESTION'] ?? TICKET_KINDS.QUESTION!).title
}

/** «Написать» — карандаш линией (как значки меню «Помощь»), а не эмодзи ✍️. */
function WriteIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />
    </svg>
  )
}

/** Одна форма обращения: тип (вопрос / что-то не работает / идея), текст и скриншот. */
function NewTicketPanel({ onClose, onSent }: { onClose: () => void; onSent: (id: number) => void }) {
  useClose(onClose)
  const client = useQueryClient()
  const [kind, setKind] = useState('QUESTION')
  const k = TICKET_KINDS[kind]!
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const send = useMutation<Thread, ApiError | Error>({
    mutationFn: async () => upload('/api/support/tickets', await ticketForm({ kind, text }, file)),
    onSuccess: (t) => {
      void client.invalidateQueries({ queryKey: ['support-tickets'] })
      onSent(t.ticket!.id)
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    send.mutate()
  }
  return (
    <aside className="panel" aria-label="Написать в Tish">
      <header className="panel-head">
        <h2>Написать в Tish</h2>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      <form className="form" onSubmit={submit}>
        <div className="field"><span>О чём</span>
          <div className="segments ticket-kinds" role="radiogroup" aria-label="О чём">
            {Object.entries(TICKET_KINDS).map(([key, x]) => (
              <button key={key} type="button" role="radio" aria-checked={kind === key} aria-pressed={kind === key} onClick={() => setKind(key)}>{x.emoji} {x.title}</button>
            ))}
          </div>
        </div>
        <label className="field"><span>Текст</span>
          <textarea rows={6} maxLength={2000} required autoFocus placeholder={k.hint} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <ShotPicker file={file} onChange={setFile} />
        <p className="hint">Не пишите имён и телефонов пациентов и не прикладывайте их снимки — для разбора они не нужны.</p>
        {send.error && <p className="error" role="alert">{send.error instanceof ApiError ? send.error.fieldErrors.text ?? send.error.fieldErrors.file ?? send.error.message : 'Это не картинка — приложите скриншот'}</p>}
        <button type="submit" className="btn primary" disabled={send.isPending || !text.trim()}>Отправить</button>
      </form>
    </aside>
  )
}
