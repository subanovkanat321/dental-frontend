import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { Loading } from '../layout/Loading'
import { shortDate, somText, timeOf, todayIn } from '../lib/time'
import { purposeText } from './cashEntryText'

type Entry = Schemas['PaymentQueryCashEntry']

const METHODS: Record<string, string> = { CASH: 'наличные', TRANSFER: 'перевод', CARD: 'карта' }

/** Кто отметил: имя сотрудника и «через бот», если отметил помощник в боте. */
function whoText(e: Entry): string {
  return [e.takenBy, e.viaBot ? 'через бот' : null].filter(Boolean).join(' · ')
}

/**
 * «Поступления (N) ›» под «Кассой»: раскрыть — список денег за период, из которых сложена «Касса» (тот же
 * отбор на сервере, сумма списка равна ей). Строка — карточка приёма; старый долг (приёма нет) — карточка пациента.
 * Список грузится только раскрытым: за год это сотни строк.
 */
export function CashEntries({ from, to, doctorId, count, onOpen, onOpenPatient, active }: {
  from: string
  to: string
  doctorId: number | null
  count: number
  onOpen: (appointmentId: number) => void
  onOpenPatient?: (patientId: number) => void
  active: number | null
}) {
  const [open, setOpen] = useState(false)
  const entries = useQuery({
    queryKey: ['cash-entries', from, to, doctorId],
    queryFn: () => unwrap(api.GET('/api/appointments/cash-entries', {
      params: { query: { from, to, ...(doctorId == null ? {} : { doctorId }) } },
    })),
    enabled: open && from <= to,
  })
  if (!count) return null
  const oneDay = from === to
  const today = todayIn()
  return (
    <div className="cash-entries-block">
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        Поступления ({count}) {open ? '⌃' : '›'}
      </button>
      {open && (entries.isPending ? <Loading />
        : entries.error ? <p className="error">{entries.error.message}</p>
        : (
          <ul className="cash-entries" aria-label="Поступления">
            {entries.data.map((e, i) => {
              const target = e.appointmentId != null ? () => onOpen(e.appointmentId!)
                : e.patientId != null && onOpenPatient ? () => onOpenPatient(e.patientId!) : undefined
              const who = whoText(e)
              const body = (
                <>
                  <span className="when num">{e.paidAt ? (oneDay ? timeOf(e.paidAt) : shortDate(e.paidAt, true)) : ''}</span>
                  <span className="what">{purposeText(e, today)}{e.patient ? <> · <span className="nowrap">{e.patient}</span></> : null}</span>
                  <span className="sum num">{somText(e.amountSom)}</span>
                  <span className="sub">{[METHODS[e.method ?? ''] ?? e.method, who, e.discountSom ? `скидка ${somText(e.discountSom)}` : null]
                    .filter(Boolean).join(' · ')}</span>
                </>
              )
              return (
                <li key={`${e.paidAt}-${e.appointmentId ?? 'o'}-${i}`}>
                  {target
                    ? <button type="button" className={`cash-entry${e.appointmentId != null && e.appointmentId === active ? ' active' : ''}`}
                      onClick={target}>{body}</button>
                    : <div className="cash-entry">{body}</div>}
                </li>
              )
            })}
          </ul>
        ))}
    </div>
  )
}
