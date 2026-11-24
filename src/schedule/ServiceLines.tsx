import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ServicePicker } from '../clinic/ServicePicker'
import { EditButton } from '../layout/EditButton'
import { servicesOfDoctor } from '../lib/doctorServices'
import { serviceEmoji } from '../lib/serviceEmoji'
import { somText, timeOf } from '../lib/time'
import { StepPrice } from '../medical/StepPrice'
import { useDiscountPolicy } from './discountDraft'
import { fromLine, lineMoney } from './lineDiscount'
import { useAppointmentAction } from './useAppointmentAction'
import { LOCKED_HINT, lockedForMe, parseTeeth } from './lineLabel'

type Appointment = Schemas['AppointmentView']
type Line = Schemas['ServiceLine']
type Me = Schemas['BookingViewsMe']

function errorText(e: ApiError | null): string | null {
  if (!e) return null
  return e.fieldErrors.teeth ?? e.fieldErrors.qty ?? e.fieldErrors.priceSom ?? e.fieldErrors.discount ?? e.fieldErrors.serviceTypeId ?? e.message
}

/** «🦷 Лечение кариеса · 36, 37 · × 2 · 12 000 сом» */
function LineText({ line, prices }: { line: Line; prices: boolean }) {
  return (
    <span className="service-line-text">
      <span aria-hidden="true">{serviceEmoji(line.name)} </span><span>{line.name}</span>
      {line.teeth.length > 0 && <span className="hint"> · {line.teeth.join(', ')}</span>}
      {line.qty > 1 && <span className="hint"> ·{'\u00a0'}×{'\u00a0'}{line.qty}</span>}
      {prices && line.amountSom != null && line.netSom != null && line.discountSom ? (
        <span className="service-line-sum wrap"> ·{'\u00a0'}<s className="hint nowrap">{somText(line.amountSom)}</s>{' '}<span className="nowrap">{somText(line.netSom)}</span>
          {' '}<span className="hint small nowrap">(скидка {line.discountPercent != null ? `${line.discountPercent} %` : somText(line.discountSom)})</span></span>
      ) : prices && line.amountSom != null && <span className="service-line-sum"> ·{'\u00a0'}{somText(line.amountSom)}</span>}
    </span>
  )
}

/**
 * «Услуги» в карточке записи (шаг 5А): строки услуг приёма — зубы, количество, цена; «изменить», ✕ и «＋ Услуга» (тот же
 * ServicePicker, что в «Новой записи»). Деньги — только тем, кто их видит (ассистенту сервер их не отдаёт). Состоявшийся
 * приём прошлого дня врачу — только посмотреть: «🔒 изменить может руководитель» (сервер ответит тем же 403).
 */
export function ServiceLines({ appointment: a, me, canEdit, prices }: { appointment: Appointment; me: Me; canEdit: boolean; prices: boolean }) {
  const action = useAppointmentAction(a)
  const policy = useDiscountPolicy()
  const [editing, setEditing] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  // Старый ответ без строк (до V246) — главная услуга одной строкой без цены
  const lines: Line[] = a.services?.length ? a.services
    : a.serviceName ? [{ id: -1, name: a.serviceName, qty: 1, teeth: [] }] : []
  const locked = lockedForMe(a, me)
  const editable = canEdit && a.status !== 'CANCELLED' && !locked
  const services = useQuery({
    queryKey: ['service-types'],
    queryFn: () => unwrap(api.GET('/api/service-types')),
    staleTime: 5 * 60_000,
    // Нужен и для «услуги не помещаются в приём» — грузим, пока приём можно продлить
    enabled: editable && (adding || editing != null || a.status === 'SCHEDULED'),
  })
  const offered = servicesOfDoctor((services.data ?? []).filter((s) => s.active !== false), me.doctorServices, a.doctorId)
  const total = prices && lines.length > 1 && a.servicesTotalSom != null ? a.servicesTotalSom : null
  // Скидки строк (V258) вместе — «итого 26 000 сом, скидка 6 000»
  const linesOff = prices ? lines.reduce((sum, l) => sum + (l.discountSom ?? 0), 0) : 0
  // Услуги не помещаются в приём (2026-11-21, владелец: «коронка × 4 — сумма прибавилась, а время нет»): сколько займут
  // по длительностям прайса × количество — и «Продлить до …» (то же, что «Перенести» с той же датой; занято — скажет сервер)
  const needed = Math.min(lines.reduce((m, l) => m + (services.data?.find((sv) => sv.id === l.serviceTypeId)?.durationMinutes ?? 0) * l.qty, 0), 480)
  const length = Math.round((Date.parse(a.endAt) - Date.parse(a.startAt)) / 60_000)
  const short = editable && a.status === 'SCHEDULED' && length > 0 && needed > length
  const extend = () => action.mutate({ kind: 'reschedule', body: { version: a.version, startAt: a.startAt, durationMinutes: needed } })

  return (
    <div className="service-lines" aria-label="Услуги">
      <p className="service-lines-head">
        <span className="hint">Услуги:</span>
        {lines.length === 0 && <span> —</span>}
        {total != null && <span className="hint service-lines-total"> итого {somText(total)}{linesOff > 0 ? `, скидка ${somText(linesOff)}` : ''}</span>}
        {locked && canEdit && <span className="hint small service-lock" title="Врач меняет состоявшийся приём только в день приёма">{LOCKED_HINT}</span>}
      </p>
      {lines.length > 0 && (
        <ul className="service-line-list">
          {lines.map((line) => (
            <li key={line.id} className="service-line">
              {editing === line.id ? (
                <LineEdit line={line} prices={prices} pending={action.isPending} error={errorText(action.error)} policy={policy.data}
                  listPrice={services.data?.find((sv) => sv.id === line.serviceTypeId)?.priceSom}
                  onCancel={() => setEditing(null)}
                  onSave={(body) => action.mutate({ kind: 'updateLine', lineId: line.id, body }, { onSuccess: () => setEditing(null) })} />
              ) : (
                <>
                  <LineText line={line} prices={prices} />
                  {editable && line.id > 0 && (
                    <span className="service-line-actions">
                      <EditButton label={`Изменить: ${line.name}`} onClick={() => setEditing(line.id)} />
                      <button type="button" className="chip-x" aria-label={`Убрать: ${line.name}`} disabled={action.isPending}
                        onClick={() => action.mutate({ kind: 'removeLine', lineId: line.id })}>✕</button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (adding ? (
        <div className="service-line-add">
          <ServicePicker aria-label="Добавить услугу" services={offered} value="" prices={prices} placeholder="Выберите услугу…"
            onChange={(id) => {
              if (id === '') return
              // Та же услуга уже есть (без зубов) — «× 2» к ней, а не вторая такая же строка (2026-11-21, владелец)
              const same = lines.find((l) => l.id > 0 && l.serviceTypeId === id && l.teeth.length === 0)
              if (same) action.mutate({ kind: 'updateLine', lineId: same.id, body: { qty: same.qty + 1 } }, { onSuccess: () => setAdding(false) })
              else action.mutate({ kind: 'addLine', body: { serviceTypeId: id } }, { onSuccess: () => setAdding(false) })
            }} />
          <button type="button" className="btn ghost small" onClick={() => setAdding(false)}>Отмена</button>
        </div>
      ) : (
        <button type="button" className="link service-line-plus" onClick={() => setAdding(true)}>＋ Услуга</button>
      ))}
      {short && (
        <p className="service-lines-short tone-wait" role="note">
          Услуги займут {durationText(needed)}, а приём — {durationText(length)}.{' '}
          <button type="button" className="link" disabled={action.isPending} onClick={extend}>
            Продлить до {timeOf(new Date(Date.parse(a.startAt) + needed * 60_000).toISOString())}</button>
        </p>
      )}
      {editing == null && action.error && <p className="error" role="alert">{errorText(action.error)}</p>}
    </div>
  )
}

/**
 * Строка в правке: зубы («36, 37»), количество (− 1 +) и цена за единицу — тем, кто видит деньги. Цена ниже цены строки —
 * скидка на разницу × количество (V258, как в плане лечения: «7 000 → 6 000», × 4 — скидка 4 000), кнопки процентов — там же
 * (StepPrice). Скидку отправляем, только если цену или скидку трогали: иначе сервер оставит прежнюю.
 */
function LineEdit({ line, prices, pending, error, policy, listPrice, onSave, onCancel }: {
  line: Line; prices: boolean; pending: boolean; error: string | null; policy?: Schemas['DiscountPoliciesPolicy']; listPrice?: number | null
  onSave: (body: Schemas['AppointmentRequestsUpdateLine']) => void; onCancel: () => void
}) {
  const [teeth, setTeeth] = useState(line.teeth.join(', '))
  const [qty, setQty] = useState(line.qty)
  const [money, setMoney] = useState(() => fromLine(line))
  const [touched, setTouched] = useState(false)
  const parsed = parseTeeth(teeth)
  const m = lineMoney(money, qty, policy)
  return (
    <form className="form sub-form service-line-edit" aria-label={`Услуга: ${line.name}`} onSubmit={(e) => {
      e.preventDefault()
      if (!parsed) return
      onSave(prices && touched && money.price !== '' ? { teeth: parsed, qty, priceSom: m.priceSom, discount: m.discount } : { teeth: parsed, qty })
    }}>
      <p className="service-line-name">{serviceEmoji(line.name)} {line.name}</p>
      <label className="field"><span>Зубы</span>
        <input inputMode="numeric" placeholder="36, 37" aria-label="Зубы" value={teeth} onChange={(e) => {
          setTeeth(e.target.value)
          // Вписали зубы — количество по их числу (поменять можно)
          const next = parseTeeth(e.target.value)
          if (next && next.length > 0) setQty(next.length)
        }} />
      </label>
      {!parsed && <p className="error small">Номера зубов через запятую: 36, 37</p>}
      <div className="field"><span>Количество</span>
        <div className="qty-stepper" role="group" aria-label="Количество">
          <button type="button" className="btn ghost small" aria-label="Меньше" disabled={qty <= 1} onClick={() => setQty(qty - 1)}>−</button>
          <output aria-live="polite">{qty}</output>
          <button type="button" className="btn ghost small" aria-label="Больше" disabled={qty >= 32} onClick={() => setQty(qty + 1)}>+</button>
        </div>
      </div>
      {prices && (
        <StepPrice value={money} onChange={(d) => { setMoney(d); setTouched(true) }} policy={policy} label="Цена за единицу, сом"
          inputLabel="Цена за единицу, сом" listPrice={listPrice != null && listPrice > (line.priceSom ?? 0) ? listPrice : undefined} />
      )}
      {prices && m.off > 0 && qty > 1 && <p className="hint small num">Скидка на строку: {somText(m.off)} (× {qty})</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={pending || !parsed}>Сохранить</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  )
}

/** «1 ч 30 мин», «45 мин». */
function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} ч${m ? ` ${m} мин` : ''}` : `${m} мин`
}
