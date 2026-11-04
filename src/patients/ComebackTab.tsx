import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { EmptyState } from '../layout/EmptyState'
import { haptic, openLink } from '../lib/telegram'
import { agoText, whatsappUrl } from '../lib/texts'
import { addDays, shortDate, somText, todayIn } from '../lib/time'
import { dueText, monthsText } from '../clinic/services'
import './comeback.css'

type Candidate = Schemas['ComebacksCandidate']
type Reason = NonNullable<Candidate['reason']>
type Patient = Schemas['PatientView']

const REASONS: Record<Reason, { label: string; tone: string }> = {
  PLAN: { label: 'Лечение не закончено', tone: 'plan' },
  NO_SHOW: { label: 'Не пришёл', tone: 'noshow' },
  RECALL: { label: 'Пора на осмотр', tone: 'recall' },
}

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

/** Сколько пациентов «Вернуть» и «Профосмотра» за раз. */
const PAGE = 50

/**
 * «Вернуть пациентов»: сколько денег лежит в незаконченных планах лечения, кто не пришёл и кому пора
 * на осмотр — и приглашение в один тап (в Telegram с кнопкой «Записаться» или в WhatsApp). Сверху —
 * «Tish вернул»: кто записался после приглашения за 30 дней. Считает сервер; здесь только показываем.
 */
export function ComebackTab({ onOpen, onBook, canEditServices = false }: {
  onOpen: (patientId: number) => void; onBook: (p: Patient) => void; canEditServices?: boolean
}) {
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

  if (board.isPending) return <p className="hint">Загрузка…</p>
  if (board.error) return <p className="error">{board.error.message}</p>
  const shown = board.data.patients ?? []
  const everyone = (board.data.planPatients ?? 0) + (board.data.noShows ?? 0) + (board.data.recalls ?? 0)
  const total = board.data.total ?? shown.length
  const sent = board.data.sent ?? 0
  const agreed = board.data.agreed ?? 0
  const r = result.data

  return (
    <div className="comeback">
      <section className="comeback-summary" aria-label="Деньги на столе">
        <button type="button" className="comeback-money" aria-pressed={filter === 'PLAN'} onClick={() => setFilter(filter === 'PLAN' ? 'ALL' : 'PLAN')}>
          <span className="hint">Незаконченные планы лечения</span>
          <b className="num">{somText(board.data.planSom ?? 0)}</b>
          <span className="hint">пациентов: {board.data.planPatients ?? 0}</span>
        </button>
        <button type="button" aria-pressed={filter === 'NO_SHOW'} onClick={() => setFilter(filter === 'NO_SHOW' ? 'ALL' : 'NO_SHOW')}>
          <span className="hint">Не пришли и не перезаписались</span><b className="num">{board.data.noShows ?? 0}</b>
        </button>
        <button type="button" aria-pressed={filter === 'RECALL'} onClick={() => setFilter(filter === 'RECALL' ? 'ALL' : 'RECALL')}>
          <span className="hint">Пора на осмотр</span><b className="num">{board.data.recalls ?? 0}</b>
        </button>
      </section>
      {sent > 0 && (
        <button type="button" className="chip comeback-sent-filter" aria-pressed={filter === 'SENT'}
          onClick={() => setFilter(filter === 'SENT' ? 'ALL' : 'SENT')}>
          Отправили план, не записались: {sent}{agreed > 0 ? ` · согласились: ${agreed}` : ''}
        </button>
      )}
      {r && (r.invited ?? 0) > 0 && (
        <p className="comeback-result" aria-label="Tish вернул">
          ✅ За 30 дней вернулись <b>{r.returned} из {r.invited}</b> приглашённых
          {(r.returnedPlanSom ?? 0) > 0 && <> · в их планах <b className="num">{somText(r.returnedPlanSom!)}</b></>}
          {(r.paidSom ?? 0) > 0 && <> · уже оплачено <b className="num">{somText(r.paidSom!)}</b></>}
        </p>
      )}
      {noServiceTerms && (board.data.recalls ?? 0) > 0 && (filter === 'ALL' || filter === 'RECALL') && (
        <p className="hint small">Пора на осмотр — по сроку клиники. Сроки по услугам — в{' '}
          <a href="#/settings/services">Настройки → Услуги</a>.</p>
      )}
      {!everyone ? (
        <EmptyState icon="🦷" title="Звать некого">Все с планом лечения записаны, неявок нет, осмотры — вовремя.</EmptyState>
      ) : !shown.length ? <p className="hint">С этим отбором никого нет.</p> : (
        <ul className="comeback-list" aria-label="Кого вернуть">
          {shown.map((c) => (
            <li key={c.patientId}>
              <div className="comeback-head">
                <button type="button" className="row-link" onClick={() => onOpen(c.patientId!)}>{c.fullName}</button>
                <span className={`chip small comeback-${REASONS[c.reason!].tone}`}>{REASONS[c.reason!].label}</span>
                {(c.planSom ?? 0) > 0 && <b className="num comeback-sum">{somText(c.planSom!)}</b>}
              </div>
              {(c.plan ?? []).length > 0 && <p className="comeback-plan">{c.plan!.join(' · ')}</p>}
              {c.planSentAt && (
                <p className={c.planAgreedAt ? 'tone-ok small' : 'hint small'}>
                  план отправлен {shortDate(c.planSentAt)}{c.planAgreedAt ? ` · согласован ${shortDate(c.planAgreedAt)} — запишите на первый этап` : ' · ещё не согласован'}
                </p>
              )}
              {c.reason === 'RECALL' && c.recallDueOn ? (
                <p className="hint small">
                  последний визит: {c.lastVisit ? shortDate(c.lastVisit) : '—'}{c.recallService ? ` · ${c.recallService}` : ''}
                  {' '}· пора с {dueText(c.recallDueOn)}{c.recallMonths ? ` (через ${monthsText(c.recallMonths)})` : ''}
                  {' '}· {c.invitedAt ? `звали ${agoText(c.invitedAt)}` : 'ещё не звали'}
                </p>
              ) : (
                <p className="hint small">
                  {c.lastVisit ? `был ${agoText(c.lastVisit)}` : 'ещё не был'} · {c.invitedAt ? `звали ${agoText(c.invitedAt)}` : 'ещё не звали'}
                </p>
              )}
              {inviting === c.patientId ? (
                <InviteForm candidate={c} onDone={() => setInviting(null)} />
              ) : (
                <div className="actions">
                  <button type="button" className={c.invitedAt ? 'btn small' : 'btn small primary'} onClick={() => setInviting(c.patientId!)}>
                    Пригласить</button>
                  <button type="button" className="btn small ghost"
                    onClick={() => onBook({ id: c.patientId, fullName: c.fullName, phone: c.phone, telegram: c.telegram })}>Записать</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {shown.length < total && (
        <button type="button" className="btn" disabled={board.isFetching} onClick={() => setLimit(limit + PAGE)}>
          {board.isFetching ? 'Загрузка…' : `Показать ещё (${Math.min(PAGE, total - shown.length)} из ${total - shown.length})`}</button>
      )}
    </div>
  )
}

/** Текст приглашения (ИИ или шаблон) → правка → в Telegram с кнопкой «Записаться» или в WhatsApp. */
function InviteForm({ candidate: c, onDone }: { candidate: Candidate; onDone: () => void }) {
  const client = useQueryClient()
  const draft = useQuery({
    queryKey: ['comebacks', 'draft', c.patientId],
    queryFn: () => unwrap(api.POST('/api/comebacks/{patientId}/draft', { params: { path: { patientId: c.patientId! } } })),
    gcTime: 0,
  })
  const [text, setText] = useState<string | null>(null)
  const value = text ?? draft.data?.text ?? ''
  const [sent, setSent] = useState('')
  const send = useMutation<Schemas['PatientMessage'] | undefined, ApiError, 'TELEGRAM' | 'WHATSAPP'>({
    mutationFn: (channel) => unwrap(api.POST('/api/comebacks/{patientId}/invite', {
      params: { path: { patientId: c.patientId! } }, body: { text: value, channel },
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
      <p className="hint small">{draft.data?.ai ? '✨ Написал ИИ — проверьте' : 'Текст по плану лечения — можно поправить'}
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
