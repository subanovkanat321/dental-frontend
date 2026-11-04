import { useQuery } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useEffect, useState } from 'react'

import { api, fetchBlob, unwrap, type Schemas } from '../api/client'
import { somText } from '../lib/time'
import { useAppointmentAction } from './useAppointmentAction'

type Appointment = Schemas['AppointmentView']
type Method = NonNullable<Schemas['DepositControllerAction']['method']>

const METHODS: [Method, string][] = [['TRANSFER', 'Перевод'], ['CASH', 'Наличные'], ['CARD', 'Карта']]
const STATUS: Record<string, [string, string]> = {
  AWAITING: ['ждём предоплату', 'wait'], REPORTED: ['пациент оплатил — проверьте', 'wait'], RECEIVED: ['получена', 'ok'],
}

/**
 * Предоплата в карточке записи (заявка или запись): не просили — «Попросить» (пациенту с ботом
 * уйдёт сообщение с суммой и QR); ждём или пациент сообщил — чек, «Получена» (как) и «Не нужна»;
 * получена — строкой: после приёма станет первым платежом.
 */
export function DepositBox({ appointment: a }: { appointment: Appointment }) {
  const action = useAppointmentAction(a)
  const [asking, setAsking] = useState(false)
  const [method, setMethod] = useState<Method>('TRANSFER')
  const settings = useQuery({
    queryKey: ['deposit-settings'],
    queryFn: () => unwrap(api.GET('/api/clinic/deposit')),
    enabled: asking,
    staleTime: 5 * 60_000,
  })
  const [amount, setAmount] = useState('')
  const shownAmount = amount || (settings.data?.amountSom ? String(settings.data.amountSom) : '')
  const error = action.error && <p className="error" role="alert">{action.error.message}</p>

  if (!a.depositStatus) {
    if (!asking) return <button type="button" className="link" onClick={() => setAsking(true)}>Попросить предоплату</button>
    return (
      <div className="sub-form form" role="group" aria-label="Предоплата">
        <label className="field"><span>Сколько предоплаты, сом</span>
          <input type="number" min={1} inputMode="numeric" value={shownAmount} onChange={(e) => setAmount(e.target.value)} /></label>
        <p className="hint">{a.patient?.telegram ? 'Пациенту в бот уйдёт сообщение: сумма, QR и «Я оплатил(а)».'
          : 'У пациента нет бота — отправьте ему реквизиты сами (WhatsApp) и отметьте, когда деньги придут.'}</p>
        {error}
        <div className="actions">
          <button type="button" className="btn primary" disabled={action.isPending || !Number(shownAmount)}
            onClick={() => action.mutate({ kind: 'deposit', body: { action: 'REQUEST', amountSom: Number(shownAmount) } })}>Попросить предоплату</button>
          <button type="button" className="btn ghost" onClick={() => setAsking(false)}>Отмена</button>
        </div>
      </div>
    )
  }
  const [text, tone] = STATUS[a.depositStatus] ?? [a.depositStatus, 'wait']
  if (a.depositStatus === 'RECEIVED') {
    return <p className={`tone-${tone}`}>Предоплата {somText(a.depositSom ?? 0)}: {text}. После приёма она станет первым платежом.</p>
  }
  return (
    <div className="sub-form form" role="group" aria-label="Предоплата">
      <strong className={`tone-${tone}`}>Предоплата {somText(a.depositSom ?? 0)}: {text}</strong>
      {a.depositStatus === 'REPORTED' && <Receipt id={a.id!} />}
      <div className="segments" role="group" aria-label="Как получена предоплата">
        {METHODS.map(([code, name]) => <button key={code} type="button" aria-pressed={method === code} onClick={() => setMethod(code)}>{name}</button>)}
      </div>
      {error}
      <div className="actions">
        <button type="button" className="btn primary" disabled={action.isPending}
          onClick={() => action.mutate({ kind: 'deposit', body: { action: 'RECEIVED', method } })}>Получена</button>
        <button type="button" className="btn" disabled={action.isPending}
          onClick={() => void ask('Снять предоплату с записи?').then((ok) => ok && action.mutate({ kind: 'deposit', body: { action: 'NONE' } }))}>Не нужна</button>
      </div>
    </div>
  )
}

/** Чек, который приложил пациент: картинка или PDF. Нет чека — сверить перевод по банку. */
function Receipt({ id }: { id: number }) {
  const [file, setFile] = useState<{ url: string; image: boolean } | null | 'none'>(null)
  useEffect(() => {
    let url: string | null = null
    let alive = true
    fetchBlob(`/api/appointments/${id}/deposit/receipt`)
      .then((blob) => {
        url = URL.createObjectURL(blob)
        if (alive) setFile({ url, image: blob.type.startsWith('image/') })
      })
      .catch(() => alive && setFile('none'))
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [id])
  if (file === null) return <p className="hint">Загружаем чек…</p>
  if (file === 'none') return <p className="hint">Чек не приложили — сверьте перевод по банку.</p>
  return file.image
    ? <a href={file.url} target="_blank" rel="noopener noreferrer"><img className="receipt" src={file.url} alt="Чек пациента" /></a>
    : <a href={file.url} download="chek.pdf">Чек (PDF) — скачать</a>
}
