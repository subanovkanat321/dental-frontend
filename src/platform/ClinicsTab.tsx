import { ask } from '../lib/confirm'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { agoText } from '../lib/texts'
import { billingLine, PAY_PERIOD_TEXT } from '../account/texts'
import { formatPhone, shortDate, somText, timeOf } from '../lib/time'
import { ClinicPanel } from './ClinicPanel'
import { byHealth, CLINIC_HEALTH, noShowShare } from './health'
import { Loading } from '../layout/Loading'
import { SalesFunnel } from './SalesFunnel'
import { adminsLine, remindedText, statusText } from './agreementTarget'
import { SubHelp } from '../layout/PageHead'
import { rowOpen } from '../lib/rowClick'
import { ALL, cityChips, cityKey, nameMatches, UNSIGNED, useClinicFilter } from './clinicFilter'
import { NewClinicPanel } from './NewClinicPanel'
import { EmptyState } from '../layout/EmptyState'
import { HelpHint } from '../help/HelpHint'
import { CalmRow, RowMenu, type MenuItem } from '../patients/CalmList'
import { clearPlatformClinic, platformClinicInHash } from '../lib/route'
import { openLink, telegram } from '../lib/telegram'

type Me = Schemas['BookingViewsMe']
type Row = Schemas['PlatformServiceClinicRow']

/**
 * «Клиники» команды платформы: сверху — «＋ Создать клинику» (карточка справа), оплаты на проверке и
 * заявки; дальше фильтр (город с количеством, поиск, статус) и клиники по здоровью (кто перестал
 * заходить — первым), скрытые — свёрнуты; воронка продаж и страница /join.
 * Только цифры, без пациентов: платформа обрабатывает данные по поручению клиник.
 */
export function ClinicsTab({ me, header, onPanel }: { me: Me; header: ReactNode; onPanel: (open: boolean) => void }) {
  const owner = Boolean(me.owner)
  const list = useQuery({ queryKey: ['platform-clinics'], queryFn: () => unwrap(api.GET('/api/platform/clinics')) })
  const applications = useQuery({ queryKey: ['platform-applications'], queryFn: () => unwrap(api.GET('/api/platform/applications')) })
  const agreements = useQuery({ queryKey: ['platform-agreement-statuses'], queryFn: () => unwrap(api.GET('/api/platform/agreements/statuses')) })
  const payRequests = useQuery({ queryKey: ['platform-pay-requests'], queryFn: () => unwrap(api.GET('/api/platform/pay-requests')), enabled: owner })
  const [opened, setOpenedState] = useState<{ id: number; invite?: { name: string; solo: boolean } } | null>(null)
  const setOpened = useCallback((next: typeof opened) => {
    setOpenedState(next)
    onPanel(next != null)
  }, [onPanel])
  const close = useCallback(() => {
    setOpened(null)
    clearPlatformClinic()
  }, [setOpened])
  // Адрес с клиникой (#/platform/clinics/12 — строки «Аналитики») открывает её карточку: при входе и при смене адреса
  useEffect(() => {
    const sync = () => {
      const id = platformClinicInHash()
      if (id == null) return
      setCreatingState(false)
      setOpened({ id })
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [setOpened])
  const [creating, setCreatingState] = useState(false)
  const setCreating = useCallback((next: boolean) => {
    setCreatingState(next)
    if (next) setOpenedState(null)
    onPanel(next)
  }, [onPanel])
  const [filter, setFilter] = useClinicFilter()
  const [query, setQuery] = useState('')
  const client = useQueryClient()
  const remindAll = useMutation<Schemas['AgreementRemindersReminded'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/agreements/remind')),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['platform-agreement-statuses'] }),
  })

  const all = list.data ?? []
  // «Не подписали»: клинике адресована версия, и она её не подписала
  const unsigned = (c: Row) => {
    const s = agreements.data?.[String(c.id)]
    return Boolean(s?.requiredVersion && !s.signed)
  }
  const unsignedCount = all.filter((c) => !c.hidden && unsigned(c)).length
  // Город и поиск — сначала: счётчики статусов считают клиники выбранного города
  const inCity = all.filter((c) => (filter.city === ALL || cityKey(c.city) === filter.city) && nameMatches(c.name, query))
  const status = (c: Row) => !filter.status || (filter.status === UNSIGNED ? unsigned(c) : c.health === filter.status)
  const visible = inCity.filter(status)
  const cities = cityChips(all.filter((c) => !c.hidden).map((c) => c.city), filter.city)
  const shownCity = inCity.filter((c) => !c.hidden)
  const shown = byHealth(visible.filter((c) => !c.hidden))
  const hidden = byHealth(visible.filter((c) => c.hidden))
  const pending = (payRequests.data ?? []).filter((r) => r.status === 'PENDING')
  const openedRow = opened ? all.find((c) => c.id === opened.id) : undefined

  const table = (rows: Row[], label: string) => (
    <table className="table" aria-label={label}>
      <thead><tr><th>Клиника</th><th>Заходили</th><th>Оплата</th><th>Договор</th><th>Руководители</th><th className="r">Врачей</th><th className="r">Приёмов 30 дн</th><th className="r">Неявки</th></tr></thead>
      <tbody>
        {rows.map((c) => {
          const hl = CLINIC_HEALTH[c.health ?? 'OK'] ?? CLINIC_HEALTH.OK!
          const line = billingLine(c.billing)
          const ag = agreements.data?.[String(c.id)]
          const st = statusText(ag)
          const share = noShowShare(c.noShow30, c.done30)
          return (
            // Вся строка нажимается — карточка клиники (оплата, договор, «Войти в клинику»)
            <tr key={c.id} {...rowOpen(() => { setCreatingState(false); setOpened({ id: c.id }) }, c.id === opened?.id && 'active')}>
              <td>
                <button type="button" className="row-link open-link" onClick={() => { setCreatingState(false); setOpened({ id: c.id }) }}>{c.name}<span aria-hidden="true"> ›</span></button>
                <div><span className={`chip small ${hl.chip}`}>{hl.label}</span>
                  {c.city ? <span className="hint"> · {c.city}</span> : null}
                  {me.clinic?.code === c.code && <span className="hint"> · вы здесь</span>}
                  {c.settingUp ? <span className="hint"> · 🛠 не видна пациентам</span> : c.listed === false ? <span className="hint"> · не в каталоге</span> : null}</div>
              </td>
              <td className="hint nowrap">{c.staffSeenAt ? agoText(c.staffSeenAt) : 'ещё не заходили'}</td>
              <td className={`tone-${line.tone}`}>{line.text}</td>
              <td className={st.tone}>{st.text}{ag?.scans ? <span className="hint"> · скан</span> : null}</td>
              <td className="hint nowrap" title="Кому дойдёт напоминание: Telegram — в бот, по номеру — push (если включён), иначе только баннер в CRM">{adminsLine(ag?.admins)}</td>
              <td className="r num">{c.doctors}</td>
              <td className="r num">{c.appointments}{c.selfBooked30 ? <span className="hint"> · бот {c.selfBooked30}</span> : null}</td>
              <td className="r num">{share == null ? '—' : `${share}%`}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  return (
    <>
      <section className="schedule-main">
        {header}
        {/* Оплаты и заявки — спокойным списком под шапкой (как «Пациенты»): строка, одно действие и «⋯»;
            больше трёх — свёрнуты, чтобы «＋ Создать клинику» и сами клиники не уезжали вниз */}
        {pending.length > 0 && (
          <Inbox title="Оплаты на проверке" label="Оплаты на проверке" count={pending.length}>
            {(n) => pending.slice(0, n).map((r) => <PayRequest key={r.id} r={r} />)}
          </Inbox>
        )}
        {(applications.data?.length ?? 0) > 0 && (
          <Inbox title="Заявки" label="Заявки с /join" count={applications.data!.length}>
            {(n) => applications.data!.slice(0, n).map((a) => <Application key={a.id} a={a} onApproved={(id, invite) => setOpened({ id, invite })} />)}
          </Inbox>
        )}
        {/* Что здесь — в «?» у заголовка, а не абзацем над списком */}
        <SubHelp title="Клиники">{owner ? 'Все клиники приложения. Нажмите на клинику: оплата, договор, пригласить её руководителя или войти в неё самому.'
            : 'Все клиники приложения — только цифры, без пациентов. Нажмите на клинику, чтобы пригласить её руководителя.'}</SubHelp>
        <section className="card-block" aria-label="Клиники">
          {/* Главное действие раздела — в шапке списка, справа (владелец, 2026-11-13: «сначала Создать клинику»);
              отдельной строкой над карточками кнопка висела одна */}
          <div className="block-head">
            <h2>Клиники{all.length > 0 && <span className="hint num"> · {all.filter((c) => !c.hidden).length}</span>}</h2>
            <button type="button" className="btn primary" aria-pressed={creating} onClick={() => setCreating(true)}>＋ Создать клинику</button>
          </div>
          {list.error && <p className="error">{list.error.message}</p>}
          {list.isPending ? <Loading /> : list.error ? null : all.length === 0 ? (
            <EmptyState compact title="Клиник пока нет">Создайте первую или одобрите заявку с /join.</EmptyState>
          ) : (
            <>
              {/* Город — по полю города клиники, с количеством; на телефоне ряд листается вбок */}
              <div className="service-filter">
                <input type="search" aria-label="Найти клинику" placeholder="Найти клинику по названию" value={query} onChange={(e) => setQuery(e.target.value)} />
                <div className="service-chips" role="group" aria-label="Города">
                  <button type="button" className="chip" aria-pressed={filter.city === ALL} onClick={() => setFilter({ city: ALL })}>
                    Все · <b className="num">{all.filter((c) => !c.hidden).length}</b></button>
                  {cities.map(([key, label, n]) => (
                    <button key={key} type="button" className="chip" aria-pressed={filter.city === key}
                      onClick={() => setFilter({ city: filter.city === key ? ALL : key })}>{label} · <b className="num">{n}</b></button>
                  ))}
                </div>
                {/* Статусы — компактно и тоже фильтр: нажали ещё раз — снова любой */}
                <div className="service-chips" role="group" aria-label="Статус">
                  {Object.entries(CLINIC_HEALTH).map(([code, hl]) => {
                    const n = shownCity.filter((c) => c.health === code).length
                    return n || filter.status === code ? (
                      <button key={code} type="button" className={`chip small ${hl.chip}`} aria-pressed={filter.status === code}
                        onClick={() => setFilter({ status: filter.status === code ? '' : code })}>{hl.short}: <b className="num">{n}</b></button>
                    ) : null
                  })}
                  <button type="button" className="chip small" aria-pressed={filter.status === UNSIGNED}
                    onClick={() => setFilter({ status: filter.status === UNSIGNED ? '' : UNSIGNED })}>
                    Не подписали договор: <b className="num">{shownCity.filter(unsigned).length}</b></button>
                </div>
              </div>
              {owner && unsignedCount > 0 && filter.status === UNSIGNED && (
                <div className="actions">
                  <button type="button" className="btn small" disabled={remindAll.isPending}
                    onClick={() => void ask(`Напомнить подписать договор всем не подписавшим (${unsignedCount})? Кому уже напоминали за сутки — пропустим.`, { ok: 'Напомнить' })
                      .then((ok) => ok && remindAll.mutate())}>Напомнить всем не подписавшим</button>
                </div>
              )}
              {remindAll.isSuccess && <p className="tone-ok" role="status">{remindedText(remindAll.data)}</p>}
              {remindAll.error && <p className="error" role="alert">{remindAll.error.message}</p>}
              {shown.length ? table(shown, 'Клиники') : <p className="hint">Нет клиник под этот фильтр.</p>}
              {hidden.length > 0 && <details><summary>Скрытые ({hidden.length})</summary>{table(hidden, 'Скрытые клиники')}</details>}
            </>
          )}
        </section>
        <SalesFunnel />
        <section className="card-block" aria-label="Страница для клиник">
          <h2>Страница для клиник<HelpHint title="Страница для клиник">Отправьте клинике — там рассказано, что умеет приложение, и форма заявки. Заявки появятся здесь, наверху.</HelpHint></h2>
          <a className="invite-link" href={`${window.location.origin}/join`} target="_blank" rel="noopener noreferrer">{window.location.origin}/join</a>
        </section>
      </section>
      {creating && <NewClinicPanel owner={owner} onClose={() => setCreating(false)}
        onOpen={(id, invite) => { setCreatingState(false); setOpened({ id, invite }) }} />}
      {!creating && openedRow && <ClinicPanel key={openedRow.id} clinic={openedRow} me={me} invite={opened?.invite} onClose={close} />}
    </>
  )
}

/** Сколько строк оплат и заявок видно сразу; остальные — под «Ещё N». */
const INBOX_SHOWN = 3

/** Блок входящих (оплаты, заявки): заголовок с числом и спокойный список; больше трёх — «Ещё N». */
function Inbox({ title, label, count, children }: { title: string; label: string; count: number; children: (shown: number) => ReactNode }) {
  const [all, setAll] = useState(false)
  const shown = all || count <= INBOX_SHOWN ? count : INBOX_SHOWN
  return (
    <section className="card-block" aria-label={label}>
      <h2>{title}<span className="hint num"> · {count}</span></h2>
      <ul className="calm-list" aria-label={label}>{children(shown)}</ul>
      {shown < count && (
        <button type="button" className="btn ghost small inbox-more" onClick={() => setAll(true)}>Ещё {count - shown}</button>
      )}
    </section>
  )
}

/** Позвонить с компьютера или телефона; в Telegram tel: молчит — своя страница звонка (номер во фрагменте #). */
function dial(phone: string): void {
  if (telegram()) openLink(`${window.location.origin}/call.html#${phone}`)
  else window.location.href = `tel:+${phone}`
}

/** Клиника сообщила об оплате: сверить с банком, подтвердить (срок продлится) или отклонить с причиной. */
function PayRequest({ r }: { r: Schemas['PayRequestsRequest'] }) {
  const client = useQueryClient()
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [done, setDone] = useState('')
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['platform-pay-requests'] })
    void client.invalidateQueries({ queryKey: ['platform-clinics'] })
  }
  const confirm = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/pay-requests/{id}/confirm', { params: { path: { id: r.id } } })),
    onSuccess: refresh,
  })
  const reject = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/pay-requests/{id}/reject', { params: { path: { id: r.id } }, body: { comment: reason } })),
    onSuccess: refresh,
  })
  const receipt = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/pay-requests/{id}/receipt/send', { params: { path: { id: r.id } } })),
    onSuccess: () => setDone('Чек отправлен в чат с ботом'),
  })
  const error = confirm.error ?? reject.error ?? receipt.error
  const items: MenuItem[] = [
    ...(r.hasReceipt ? [{ label: 'Чек — в бот', disabled: receipt.isPending, onSelect: () => receipt.mutate() }] : []),
    { label: 'Денег нет — отклонить', tone: 'bad', onSelect: () => setRejecting(true) },
  ]
  return (
    <CalmRow open={null} name={r.clinicName}
      sub={[`${somText(r.amountSom)} за ${(PAY_PERIOD_TEXT[r.months] ?? `${r.months} мес`).toLowerCase()}`, `тариф «${r.tariff}»`,
        r.createdAt ? `сообщили ${shortDate(r.createdAt)} в ${timeOf(r.createdAt)}` : null, r.hasReceipt ? null : 'без чека'].filter(Boolean).join(' · ')}
      action={<button type="button" className="btn" disabled={confirm.isPending}
        onClick={() => void ask(`Деньги от «${r.clinicName}» пришли? Срок оплаты продлится.`, { ok: 'Подтвердить' }).then((ok) => ok && confirm.mutate())}>Деньги пришли</button>}
      menu={<RowMenu label={`Ещё: ${r.clinicName}`} items={items} />}>
      {rejecting && (
        <div className="form" role="group" aria-label={`Отклонить оплату: ${r.clinicName}`}>
          <label className="field"><span>Причина — клиника увидит её</span>
            <input value={reason} maxLength={300} placeholder="Перевода нет / сумма другая" onChange={(e) => setReason(e.target.value)} /></label>
          <div className="actions">
            <button type="button" className="btn danger" disabled={reject.isPending} onClick={() => reject.mutate()}>Отклонить</button>
            <button type="button" className="btn ghost" onClick={() => setRejecting(false)}>Отмена</button>
          </div>
        </div>
      )}
      {error && <p className="error" role="alert">{error.message}</p>}
      {done && <p className="tone-ok" role="status">{done}</p>}
    </CalmRow>
  )
}

/**
 * Заявка с /join — строкой: название, серым — кто и откуда (частный врач, город, контакт, дата); «Одобрить» —
 * завести клинику и сразу открыть её карточку с приглашением админа; связаться и отклонить — в «⋯».
 */
function Application({ a, onApproved }: { a: Schemas['ClinicApplicationsApplicationView']; onApproved: (id: number, invite: { name: string; solo: boolean }) => void }) {
  const client = useQueryClient()
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: ['platform-applications'] }),
    client.invalidateQueries({ queryKey: ['platform-clinics'] }),
  ])
  const approve = useMutation<Schemas['ClinicApplicationsApproved'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/applications/{id}/approve', { params: { path: { id: a.id } } })),
    onSuccess: (r) => void refresh().then(() => onApproved(r.clinic!.id, { name: r.contactName ?? '', solo: Boolean(r.solo) })),
  })
  const reject = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/applications/{id}/reject', { params: { path: { id: a.id } } })),
    onSuccess: () => void refresh(),
  })
  const error = approve.error ?? reject.error
  // Серая строка — только то, что есть: без телефона не висит точка в конце
  const sub = [a.solo ? 'частный врач' : null, a.city, a.doctors ? `врачей: ${a.doctors}` : null, a.contactName,
    a.phone ? formatPhone(a.phone) : null, a.createdAt ? shortDate(a.createdAt, true) : null].filter(Boolean).join(' · ')
  const items: MenuItem[] = [
    ...(a.phone ? [
      { label: 'Позвонить', onSelect: () => dial(a.phone!) },
      { label: 'Написать в WhatsApp', onSelect: () => openLink(`https://wa.me/${a.phone}`) },
    ] : []),
    ...(a.telegram ? [{ label: `Telegram @${a.telegram}`, onSelect: () => openLink(`https://t.me/${a.telegram}`) }] : []),
    { label: 'Отклонить заявку', tone: 'bad', disabled: reject.isPending,
      onSelect: () => void ask(`Отклонить заявку «${a.clinicName}»?`).then((ok) => ok && reject.mutate()) },
  ]
  return (
    <CalmRow open={null} name={a.clinicName} sub={sub}
      action={<button type="button" className="btn" disabled={approve.isPending} onClick={() => approve.mutate()}>Одобрить</button>}
      menu={<RowMenu label={`Ещё: ${a.clinicName}`} items={items} />}>
      {a.message && <p className="hint">«{a.message}»</p>}
      {error && <p className="error" role="alert">{error.message}</p>}
    </CalmRow>
  )
}
