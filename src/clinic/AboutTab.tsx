import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'

import { api, ApiError, fetchBlob, unwrap, upload, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { Select } from '../layout/Select'
import { CITIES, guessCity } from '../lib/clinicSearch'
import { openLink, telegram } from '../lib/telegram'
import { useDirty } from '../lib/unsaved'
import { PhoneInput } from './PhoneInput'
import { PhoneListInput } from './PhoneListInput'
import { SetupChecklist } from './SetupChecklist'
import { phoneFromInput, phonesFromInput, phonesToInput, phoneToInput } from './phone'
import { Loading } from '../layout/Loading'

type Me = Schemas['BookingViewsMe']
type Clinic = Schemas['ClinicView']

const FIELDS = ['brandName', 'phones', 'whatsappPhone', 'legalName', 'address', 'city', 'mapUrl', 'supportTelegram', 'supportPhone', 'workEnd', 'workDays'] as const

/**
 * «О клинике»: что видят пациенты (название, телефоны, WhatsApp, адрес, 2ГИС, часы), как работают врачи
 * (независимо, свой склад), кто отвечает за данные (для согласия). Меняют админ и врачи;
 * «независимо» и «свой склад» — только админ. Админу ещё предоплата («с чистого листа» — в «Данных»).
 */
export function AboutTab({ me }: { me: Me }) {
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')) })
  if (clinic.isPending) return <Loading />
  if (clinic.error) return <p className="error">{clinic.error.message}</p>
  return (
    <>
      <SetupChecklist me={me} />
      <AboutForm me={me} clinic={clinic.data} />
      {me.admin && <DepositSettings />}
    </>
  )
}

function AboutForm({ me, clinic: c }: { me: Me; clinic: Clinic }) {
  const client = useQueryClient()
  const canEdit = Boolean(me.admin || me.doctorId != null)
  const [f, setF] = useState({
    brandName: c.brandName ?? '', phones: phonesToInput(c.phones), whatsappPhone: phoneToInput(c.whatsappPhone), legalName: c.legalName ?? '', address: c.address ?? '', city: c.city ?? '',
    mapUrl: c.mapUrl ?? '', supportTelegram: c.supportTelegram ? `@${c.supportTelegram}` : '', supportPhone: phoneToInput(c.supportPhone),
    workStart: (c.workStart ?? '09:00').slice(0, 5), workEnd: (c.workEnd ?? '18:00').slice(0, 5),
    independentDoctors: Boolean(c.independentDoctors), separateSupplies: Boolean(c.separateSupplies), listed: c.listed !== false,
  })
  const { dirty, commit } = useDirty(f)
  // Город подставлен из адреса (а не выбран руками) — следим за адресом дальше: «Ош» → «Ошская» уже не Ош
  const [cityGuessed, setCityGuessed] = useState(false)
  const changeAddress = (address: string) => {
    save.reset()
    const guess = !f.city || cityGuessed
    setF({ ...f, address, city: guess ? guessCity(address) ?? '' : f.city })
    setCityGuessed(guess)
  }
  const save = useMutation<Clinic, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/clinic', {
      body: {
        ...f, phones: phonesFromInput(f.phones), whatsappPhone: phoneFromInput(f.whatsappPhone), supportPhone: phoneFromInput(f.supportPhone),
        // Часы меняются в «Часах работы» — здесь берём текущие, чтобы не затереть их
        workStart: c.workStart, workEnd: c.workEnd, workDays: c.workDays,
      },
    })),
    onSuccess: (saved) => {
      commit()
      client.setQueryData(['clinic'], saved)
      // Название, часы и режимы клиники приходят и в me (шапка, сетка «Расписания», склад)
      void client.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const err = (k: string) => save.error?.fieldErrors[k]
  const set = (k: keyof typeof f) => (v: string | boolean | string[]) => {
    save.reset()
    setF({ ...f, [k]: v })
  }
  const text = (k: keyof typeof f) => (e: { target: { value: string } }) => set(k)(e.target.value)
  const flag = (k: keyof typeof f) => (e: { target: { checked: boolean } }) => set(k)(e.target.checked)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const page = c.code ? `${window.location.origin}/c/${c.code}` : null

  return (
    <form className="card-block about" aria-label="О клинике" onSubmit={submit}>
      <fieldset className="about-grid" disabled={!canEdit}>
        {!canEdit && <p className="tone-wait">Только просмотр: «О клинике» меняют руководитель и врачи.</p>}
        <div className="about-col">
          <WebVersion />
          <h2>Для пациентов</h2>
          <p className="hint">Адрес и ссылку на карту пациенты видят при записи и в напоминаниях бота.</p>
          <label className="field"><span>Название для пациентов</span>
            <input value={f.brandName} maxLength={100} placeholder="Стоматология «Улыбка»" onChange={text('brandName')} /></label>
          {err('brandName') && <p className="error">{err('brandName')}</p>}
          <div className="field"><span>Телефоны клиники — первый главный</span>
            <PhoneListInput label="Телефон клиники" values={f.phones} onChange={set('phones')} /></div>
          {err('phones') && <p className="error">{err('phones')}</p>}
          <label className="field"><span>WhatsApp клиники — если на другом номере, укажите его</span>
            <PhoneInput label="WhatsApp клиники" value={f.whatsappPhone} onChange={set('whatsappPhone')} /></label>
          {err('whatsappPhone') && <p className="error">{err('whatsappPhone')}</p>}
          <p className="hint">Пациенты видят кнопку «Позвонить» на каждый номер; без WhatsApp кнопки «Написать в WhatsApp» нет.</p>
          <label className="field"><span>Адрес</span>
            {/* Город не выбран, а в адресе он есть — подставляем сами: одним действием меньше */}
            <input value={f.address} maxLength={200} placeholder="Например: Бишкек, ул. Шевченко 6" onChange={(e) => changeAddress(e.target.value)} /></label>
          {err('address') && <p className="error">{err('address')}</p>}
          <label className="field"><span>Город</span>
            <Select value={f.city} onChange={(e) => { setCityGuessed(false); set('city')(e.target.value) }}>
              <option value="">Не указан</option>
              {CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
            </Select></label>
          {err('city') && <p className="error">{err('city')}</p>}
          <p className="hint">По городу пациенты находят клинику в каталоге /clinics и в боте, когда клиник станет много.</p>
          <label className="field"><span>Ссылка 2ГИС</span>
            <input type="url" value={f.mapUrl} maxLength={300} placeholder="https://2gis.kg/bishkek/…" onChange={text('mapUrl')} /></label>
          {err('mapUrl') && <p className="error">{err('mapUrl')}</p>}
          <p className="hint">В 2ГИС найдите кабинет → «Поделиться» → «Скопировать ссылку» и вставьте сюда.</p>
          {page && <BookingPage url={page} />}
          <label className="check"><input type="checkbox" checked={f.listed} onChange={flag('listed')} /> Показывать клинику в общем каталоге /clinics</label>

          <p className="hint">Часы клиники и каждого врача — в «Клиника → Рабочее время».</p>
        </div>

        <div className="about-col">
          <h2>Как работают врачи</h2>
          <label className="check"><input type="checkbox" checked={f.independentDoctors} disabled={!me.admin} onChange={flag('independentDoctors')} />
            Врачи работают независимо: медкарты, заметки и выручку врача видит только он сам</label>
          <p className="hint">Для частных врачей в одном кабинете. Расписание и пациенты остаются общими. Владелец кабинета
            (руководитель без своего приёма) видит всё при любой настройке. Выключено — все руководители видят всё.</p>
          <label className="check"><input type="checkbox" checked={f.separateSupplies} disabled={!me.admin} onChange={flag('separateSupplies')} />
            Свой склад у каждого врача</label>
          <p className="hint">Когда каждый врач закупает материалы сам: врач видит и тратит свои материалы и общие. Выключено — один склад на всех.</p>

          <h2>Для согласия пациентов</h2>
          <label className="field"><span>Клиника или ИП</span>
            <input value={f.legalName} maxLength={150} placeholder="ИП Садыкова А. или Стоматология «Улыбка»" onChange={text('legalName')} /></label>
          {err('legalName') && <p className="error">{err('legalName')}</p>}
          <p className="hint">Кто отвечает за данные пациентов: это название пациент видит в согласии и в «Политике обработки данных».</p>
          {/* «Техподдержка приложения» убрана: у клиники своей нет — в /help бота контакты Tish.
              Старые значения уходят при сохранении как были (сервер их не стирает молча). */}
        </div>
      </fieldset>
      {/* Ошибка поля — и под полем, и в полосе: поле может быть выше, за краем экрана */}
      {canEdit && <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} savedText="«О клинике» сохранено — пациенты видят новое"
        error={save.error && (FIELDS.map((k) => err(k)).find(Boolean) ?? save.error.message)} />}
    </form>
  )
}

type Deposit = Schemas['DepositsSettings']
const MODES: [NonNullable<Deposit['mode']>, string][] = [['OFF', 'Не просить'], ['NEW', 'Новых пациентов'], ['ALL', 'Всех через бота']]

/**
 * Предоплата за запись: кто записался через бота, переводит её по QR и жмёт «Я оплатил(а)»;
 * клиника сверяет и отмечает «Получена». После приёма — первый платёж, не пришёл — остаётся у клиники.
 */
function DepositSettings() {
  const client = useQueryClient()
  const st = useQuery({ queryKey: ['deposit-settings'], queryFn: () => unwrap(api.GET('/api/clinic/deposit')) })
  if (st.isPending) return <section className="card-block"><h2>Предоплата за запись</h2><Loading /></section>
  if (st.error) return <section className="card-block"><h2>Предоплата за запись</h2><p className="error">{st.error.message}</p></section>
  return <DepositForm st={st.data} onSaved={(d) => client.setQueryData(['deposit-settings'], d)} />
}

function DepositForm({ st, onSaved }: { st: Deposit; onSaved: (d: Deposit) => void }) {
  const [mode, setMode] = useState(st.mode ?? 'OFF')
  const [amount, setAmount] = useState(st.amountSom == null ? '' : String(st.amountSom))
  const [details, setDetails] = useState(st.details ?? '')
  const [done, setDone] = useState('')
  const { dirty, commit } = useDirty({ mode, amount, details })
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!st.hasQr) return
    let url: string | null = null
    let alive = true
    fetchBlob('/api/clinic/deposit/qr').then((blob) => {
      url = URL.createObjectURL(blob)
      if (alive) setQrUrl(url)
    }).catch(() => {})
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [st.hasQr])
  const save = useMutation<Deposit, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/clinic/deposit', { body: { mode, amountSom: amount === '' ? undefined : Number(amount), details } })),
    onSuccess: (d) => {
      commit()
      onSaved(d)
    },
  })
  const qr = useMutation<Deposit, ApiError, File>({
    mutationFn: (file) => {
      const body = new FormData()
      body.append('file', file)
      return upload('/api/clinic/deposit/qr', body)
    },
    onSuccess: (d) => {
      setDone('QR загружен')
      onSaved(d)
    },
  })
  const errorText = (e: ApiError | null) => e && (e.fieldErrors.amountSom ?? e.fieldErrors.details ?? e.fieldErrors.file ?? e.message)

  return (
    <section className="card-block">
      <h2>Предоплата за запись</h2>
      <div className="form narrow">
        <p className="hint">Меньше неявок: кто записался через бота, переводит предоплату по QR и жмёт «Я оплатил(а)». Вы сверяете и отмечаете
          «Получена». После приёма она станет первым платежом, не пришёл — остаётся у клиники. Попросить вручную — в карточке записи.</p>
        <div className="segments" role="group" aria-label="Когда просить предоплату">
          {MODES.map(([code, name]) => <button key={code} type="button" aria-pressed={mode === code} onClick={() => { setDone(''); save.reset(); setMode(code) }}>{name}</button>)}
        </div>
        <label className="field"><span>Сколько, сом</span>
          <input type="number" min={1} inputMode="numeric" placeholder="Например: 1000" value={amount} onChange={(e) => { setDone(''); save.reset(); setAmount(e.target.value) }} /></label>
        <label className="field"><span>Как перевести (номер, банк, получатель)</span>
          <textarea rows={2} maxLength={500} placeholder="MBank: 0555 123 456 (Стоматология «Улыбка»)" value={details} onChange={(e) => { setDone(''); save.reset(); setDetails(e.target.value) }} /></label>
        <div className="qr-row">
          {qrUrl && <img className="pay-qr" src={qrUrl} alt="QR для предоплаты" />}
          <label className="btn">{st.hasQr ? 'Заменить QR' : 'Загрузить QR'}
            <input type="file" accept="image/jpeg,image/png" className="sr-only" aria-label="QR для предоплаты"
              onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) qr.mutate(file) }} /></label>
        </div>
        {qr.error && <p className="error" role="alert">{errorText(qr.error)}</p>}
        {done && <p className="tone-ok" role="status">{done}</p>}
        <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} error={errorText(save.error)}
          label="Сохранить предоплату" savedText="Предоплата сохранена" onSave={() => save.mutate()} />
      </div>
    </section>
  )
}

/**
 * «Страница для Instagram»: tish.kg/c/<код> — запись, «Позвонить», WhatsApp, врачи, услуги, адрес.
 * «Скопировать» и подсказка, куда её ставить; подробно — раздел руководства (#ssylka-na-zapis).
 */
function BookingPage({ url }: { url: string }) {
  const [copied, setCopied] = useState<boolean | null>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="field"><span>Страница для Instagram — запись, WhatsApp, врачи, услуги, адрес</span>
      <a className="invite-link" href={url} target="_blank" rel="noopener noreferrer">{url}</a>
      <div className="actions">
        <button type="button" className="btn" aria-label="Скопировать ссылку на страницу записи" onClick={() => void copy()}>Скопировать</button>
      </div>
      {copied === true && <p className="tone-ok" role="status">Ссылка на запись скопирована</p>}
      {copied === false && <p className="hint" role="status">Скопировать не получилось — нажмите на ссылку выше и удерживайте, затем «Копировать»</p>}
      <p className="hint">Поставьте в Instagram (Ссылки в профиле), 2ГИС (поле «Сайт»), Google Карты и рекламу. Отдельная ссылка под каждую рекламу — «Откуда приходят → Промокоды».{' '}
        <a href="/guide?from=app#ssylka-na-zapis" target="_blank" rel="noopener noreferrer">Как и куда поставить</a></p>
    </div>
  )
}

/**
 * «Работать с компьютера»: та же CRM в браузере — удобно в регистратуре. Вход через Telegram тем
 * же аккаунтом. Ссылку скопировать и открыть на компьютере (в Telegram — открыть браузером).
 */
function WebVersion() {
  const url = `${window.location.origin}/login`
  const app = telegram()
  const phone = /^(ios|android)/.test(app?.platform ?? '')
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // Буфер обмена закрыт (старый Telegram, нет разрешения) — без системного окна: подсказка у ссылки
      setCopyFailed(true)
    }
  }
  return (
    <div className="web-version">
      <h2>Работать с компьютера</h2>
      <p className="hint">То же приложение в браузере — удобно на компьютере в регистратуре. Вход — через Telegram, тем же аккаунтом, что и в боте.</p>
      <a className="invite-link" href={url} target="_blank" rel="noopener noreferrer">{url}</a>
      <div className="actions">
        <button type="button" className="btn" onClick={() => void copy()}>Скопировать ссылку</button>
        {/* На телефоне Telegram открыл бы ссылку своим встроенным браузером, где вход через Telegram
            не срабатывает, — там только ссылка и «Скопировать». На компьютере — обычный браузер */}
        {app && !phone && <button type="button" className="btn" onClick={() => openLink(url)}>Открыть в браузере</button>}
      </div>
      {copied && <p className="tone-ok" role="status">Ссылка скопирована — откройте её в браузере на компьютере</p>}
      {copyFailed && !copied && <p className="hint" role="status">Скопировать не получилось — нажмите на ссылку выше и удерживайте, затем «Копировать»</p>}
    </div>
  )
}
