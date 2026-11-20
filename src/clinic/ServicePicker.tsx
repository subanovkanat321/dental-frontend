import type { Schemas } from '../api/client'
import { Select } from '../layout/Select'
import { serviceEmoji } from '../lib/serviceEmoji'
import { somText } from '../lib/time'
import { groupLabel, groupServices } from './services'
import { usePopularServices } from './serviceOptions'

type Service = Schemas['ServiceTypeView']

/** Сколько услуг в «Частых». */
const FREQUENT = 5
/** Меньше услуг — без «Частых» и разделов: список и так виден целиком. */
const PLAIN_UP_TO = 5
/** С этого числа услуг сверху списка — поиск. */
const SEARCH_FROM = 6

type Common = {
  /** Из чего выбирать: уже отобранные (услуги врача, только из прайса). */
  services: Service[]
  /** Цена в строке — только тем, кому видны деньги. */
  prices?: boolean
  'aria-label'?: string
  /** Подсказка в пустом поле. */
  placeholder?: string
  /** Приписка к строке: «не в прайсе» у снятой услуги. */
  note?: (s: Service) => string | null
}

type Single = Common & {
  multiple?: false
  value: number | ''
  /** '' — без услуги. */
  onChange: (id: number | '', service?: Service) => void
  /** Можно снять выбор: пункт «Без услуги». */
  clearable?: boolean
}

type Multiple = Common & {
  multiple: true
  values: number[]
  onChange: (ids: number[]) => void
}

/** «Лечение кариеса · 45 мин · 6 000 сом»: название — главным, остальное серым (Select делит по « · »). */
function rowText(s: Service, prices: boolean, note?: string | null): string {
  return [`${serviceEmoji(s.name)} ${s.name}`, s.durationMinutes ? `${s.durationMinutes} мин` : null,
    prices && s.priceSom ? somText(s.priceSom) : null, note ?? null].filter(Boolean).join(' · ')
}

/** «🦷 Лечение кариеса · 45 мин» — в поле и в чипе, без цены. */
function ValueLabel({ s }: { s: Service }) {
  return <><span aria-hidden="true">{serviceEmoji(s.name)} </span>{s.name}{s.durationMinutes ? <span className="hint"> · {s.durationMinutes} мин</span> : null}</>
}

/**
 * Выбор услуги одним полем вместо ряда кнопок (2026-11-20, владелец: «экономить место»): в поле — выбранная услуга
 * «🦷 Лечение кариеса · 45 мин», нажали — список (телефон — лист снизу, компьютер — под полем; это общий Select):
 * поиск сверху, «Частые» (топ клиники за 90 дней, нет данных — первые по порядку), потом все услуги по разделам
 * прайса; в строке — длительность и цена (только тем, кто видит деньги). Клавиатура: ↑ ↓ Enter Esc.
 *
 * multiple — несколько услуг на запись (следующий шаг): выбранные — чипами с ✕, поле — «＋ Добавить услугу».
 */
export function ServicePicker(props: Single | Multiple) {
  const { services, prices = false, note } = props
  const plain = services.length <= PLAIN_UP_TO
  const popularIds = usePopularServices(!plain)
  const chosenIds = props.multiple ? props.values : props.value === '' ? [] : [props.value]
  // В мульти-режиме уже выбранные в списке не повторяем
  const offered = props.multiple ? services.filter((s) => !chosenIds.includes(s.id)) : services
  const frequent = plain ? [] : (popularIds.length
    ? popularIds.map((id) => offered.find((s) => s.id === id)).filter((s): s is Service => s != null)
    : offered).slice(0, FREQUENT)
  const option = (s: Service, key = '') => <option key={key + s.id} value={s.id}>{rowText(s, prices, note?.(s))}</option>
  const options = plain ? offered.map((s) => option(s)) : [
    frequent.length > 0 && <optgroup key="frequent" label="Частые">{frequent.map((s) => option(s, 'f'))}</optgroup>,
    // Разделы прайса; раздел один (прайс без разделов) — подпись «Все услуги»
    ...groupServices(offered).map(({ group, items }, _i, all) => (
      <optgroup key={group} label={all.length > 1 ? groupLabel(group) : 'Все услуги'}>{items.map((s) => option(s))}</optgroup>
    )),
  ]
  const byId = (id: number) => services.find((s) => s.id === id)

  if (props.multiple) {
    const chosen = chosenIds.map(byId).filter((s): s is Service => s != null)
    return (
      <div className="service-picker multiple">
        {chosen.length > 0 && (
          <ul className="service-picked" aria-label="Выбранные услуги">
            {chosen.map((s) => (
              <li key={s.id} className="chip">
                <ValueLabel s={s} />
                <button type="button" className="chip-x" aria-label={`Убрать: ${s.name}`}
                  onClick={() => props.onChange(chosenIds.filter((id) => id !== s.id))}>✕</button>
              </li>
            ))}
          </ul>
        )}
        {offered.length > 0 && (
          <Select aria-label={props['aria-label'] ?? 'Добавить услугу'} value="" searchFrom={SEARCH_FROM}
            onChange={(e) => e.target.value && props.onChange([...chosenIds, Number(e.target.value)])}>
            <option value="">{chosen.length ? '＋ Ещё услуга…' : (props.placeholder ?? 'Выберите услугу…')}</option>
            {options}
          </Select>
        )}
      </div>
    )
  }

  const current = props.value === '' ? undefined : byId(props.value)
  return (
    <Select aria-label={props['aria-label']} value={props.value} searchFrom={SEARCH_FROM} className="service-picker"
      valueLabel={current ? <ValueLabel s={current} /> : undefined}
      onChange={(e) => props.onChange(e.target.value === '' ? '' : Number(e.target.value), e.target.value === '' ? undefined : byId(Number(e.target.value)))}>
      {/* Пусто — подсказка (не пункт списка); выбрано и можно снять — «Без услуги» */}
      <option value="">{props.value === '' || !props.clearable ? (props.placeholder ?? 'Выберите услугу…') : 'Без услуги'}</option>
      {options}
    </Select>
  )
}
