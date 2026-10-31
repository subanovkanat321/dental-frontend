import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type ReactNode } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { agoText } from '../lib/texts'
import { billingLine, PAY_PERIOD_TEXT } from '../account/texts'
import { formatPhone, shortDate, somText, timeOf } from '../lib/time'
import { ClinicPanel } from './ClinicPanel'
import { byHealth, CLINIC_HEALTH, noShowShare } from './health'

type Me = Schemas['BookingViewsMe']
type Row = Schemas['PlatformServiceClinicRow']

/**
 * «Клиники» команды платформы: оплаты на проверке и заявки — сверху, дальше все клиники по
 * здоровью (кто перестал заходить — первым), скрытые — свёрнуты; новая клиника и страница /join.
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
  const close = useCallback(() => setOpened(null), [setOpened])

  const all = list.data ?? []
  const shown = byHealth(all.filter((c) => !c.hidden))
  const hidden = byHealth(all.filter((c) => c.hidden))
  const pending = (payRequests.data ?? []).filter((r) => r.status === 'PENDING')
  const openedRow = opened ? all.find((c) => c.id === opened.id) : undefined

  const table = (rows: Row[], label: string) => (
    <table className="table" aria-label={label}>
      <thead><tr><th>Клиника</th><th>Заходили</th><th>Оплата</th><th>Договор</th><th className="r">Врачей</th><th className="r">Приёмов 30 дн</th><th className="r">Неявки</th></tr></thead>
      <tbody>
        {rows.map((c) => {
          const hl = CLINIC_HEALTH[c.health ?? 'OK'] ?? CLINIC_HEALTH.OK!
          const line = billingLine(c.billing)
          const ag = agreements.data?.[String(c.id)]
          const share = noShowShare(c.noShow30, c.done30)
          return (
            <tr key={c.id} className={c.id === opened?.id ? 'active' : undefined}>
              <td>
                <button type="button" className="row-link" onClick={() => setOpened({ id: c.id! })}>{c.name}</button>
                {me.clinic?.code === c.code && <span className="hint"> · вы здесь</span>}
                <div><span className={`chip small ${hl.chip}`}>{hl.label}</span></div>
              </td>
              <td className="hint nowrap">{c.staffSeenAt ? agoText(c.staffSeenAt) : 'ещё не заходили'}</td>
              <td className={`tone-${line.tone}`}>{line.text}</td>
              <td className={ag?.acceptedVersion ? 'tone-ok' : 'hint'}>{ag?.acceptedVersion ? `v${ag.acceptedVersion}` : ag?.scans ? 'скан' : 'не подписан'}</td>
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
        {pending.length > 0 && (
          <section className="card-block">
            <h2>Оплаты на проверке · {pending.length}</h2>
            {pending.map((r) => <PayRequest key={r.id} r={r} />)}
          </section>
        )}
        {(applications.data?.length ?? 0) > 0 && (
          <section className="card-block">
            <h2>Заявки · {applications.data!.length}</h2>
            {applications.data!.map((a) => <Application key={a.id} a={a} onApproved={(id, invite) => setOpened({ id, invite })} />)}
          </section>
        )}
        <section className="card-block">
          <p className="hint">{owner ? 'Все клиники приложения. Нажмите на клинику: оплата, договор, пригласить её админа или войти в неё самому.'
            : 'Все клиники приложения — только цифры, без пациентов. Нажмите на клинику, чтобы пригласить её админа.'}</p>
          {list.error && <p className="error">{list.error.message}</p>}
          {list.isPending ? <p className="hint">Загрузка…</p> : (
            <>
              <p className="stats">
                <span className="chip small s-quiet">Клиник: <b className="num">{shown.length}</b></span>
                {Object.entries(CLINIC_HEALTH).map(([code, hl]) => {
                  const n = shown.filter((c) => c.health === code).length
                  return n ? <span key={code} className={`chip small ${hl.chip}`}>{hl.short}: <b className="num">{n}</b></span> : null
                })}
              </p>
              {table(shown, 'Клиники')}
              {hidden.length > 0 && <details><summary>Скрытые ({hidden.length})</summary>{table(hidden, 'Скрытые клиники')}</details>}
            </>
          )}
        </section>
        <NewClinic onCreated={(id, solo) => setOpened({ id, invite: { name: '', solo } })} />
        <section className="card-block">
          <h2>Страница для клиник</h2>
          <p className="hint">Отправьте клинике — там рассказано, что умеет приложение, и форма заявки. Заявки появятся здесь, наверху.</p>
          <a className="invite-link" href={`${window.location.origin}/join`} target="_blank" rel="noopener noreferrer">{window.location.origin}/join</a>
        </section>
      </section>
      {openedRow && <ClinicPanel key={openedRow.id} clinic={openedRow} me={me} invite={opened?.invite} onClose={close} />}
    </>
  )
}

function NewClinic({ onCreated }: { onCreated: (id: number, solo: boolean) => void }) {
  const client = useQueryClient()
  const [name, setName] = useState('')
  const [solo, setSolo] = useState(false)
  const create = useMutation<Row, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/clinics', { body: { name } })),
    onSuccess: (c) => {
      setName('')
      void client.invalidateQueries({ queryKey: ['platform-clinics'] }).then(() => onCreated(c.id!, solo))
    },
  })
  return (
    <section className="card-block">
      <h2>Новая клиника или кабинет</h2>
      <form className="form narrow" aria-label="Новая клиника" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
        <label className="field"><span>Название</span><input value={name} required maxLength={100} placeholder="Стоматология «Улыбка»" onChange={(e) => setName(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={solo} onChange={(e) => setSolo(e.target.checked)} /> Частный врач — работает один (он и врач, и админ)</label>
        {create.error && <p className="error" role="alert">{create.error.fieldErrors.name ?? create.error.message}</p>}
        <button type="submit" className="btn primary" disabled={create.isPending}>Создать клинику</button>
      </form>
    </section>
  )
}

/** Клиника сообщила об оплате: сверить с банком, подтвердить (срок продлится) или отклонить с причиной. */
function PayRequest({ r }: { r: Schemas['PayRequestsRequest'] }) {
  const client = useQueryClient()
  const [reason, setReason] = useState('')
  const [done, setDone] = useState('')
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['platform-pay-requests'] })
    void client.invalidateQueries({ queryKey: ['platform-clinics'] })
  }
  const confirm = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/pay-requests/{id}/confirm', { params: { path: { id: r.id! } } })),
    onSuccess: refresh,
  })
  const reject = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/pay-requests/{id}/reject', { params: { path: { id: r.id! } }, body: { comment: reason } })),
    onSuccess: refresh,
  })
  const receipt = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/pay-requests/{id}/receipt/send', { params: { path: { id: r.id! } } })),
    onSuccess: () => setDone('Чек отправлен в чат с ботом'),
  })
  const error = confirm.error ?? reject.error ?? receipt.error
  return (
    <div className="sub-form form" role="group" aria-label={`Оплата: ${r.clinicName}`}>
      <strong>{r.clinicName}</strong>
      <span>{somText(r.amountSom ?? 0)} за {(PAY_PERIOD_TEXT[r.months ?? 1] ?? `${r.months} мес`).toLowerCase()} · тариф «{r.tariff}»</span>
      <span className="hint">Сообщили {r.createdAt ? `${shortDate(r.createdAt)} в ${timeOf(r.createdAt)}` : ''}{r.hasReceipt ? '' : ' · без чека'}</span>
      <div className="actions">
        <button type="button" className="btn primary" disabled={confirm.isPending} onClick={() => confirm.mutate()}>Деньги пришли — подтвердить</button>
        {r.hasReceipt && <button type="button" className="btn" disabled={receipt.isPending} onClick={() => receipt.mutate()}>Чек — в бот</button>}
      </div>
      <details>
        <summary>Денег нет — отклонить</summary>
        <div className="form">
          <label className="field"><span>Причина — клиника увидит её</span>
            <input value={reason} maxLength={300} placeholder="Перевода нет / сумма другая" onChange={(e) => setReason(e.target.value)} /></label>
          <button type="button" className="btn" disabled={reject.isPending} onClick={() => reject.mutate()}>Отклонить</button>
        </div>
      </details>
      {error && <p className="error" role="alert">{error.message}</p>}
      {done && <p className="tone-ok" role="status">{done}</p>}
    </div>
  )
}

/** Заявка с /join: кто, откуда, контакт; одобрить — завести клинику и сразу пригласить админа. */
function Application({ a, onApproved }: { a: Schemas['ClinicApplicationsApplicationView']; onApproved: (id: number, invite: { name: string; solo: boolean }) => void }) {
  const client = useQueryClient()
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: ['platform-applications'] }),
    client.invalidateQueries({ queryKey: ['platform-clinics'] }),
  ])
  const approve = useMutation<Schemas['ClinicApplicationsApproved'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/applications/{id}/approve', { params: { path: { id: a.id! } } })),
    onSuccess: (r) => void refresh().then(() => onApproved(r.clinic!.id!, { name: r.contactName ?? '', solo: Boolean(r.solo) })),
  })
  const reject = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/applications/{id}/reject', { params: { path: { id: a.id! } } })),
    onSuccess: () => void refresh(),
  })
  const error = approve.error ?? reject.error
  return (
    <div className="sub-form form" role="group" aria-label={`Заявка: ${a.clinicName}`}>
      <strong>{a.clinicName}</strong>
      <span className="hint">{[a.solo ? 'частный врач' : null, a.city, a.doctors ? `врачей: ${a.doctors}` : null, a.createdAt ? shortDate(a.createdAt, true) : null].filter(Boolean).join(' · ')}</span>
      <span>{a.contactName} · {a.phone && <a href={`tel:+${a.phone}`}>{formatPhone(a.phone)}</a>}</span>
      {a.message && <span className="hint">{a.message}</span>}
      <div className="actions">
        <button type="button" className="btn primary" disabled={approve.isPending} onClick={() => approve.mutate()}>Одобрить и завести клинику</button>
        <button type="button" className="btn" disabled={reject.isPending} onClick={() => window.confirm(`Отклонить заявку «${a.clinicName}»?`) && reject.mutate()}>Отклонить</button>
      </div>
      {error && <p className="error" role="alert">{error.message}</p>}
    </div>
  )
}
