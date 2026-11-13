import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { EmptyState } from '../layout/EmptyState'
import { haptic, openLink } from '../lib/telegram'
import { agoText, recentlyInvited, whatsappUrl } from '../lib/texts'
import { ask } from '../lib/confirm'
import { addDays, shortDate, somText, todayIn } from '../lib/time'
import { dueText, monthsText } from '../clinic/services'
import './comeback.css'
import { Loading, Spinner } from '../layout/Loading'
import { HeadTools, SubHelp } from '../layout/PageHead'
import { CalmRow, RowMenu } from './CalmList'

type Candidate = Schemas['ComebacksCandidate']
type Reason = NonNullable<Candidate['reason']>
type Patient = Schemas['PatientView']
type Cancelled = NonNullable<Candidate['cancelled']>

/** «Записать» из «Отменили»: тот же врач, та же услуга и длительность, что у отменённой записи. */
export type BookPreset = { doctorId?: number; serviceId?: number; duration?: number }

const REASONS: Record<Reason, string> = {
  PLAN: 'Лечение не закончено',
  CANCELLED: 'Отменил запись',
  NO_SHOW: 'Не пришёл',
  RECALL: 'Пора на осмотр',
}

/** «отменил пациент в боте · 3 дня назад» — кто и когда (V160). */
function cancelledText(c: Cancelled): string {
  const who = c.source === 'PATIENT' ? 'отменил пациент в боте'
    : c.source === 'STAFF' ? `отменили в клинике${c.by ? ` (${c.by})` : ''}`
      : c.source === 'SYSTEM' ? 'отменено автоматически' : 'отменено'
  return c.at ? `${who} · ${agoText(c.at)}` : who
}

/** «звали 3 дня назад · всего 2 раза» / «ещё не звали»: когда последний раз и сколько раз (comeback_invite). */
function invitedText(c: Candidate, verb: 'звали' | 'напоминали'): string {
  if (!c.invitedAt) return `ещё не ${verb}`
  const n = c.invites ?? 0
  const times = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'раза' : 'раз'
  return `${verb} ${agoText(c.invitedAt)}${n > 1 ? ` · всего ${n} ${times}` : ''}`
}

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

/** Сколько пациентов «Позвать снова» и «Профосмотра» за раз. */
const PAGE = 50

/**
 * «Позвать снова» (было «Вернуть»): сколько денег лежит в незаконченных планах лечения, кто не пришёл и кому пора
 * на осмотр — и приглашение в один тап (в Telegram с кнопкой «Записаться» или в WhatsApp). Сверху —
 * «Tish вернул»: кто записался после приглашения за 30 дней. Считает сервер; здесь только показываем.
 */
export function ComebackTab({ onOpen, onBook, canEditServices = false }: {
  onOpen: (patientId: number) => void; onBook: (p: Patient, preset?: BookPreset) => void; canEditServices?: boolean
}) {
  const client = useQueryClient()
  // Ни у одной услуги нет своего срока профосмотра — подсказать, где он задаётся
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), enabled: canEditServices })
  const noServiceTerms = services.isSuccess && services.data.length > 0 && !services.data.some((s) => s.recallMonths != null)
  const today = todayIn()
  const result = useQuery({
    queryKey: ['comebacks', 'result', today],
    queryFn: () => unwrap(api.GET('/api/comebacks/result', { params: { query: { from: addDays(today, -29), to: today } } })),
  })
  // SENT — отправили план с ценами (V140), а пациент так и не записался
  const [filter, choose] = useState<Reason | 'ALL' | 'SENT'>('ALL')
  const [inviting, setInviting] = useState<number | null>(null)
  // По 50 за раз: у большой клиники «на столе» тысячи пациентов; счётчики сверху — по всему списку
  const [limit, setLimit] = useState(PAGE)
  const setFilter = (f: typeof filter) => {
    choose(f)
    setLimit(PAGE)
  }
  const board = useQuery({
    queryKey: ['comebacks', 'board', filter, limit],
    queryFn: () => unwrap(api.GET('/api/comebacks', { params: { query: { filter, limit } } })),
    // Сменили фильтр или «Показать ещё» — прежний список на экране, пока грузится новый
    placeholderData: keepPreviousData,
  })
  // «Не звать» — только в группе «Отменили и не записались»: убрать до новой отмены
  const skip = useMutation<unknown, ApiError, number>({
    mutationFn: (patientId) => unwrap(api.POST('/api/comebacks/{patientId}/skip', { params: { path: { patientId } } })),
    onSuccess: () => {
      haptic('success')
      void client.invalidateQueries({ queryKey: ['comebacks'] })
    },
    onError: () => haptic('error'),
  })

  if (board.isPending) return <Loading />
  if (board.error) return <p className="error">{board.error.message}</p>
  const shown = board.data.patients ?? []
  const everyone = board.data.planPatients + board.data.noShows + board.data.recalls + board.data.cancelled
  const total = board.data.total ?? shown.length
  const sent = board.data.sent
  const r = result.data

  const book = (c: Candidate) => onBook({ id: c.patientId, fullName: c.fullName ?? '', phone: c.phone, telegram: c.telegram },
    c.cancelled ? { doctorId: c.cancelled.doctorId, serviceId: c.cancelled.serviceId, duration: c.cancelled.minutes } : undefined)
  // Отбор — одной строкой переключателей в шапке; пустые группы не показываем (кроме выбранной)
  const groups: [typeof filter, string, number, string?][] = [
    ['PLAN', 'Планы лечения', board.data.planPatients, board.data.planSom > 0 ? somText(board.data.planSom) : undefined],
    ['CANCELLED', 'Отменили', board.data.cancelled],
    ['NO_SHOW', 'Не пришли', board.data.noShows],
    ['RECALL', 'Пора на осмотр', board.data.recalls],
    ['SENT', 'План отправлен', sent],
  ]

  return (
    <div className="comeback calm-stack">
      <SubHelp title="Позвать снова">Кого стоит позвать: незаконченные планы лечения, кто отменил или не пришёл и не перезаписался, кому пора
        на осмотр. «Пригласить» — готовый текст в Telegram или WhatsApp; записать и «Не звать» — в «⋯».</SubHelp>
      <HeadTools>
        <div className="segments comeback-filter" role="group" aria-label="Кого позвать">
          <button type="button" aria-pressed={filter === 'ALL'} onClick={() => setFilter('ALL')}>Все <span className="num">{everyone}</span></button>
          {groups.filter(([key, , n]) => n > 0 || filter === key).map(([key, title, n, money]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(filter === key ? 'ALL' : key)}>
              {title} <span className="num">{money ?? n}</span></button>
          ))}
        </div>
      </HeadTools>
      {!everyone ? (
        <EmptyState fill title="Звать некого" />
      ) : !shown.length ? <EmptyState fill title="По этому отбору никого" /> : (
        <ul className="calm-list" aria-label="Кого вернуть">
          {shown.map((c) => (
            <CalmRow key={c.patientId} open={inviting !== c.patientId && (() => onOpen(c.patientId))} name={c.fullName}
              flags={c.planAgreedAt && <span className="chip calm-flag s-ok">План согласован</span>}
              sub={reasonLine(c)}
              meta={(c.planSom > 0 || c.invitedAt) && (
                <>
                  {c.planSom > 0 && <span className="num calm-meta-strong">{somText(c.planSom)}</span>}
                  {c.invitedAt && <span>{c.reason === 'CANCELLED' ? 'напоминали' : 'звали'} {agoText(c.invitedAt)}</span>}
                </>
              )}
              action={inviting !== c.patientId && (
                <button type="button" className="btn" onClick={() => void again(c).then((ok) => ok && setInviting(c.patientId))}>
                  {c.reason === 'CANCELLED' ? 'Напомнить' : 'Пригласить'}</button>
              )}
              menu={inviting !== c.patientId && (
                <RowMenu label={`Ещё: ${c.fullName ?? 'пациент'}`} items={[
                  { label: c.planAgreedAt ? 'Записать на первый этап' : 'Записать', onSelect: () => book(c) },
                  ...(c.reason === 'CANCELLED' ? [{ label: 'Не звать', disabled: skip.isPending && skip.variables === c.patientId, onSelect: () => skip.mutate(c.patientId) }] : []),
                ]} />
              )}>
              {inviting === c.patientId && <InviteForm candidate={c} onDone={() => setInviting(null)} />}
            </CalmRow>
          ))}
        </ul>
      )}
      {skip.error && <p className="error" role="alert">{errorText(skip.error)}</p>}
      {shown.length < total && (
        <button type="button" className="btn comeback-more" disabled={board.isFetching} onClick={() => setLimit(limit + PAGE)}>
          {board.isFetching ? <><Spinner />Загрузка…</> : `Показать ещё (${Math.min(PAGE, total - shown.length)} из ${total - shown.length})`}</button>
      )}
      {r && r.invited > 0 && (
        <p className="calm-note" aria-label="Tish вернул">
          За 30 дней вернулись <b>{r.returned} из {r.invited}</b> приглашённых
          {r.returnedPlanSom > 0 && <> · в их планах <b className="num">{somText(r.returnedPlanSom)}</b></>}
          {r.paidSom > 0 && <> · уже оплачено <b className="num">{somText(r.paidSom)}</b></>}
        </p>
      )}
      {noServiceTerms && board.data.recalls > 0 && (filter === 'ALL' || filter === 'RECALL') && (
        <p className="calm-note">Пора на осмотр — по сроку клиники. Сроки по услугам — в{' '}
          <a href="#/clinic/services">Клиника → Услуги и цены</a>.</p>
      )}
    </div>
  )
}

/** Одна серая строка под именем: причина и главное по ней (план, что отменил, с какого дня пора). */
function reasonLine(c: Candidate): string {
  const reason = REASONS[c.reason!]
  if (c.reason === 'PLAN') return [reason, ...(c.plan ?? [])].join(' · ')
  if (c.reason === 'CANCELLED' && c.cancelled) {
    return [reason, c.cancelled.service, c.cancelled.startAt && shortDate(c.cancelled.startAt, true)].filter(Boolean).join(' · ')
  }
  if (c.reason === 'RECALL' && c.recallDueOn) return [`Пора на осмотр с ${dueText(c.recallDueOn)}`, c.recallService].filter(Boolean).join(' · ')
  return [reason, c.lastVisit ? `был ${agoText(c.lastVisit)}` : null].filter(Boolean).join(' · ')
}

/** Подробности — в форме приглашения, где они нужны: кто и когда отменил, звали ли, статус плана, срок осмотра. */
function details(c: Candidate): string[] {
  const lines: string[] = []
  if (c.reason === 'CANCELLED' && c.cancelled) {
    lines.push(`${cancelledText(c.cancelled)} · был записан: ${[c.cancelled.service, c.cancelled.doctor, c.cancelled.startAt && shortDate(c.cancelled.startAt, true)].filter(Boolean).join(' · ')}`)
  }
  if (c.reason === 'RECALL' && c.recallDueOn) {
    lines.push(`последний визит: ${c.lastVisit ? shortDate(c.lastVisit) : '—'}${c.recallService ? ` · ${c.recallService}` : ''}`
      + ` · пора с ${dueText(c.recallDueOn)}${c.recallMonths ? ` (через ${monthsText(c.recallMonths)})` : ''}`)
  }
  if (c.planSentAt) {
    lines.push(`план отправлен ${shortDate(c.planSentAt)}${c.planAgreedAt ? ` · согласован ${shortDate(c.planAgreedAt)} — запишите на первый этап` : ' · ещё не согласован'}`)
  }
  lines.push(invitedText(c, c.reason === 'CANCELLED' ? 'напоминали' : 'звали'))
  return lines
}

/** Звали на этой неделе — сначала спросить: второе приглашение подряд раздражает пациента. */
function again(c: Candidate): Promise<boolean> {
  if (!c.invitedAt || !recentlyInvited(c.invitedAt)) return Promise.resolve(true)
  const verb = c.reason === 'CANCELLED' ? 'Напоминали' : 'Звали'
  return ask(`${verb} ${agoText(c.invitedAt)}. ${c.reason === 'CANCELLED' ? 'Напомнить' : 'Позвать'} ещё раз?`,
    { ok: c.reason === 'CANCELLED' ? 'Напомнить ещё раз' : 'Позвать ещё раз' })
}

/** Текст приглашения (ИИ или шаблон) → правка → в Telegram с кнопкой «Записаться» или в WhatsApp. */
function InviteForm({ candidate: c, onDone }: { candidate: Candidate; onDone: () => void }) {
  const client = useQueryClient()
  const draft = useQuery({
    queryKey: ['comebacks', 'draft', c.patientId],
    queryFn: () => unwrap(api.POST('/api/comebacks/{patientId}/draft', { params: { path: { patientId: c.patientId } } })),
    gcTime: 0,
  })
  const [text, setText] = useState<string | null>(null)
  const value = text ?? draft.data?.text ?? ''
  const [sent, setSent] = useState('')
  const send = useMutation<Schemas['PatientMessage'] | undefined, ApiError, 'TELEGRAM' | 'WHATSAPP'>({
    mutationFn: (channel) => unwrap(api.POST('/api/comebacks/{patientId}/invite', {
      params: { path: { patientId: c.patientId } }, body: { text: value, channel },
    })),
    onSuccess: (message, channel) => {
      haptic('success')
      if (channel === 'WHATSAPP' && c.phone && message?.text) openLink(whatsappUrl(c.phone, message.text))
      setSent(channel === 'TELEGRAM' ? 'Приглашение отправлено в Telegram — с кнопкой «Записаться»' : 'Открыли WhatsApp с текстом')
      void client.invalidateQueries({ queryKey: ['comebacks'] })
    },
    onError: () => haptic('error'),
  })
  if (draft.isPending) return <p className="hint">Пишем приглашение…</p>
  if (draft.error) return <p className="error">{draft.error.message}</p>
  if (sent) {
    return <div className="comeback-sent"><p className="tone-ok" role="status">✅ {sent}</p><button type="button" className="btn small" onClick={onDone}>Готово</button></div>
  }
  return (
    <form className="form comeback-invite" aria-label={`Приглашение: ${c.fullName}`} onSubmit={(e) => e.preventDefault()}>
      <ul className="comeback-details" aria-label="Подробности">{details(c).map((line) => <li key={line}>{line}</li>)}</ul>
      <p className="hint small">{draft.data?.ai ? '✨ Написал ИИ — проверьте' : c.invitedAt ? 'Повторное приглашение — короче первого, можно поправить'
        : c.reason === 'CANCELLED' ? 'Готовый текст — можно поправить' : 'Текст по плану лечения — можно поправить'}
        {draft.data?.lang === 'KY' ? ' · на кыргызском' : ''}</p>
      <textarea aria-label="Текст приглашения" rows={6} maxLength={2000} value={value} onChange={(e) => setText(e.target.value)} />
      <div className="actions">
        {draft.data?.telegram && (
          <button type="button" className="btn primary" disabled={send.isPending || !value.trim()} onClick={() => send.mutate('TELEGRAM')}>
            📤 В Telegram</button>
        )}
        {c.phone && (
          <button type="button" className={draft.data?.telegram ? 'btn' : 'btn primary'} disabled={send.isPending || !value.trim()}
            onClick={() => send.mutate('WHATSAPP')}>WhatsApp</button>
        )}
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
      </div>
      {!draft.data?.telegram && !c.phone && <p className="hint small">Ни Telegram, ни телефона — позвоните пациенту.</p>}
      {send.error && <p className="error" role="alert">{errorText(send.error)}</p>}
    </form>
  )
}
