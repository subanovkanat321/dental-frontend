import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'

import { api, ApiError, fetchBlob, unwrap, upload, type Schemas } from '../api/client'
import { openLink, telegram } from '../lib/telegram'
import { PhoneInput } from './PhoneInput'
import { SetupChecklist } from './SetupChecklist'
import { phoneFromInput, phoneToInput } from './phone'

type Me = Schemas['BookingViewsMe']
type Clinic = Schemas['ClinicView']

const FIELDS = ['brandName', 'whatsappPhone', 'legalName', 'address', 'mapUrl', 'supportTelegram', 'supportPhone', 'workEnd', 'workDays'] as const

/**
 * «О клинике»: что видят пациенты (название, WhatsApp, адрес, 2ГИС, часы), как работают врачи
 * (независимо, свой склад), кто отвечает за данные (для согласия). Меняют админ и врачи;
 * «независимо» и «свой склад» — только админ. Админу ещё предоплата («с чистого листа» — в «Данных»).
 */
export function AboutTab({ me }: { me: Me }) {
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')) })
  if (clinic.isPending) return <p className="hint">Загрузка…</p>
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
    brandName: c.brandName ?? '', whatsappPhone: phoneToInput(c.whatsappPhone), legalName: c.legalName ?? '', address: c.address ?? '',
    mapUrl: c.mapUrl ?? '', supportTelegram: c.supportTelegram ? `@${c.supportTelegram}` : '', supportPhone: phoneToInput(c.supportPhone),
    workStart: (c.workStart ?? '09:00').slice(0, 5), workEnd: (c.workEnd ?? '18:00').slice(0, 5),
    independentDoctors: Boolean(c.independentDoctors), separateSupplies: Boolean(c.separateSupplies), listed: c.listed !== false,
  })
  const [done, setDone] = useState(false)
  const save = useMutation<Clinic, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/clinic', {
      body: {
        ...f, whatsappPhone: phoneFromInput(f.whatsappPhone), supportPhone: phoneFromInput(f.supportPhone),
        // Часы меняются в «Часах работы» — здесь берём текущие, чтобы не затереть их
        workStart: c.workStart, workEnd: c.workEnd, workDays: c.workDays,
      },
    })),
    onSuccess: (saved) => {
      setDone(true)
      client.setQueryData(['clinic'], saved)
      // Название, часы и режимы клиники приходят и в me (шапка, сетка «Расписания», склад)
      void client.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const err = (k: string) => save.error?.fieldErrors[k]
  const set = (k: keyof typeof f) => (v: string | boolean) => {
    setDone(false)
    setF({ ...f, [k]: v })
  }
  const text = (k: keyof typeof f) => (e: { target: { value: string } }) => set(k)(e.target.value)
  const flag = (k: keyof typeof f) => (e: { target: { checked: boolean } }) => set(k)(e.target.checked)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setDone(false)
    save.mutate()
  }
  const page = c.code ? `${window.location.origin}/c/${c.code}` : null

  return (
    <form className="card-block about" aria-label="О клинике" onSubmit={submit}>
      <fieldset className="about-grid" disabled={!canEdit}>
        {!canEdit && <p className="tone-wait">Только просмотр: «О клинике» меняют администратор и врачи.</p>}
        <div className="about-col">
          <WebVersion />
          <h2>Для пациентов</h2>
          <p className="hint">Адрес и ссылку на карту пациенты видят при записи и в напоминаниях бота.</p>
          <label className="field"><span>Название для пациентов</span>
            <input value={f.brandName} maxLength={100} placeholder="Стоматология «Улыбка»" onChange={text('brandName')} /></label>
          {err('brandName') && <p className="error">{err('brandName')}</p>}
          <label className="field"><span>WhatsApp клиники</span>
            <PhoneInput label="WhatsApp клиники" value={f.whatsappPhone} onChange={set('whatsappPhone')} /></label>
          {err('whatsappPhone') && <p className="error">{err('whatsappPhone')}</p>}
          <label className="field"><span>Адрес</span>
            <input value={f.address} maxLength={200} placeholder="Например: Бишкек, ул. Шевченко 6" onChange={text('address')} /></label>
          {err('address') && <p className="error">{err('address')}</p>}
          <label className="field"><span>Ссылка 2ГИС</span>
            <input type="url" value={f.mapUrl} maxLength={300} placeholder="https://2gis.kg/bishkek/…" onChange={text('mapUrl')} /></label>
          {err('mapUrl') && <p className="error">{err('mapUrl')}</p>}
          <p className="hint">В 2ГИС найдите кабинет → «Поделиться» → «Скопировать ссылку» и вставьте сюда.</p>
          {page && (
            <div className="field"><span>Страница для Instagram — запись, WhatsApp, врачи, услуги, адрес</span>
              <a className="invite-link" href={page} target="_blank" rel="noopener noreferrer">{page}</a>
            </div>
          )}
          <label className="check"><input type="checkbox" checked={f.listed} onChange={flag('listed')} /> Показывать клинику в общем каталоге /clinics</label>

          <p className="hint">Часы клиники и каждого врача — в «Настройки → Часы работы».</p>
        </div>

        <div className="about-col">
          <h2>Как работают врачи</h2>
          <label className="check"><input type="checkbox" checked={f.independentDoctors} disabled={!me.admin} onChange={flag('independentDoctors')} />
            Врачи работают независимо: медкарты, заметки и выручку врача видит только он сам</label>
          <p className="hint">Для частных врачей в одном кабинете. Расписание и пациенты остаются общими. Выключено — администратор видит всё.</p>
          <label className="check"><input type="checkbox" checked={f.separateSupplies} disabled={!me.admin} onChange={flag('separateSupplies')} />
            Свой склад у каждого врача</label>
          <p className="hint">Когда каждый врач закупает материалы сам: врач видит и тратит свои материалы и общие. Выключено — один склад на всех.</p>

          <h2>Для согласия пациентов</h2>
          <label className="field"><span>Клиника или ИП</span>
            <input value={f.legalName} maxLength={150} placeholder="ИП Садыкова А. или Стоматология «Улыбка»" onChange={text('legalName')} /></label>
          {err('legalName') && <p className="error">{err('legalName')}</p>}
          <p className="hint">Кто отвечает за данные пациентов: это название пациент видит в согласии и в «Политике обработки данных».</p>

          <h2>Техподдержка приложения</h2>
          <label className="field"><span>Telegram</span>
            <input value={f.supportTelegram} maxLength={40} placeholder="@ник" onChange={text('supportTelegram')} /></label>
          {err('supportTelegram') && <p className="error">{err('supportTelegram')}</p>}
          <label className="field"><span>Телефон</span>
            <PhoneInput label="Телефон техподдержки" value={f.supportPhone} onChange={set('supportPhone')} /></label>
          {err('supportPhone') && <p className="error">{err('supportPhone')}</p>}
        </div>
      </fieldset>
      {save.error && !FIELDS.some((k) => err(k)) && <p className="error" role="alert">{save.error.message}</p>}
      {done && <p className="tone-ok" role="status">Сохранено</p>}
      {canEdit && <button type="submit" className="btn primary" disabled={save.isPending}>Сохранить</button>}
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
  if (st.isPending) return <section className="card-block"><h2>Предоплата за запись</h2><p className="hint">Загрузка…</p></section>
  if (st.error) return <section className="card-block"><h2>Предоплата за запись</h2><p className="error">{st.error.message}</p></section>
  return <DepositForm st={st.data} onSaved={(d) => client.setQueryData(['deposit-settings'], d)} />
}

function DepositForm({ st, onSaved }: { st: Deposit; onSaved: (d: Deposit) => void }) {
  const [mode, setMode] = useState(st.mode ?? 'OFF')
  const [amount, setAmount] = useState(st.amountSom == null ? '' : String(st.amountSom))
  const [details, setDetails] = useState(st.details ?? '')
  const [done, setDone] = useState('')
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
  const error = save.error ?? qr.error

  return (
    <section className="card-block">
      <h2>Предоплата за запись</h2>
      <div className="form narrow">
        <p className="hint">Меньше неявок: кто записался через бота, переводит предоплату по QR и жмёт «Я оплатил(а)». Вы сверяете и отмечаете
          «Получена». После приёма она станет первым платежом, не пришёл — остаётся у клиники. Попросить вручную — в карточке записи.</p>
        <div className="segments" role="group" aria-label="Когда просить предоплату">
          {MODES.map(([code, name]) => <button key={code} type="button" aria-pressed={mode === code} onClick={() => { setDone(''); setMode(code) }}>{name}</button>)}
        </div>
        <label className="field"><span>Сколько, сом</span>
          <input type="number" min={1} inputMode="numeric" placeholder="Например: 1000" value={amount} onChange={(e) => { setDone(''); setAmount(e.target.value) }} /></label>
        <label className="field"><span>Как перевести (номер, банк, получатель)</span>
          <textarea rows={2} maxLength={500} placeholder="MBank: 0555 123 456 (Стоматология «Улыбка»)" value={details} onChange={(e) => { setDone(''); setDetails(e.target.value) }} /></label>
        <div className="qr-row">
          {qrUrl && <img className="pay-qr" src={qrUrl} alt="QR для предоплаты" />}
          <label className="btn">{st.hasQr ? 'Заменить QR' : 'Загрузить QR'}
            <input type="file" accept="image/jpeg,image/png" className="sr-only" aria-label="QR для предоплаты"
              onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) qr.mutate(file) }} /></label>
        </div>
        {error && <p className="error" role="alert">{error.fieldErrors.amountSom ?? error.fieldErrors.details ?? error.fieldErrors.file ?? error.message}</p>}
        {done && <p className="tone-ok" role="status">{done}</p>}
        {save.isSuccess && <p className="tone-ok" role="status">Предоплата сохранена</p>}
        <button type="button" className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}>Сохранить предоплату</button>
      </div>
    </section>
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
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      window.prompt('Скопируйте ссылку', url)
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
    </div>
  )
}
