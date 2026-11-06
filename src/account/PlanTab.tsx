import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useState } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { download } from '../lib/download'
import { shortDate, somText } from '../lib/time'
import { useBlobUrl } from '../lib/useBlobUrl'
import { DeveloperContacts } from './Contacts'
import { billingLine, PAY_PERIOD_TEXT } from './texts'
import { Loading } from '../layout/Loading'

type Pay = Schemas['PayRequestsClinicView']

const day = (d?: string) => (d ? shortDate(`${d}T12:00:00Z`) : '')

/** «Тариф и оплата» (админ): до какого числа оплачено, тариф, как продлить, история оплат. */
export function PlanTab() {
  const plan = useQuery({ queryKey: ['clinic-plan'], queryFn: () => unwrap(api.GET('/api/clinic/plan')) })
  const pay = useQuery({ queryKey: ['clinic-pay'], queryFn: () => unwrap(api.GET('/api/clinic/pay')) })
  if (plan.isPending || pay.isPending) return <Loading />
  if (plan.error || pay.error) return <p className="error">{(plan.error ?? pay.error)!.message}</p>
  const p = plan.data
  const line = billingLine(p.billing)
  const t = p.tariffs

  return (
    <>
      <section className={`card-block pay-status tone-${line.tone}`}>
        <h2>Приложение: {line.text}</h2>
        <p className="hint">Ваш тариф — «{p.tariff?.name}»: работающих врачей {p.doctors}, {somText(p.tariff?.monthSom ?? 0)} в месяц</p>
      </section>

      <section className="card-block">
        <h2>Тарифы</h2>
        <div className="tariffs">
          {(t?.tariffs ?? []).map((x) => (
            <div key={x.code} className={x.code === p.tariff?.code ? 'tariff current' : 'tariff'}>
              {x.code === p.tariff?.code && <span className="chip small s-ok">ваш тариф</span>}
              <strong>{x.name}</strong>
              <span className="hint">{x.who}</span>
              <span className="tariff-price num">{somText(x.monthSom ?? 0)}<span className="hint"> / месяц</span></span>
              <span className="hint">за год — {somText(x.yearSom ?? 0)} (2 месяца в подарок)</span>
            </div>
          ))}
        </div>
        <p className="hint">Во всех тарифах — всё приложение: запись, бот, напоминания, медкарта, склад, касса.
          Тариф — по числу работающих врачей.</p>
      </section>

      <section className="card-block">
        <h2>Оплатить</h2>
        <PayBox pay={pay.data} />
      </section>

      {(p.payments?.length ?? 0) > 0 && (
        <section className="card-block">
          <h2>Оплаты</h2>
          <table className="table" aria-label="Оплаты">
            <thead><tr><th>Когда</th><th className="r">Сумма</th><th className="r">Срок</th><th>Оплачено до</th></tr></thead>
            <tbody>
              {p.payments!.map((x) => (
                <tr key={x.id}><td>{day(x.paidOn)}</td><td className="r num">{somText(x.amountSom ?? 0)}</td><td className="r">{x.months} мес</td><td>{day(x.paidUntil)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card-block">
        <h2>Вопросы по оплате</h2>
        <DeveloperContacts />
      </section>
    </>
  )
}

/**
 * Оплатить: срок → сумма → QR и как перевести → «Я оплатил(а)» с чеком. Деньги идут мимо
 * приложения; платформа сверяет с банком и продлевает срок. Пока проверяет — записи не на паузе.
 */
function PayBox({ pay }: { pay: Pay }) {
  const client = useQueryClient()
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['clinic-pay'] })
    void client.invalidateQueries({ queryKey: ['clinic-plan'] })
  }
  const s = pay.settings ?? {}
  const [months, setMonths] = useState(pay.periods?.[0]?.months ?? 1)
  const [file, setFile] = useState<File | null>(null)
  const [sent, setSent] = useState('')
  const qr = useBlobUrl(s.hasQr ? '/api/clinic/pay/qr' : null)
  const paid = useMutation<Schemas['PayRequestsRequest'], ApiError>({
    mutationFn: () => {
      const body = new FormData()
      if (file) body.append('file', file)
      return upload(`/api/clinic/pay/requests?months=${months}`, body)
    },
    onSuccess: refresh,
  })
  const cancel = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => unwrap(api.DELETE('/api/clinic/pay/requests/{id}', { params: { path: { id } } })),
    onSuccess: refresh,
  })
  const sendInvoice = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/clinic/pay/invoice/send', { params: { query: { months } } })),
    onSuccess: () => setSent('Счёт отправлен в чат с ботом'),
  })

  if (pay.pending) {
    const r = pay.pending
    return (
      <div className="form narrow">
        <p className="chip s-wait">Оплата на проверке</p>
        <p className="hint">{somText(r.amountSom ?? 0)} за {(PAY_PERIOD_TEXT[r.months ?? 1] ?? '').toLowerCase()} · отправлено {r.createdAt ? shortDate(r.createdAt) : ''}{r.hasReceipt ? ' · с чеком' : ''}</p>
        <p className="hint">Разработчики сверят перевод с банком — срок продлится сам, бот пришлёт «оплата получена». Пока проверяем, новые записи работают.</p>
        {cancel.error && <p className="error" role="alert">{cancel.error.message}</p>}
        <button type="button" className="btn" disabled={cancel.isPending}
          onClick={() => void ask('Отменить отправленную оплату?').then((ok) => ok && cancel.mutate(r.id!))}>Отменить — нажал(а) по ошибке</button>
      </div>
    )
  }
  const period = pay.periods?.find((x) => x.months === months)
  const nothing = !s.hasQr && !s.details
  return (
    <div className="form narrow">
      {pay.last?.status === 'REJECTED' && (
        <p className="tone-bad">Прошлую оплату ({somText(pay.last.amountSom ?? 0)}) не нашли{pay.last.comment ? `: ${pay.last.comment}` : ''}. Если вы уже заплатили — напишите разработчикам.</p>
      )}
      <div className="segments" role="group" aria-label="Срок оплаты">
        {(pay.periods ?? []).map((x) => (
          <button key={x.months} type="button" aria-pressed={x.months === months} onClick={() => { setMonths(x.months!); setSent('') }}>{PAY_PERIOD_TEXT[x.months!] ?? `${x.months} мес`}</button>
        ))}
      </div>
      <p><strong className="num">К оплате: {somText(period?.amountSom ?? 0)}</strong>{months === 12 && <span className="hint"> — 2 месяца в подарок</span>}</p>
      {nothing && <p className="hint">Способы оплаты ещё не заданы — напишите разработчикам, пришлём реквизиты.</p>}
      {qr && qr !== 'error' && <><p className="hint">Отсканируйте QR в приложении банка и введите сумму:</p><img className="pay-qr" src={qr.url} alt="QR для оплаты" /></>}
      {s.details && <p className="pay-details">{s.details}</p>}
      {s.hasRequisites && (
        <div className="field"><span>Платите со счёта клиники? Счёт для бухгалтерии — на выбранный срок:</span>
          <div className="actions">
            <button type="button" className="btn" disabled={sendInvoice.isPending} onClick={() => sendInvoice.mutate()}>Счёт — PDF в бот</button>
            <button type="button" className="btn" onClick={() => void download(`/api/clinic/pay/invoice?months=${months}`, 'schet.pdf')}>Скачать счёт</button>
          </div>
        </div>
      )}
      {sent && <p className="tone-ok" role="status">{sent}</p>}
      {!nothing && (
        <>
          <p className="hint">Оплатили? Нажмите — разработчики сверят перевод и продлят срок. Чек или скриншот — по желанию, так быстрее.</p>
          <label className="btn">{file ? `Чек: ${file.name}` : 'Приложить чек'}
            <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png" aria-label="Чек об оплате"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          {paid.error && <p className="error" role="alert">{paid.error.fieldErrors.file ?? paid.error.fieldErrors.months ?? paid.error.message}</p>}
          <button type="button" className="btn primary" disabled={paid.isPending} onClick={() => paid.mutate()}>Я оплатил(а)</button>
        </>
      )}
    </div>
  )
}
