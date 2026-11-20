import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Loading } from '../layout/Loading'
import { Select } from '../layout/Select'
import { discountText, usePromoCodes } from '../lib/promo'
import { SubHeader } from './SubHeader'

type Settings = Schemas['BirthdaysSettings']

const KEY = ['birthday-settings']

/** Утро по Бишкеку, как на сервере (8–13). */
const HOURS = [8, 9, 10, 11, 12, 13]

/**
 * «Настройки → Дни рождения» (шаг 6Б; меняет руководитель — сервер отвечает 403 остальным): поздравлять ли пациентов ботом
 * автоматически (по умолчанию нет), во сколько утра и какой промокод дарить. Сохраняется сразу, как «Оценка приёма».
 */
export function BirthdaysPage({ onBack }: { onBack: () => void }) {
  const client = useQueryClient()
  const current = useQuery<Settings, ApiError>({ queryKey: KEY, queryFn: () => unwrap(api.GET('/api/clinic/birthday-settings')) })
  const promos = usePromoCodes()
  const save = useMutation<Settings, ApiError, Settings>({
    mutationFn: (body) => unwrap(api.PUT('/api/clinic/birthday-settings', { body })),
    onSuccess: (now) => {
      client.setQueryData(KEY, now)
      void client.invalidateQueries({ queryKey: ['birthdays'] })
    },
  })
  const value = save.isPending ? save.variables : current.data
  const change = (patch: Partial<Settings>) => value && save.mutate({ ...value, ...patch })
  const active = (promos.data ?? []).filter((p) => p.active || p.id === value?.promoCodeId)
  return (
    <section className="schedule-main">
      <SubHeader title="Дни рождения" onBack={onBack} />
      {current.isPending ? <Loading />
        : current.error ? <p className="error">{current.error.message}</p>
          : value && (
            <section className="card-block form" aria-label="Поздравления с днём рождения">
              <p className="hint">
                Именинники сегодня — в «Расписании» («🎂 Дни рождения») и в «Пациентах» (фильтр «🎂 Сегодня»): «Поздравить» в бот или
                WhatsApp тёплым текстом по-русски или по-кыргызски, с названием клиники. Только пациенты с датой рождения в карточке,
                которые были у вас за последние 2 года.
              </p>
              <label className="check">
                <input type="checkbox" checked={value.autoGreet} disabled={save.isPending} onChange={(e) => change({ autoGreet: e.target.checked })} />
                <span><strong>Поздравлять ботом автоматически</strong><span className="hint"> — пациентам в Telegram-боте, один раз в год.
                  Без бота — поздравит регистратура в WhatsApp.</span></span>
              </label>
              <label>
                Во сколько утра
                <Select aria-label="Во сколько поздравлять" value={value.greetHour} disabled={save.isPending || !value.autoGreet}
                  onChange={(e) => change({ greetHour: Number(e.target.value) })}>
                  {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </Select>
              </label>
              <label>
                Промокод в подарок
                <Select aria-label="Промокод в подарок" value={value.promoCodeId ?? ''} disabled={save.isPending}
                  onChange={(e) => change({ promoCodeId: e.target.value ? Number(e.target.value) : undefined })}>
                  <option value="">Без промокода</option>
                  {active.map((p) => <option key={p.id} value={p.id}>{p.code}{discountText(p) ? ` (${discountText(p)})` : ''}{p.active ? '' : ' — выключен'}</option>)}
                </Select>
              </label>
              <p className="hint small">Промокоды заводят в «Откуда приходят пациенты» → «Промокоды». Выключенный или просроченный в поздравление
                не попадёт. В утренней сводке руководителю бот пишет только число именинников — без имён.</p>
              {save.error && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
            </section>
          )}
    </section>
  )
}
