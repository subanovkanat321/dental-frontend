import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, upload, webTariffs, type Schemas } from '../api/client'
import { usePlatformInfo } from '../api/platform'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput, phoneToInput } from '../clinic/phone'
import { somText } from '../lib/time'
import { useBlobUrl } from '../lib/useBlobUrl'
import { InviteLink } from '../team/InviteLink'

type Info = Schemas['PlatformInfoInfo']
type PaySettings = Schemas['PayRequestsSettings']

/**
 * «Настройки платформы» (владелец): сведения о платформе (их видят все сотрудники клиник),
 * входы в клиники, способы оплаты для клиник, менеджеры платформы, тарифы.
 */
export function SettingsTab() {
  const info = usePlatformInfo()
  return (
    <>
      {info.isPending ? <p className="hint">Загрузка…</p> : info.error ? <p className="error">{info.error.message}</p> : (
        <>
          <InfoForm info={info.data} />
          <AccessToggles info={info.data} />
        </>
      )}
      <PaySettingsBox />
      <Managers />
      <TariffsBox />
    </>
  )
}

const FIELDS: [keyof Info, string, string][] = [
  ['legalName', 'Кто отвечает за платформу (ИП или компания, ИНН)', 'ИП Иванов И. И., ИНН 2xxxxxxxxxxxxx'],
  ['hosting', 'Где сервер', 'Германия, DigitalOcean'],
  ['supportTelegram', 'Telegram поддержки', '@nick'],
  ['supportEmail', 'Почта поддержки', 'support@tish.kg'],
]

function InfoForm({ info }: { info: Info }) {
  const client = useQueryClient()
  const [f, setF] = useState({
    legalName: info.legalName ?? '', hosting: info.hosting ?? '', supportTelegram: info.supportTelegram ?? '',
    supportEmail: info.supportEmail ?? '', supportPhone: phoneToInput(info.supportPhone),
  })
  const save = useMutation<Info, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/info', { body: { ...f, supportPhone: phoneFromInput(f.supportPhone) } })),
    onSuccess: (saved) => client.setQueryData(['platform-info'], saved),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const err = (k: string) => save.error?.fieldErrors[k]
  return (
    <section className="card-block">
      <h2>Сведения о платформе</h2>
      <form className="form narrow" aria-label="Сведения о платформе" onSubmit={submit}>
        <p className="hint">Это видят все сотрудники клиник: в «Конфиденциальности» и «Техподдержке». Пустое поле — «уточняется».</p>
        {FIELDS.map(([key, label, placeholder]) => (
          <div key={key} className="field">
            <label className="field"><span>{label}</span>
              <input value={f[key as keyof typeof f]} maxLength={200} placeholder={placeholder} type={key === 'supportEmail' ? 'email' : 'text'}
                onChange={(e) => { save.reset(); setF({ ...f, [key]: e.target.value }) }} /></label>
            {err(key) && <p className="error">{err(key)}</p>}
          </div>
        ))}
        <label className="field"><span>Телефон поддержки</span>
          <PhoneInput label="Телефон поддержки" value={f.supportPhone} onChange={(v) => { save.reset(); setF({ ...f, supportPhone: v }) }} /></label>
        {err('supportPhone') && <p className="error">{err('supportPhone')}</p>}
        {save.error && !Object.keys(save.error.fieldErrors).length && <p className="error" role="alert">{save.error.message}</p>}
        {save.isSuccess && <p className="tone-ok" role="status">Сохранено</p>}
        <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить</button>
      </form>
    </section>
  )
}

/** Входы владельца в клиники: журнал, сообщение админам, только по разрешению клиники. Сохраняются сразу. */
function AccessToggles({ info }: { info: Info }) {
  const client = useQueryClient()
  const set = useMutation<Info, ApiError, { log: boolean; alert: boolean; grant: boolean }>({
    mutationFn: (body) => unwrap(api.PUT('/api/platform/info/access', { body })),
    onSuccess: (saved) => client.setQueryData(['platform-info'], saved),
  })
  const now = { log: Boolean(info.accessLog), alert: Boolean(info.accessNotify), grant: Boolean(info.accessRequiresGrant) }
  const box = (key: keyof typeof now, label: string) => (
    <label className="check"><input type="checkbox" checked={now[key]} disabled={set.isPending}
      onChange={(e) => set.mutate({ ...now, [key]: e.target.checked })} /> {label}</label>
  )
  return (
    <section className="card-block">
      <h2>Ваши входы в клиники</h2>
      <div className="form narrow">
        <p className="hint">По договору (п. 3.6) клиника знает о каждом вашем входе. На пилоте можно выключить — включите, когда подключаете другие клиники.</p>
        {box('log', 'Записывать мои входы в клиники — админ видит журнал в «Конфиденциальности»')}
        {box('alert', 'Сообщать админам клиники в бот о каждом моём входе')}
        {box('grant', 'Входить только по разрешению клиники — без него только аварийный вход (всегда в журнал и с сообщением). Клиника №1 — без разрешения')}
        {set.error && <p className="error" role="alert">{set.error.message}</p>}
      </div>
    </section>
  )
}

/** «Оплата для клиник»: как перевести, реквизиты для счёта PDF и QR — это видят админы в «Тариф и оплата». */
function PaySettingsBox() {
  const st = useQuery({ queryKey: ['platform-pay-settings'], queryFn: () => unwrap(api.GET('/api/platform/pay-settings')) })
  return (
    <section className="card-block">
      <h2>Оплата для клиник</h2>
      {st.isPending ? <p className="hint">Загрузка…</p> : st.error ? <p className="error">{st.error.message}</p> : <PayForm st={st.data} />}
    </section>
  )
}

function PayForm({ st }: { st: PaySettings }) {
  const client = useQueryClient()
  const onSaved = (s: PaySettings) => client.setQueryData(['platform-pay-settings'], s)
  const [details, setDetails] = useState(st.details ?? '')
  const [requisites, setRequisites] = useState(st.requisites ?? '')
  const qr = useBlobUrl(st.hasQr ? '/api/platform/pay-settings/qr' : null)
  const save = useMutation<PaySettings, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/pay-settings', { body: { details, requisites } })),
    onSuccess: onSaved,
  })
  const addQr = useMutation<PaySettings, ApiError, File>({
    mutationFn: (file) => {
      const body = new FormData()
      body.append('file', file)
      return upload('/api/platform/pay-settings/qr', body)
    },
    onSuccess: onSaved,
  })
  const dropQr = useMutation<PaySettings, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/platform/pay-settings/qr')),
    onSuccess: onSaved,
  })
  const error = save.error ?? addQr.error ?? dropQr.error
  return (
    <div className="form narrow">
      <p className="hint">Это видят админы клиник в «Тариф и оплата → Оплатить». После перевода они жмут «Я оплатил» — вам придёт сообщение
        в бот, подтвердите в «Клиниках».</p>
      <label className="field"><span>Как перевести (номер, банк, получатель)</span>
        <textarea rows={3} maxLength={1000} value={details} placeholder={'MBank: 0555 123 456 (Иван И.)\nЭлсом: 0700 123 456'} onChange={(e) => { save.reset(); setDetails(e.target.value) }} /></label>
      <label className="field"><span>Реквизиты для счёта PDF (ИНН, банк, счёт)</span>
        <textarea rows={4} maxLength={1000} value={requisites} placeholder={'ИНН 2xxxxxxxxxxxxx\nБанк: ОАО «…», БИК 1xxxxx\nр/с 1xxxxxxxxxxxxxxx'} onChange={(e) => { save.reset(); setRequisites(e.target.value) }} /></label>
      {save.isSuccess && <p className="tone-ok" role="status">Сохранено</p>}
      <button type="button" className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}>Сохранить способы оплаты</button>
      <h3>QR для оплаты</h3>
      {qr && qr !== 'error' ? <img className="pay-qr" src={qr.url} alt="QR для оплаты" />
        : !st.hasQr && <p className="hint">QR не загружен. Сохраните QR из приложения банка картинкой и загрузите сюда.</p>}
      <div className="actions">
        <label className="btn">{st.hasQr ? 'Заменить QR' : 'Загрузить QR'}
          <input type="file" className="sr-only" accept="image/jpeg,image/png" aria-label="QR для оплаты"
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) addQr.mutate(file) }} /></label>
        {st.hasQr && <button type="button" className="btn ghost" disabled={dropQr.isPending} onClick={() => window.confirm('Убрать QR?') && dropQr.mutate()}>Убрать QR</button>}
      </div>
      {error && <p className="error" role="alert">{error.fieldErrors.details ?? error.fieldErrors.requisites ?? error.fieldErrors.file ?? error.message}</p>}
    </div>
  )
}

/** Менеджеры платформы: видят клиники и цифры, заводят клиники и приглашают админов. Пациентов не видят. */
function Managers() {
  const client = useQueryClient()
  const list = useQuery({ queryKey: ['platform-managers'], queryFn: () => unwrap(api.GET('/api/platform/managers')) })
  const [name, setName] = useState('')
  const invite = useMutation<Schemas['DoctorInvitesInvite'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/managers/invite', { body: { fullName: name } })),
  })
  const remove = useMutation<unknown, ApiError, number>({
    mutationFn: (telegramId) => unwrap(api.DELETE('/api/platform/managers/{telegramId}', { params: { path: { telegramId } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['platform-managers'] }),
  })
  return (
    <section className="card-block">
      <h2>Менеджеры платформы</h2>
      <p className="hint">Менеджер видит клиники и их цифры, заводит клиники и приглашает их админов. Пациентов и медкарт не видит.</p>
      {list.data?.length ? (
        <table className="table" aria-label="Менеджеры">
          <tbody>{list.data.map((m) => (
            <tr key={m.telegramId}>
              <td className="strong">{m.fullName || `Telegram ${m.telegramId}`}</td>
              <td className="r"><button type="button" className="btn small ghost" disabled={remove.isPending}
                onClick={() => window.confirm(`Убрать менеджера «${m.fullName ?? m.telegramId}»?`) && remove.mutate(m.telegramId!)}>Убрать</button></td>
            </tr>
          ))}</tbody>
        </table>
      ) : <p className="hint">{list.isPending ? 'Загрузка…' : 'Пока никого.'}</p>}
      {remove.error && <p className="error">{remove.error.message}</p>}
      {invite.data?.token ? <InviteLink start={`mgr_${invite.data.token}`} name={name.trim()} toWhom="менеджеру" /> : (
        <form className="form narrow" aria-label="Пригласить менеджера" onSubmit={(e) => { e.preventDefault(); invite.mutate() }}>
          <label className="field"><span>Имя менеджера</span><input value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
          {invite.error && <p className="error" role="alert">{invite.error.fieldErrors.fullName ?? invite.error.message}</p>}
          <button type="submit" className="btn" disabled={invite.isPending}>Создать ссылку</button>
        </form>
      )}
    </section>
  )
}

/** Тарифы — как их видят клиники («Тариф и оплата» и страница /join). Меняются в коде (Tariffs.java). */
function TariffsBox() {
  const t = useQuery({ queryKey: ['web-tariffs'], queryFn: webTariffs, staleTime: 30 * 60_000 })
  if (!t.data) return null
  return (
    <section className="card-block">
      <h2>Тарифы</h2>
      {t.data.promo && <p className="tone-ok">{t.data.promo.title}</p>}
      <div className="tariffs">
        {(t.data.tariffs ?? []).map((x) => (
          <div key={x.code} className="tariff">
            <strong>{x.name}</strong>
            <span className="hint">{x.who}</span>
            <span className="tariff-price num">{somText(x.monthSom ?? 0)}<span className="hint"> / месяц</span></span>
            <span className="hint">за год — {somText(x.yearSom ?? 0)}</span>
          </div>
        ))}
      </div>
      <p className="hint">Новым клиникам — {t.data.pilotMonths} месяца бесплатно. Их видят админы клиник и страница /join.</p>
    </section>
  )
}
