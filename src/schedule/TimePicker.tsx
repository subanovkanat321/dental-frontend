import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { api, unwrap } from '../api/client'
import { suggestTime, timeOf, workHours } from '../lib/time'
import { Loading } from '../layout/Loading'
import { TimeInput } from '../layout/TimeInput'

function endText(time: string, duration: number): string {
  const [h, m] = time.split(':').map(Number)
  const end = (h ?? 0) * 60 + (m ?? 0) + duration
  return `${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
}

/**
 * Время приёма — как в прежнем приложении: сетка свободных начал (/api/slots) под длительность,
 * нажать — выбрать; «Другое время» — ввести руками (например, вне часов работы): в листе сразу часы
 * врача в этот день и строка «Свободно» с теми же началами. При переносе
 * старое время самого приёма считается свободным (exclude). Время из сетки не помещается —
 * сразу ручной ввод с этим временем. «Время занято» (error) — сетка перечитывается.
 */
export function TimePicker({ date, doctorId, duration, exclude, value, onChange, error }: {
  date: string
  doctorId: number
  duration: number
  exclude?: number
  value: string
  onChange: (time: string) => void
  error?: string | null
}) {
  const slots = useQuery({
    queryKey: ['slots', date, doctorId, duration, exclude ?? null],
    queryFn: () => unwrap(api.GET('/api/slots', { params: { query: { date, doctorId, duration, exclude } } })),
    enabled: Boolean(date),
  })
  const { refetch } = slots
  useEffect(() => {
    if (error) void refetch()
  }, [error, refetch])
  const starts = (slots.data?.starts ?? []).map(timeOf)
  const [manualChoice, setManual] = useState<boolean | null>(null)
  // Подставленное время не в сетке — показываем его в поле и дальше остаёмся в ручном вводе
  // (стерли время — поле не пропадает). Состояние меняем при отрисовке, без эффекта и мигания
  if (manualChoice === null && Boolean(value) && slots.data != null && !starts.includes(value)) setManual(true)
  const manual = manualChoice ?? false

  return (
    <div className="field">
      <span>Время</span>
      {error && <p className="error" role="alert">{error}</p>}
      {!manual && (
        slots.isPending ? <Loading />
          : slots.error ? <p className="error">{slots.error.message}</p>
            : starts.length === 0 ? <p className="hint">{slots.data?.workingDay === false ? (slots.data.dayOff?.title ?? 'Выходной') : 'Свободного времени нет'}</p> : (
              <div className="slots" role="group" aria-label="Свободное время">
                {starts.map((t) => (
                  <button key={t} type="button" className="slot num" aria-pressed={t === value} onClick={() => onChange(t)}>{t}</button>
                ))}
              </div>
            )
      )}
      {manual && (
        // Часы врача в этот день — сразу, остальные — «Другие часы»; свободные начала — чипами сверху листа
        <TimeInput aria-label="Время" value={value} required onChange={onChange}
          hours={slots.data?.workingDay === false ? undefined : workHours(slots.data?.workStart, slots.data?.workEnd)} free={starts} />
      )}
      <button type="button" className="link" onClick={() => {
        // Своё время, а поле пустое — не текущая минута (как у системного поля: «22:43»), а ближайшие
        // 5 минут сегодня или начало работы врача в другой день
        if (!manual && !value) onChange(suggestTime(date, slots.data?.workStart))
        setManual(!manual)
      }}>{manual ? 'Выбрать свободное время' : 'Другое время'}</button>
      {value && <p className="hint appt-end">Приём: {value}–{endText(value, duration)}</p>}
    </div>
  )
}
