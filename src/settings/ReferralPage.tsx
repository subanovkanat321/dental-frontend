import '../schedule/attention.css'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ChoiceCards, type Choice } from '../layout/ChoiceCards'
import { Loading } from '../layout/Loading'
import { Select } from '../layout/Select'
import { REFERRAL_SETTINGS_KEY, useReferralSettings, type ReferralSettings } from '../refer/referral'
import { SubHeader } from './SubHeader'

type Request = Schemas['PatientReferralsSettings']
type Bonus = Schemas['PatientReferralsBonus']

/** Вариант бонуса одним касанием: скидка N % или услуга прайса бесплатно. */
type Preset = 'P5' | 'P10' | 'P15' | 'P20' | 'SERVICE'

const PERCENTS: Record<Exclude<Preset, 'SERVICE'>, number> = { P5: 5, P10: 10, P15: 15, P20: 20 }

function choices(whom: 'friend' | 'inviter'): Choice<Preset>[] {
  const on = whom === 'friend' ? 'на первый приём' : 'на следующий приём — за каждого пришедшего друга'
  return [
    ...(Object.entries(PERCENTS) as [Exclude<Preset, 'SERVICE'>, number][]).map(([value, p]) => ({ value, icon: '🎁', title: `Скидка ${p} %`, text: on })),
    { value: 'SERVICE', icon: '🪥', title: 'Услуга бесплатно', text: 'Консультация или профчистка из прайса — в оплате скидка на её цену' },
  ]
}

function presetOf(b: Bonus): Preset {
  if (b.kind === 'SERVICE') return 'SERVICE'
  const found = (Object.entries(PERCENTS) as [Preset, number][]).find(([, p]) => p === b.percent)
  return found ? found[0] : 'P10'
}

function requestOf(s: ReferralSettings): Request {
  return {
    enabled: s.enabled, validDays: s.validDays,
    friendKind: s.friend.kind, friendPercent: s.friend.percent, friendServiceId: s.friend.serviceId,
    inviterKind: s.inviter.kind, inviterPercent: s.inviter.percent, inviterServiceId: s.inviter.serviceId,
  }
}

/** Бонус другу или пригласившему — поля запроса. */
function patchOf(whom: 'friend' | 'inviter', kind: Bonus['kind'], percent: number | undefined, serviceId: number | undefined): Partial<Request> {
  return whom === 'friend'
    ? { friendKind: kind, friendPercent: percent, friendServiceId: serviceId }
    : { inviterKind: kind, inviterPercent: percent, inviterServiceId: serviceId }
}

/** Профчистка или консультация в прайсе — подставим её сами, когда выбрали «Услуга бесплатно». */
const FREE_SERVICE = /чистк|гигиен|консульт|осмотр/i

const DAYS = [30, 60, 90, 180]

/**
 * «Настройки → Приведи друга» (2026-11-24, идея 3 «Рост клиник»): включить программу, бонус другу на первый приём и бонус
 * пригласившему за каждого пришедшего друга (скидка или услуга бесплатно), срок, образец сообщения пациенту (ru / ky).
 * Меняет руководитель — сервер отвечает 403 остальным. Изменения сохраняются сразу.
 */
export function ReferralPage({ onBack }: { onBack: () => void }) {
  const client = useQueryClient()
  const settings = useReferralSettings()
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), staleTime: 5 * 60_000 })
  const [lang, setLang] = useState<'RU' | 'KY'>('RU')
  const save = useMutation<ReferralSettings, ApiError, Request>({
    mutationFn: (body) => unwrap(api.PUT('/api/clinic/referral-settings', { body })),
    onSuccess: (now) => client.setQueryData(REFERRAL_SETTINGS_KEY, now),
  })
  if (settings.isPending) return <section className="schedule-main"><SubHeader title="Приведи друга" onBack={onBack} /><Loading /></section>
  if (settings.error) return <section className="schedule-main"><SubHeader title="Приведи друга" onBack={onBack} /><p className="error">{settings.error.message}</p></section>
  const s = settings.data
  const active = (services.data ?? []).filter((x) => x.active)
  const change = (patch: Partial<Request>) => save.mutate({ ...requestOf(s), ...patch })
  const pick = (whom: 'friend' | 'inviter', value: Preset) => {
    const current = whom === 'friend' ? s.friend : s.inviter
    const serviceId = current.serviceId ?? active.find((x) => FREE_SERVICE.test(x.name))?.id ?? active[0]?.id
    change(value === 'SERVICE' ? patchOf(whom, 'SERVICE', undefined, serviceId) : patchOf(whom, 'PERCENT', PERCENTS[value], undefined))
  }
  const bonusBlock = (whom: 'friend' | 'inviter', title: string, b: Bonus) => (
    <div className="referral-bonus">
      <h3 className="choice-cards-title">{title}</h3>
      <ChoiceCards label={title} value={presetOf(b)} choices={choices(whom)} disabled={save.isPending} onChange={(v) => pick(whom, v)} />
      {b.kind === 'SERVICE' && (
        <label>
          Какая услуга бесплатно
          <Select aria-label={`${title}: услуга`} value={b.serviceId ?? ''} disabled={save.isPending}
            onChange={(e) => e.target.value && change(patchOf(whom, 'SERVICE', undefined, Number(e.target.value)))}>
            <option value="">Выберите услугу</option>
            {active.map((x) => <option key={x.id} value={x.id}>{x.name}{x.priceSom != null ? ` · ${x.priceSom} сом` : ''}</option>)}
          </Select>
        </label>
      )}
    </div>
  )
  const error = save.error ? Object.values(save.error.fieldErrors)[0] ?? save.error.message : null
  return (
    <section className="schedule-main">
      <SubHeader title="Приведи друга" onBack={onBack} />
      <section className="card-block form" aria-label="Приведи друга">
        <p className="hint">Сарафан — главный канал. У каждого пациента — своя ссылка для друзей: в боте кнопка «🎁 Приведи друга», в Mini App —
          карточка, у вас — «⋯ → Ссылка «Приведи друга»» в карточке пациента. Друг записался по ссылке — Tish сам отметит, кто его
          пригласил, и подскажет бонусы в оплате. В ссылке нет ни имени, ни телефона: друг не узнает, кто его пригласил.</p>
        <label className="check">
          <input type="checkbox" checked={s.enabled} disabled={save.isPending} onChange={(e) => change({ enabled: e.target.checked })} />
          <span><strong>Включить «Приведи друга»</strong><span className="hint"> — кнопка в боте, карточка в Mini App и бонусы в оплате</span></span>
        </label>
        {bonusBlock('friend', '🎁 Бонус другу', s.friend)}
        {bonusBlock('inviter', '🎁 Бонус пригласившему', s.inviter)}
        <label>
          Сколько дней действует бонус
          <Select aria-label="Срок бонуса" value={s.validDays} disabled={save.isPending} onChange={(e) => change({ validDays: Number(e.target.value) })}>
            {[...new Set([...DAYS, s.validDays])].sort((x, y) => x - y).map((d) => <option key={d} value={d}>{d} дней</option>)}
          </Select>
          <span className="hint small">Другу — со дня, когда он пришёл по ссылке; пригласившему — со дня, когда друг пришёл на приём.</span>
        </label>
        <p className="hint small">Бонус — подсказка в оплате («🎁 Пришёл по приглашению — Применить»): скидку можно убрать, правила
          «Настройки → Скидки» те же. Со скидкой по метке и подарком на день рождения не складывается — подставится бо́льшая.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="bd-preview">
          <div className="bd-lang hint small">
            <span>Так пациент увидит кнопку «🎁 Приведи друга» в боте (пример):</span>
            <span className="segments" role="group" aria-label="Язык образца">
              {(['RU', 'KY'] as const).map((l) => (
                <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l === 'RU' ? 'Русский' : 'Кыргызча'}</button>
              ))}
            </span>
          </div>
          <p className="bd-preview-text" aria-label="Образец сообщения">{lang === 'RU' ? s.previewRu : s.previewKy}</p>
        </div>
      </section>
    </section>
  )
}
