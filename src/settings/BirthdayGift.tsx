import '../schedule/attention.css'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ChoiceCards, type Choice } from '../layout/ChoiceCards'
import { Loading } from '../layout/Loading'
import { Select } from '../layout/Select'
import { discountText, usePromoCodes } from '../lib/promo'
import { somText } from '../lib/time'
import { GIFT_KEY, useBirthdayGift, type Gift, type GiftPreset } from '../patients/birthdayGift'

type Request = Schemas['BirthdaysGiftRequest']
type Settings = Schemas['BirthdaysSettings']

/** Услуга «профчистка» в прайсе — подставим её сами, когда выбрали «Бесплатная профчистка». */
const CLEANING = /чистк|гигиен/i

const CHOICES: Choice<GiftPreset>[] = [
  { value: 'NONE', icon: '—', title: 'Без подарка', text: 'Только тёплое поздравление' },
  { value: 'PERCENT_10', icon: '🎁', title: 'Скидка 10 %', text: <>Код <b>ДР10</b> — скидка на лечение</> },
  { value: 'PERCENT_15', icon: '🎁', title: 'Скидка 15 %', text: <>Код <b>ДР15</b> — скидка на лечение</> },
  { value: 'PERCENT_20', icon: '🎁', title: 'Скидка 20 %', text: <>Код <b>ДР20</b> — скидка на лечение</> },
  { value: 'CLEANING', icon: '🪥', title: 'Бесплатная профчистка', text: <>Код <b>ДРЧИСТКА</b> — в оплате скидка на цену чистки</> },
  { value: 'CUSTOM', icon: '🎟', title: 'Свой промокод…', text: 'Любой промокод клиники из «Промокодов»' },
]

/** «24 декабря» из 2026-12-24 — как в поздравлении. */
function dayMonth(date: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}

/**
 * «🎁 Подарок на день рождения» в «Настройки → Дни рождения» (2026-11-24, владелец: «скидку или бесплатную чистку — в
 * поздравления»): вариант — одним касанием, промокод «ДР10» заводит сервер. Ниже — образец поздравления на вымышленной
 * пациентке, ровно как его получит пациент (ru / ky). Меняет руководитель (остальным сервер ответит 403).
 */
export function BirthdayGiftSection() {
  const client = useQueryClient()
  const gift = useBirthdayGift()
  const promos = usePromoCodes()
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), staleTime: 5 * 60_000 })
  const [lang, setLang] = useState<'RU' | 'KY'>('RU')
  // «Свой промокод…» выбрали, а код ещё нет — показываем список, сохраняем после выбора кода
  const [customOpen, setCustomOpen] = useState(false)
  const save = useMutation<Gift, ApiError, Request>({
    mutationFn: (body) => unwrap(api.PUT('/api/clinic/birthday-gift', { body })),
    onSuccess: (now) => {
      client.setQueryData(GIFT_KEY, now)
      // Настройки поздравлений хранят тот же промокод — иначе следующее «Поздравлять ботом» вернуло бы старый
      client.setQueryData<Settings>(['birthday-settings'], (old) => old && { ...old, promoCodeId: now.promoCodeId })
      void client.invalidateQueries({ queryKey: ['birthdays'] })
      void client.invalidateQueries({ queryKey: ['promo-codes'] })
      setCustomOpen(false)
    },
  })
  if (gift.isPending) return <Loading />
  if (gift.error) return <p className="error">{gift.error.message}</p>
  const g = gift.data
  const preset: GiftPreset = customOpen ? 'CUSTOM' : g.preset
  const active = (services.data ?? []).filter((s) => s.active || s.id === g.serviceId)
  const pick = (value: GiftPreset) => {
    if (value === 'CUSTOM') {
      setCustomOpen(true)
      return
    }
    setCustomOpen(false)
    const serviceId = value === 'CLEANING' ? (g.serviceId ?? active.find((s) => CLEANING.test(s.name))?.id) : undefined
    save.mutate({ preset: value, serviceId })
  }
  const codes = (promos.data ?? []).filter((p) => p.active || p.id === g.promoCodeId)
  return (
    <section className="card-block form" aria-label="Подарок на день рождения">
      <h3 className="choice-cards-title">🎁 Подарок на день рождения</h3>
      <p className="hint small">Строка о подарке попадёт в поздравление — и в «Поздравить», и в авто-поздравление ботом. Подарок действует
        {' '}{g.validDays} дней со дня поздравления (поздравить сегодня — «до {dayMonth(g.validUntil)}»). В оплате имениннику Tish сам
        подскажет «🎂 Подарок на день рождения — Применить».</p>
      <ChoiceCards label="Подарок на день рождения" value={preset} choices={CHOICES} onChange={pick} disabled={save.isPending} />
      {preset === 'CUSTOM' && (
        <label>
          Промокод в подарок
          <Select aria-label="Промокод в подарок" value={g.preset === 'CUSTOM' ? g.promoCodeId ?? '' : ''} disabled={save.isPending}
            onChange={(e) => e.target.value && save.mutate({ preset: 'CUSTOM', promoCodeId: Number(e.target.value) })}>
            <option value="">Выберите промокод</option>
            {codes.map((p) => <option key={p.id} value={p.id}>{p.code}{discountText(p) ? ` (${discountText(p)})` : ''}{p.active ? '' : ' — выключен'}</option>)}
          </Select>
          <span className="hint small">Промокоды заводят в «Откуда приходят пациенты» → «Промокоды».</span>
        </label>
      )}
      {preset === 'CLEANING' && (
        <label>
          Какая услуга — профчистка
          <Select aria-label="Услуга профчистки" value={g.serviceId ?? ''} disabled={save.isPending}
            onChange={(e) => save.mutate({ preset: 'CLEANING', serviceId: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Найти в приёме по названию («чистка», «гигиена»)</option>
            {active.map((s) => <option key={s.id} value={s.id}>{s.name}{s.priceSom != null ? ` · ${somText(s.priceSom)}` : ''}</option>)}
          </Select>
          <span className="hint small">В оплате Tish подставит скидку на цену этой услуги в приёме.</span>
        </label>
      )}
      {g.promoCodeId != null && !g.active && <p className="error small" role="alert">Промокод {g.code} выключен или просрочен — в поздравление подарок не попадёт</p>}
      {save.error && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
      <div className="bd-preview">
        <div className="bd-lang hint small">
          <span>Так получит пациент (пример):</span>
          <span className="segments" role="group" aria-label="Язык образца">
            {(['RU', 'KY'] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l === 'RU' ? 'Русский' : 'Кыргызча'}</button>
            ))}
          </span>
        </div>
        <p className="bd-preview-text" aria-label="Образец поздравления">{lang === 'RU' ? g.previewRu : g.previewKy}</p>
      </div>
    </section>
  )
}
