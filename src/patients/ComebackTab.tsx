import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { EditButton } from '../layout/EditButton'
import { EmptyState } from '../layout/EmptyState'
import { Loading, Spinner } from '../layout/Loading'
import { HeadTools, SubHelp } from '../layout/PageHead'
import { Segments, type SegmentOption } from '../layout/Segments'
import { Select } from '../layout/Select'
import { Sheet } from '../layout/Sheet'
import { ask } from '../lib/confirm'
import { haptic, openLink } from '../lib/telegram'
import { agoText, recentlyInvited, whatsappUrl } from '../lib/texts'
import { comebackCardInHash, setComebackCardInHash } from '../lib/route'
import { useMedia } from '../lib/useMedia'
import { addDays, shortDate, somText, todayIn } from '../lib/time'
import { dueText, monthsText } from '../clinic/services'
import { ContactMenu } from '../schedule/ContactMenu'
import { talkItems } from '../schedule/contactItems'
import { TaskDialog } from '../tasks/TaskDialog'
import { usePatientTags } from '../tags/tags'
import { CalmRow, RowMenu } from './CalmList'
import { DroppedList } from './DroppedList'
import { GroupCall, MessageProgress } from './GroupCall'
import { GroupEditor } from './GroupEditor'
import {
  GROUPS, READY_HINT, filterText, patientsText, useGroups, useMembers, type GroupItem, type Members,
} from './groupsModel'
import { READY_ORDER, keyOfSlug, refOfCard, slugOf, sourceOf, type BoardFilter, type CardKey } from './comebackCards'
import './comeback.css'
import './groups.css'

type Me = Schemas['BookingViewsMe']
type Candidate = Schemas['ComebacksCandidate']
type Reason = NonNullable<Candidate['reason']>
type Patient = Schemas['PatientView']
type Cancelled = NonNullable<Candidate['cancelled']>
type Member = Schemas['SegmentServiceMember']

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

/** Сколько пациентов за раз. */
const PAGE = 50

/** Телефон — как у `Segments`: карточки — одной строкой с листом снизу. */
const PHONE = '(max-width: 640px)'

/** Последняя карточка — не отбор, а действие: «＋ Своя группа». */
const NEW_GROUP = 'NEW'

/** Карточка «кого звать»: значок, название, пояснение и число; `keep` — показывать и пустой (свои группы). */
type Card = { key: CardKey; icon: string; name: string; hint: string; count?: string; n?: number; keep?: boolean }

/**
 * «Пациенты → Позвать снова» — одна вкладка вместо трёх (2026-11-24, владелец: «есть позвать снова, есть бросили
 * лечение и есть группы — это же одни и те же люди»). Сверху — карточки «кого звать» с числом (comebackCards.ts), под
 * ними — пациенты выбранной карточки: в строке «Пригласить» (готовый текст в Telegram или WhatsApp) или «📞 Связаться»,
 * в «⋯» — то, что подходит строке. «Позвать всех N» — задачи на обзвон или сообщение группе (GroupCall). Внизу свёрнуто —
 * «вернулись после приглашения» и «Что уже делали». Права — как были: считает и решает сервер.
 */
export function ComebackTab({ me, onOpen, onBook, canEditServices = false }: {
  me: Me
  onOpen: (patientId: number) => void
  onBook: (p: Patient, preset?: BookPreset) => void
  canEditServices?: boolean
}) {
  const client = useQueryClient()
  const phone = useMedia(PHONE)
  // Карточка — из адреса (#/patients/comeback/dropped: старые ссылки «Бросили лечение», закладки), иначе «Все»
  const [filter, choose] = useState<CardKey>(() => keyOfSlug(comebackCardInHash()) ?? 'ALL')
  const [limit, setLimit] = useState(PAGE)
  const [doctorId, setDoctorId] = useState<number | null>(null)
  const [editing, setEditing] = useState<GroupItem | 'new' | null>(null)
  const [calling, setCalling] = useState(false)
  const [message, setMessage] = useState<number | null>(null)
  const setFilter = (f: CardKey) => {
    choose(f)
    setLimit(PAGE)
    setDoctorId(null)
    setComebackCardInHash(slugOf(f))
  }
  const source = sourceOf(filter)
  const ref = refOfCard(filter)

  // Ни у одной услуги нет своего срока профосмотра — подсказать, где он задаётся
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), enabled: canEditServices })
  const noServiceTerms = services.isSuccess && services.data.length > 0 && !services.data.some((s) => s.recallMonths != null)
  const today = todayIn()
  const result = useQuery({
    queryKey: ['comebacks', 'result', today],
    queryFn: () => unwrap(api.GET('/api/comebacks/result', { params: { query: { from: addDays(today, -29), to: today } } })),
  })
  // Список «Позвать снова» — и для чисел на карточках: у других карточек — первая страница «Все» (тот же ключ кэша)
  const boardFilter: BoardFilter = source === 'board' ? (filter as BoardFilter) : 'ALL'
  const boardLimit = source === 'board' ? limit : PAGE
  const board = useQuery({
    queryKey: ['comebacks', 'board', boardFilter, boardLimit],
    queryFn: () => unwrap(api.GET('/api/comebacks', { params: { query: { filter: boardFilter, limit: boardLimit } } })),
    // Сменили отбор или «Показать ещё» — прежний список на экране, пока грузится новый
    placeholderData: keepPreviousData,
  })
  const groups = useGroups()
  // Группа карточки: у «Не были 6+», «Долга», «Дня рождения» и своих — сам список; у остальных — число и тексты для «Позвать всех»
  const members = useMembers(ref, doctorId, source === 'group' ? limit : 0)
  const tags = usePatientTags()
  // «Не звать» — только в группе «Отменили и не записались»: убрать до новой отмены
  const skip = useMutation<unknown, ApiError, number>({
    mutationFn: (patientId) => unwrap(api.POST('/api/comebacks/{patientId}/skip', { params: { path: { patientId } } })),
    onSuccess: () => {
      haptic('success')
      void client.invalidateQueries({ queryKey: ['comebacks'] })
      void client.invalidateQueries({ queryKey: GROUPS })
    },
    onError: () => haptic('error'),
  })

  if (board.isPending) return <Loading />
  if (board.error) return <p className="error">{board.error.message}</p>
  const b = board.data
  const everyone = b.planPatients + b.noShows + b.recalls + b.cancelled
  const ready = (key: string) => groups.data?.ready.find((g) => g.ready === key)?.count
  const doctorName = (id?: number) => me.doctors?.find((d) => d.id === id)?.fullName
  const tagName = (id?: number) => tags.data?.find((t) => t.id === id)?.name
  const custom = groups.data?.custom ?? []
  const group = filter.startsWith('group-') ? custom.find((g) => `group-${g.groupId}` === filter) : undefined

  const num = (n: number | undefined) => (n == null ? {} : { n, count: String(n) })
  const cards: Card[] = [
    { key: 'ALL', icon: '👥', name: 'Все', hint: b.planSom > 0 ? `Все, кого стоит позвать · в планах ${somText(b.planSom)}` : 'Все, кого стоит позвать',
      ...num(everyone), keep: true },
    { key: 'DROPPED', icon: '🦷', name: 'Бросили лечение', hint: READY_HINT.DROPPED, ...num(ready('DROPPED')) },
    { key: 'SENT', icon: '📨', name: 'План отправлен', hint: READY_HINT.PLAN_SENT, ...num(b.sent) },
    { key: 'CANCELLED', icon: '↩️', name: 'Отменили', hint: READY_HINT.CANCELLED, ...num(b.cancelled) },
    { key: 'NO_SHOW', icon: '🚫', name: 'Не пришли', hint: READY_HINT.NO_SHOW, ...num(b.noShows) },
    { key: 'RECALL', icon: '🗓', name: 'Пора на осмотр', hint: READY_HINT.RECALL, ...num(b.recalls) },
    ...READY_ORDER.map((key): Card => ({ key, icon: key === 'DEBT' ? '💰' : key === 'BIRTHDAY_MONTH' ? '🎂' : '😴',
      name: key === 'DEBT' ? 'Долг' : key === 'BIRTHDAY_MONTH' ? 'День рождения в этом месяце' : 'Не были 6+ месяцев',
      hint: READY_HINT[key as 'DEBT'], ...num(ready(key)) })),
    ...custom.map((g): Card => ({ key: `group-${g.groupId!}`, icon: '⭐', name: g.name,
      hint: filterText(g.filter, { doctor: doctorName(g.filter?.doctorId), tag: tagName(g.filter?.tagId) }) || 'Своя группа', ...num(g.count), keep: true })),
  ]
  // Пустые карточки не показываем (кроме выбранной и своих групп); ещё не посчитанные — тоже
  const shown = cards.filter((c) => c.key === filter || c.keep || (c.n ?? 0) > 0)
  const current = cards.find((c) => c.key === filter)
  const pick = (key: string) => {
    if (key === NEW_GROUP) setEditing('new')
    else setFilter(key === filter && key !== 'ALL' ? 'ALL' : key as CardKey)
  }
  const book = (c: Candidate) => onBook({ id: c.patientId, fullName: c.fullName ?? '', phone: c.phone, telegram: c.telegram },
    c.cancelled ? { doctorId: c.cancelled.doctorId, serviceId: c.cancelled.serviceId, duration: c.cancelled.minutes } : undefined)
  const m = members.data
  // «Позвать всех N»: число — по группе на сервере (то же правило, что у списка карточки)
  const callAll = m && m.total > 0 && (
    <button type="button" className="btn primary group-call-btn" onClick={() => setCalling(true)}>Позвать всех {m.total}</button>
  )
  const r = result.data
  const history = m?.history ?? []
  const doctors = (me.doctors ?? []).filter((d) => d.active !== false)
  // «Врач: …» — у списков групп тем, кто видит всю клинику (врачу сервер и так отдаёт только его пациентов)
  const pickDoctor = source === 'group' && doctors.length > 1 && (me.admin || me.reception)

  return (
    <div className="comeback calm-stack">
      <SubHelp title="Позвать снова">Кого стоит позвать — карточками: бросили лечение, отменили или не пришли и не перезаписались, кому
        пора на осмотр, давно не были, долг, день рождения и ваши группы. «Пригласить» — готовый текст в Telegram или WhatsApp; записать,
        задача и «Не звать» — в «⋯». «Позвать всех» — задачи на обзвон или сообщение сразу всем (одному пациенту — не чаще раза в неделю).</SubHelp>
      {phone ? (
        <HeadTools>
          {/* Телефон: одна строка с выбранной карточкой, нажали — лист со всеми (layout/Segments → ChoicePick) */}
          <Segments className="comeback-filter" label="Кого позвать" value={filter as string} onChange={pick}
            options={[...shown.map((c): SegmentOption<string> => ({ value: c.key, label: c.name, text: c.name, icon: c.icon, name: c.name, hint: c.hint, count: c.count })),
              { value: NEW_GROUP, label: 'Своя группа', icon: '＋', name: 'Своя группа', hint: 'Свои условия: врач, метка, услуга, давность визита' }]} />
        </HeadTools>
      ) : (
        <div className="cb-cards" role="group" aria-label="Кого позвать">
          {shown.map((c) => (
            <button key={c.key} type="button" className="cb-card" aria-pressed={c.key === filter} title={c.hint} onClick={() => pick(c.key)}>
              <span className="cb-card-icon" aria-hidden="true">{c.icon}</span>
              <span className="cb-card-name">{c.name}</span>
              {c.count != null && <span className="cb-card-count num">{c.count}</span>}
            </button>
          ))}
          <button type="button" className="cb-card cb-card-new" onClick={() => setEditing('new')}>
            <span className="cb-card-icon" aria-hidden="true">＋</span><span className="cb-card-name">Своя группа</span></button>
        </div>
      )}

      {source === 'board' && (
        <>
          {filter !== 'ALL' && (
            <div className="cb-tools">
              {current && <span className="head-note">{current.hint}</span>}
              {callAll}
            </div>
          )}
          {!everyone ? <EmptyState fill title="Звать некого" />
            : !(b.patients ?? []).length ? <EmptyState fill title="По этому отбору никого" /> : (
              <BoardRows rows={b.patients ?? []} onOpen={onOpen} onBook={book} skip={skip} />
            )}
          {skip.error && <p className="error" role="alert">{errorText(skip.error)}</p>}
          {(b.patients ?? []).length < (b.total ?? 0) && (
            <MoreButton shown={(b.patients ?? []).length} total={b.total ?? 0} busy={board.isFetching} onMore={() => setLimit(limit + PAGE)} />
          )}
          {noServiceTerms && b.recalls > 0 && (filter === 'ALL' || filter === 'RECALL') && (
            <p className="calm-note">Пора на осмотр — по сроку клиники. Сроки по услугам — в{' '}
              <a href="#/clinic/services">Клиника → Услуги и цены</a>.</p>
          )}
        </>
      )}

      {source === 'dropped' && (
        <DroppedList me={me} onOpen={onOpen} onBook={onBook} callAll={(days) => (days === '30' ? callAll : null)} />
      )}

      {source === 'group' && (
        <>
          <div className="cb-tools">
            {pickDoctor && (
              <Select aria-label="Врач" value={doctorId ?? ''} onChange={(e) => { setDoctorId(e.target.value ? Number(e.target.value) : null); setLimit(PAGE) }}>
                <option value="">Все врачи</option>
                {doctors.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
              </Select>
            )}
            {m && (
              <span className="head-note" aria-label="В группе">
                <b className="num">{patientsText(m.total)}</b>{m.total > 0 && <> · в боте <span className="num">{m.inBot}</span></>}
              </span>
            )}
            {group?.canEdit && <EditButton label={`Изменить группу: ${group.name}`} onClick={() => setEditing(group)} />}
            {callAll}
          </div>
          {members.isPending && <Loading />}
          {members.error && <p className="error">{members.error.message}</p>}
          {m && m.total === 0 && (
            <EmptyState fill title="Сейчас никого">{group ? 'Под условия группы никто не подходит — загляните позже или измените условия.' : 'Загляните позже.'}</EmptyState>
          )}
          {m && m.patients.length > 0 && <MemberRows members={m} onOpen={onOpen} onBook={onBook} />}
          {m && m.patients.length < m.total && (
            <MoreButton shown={m.patients.length} total={m.total} busy={members.isFetching} onMore={() => setLimit(limit + PAGE)} />
          )}
        </>
      )}

      {/* Внизу, свёрнуто: итог приглашений за 30 дней и что уже делали с этой карточкой */}
      {((r && r.invited > 0) || history.length > 0) && (
        <details className="cb-more">
          <summary>{history.length > 0 ? 'Что уже делали и кто вернулся' : 'Кто вернулся после приглашения'}</summary>
          {r && r.invited > 0 && (
            <p className="calm-note" aria-label="Tish вернул">
              За 30 дней вернулись <b>{r.returned} из {r.invited}</b> приглашённых
              {r.returnedPlanSom > 0 && <> · в их планах <b className="num">{somText(r.returnedPlanSom)}</b></>}
              {r.paidSom > 0 && <> · уже оплачено <b className="num">{somText(r.paidSom)}</b></>}
            </p>
          )}
          {history.length > 0 && (
            <section className="calm-day" aria-label="Что уже делали">
              <h3>Что уже делали: {current?.name ?? m?.name}</h3>
              <ul className="calm-list">
                {history.map((h) => (
                  <CalmRow key={h.id} open={h.kind === 'MESSAGE' ? () => setMessage(h.id) : null}
                    name={h.kind === 'MESSAGE' ? 'Сообщение' : 'Задачи на обзвон'}
                    sub={`${shortDate(h.at, true)} · ${h.by}${h.skipped ? ` · пропущено ${h.skipped}` : ''}`}
                    meta={(
                      <>
                        <span className="calm-meta-strong">{h.kind === 'MESSAGE' ? 'дошло' : 'задач'} <span className="num">{h.reached}</span></span>
                        <span>записались <span className="num">{h.booked}</span></span>
                      </>
                    )} />
                ))}
              </ul>
              <p className="calm-note">«Записались» — сколько из них записались в течение 30 дней после сообщения или задачи.</p>
            </section>
          )}
        </details>
      )}

      {calling && m && ref && (
        <GroupCall group={{ ...ref, doctorId: source === 'group' ? doctorId ?? undefined : undefined }} members={m} onClose={() => setCalling(false)} />
      )}
      {message != null && (
        <Sheet label="Сообщение группе" title="Сообщение группе" onClose={() => setMessage(null)} wide>
          <MessageProgress id={message} />
        </Sheet>
      )}
      {editing === 'new' && (
        <GroupEditor me={me} onClose={() => setEditing(null)} onSaved={(g) => g.groupId != null && setFilter(`group-${g.groupId}`)} />
      )}
      {editing && editing !== 'new' && (
        <GroupEditor me={me} group={editing} onClose={() => setEditing(null)} onDeleted={() => setFilter('ALL')} />
      )}
    </div>
  )
}

function MoreButton({ shown, total, busy, onMore }: { shown: number; total: number; busy: boolean; onMore: () => void }) {
  return (
    <button type="button" className="btn comeback-more" disabled={busy} onClick={onMore}>
      {busy ? <><Spinner />Загрузка…</> : `Показать ещё (${Math.min(PAGE, total - shown)} из ${total - shown})`}</button>
  )
}

/** Список «Позвать снова»: «Пригласить» / «Напомнить» в строке; «Записать» и «Не звать» (у отменивших) — в «⋯». */
function BoardRows({ rows, onOpen, onBook, skip }: {
  rows: Candidate[]
  onOpen: (patientId: number) => void
  onBook: (c: Candidate) => void
  skip: ReturnType<typeof useMutation<unknown, ApiError, number>>
}) {
  const [inviting, setInviting] = useState<number | null>(null)
  return (
    <ul className="calm-list" aria-label="Кого вернуть">
      {rows.map((c) => (
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
              { label: c.planAgreedAt ? 'Записать на первый этап' : 'Записать', onSelect: () => onBook(c) },
              ...(c.reason === 'CANCELLED' ? [{ label: 'Не звать', disabled: skip.isPending && skip.variables === c.patientId, onSelect: () => skip.mutate(c.patientId) }] : []),
            ]} />
          )}>
          {inviting === c.patientId && <InviteForm candidate={c} onDone={() => setInviting(null)} />}
        </CalmRow>
      ))}
    </ul>
  )
}

/** Пациенты группы («Не были 6+», «Долг», «День рождения», свои): «📞 Связаться» в строке, «Записать» и «＋ Задача» — в «⋯». */
function MemberRows({ members, onOpen, onBook }: { members: Members; onOpen: (patientId: number) => void; onBook: (p: Patient) => void }) {
  const [task, setTask] = useState<Member | null>(null)
  return (
    <>
      <ul className="calm-list" aria-label={members.name}>
        {members.patients.map((p) => (
          <CalmRow key={p.patientId} open={() => onOpen(p.patientId)} name={p.fullName}
            flags={p.optedOut ? <span className="chip calm-flag s-quiet" title="Нажал в боте «Не присылать такие сообщения»">без сообщений</span> : undefined}
            sub={[p.reason, p.doctor].filter(Boolean).join(' · ')}
            meta={<span>{p.lastVisit ? `был ${shortDate(p.lastVisit)}` : 'ещё не был'}</span>}
            action={<ContactMenu items={talkItems({ phone: p.phone })} />}
            menu={(
              <RowMenu label={`Ещё: ${p.fullName}`} items={[
                ...(p.booked ? [] : [{ label: '＋ Записать', onSelect: () => onBook({ id: p.patientId, fullName: p.fullName, phone: p.phone, telegram: p.inBot }) }]),
                { label: '＋ Задача', onSelect: () => setTask(p) },
              ]} />
            )} />
        ))}
      </ul>
      {task && (
        <TaskDialog patient={{ id: task.patientId, fullName: task.fullName }} draft={{ kind: 'TASK', title: members.taskTitle }}
          onClose={() => setTask(null)} />
      )}
    </>
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
