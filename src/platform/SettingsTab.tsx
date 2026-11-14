import { HelpHint } from '../help/HelpHint'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { subHref } from '../lib/sub'
import { inTelegram } from '../lib/telegram'
import { CaseBlock } from '../site/CaseBlock'
import { caseMissing } from './joinCase'
import { usePlatformInfo } from '../api/platform'
import { PhoneInput } from '../clinic/PhoneInput'
import { phoneFromInput, phonesFromInput, phonesToInput, phoneToInput } from '../clinic/phone'
import { PhoneListInput } from '../clinic/PhoneListInput'
import { SaveBar } from '../layout/SaveBar'
import { useDirty } from '../lib/unsaved'
import { useBlobUrl } from '../lib/useBlobUrl'
import { InviteLink } from '../team/InviteLink'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'

type Info = Schemas['PlatformInfoInfo']
type PaySettings = Schemas['PayRequestsSettings']

/**
 * «Настройки платформы» (владелец): сведения о платформе (их видят все сотрудники клиник),
 * входы в клиники, способы оплаты для клиник, менеджеры платформы; цены тарифов — ссылкой на вкладку «Тарифы».
 */
export function SettingsTab() {
  const info = usePlatformInfo()
  return (
    <>
      {info.isPending ? <Loading /> : info.error ? <p className="error">{info.error.message}</p> : (
        <>
          <InfoForm info={info.data} />
          <AccessToggles info={info.data} />
        </>
      )}
      <CaseBox />
      <PaySettingsBox />
      <Managers />
      <TariffsLink />
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
    supportEmail: info.supportEmail ?? '', supportPhones: phonesToInput(info.supportPhones), supportWhatsapp: phoneToInput(info.supportWhatsapp),
    doctorsGroupUrl: info.doctorsGroupUrl ?? '',
  })
  const { dirty, commit } = useDirty(f)
  const save = useMutation<Info, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/info', {
      body: { ...f, supportPhones: phonesFromInput(f.supportPhones), supportWhatsapp: phoneFromInput(f.supportWhatsapp) },
    })),
    onSuccess: (saved) => {
      commit()
      client.setQueryData(['platform-info'], saved)
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const err = (k: string) => save.error?.fieldErrors[k]
  return (
    <section className="card-block">
      <h2>Сведения о платформе<HelpHint title="Сведения о платформе">Это видят все сотрудники клиник в «Помощи»: «Конфиденциальность» и «Написать в Tish». Пустое поле — «уточняется».</HelpHint></h2>
      <form className="form narrow" aria-label="Сведения о платформе" onSubmit={submit}>
        {FIELDS.map(([key, label, placeholder]) => (
          <div key={key} className="field">
            <label className="field"><span>{label}</span>
              <input value={f[key as 'legalName' | 'hosting' | 'supportTelegram' | 'supportEmail']} maxLength={200} placeholder={placeholder} type={key === 'supportEmail' ? 'email' : 'text'}
                onChange={(e) => { save.reset(); setF({ ...f, [key]: e.target.value }) }} /></label>
            {err(key) && <p className="error">{err(key)}</p>}
          </div>
        ))}
        <div className="field"><span>Телефоны поддержки — первый главный</span>
          <PhoneListInput label="Телефон поддержки" values={f.supportPhones} onChange={(v) => { save.reset(); setF({ ...f, supportPhones: v }) }} /></div>
        {err('supportPhones') && <p className="error">{err('supportPhones')}</p>}
        <label className="field"><span>WhatsApp поддержки — пусто: кнопки WhatsApp на /go и /join нет</span>
          <PhoneInput label="WhatsApp поддержки" value={f.supportWhatsapp} onChange={(v) => { save.reset(); setF({ ...f, supportWhatsapp: v }) }} /></label>
        {err('supportWhatsapp') && <p className="error">{err('supportWhatsapp')}</p>}
        {/* Общая группа врачей Tish (V194): бот и «Помощь» показывают её только сотрудникам */}
        <label className="field"><span>Группа врачей в Telegram — пусто: кнопок группы в боте и «Помощи» нет</span>
          <input type="url" value={f.doctorsGroupUrl} maxLength={200} placeholder="https://t.me/+…"
            onChange={(e) => { save.reset(); setF({ ...f, doctorsGroupUrl: e.target.value }) }} /></label>
        {err('doctorsGroupUrl') && <p className="error">{err('doctorsGroupUrl')}</p>}
        <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} savedText="Сведения о платформе сохранены"
          error={save.error && (Object.values(save.error.fieldErrors)[0] ?? save.error.message)} />
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
      <h2>Ваши входы в клиники<HelpHint title="Ваши входы в клиники">По договору (п. 3.6) клиника знает о каждом вашем входе. На пилоте можно выключить — включите, когда подключаете другие клиники.</HelpHint></h2>
      <div className="form narrow">
        {box('log', 'Записывать мои входы в клиники — руководитель видит журнал в «Помощь → Конфиденциальность»')}
        {box('alert', 'Сообщать руководителям клиники в бот о каждом моём входе')}
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
      <h2>Оплата для клиник<HelpHint title="Оплата для клиник">Это видят руководители клиник в «Тариф и оплата → Оплатить». После перевода они жмут «Я оплатил» — вам придёт сообщение
        в бот, подтвердите в «Клиниках».</HelpHint></h2>
      {st.isPending ? <Loading /> : st.error ? <p className="error">{st.error.message}</p> : <PayForm st={st.data} />}
    </section>
  )
}

function PayForm({ st }: { st: PaySettings }) {
  const client = useQueryClient()
  const onSaved = (s: PaySettings) => client.setQueryData(['platform-pay-settings'], s)
  const [details, setDetails] = useState(st.details ?? '')
  const [requisites, setRequisites] = useState(st.requisites ?? '')
  const { dirty, commit } = useDirty({ details, requisites })
  const qr = useBlobUrl(st.hasQr ? '/api/platform/pay-settings/qr' : null)
  const save = useMutation<PaySettings, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/pay-settings', { body: { details, requisites } })),
    onSuccess: (s) => {
      commit()
      onSaved(s)
    },
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
  const error = addQr.error ?? dropQr.error
  return (
    <div className="form narrow">
      <label className="field"><span>Как перевести (номер, банк, получатель)</span>
        <textarea rows={3} maxLength={1000} value={details} placeholder={'MBank: 0555 123 456 (Иван И.)\nЭлсом: 0700 123 456'} onChange={(e) => { save.reset(); setDetails(e.target.value) }} /></label>
      <label className="field"><span>Реквизиты для счёта PDF (ИНН, банк, счёт)</span>
        <textarea rows={4} maxLength={1000} value={requisites} placeholder={'ИНН 2xxxxxxxxxxxxx\nБанк: ОАО «…», БИК 1xxxxx\nр/с 1xxxxxxxxxxxxxxx'} onChange={(e) => { save.reset(); setRequisites(e.target.value) }} /></label>
      <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label="Сохранить способы оплаты" savedText="Способы оплаты сохранены"
        error={save.error && (save.error.fieldErrors.details ?? save.error.fieldErrors.requisites ?? save.error.message)} onSave={() => save.mutate()} />
      <h3>QR для оплаты</h3>
      {qr && qr !== 'error' ? <img className="pay-qr" src={qr.url} alt="QR для оплаты" />
        : !st.hasQr && <p className="hint">QR не загружен. Сохраните QR из приложения банка картинкой и загрузите сюда.</p>}
      <div className="actions">
        <label className="btn">{st.hasQr ? 'Заменить QR' : 'Загрузить QR'}
          <input type="file" className="sr-only" accept="image/jpeg,image/png" aria-label="QR для оплаты"
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) addQr.mutate(file) }} /></label>
        {st.hasQr && <button type="button" className="btn ghost" disabled={dropQr.isPending} onClick={() => void ask('Убрать QR?').then((ok) => ok && dropQr.mutate())}>Убрать QR</button>}
      </div>
      {error && <p className="error" role="alert">{error.fieldErrors.file ?? error.message}</p>}
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
      <h2>Менеджеры платформы<HelpHint title="Менеджеры платформы">Менеджер видит клиники и их цифры, заводит клиники и приглашает их руководителей. Пациентов и медкарт не видит.</HelpHint></h2>
      {list.error && <p className="error" role="alert">Менеджеры не загрузились: {list.error.message}</p>}
      {/* Имя и «Убрать» — одной строкой (таблица на телефоне клала кнопку отдельной строкой под имя) */}
      {list.data?.length ? (
        <ul className="materials-list" aria-label="Менеджеры">
          {list.data.map((m) => (
            <li key={m.telegramId}>
              <span className="strong">{m.fullName || `Telegram ${m.telegramId}`}</span>
              <button type="button" className="btn small" data-tone="bad" disabled={remove.isPending}
                onClick={() => void ask(`Убрать менеджера «${m.fullName ?? m.telegramId}»?`).then((ok) => ok && remove.mutate(m.telegramId))}>Убрать</button>
            </li>
          ))}
        </ul>
      ) : list.isPending ? <Loading /> : !list.error && <EmptyState compact title="Менеджеров пока нет" />}
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

/** Тарифы меняются и видны во вкладке «Тарифы» — здесь только ссылка туда (блок с ценами дублировал её). */
function TariffsLink() {
  return (
    <p className="settings-more">
      <a className="row-link open-link" href={subHref('platform', 'tariffs')}>Цены тарифов — во вкладке «Тарифы» ›</a>
    </p>
  )
}

type JoinCase = Schemas['JoinCaseCase']
type Metric = { value: string; label: string }

/**
 * Кейс на /join — блок «Как работает в клинике» на странице для клиник: заголовок, история, чья она (по желанию)
 * и до трёх цифр. Всё пишет владелец руками — цифры берёт из «Статистики» клиники за пилот, сервер их не считает.
 * На сайте блок виден, только когда есть заголовок, история и отметка «клиника согласна на публикацию» (V211);
 * черновик читаем из /api/platform/case — сайт (/web/case) отдаёт только опубликованное.
 */
function CaseBox() {
  const current = useQuery<JoinCase, ApiError>({ queryKey: ['platform-case'], queryFn: () => unwrap(api.GET('/api/platform/case')) })
  const [more, setMore] = useState(false)
  return (
    <section className="card-block" aria-label="Кейс на странице для клиник">
      <h2>Кейс на /join</h2>
      <p className="hint">История одной клиники с цифрами — на странице tish.kg/join, где клиники оставляют заявку.{' '}
        <button type="button" className="hint-more" aria-label="Подробнее про кейс на /join" aria-expanded={more} onClick={() => setMore(!more)}>?</button></p>
      {more && (
        <div className="hint" role="note" aria-label="Как работает кейс">
          <p><b>Кто видит:</b> все, кто открыл tish.kg/join, — чаще руководители клиник, которым вы отправили ссылку. Блок «Как работает в клинике» стоит после «Что умеет».</p>
          <p><b>Что писать:</b> что было в клинике до Tish и что стало — коротко, своими словами. Цифры — только настоящие: из «Статистики»
            клиники за месяц пилота (записей через бота, неявок до и после, сколько вернулось по «Позвать снова»). Tish их сам не считает.</p>
          <p><b>Согласие:</b> показываем только с разрешения клиники — спросите её (лучше письменно, в WhatsApp) и поставьте отметку.
            Без отметки кейс остаётся черновиком и на сайте не виден. Название клиники — по желанию: можно «Клиника в Бишкеке».</p>
        </div>
      )}
      {current.isPending ? <Loading /> : current.error ? <p className="error">{current.error.message}</p> : <CaseForm initial={current.data} />}
    </section>
  )
}

function CaseForm({ initial }: { initial: JoinCase }) {
  const client = useQueryClient()
  const start: Metric[] = [0, 1, 2].map((i) => ({ value: initial.metrics?.[i]?.value ?? '', label: initial.metrics?.[i]?.label ?? '' }))
  const [title, setTitle] = useState(initial.title ?? '')
  const [text, setText] = useState(initial.text ?? '')
  const [clinic, setClinic] = useState(initial.clinic ?? '')
  const [consent, setConsent] = useState(initial.consent)
  const [metrics, setMetrics] = useState<Metric[]>(start)
  const [done, setDone] = useState('')
  const save = useMutation<JoinCase, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/case', { body: { title, text, clinic, consent, metrics: metrics.filter((m) => m.value || m.label) } })),
    onSuccess: (saved) => {
      client.setQueryData(['platform-case'], saved)
      setDone(saved.shown ? 'Сохранено — блок виден на /join' : 'Сохранено как черновик — на /join блока нет')
    },
  })
  const setMetric = (i: number, key: keyof Metric, value: string) => setMetrics((all) => all.map((m, k) => (k === i ? { ...m, [key]: value } : m)))
  const missing = caseMissing({ title, text, consent })
  return (
    <form className="form narrow" aria-label="Кейс" onSubmit={(e) => { e.preventDefault(); setDone(''); save.mutate() }}>
      {missing.length > 0
        ? <p className="notice tone-wait" aria-label="Состояние кейса">Кейс не показывается на /join, пока нет: {missing.join(', ')}.</p>
        : <p className="notice tone-ok" aria-label="Состояние кейса">После сохранения кейс виден на /join.</p>}
      <label className="field"><span>Заголовок блока</span>
        <input value={title} maxLength={120} placeholder="Пилот в клинике в Бишкеке" onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="field"><span>История: что было до Tish и что стало</span>
        <textarea value={text} maxLength={1000} rows={4} placeholder="Раньше записывали в тетрадь и звонили каждому накануне. Теперь пациенты записываются в боте, напоминания уходят сами." onChange={(e) => setText(e.target.value)} /></label>
      <label className="field"><span>Клиника — как подписать (по желанию)</span>
        <input value={clinic} maxLength={120} placeholder="Стоматология «Улыбка», Бишкек — или пусто" onChange={(e) => setClinic(e.target.value)} /></label>
      {metrics.map((m, i) => (
        <div key={i} className="row-fields" role="group" aria-label={`Цифра ${i + 1}`}>
          <label className="field"><span>Цифра {i + 1}</span><input value={m.value} maxLength={20} placeholder="−30%" onChange={(e) => setMetric(i, 'value', e.target.value)} /></label>
          <label className="field"><span>Что она значит</span><input value={m.label} maxLength={60} placeholder="неявок за месяц" onChange={(e) => setMetric(i, 'label', e.target.value)} /></label>
        </div>
      ))}
      <p className="hint">Цифры — из «Статистики» клиники за пилот; необязательны. Пустые не показываются.</p>
      <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        {' '}Клиника согласна на публикацию: история, цифры и название (если указано)</label>
      <h3 className="small">Как это видно на /join</h3>
      {title.trim() || text.trim()
        ? <CaseBlock story={{ title, text, clinic: clinic.trim() || undefined, metrics }} className="join-case-preview" heading="h3" />
        : <p className="hint">Напишите заголовок и историю — здесь появится блок, как его увидит клиника.</p>}
      <p className="hint"><a href="/join" target="_blank" rel="noopener noreferrer" onClick={inTelegram(new URL('/join', window.location.origin).href)}>Открыть tish.kg/join ↗</a>
        {' '}— кейс там появится после сохранения, когда всё заполнено и есть согласие.</p>
      {save.error && <p className="error" role="alert">{save.error.fieldErrors.metrics ?? save.error.fieldErrors.title ?? save.error.fieldErrors.text ?? save.error.fieldErrors.clinic ?? save.error.message}</p>}
      {done && <p className="tone-ok" role="status">{done}</p>}
      <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить кейс</button>
    </form>
  )
}
