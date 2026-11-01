import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { billingLine } from '../account/texts'
import { shortDate, somText, todayIn } from '../lib/time'
import { useClose } from '../lib/useClose'
import { InviteLink } from '../team/InviteLink'
import { extendPaid } from './health'

type Me = Schemas['BookingViewsMe']
type Row = Schemas['PlatformServiceClinicRow']
type Plan = Schemas['ClinicPaymentsPlan']

const day = (d?: string) => (d ? shortDate(`${d}T12:00:00Z`) : '')

/**
 * Клиника на платформе — карточка справа: цифры, оплата и договор (владелец), ссылка для
 * пациентов, войти в клинику (владелец), пригласить админа, выгрузка, скрыть и удалить (владелец).
 * Менеджер видит только цифры и приглашает админа — пациентов платформа не видит.
 */
export function ClinicPanel({ clinic: c, me, invite, onClose }: {
  clinic: Row
  me: Me
  invite?: { name: string; solo: boolean }
  onClose: () => void
}) {
  useClose(onClose)
  const owner = Boolean(me.owner)
  const page = c.code ? `${window.location.origin}/c/${c.code}` : null
  return (
    <aside className="panel" aria-label="Клиника на платформе">
      <header className="panel-head">
        <div>
          <h2>{c.name}</h2>
          <span className="hint">Врачей {c.doctors} · сотрудников {c.staff} · пациентов {c.patients} · приёмов за 30 дней {c.appointments}</span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      {owner && <BillingBox id={c.id!} />}
      <AgreementBox id={c.id!} owner={owner} />
      {page && (
        <section className="form">
          <h3>Ссылка для пациентов</h3>
          <p className="hint">С неё пациенты записываются в бота именно в эту клинику. Её ставят в Instagram.</p>
          <a className="invite-link" href={page} target="_blank" rel="noopener noreferrer">{page}</a>
        </section>
      )}
      {owner && <EnterBox id={c.id!} />}
      <AdminInvite clinic={c} initial={invite} owner={owner} />
      {owner && <ExportBox id={c.id!} />}
      {owner && <HideBox clinic={c} />}
      {owner && c.id !== 1 && <DeleteBox clinic={c} onDeleted={onClose} />}
    </aside>
  )
}

/** Оплата (владелец): отметить оплату — срок продлевает сервер; история; поправить срок; бесплатно. */
function BillingBox({ id }: { id: number }) {
  const plan = useQuery({ queryKey: ['platform-plan', id], queryFn: () => unwrap(api.GET('/api/platform/clinics/{id}/plan', { params: { path: { id } } })) })
  if (plan.isPending) return <section className="form"><h3>Оплата</h3><p className="hint">Загрузка…</p></section>
  if (plan.error) return <section className="form"><h3>Оплата</h3><p className="error">{plan.error.message}</p></section>
  return <BillingForm id={id} plan={plan.data} />
}

function BillingForm({ id, plan }: { id: number; plan: Plan }) {
  const client = useQueryClient()
  const today = todayIn()
  const price = (n: number) => (n === 12 ? plan.tariff?.yearSom ?? 0 : (plan.tariff?.monthSom ?? 0) * n)
  const [months, setMonths] = useState(1)
  const [paidOn, setPaidOn] = useState(today)
  const [amount, setAmount] = useState(String(price(1)))
  const [manual, setManual] = useState(plan.billing?.paidUntil ?? '')
  const [done, setDone] = useState('')
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['platform-plan', id] })
    void client.invalidateQueries({ queryKey: ['platform-clinics'] })
  }
  const pay = useMutation<Plan, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/clinics/{id}/payments', {
      params: { path: { id } }, body: { paidOn, amountSom: amount === '' ? undefined : Number(amount), months },
    })),
    onSuccess: (p) => {
      setDone(`Оплата отмечена — до ${day(p.billing?.paidUntil)}`)
      refresh()
    },
  })
  const undo = useMutation<Plan, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/platform/clinics/{id}/payments/last', { params: { path: { id } } })),
    onSuccess: () => {
      setDone('Последняя оплата отменена')
      refresh()
    },
  })
  const setUntil = useMutation<unknown, ApiError, string | null>({
    mutationFn: (paidUntil) => unwrap(api.PUT('/api/platform/clinics/{id}/paid-until', { params: { path: { id } }, body: { paidUntil: paidUntil ?? undefined } })),
    onSuccess: (_r, v) => {
      setDone(v ? 'Срок сохранён' : 'Клиника — бесплатно')
      refresh()
    },
  })
  const line = billingLine(plan.billing)
  const error = pay.error ?? undo.error ?? setUntil.error

  return (
    <section className="form">
      <h3>Оплата</h3>
      <p className={`tone-${line.tone} strong`}>{line.text}</p>
      <p className="hint">Тариф «{plan.tariff?.name}» по числу врачей ({plan.doctors}): {somText(plan.tariff?.monthSom ?? 0)} в месяц</p>
      <div className="segments" role="group" aria-label="На сколько месяцев">
        {[1, 3, 6, 12].map((n) => (
          <button key={n} type="button" aria-pressed={months === n} onClick={() => { setMonths(n); setAmount(String(price(n))); setDone('') }}>{n} мес</button>
        ))}
      </div>
      <div className="row">
        <label className="field"><span>Дата оплаты</span><input type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
        <label className="field"><span>Сумма, сом</span><input type="number" min={0} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      </div>
      <p className="hint">Оплачено будет до {day(extendPaid(plan.billing?.paidUntil, months, paidOn || today))}</p>
      {error && <p className="error" role="alert">{Object.values(error.fieldErrors)[0] ?? error.message}</p>}
      {done && <p className="tone-ok" role="status">{done}</p>}
      <button type="button" className="btn primary" disabled={pay.isPending} onClick={() => pay.mutate()}>Отметить оплату</button>
      {(plan.payments?.length ?? 0) > 0 && (
        <>
          <ul className="visits">
            {plan.payments!.map((p) => <li key={p.id}><b className="num">{somText(p.amountSom ?? 0)}</b> · {p.months} мес <span className="hint">· {day(p.paidOn)} → до {day(p.paidUntil)}</span></li>)}
          </ul>
          <button type="button" className="btn small" disabled={undo.isPending}
            onClick={() => window.confirm('Отменить последнюю оплату?') && undo.mutate()}>Отменить последнюю оплату</button>
        </>
      )}
      <details>
        <summary>Поправить срок вручную</summary>
        <div className="form">
          <label className="field"><span>Оплачено до</span><input type="date" value={manual} onChange={(e) => setManual(e.target.value)} /></label>
          <div className="actions">
            <button type="button" className="btn" disabled={!manual || setUntil.isPending} onClick={() => setUntil.mutate(manual)}>Сохранить срок</button>
            <button type="button" className="btn" disabled={setUntil.isPending} onClick={() => setUntil.mutate(null)}>Бесплатно (пилот)</button>
          </div>
          <p className="hint">После срока — 7 дней отсрочки, затем новые записи на паузе; остальное работает. Админам бот напомнит за 7, 3 и 1 день.</p>
        </div>
      </details>
    </section>
  )
}

/** Договор клиники: подписан ли, кем; PDF и сканы — владельцу в бот. */
function AgreementBox({ id, owner }: { id: number; owner: boolean }) {
  const a = useQuery({ queryKey: ['platform-clinic-agreement', id], queryFn: () => unwrap(api.GET('/api/platform/clinics/{id}/agreement', { params: { path: { id } } })) })
  const [done, setDone] = useState('')
  const pdf = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/clinics/{id}/agreement/pdf/send', { params: { path: { id } } })),
    onSuccess: () => setDone('PDF отправлен в чат с ботом'),
  })
  const scan = useMutation<unknown, ApiError, number>({
    mutationFn: (scanId) => unwrap(api.POST('/api/platform/clinics/{id}/agreement/scans/{scanId}/send', { params: { path: { id, scanId } } })),
    onSuccess: () => setDone('Скан отправлен в чат с ботом'),
  })
  const d = a.data
  const accepted = d?.accepted
  return (
    <section className="form">
      <h3>Договор</h3>
      {a.isPending && <p className="hint">Загрузка…</p>}
      {a.error && <p className="error">{a.error.message}</p>}
      {d && (
        <>
          <p className={accepted ? 'tone-ok strong' : d.current ? 'tone-wait strong' : 'hint'}>
            {accepted ? 'Договор подписан' : d.current ? `Версия ${d.current.version} не подписана` : 'Договор ещё не опубликован'}</p>
          <p className="hint">{accepted ? `${accepted.acceptedAt ? shortDate(accepted.acceptedAt) : ''} · версия ${accepted.version} — ${accepted.signerName} · «${accepted.clinicLegalName}»`
            : d.last ? `Принята раньше: версия ${d.last.version}` : 'Клиника ещё не принимала договор'}</p>
          {owner && d.current && <button type="button" className="btn small" disabled={pdf.isPending} onClick={() => pdf.mutate()}>
            {accepted ? 'Подписанный договор — PDF в бот' : 'PDF для подписи — в бот'}</button>}
          {owner ? (d.scans?.length ? (
            <ul className="visits">{d.scans.map((x) => (
              <li key={x.id}>{x.fileName} <button type="button" className="btn small ghost" disabled={scan.isPending} onClick={() => scan.mutate(x.id!)}>В бот</button></li>
            ))}</ul>
          ) : <p className="hint">Сканов нет</p>) : <p className="hint">Сканов: {d.scans?.length ?? 0}</p>}
          {(pdf.error ?? scan.error) && <p className="error">{(pdf.error ?? scan.error)!.message}</p>}
          {done && <p className="tone-ok" role="status">{done}</p>}
        </>
      )}
    </section>
  )
}

/**
 * Войти в клинику админом или регистратором (только владелец: внутри видны пациенты). Клиника
 * не открыла доступ — объяснить и предложить аварийный вход (он всегда в журнале клиники).
 */
function EnterBox({ id }: { id: number }) {
  const enter = useMutation<unknown, ApiError, { reception: boolean; emergency?: boolean }>({
    mutationFn: (body) => unwrap(api.POST('/api/platform/clinics/{id}/enter', { params: { path: { id } }, body })),
    // Другая клиника — другие врачи, пациенты и права: начать заново
    onSuccess: () => window.location.reload(),
  })
  const [last, setLast] = useState(false)
  const go = (reception: boolean) => {
    setLast(reception)
    enter.mutate({ reception })
  }
  return (
    <section className="form">
      <h3>Войти в клинику</h3>
      <p className="hint">Откроется CRM этой клиники — как у её админа. Вас будет видно в её «Сотрудниках».</p>
      <div className="actions">
        <button type="button" className="btn primary" disabled={enter.isPending} onClick={() => go(false)}>Войти как админ</button>
        <button type="button" className="btn" disabled={enter.isPending} onClick={() => go(true)}>Войти как регистратор</button>
      </div>
      {enter.error?.code === 'support-access-required' ? (
        <div className="duplicate" role="alert">
          <p>{enter.error.message}</p>
          <button type="button" className="btn danger" disabled={enter.isPending}
            onClick={() => window.confirm('Аварийный вход: клиника получит сообщение. Войти?') && enter.mutate({ reception: last, emergency: true })}>Аварийный вход — клиника узнает</button>
        </div>
      ) : enter.error && <p className="error" role="alert">{enter.error.message}</p>}
    </section>
  )
}

/**
 * Пригласить админа клиники ссылкой; админ уже есть — свёрнуто (второй управляющий, сменил Telegram).
 * Ещё одного админа в работающую клинику приглашает только владелец: менеджер открыл бы ссылку сам
 * и увидел бы пациентов (сервер ответит 403).
 */
function AdminInvite({ clinic: c, initial, owner }: { clinic: Row; initial?: { name: string; solo: boolean }; owner: boolean }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [alsoDoctor, setAlsoDoctor] = useState(initial?.solo ?? false)
  const make = useMutation<Schemas['DoctorInvitesInvite'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/clinics/{id}/admin-invite', { params: { path: { id: c.id! } }, body: { fullName: name, alsoDoctor } })),
  })
  const form = make.data?.token ? <InviteLink start={`staff_${make.data.token}`} name={name.trim()} toWhom="админу клиники" /> : (
    <form className="form" aria-label="Пригласить админа клиники" onSubmit={(e) => { e.preventDefault(); make.mutate() }}>
      <label className="field"><span>Имя админа</span><input value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={alsoDoctor} onChange={(e) => setAlsoDoctor(e.target.checked)} /> Он же ведёт приём (частный врач) — станет и врачом</label>
      {make.error && <p className="error" role="alert">{make.error.fieldErrors.fullName ?? make.error.message}</p>}
      <button type="submit" className="btn primary" disabled={make.isPending}>Создать ссылку</button>
    </form>
  )
  return c.admins ? (
    <section className="form">
      <h3>Админ клиники</h3>
      <p>{c.admins}</p>
      {owner && <details><summary>Пригласить ещё одного админа</summary>{form}</details>}
    </section>
  ) : (
    <section className="form">
      <h3>Пригласить админа клиники</h3>
      <p className="hint">Админ откроет ссылку, нажмёт «Начать» и сам добавит врачей и регистратуру, заполнит «О клинике» и цены.</p>
      {form}
    </section>
  )
}

function ExportBox({ id }: { id: number }) {
  const run = useMutation<Schemas['ExportControllerResult'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/clinics/{id}/export', { params: { path: { id } } })),
  })
  return (
    <section className="form">
      <h3>Выгрузка данных</h3>
      <p className="hint">По просьбе клиники или при её уходе (договор, п. 7.3): все данные одним архивом — в ваш чат с ботом.</p>
      {run.data && <p className="tone-ok" role="status">Архив в чате с ботом: пациентов {run.data.patients}, снимков {run.data.filesIncluded}</p>}
      {run.error && <p className="error">{run.error.message}</p>}
      <button type="button" className="btn" disabled={run.isPending} onClick={() => run.mutate()}>Выгрузить данные клиники — в бот</button>
    </section>
  )
}

/** Скрыть тестовую или демо-клинику: внизу списка и не в каталоге; по прямой ссылке работает. */
function HideBox({ clinic: c }: { clinic: Row }) {
  const client = useQueryClient()
  const hide = useMutation<Row, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/clinics/{id}/hidden', { params: { path: { id: c.id! } }, body: { hidden: !c.hidden } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['platform-clinics'] }),
  })
  return (
    <section className="form">
      {hide.error && <p className="error">{hide.error.message}</p>}
      <button type="button" className="btn" disabled={hide.isPending} onClick={() => hide.mutate()}>
        {c.hidden ? 'Вернуть в список клиник' : 'Скрыть из списка (тестовая, демо)'}</button>
    </section>
  )
}

/** Удалить клинику со всеми данными: название вписать вручную — сервер сверяет его сам. */
function DeleteBox({ clinic: c, onDeleted }: { clinic: Row; onDeleted: () => void }) {
  const client = useQueryClient()
  const [word, setWord] = useState('')
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/platform/clinics/{id}', { params: { path: { id: c.id! } }, body: { confirm: word } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['platform-clinics'] })
      void client.invalidateQueries({ queryKey: ['me'] })
      onDeleted()
    },
  })
  return (
    <div className="danger-zone form">
      <h3>Удалить клинику</h3>
      <p className="hint">Удалятся все данные клиники: врачей {c.doctors}, сотрудников {c.staff}, пациентов {c.patients} — с приёмами,
        анкетами, снимками, складом и услугами. Вернуть можно только из резервной копии.</p>
      <label className="field"><span>Впишите название: {c.name}</span>
        <input value={word} maxLength={100} autoComplete="off" placeholder={c.name} onChange={(e) => setWord(e.target.value)} /></label>
      {remove.error && <p className="error" role="alert">{remove.error.fieldErrors.confirm ?? remove.error.message}</p>}
      <button type="button" className="btn danger" disabled={!word || remove.isPending} onClick={() => remove.mutate()}>Удалить клинику навсегда</button>
    </div>
  )
}
