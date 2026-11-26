import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, unwrap, upload, type Schemas } from '../api/client'
import { ChoiceCards } from '../layout/ChoiceCards'
import { SaveBar } from '../layout/SaveBar'
import { Select } from '../layout/Select'
import { CITIES, guessCity } from '../lib/clinicSearch'
import { openSettings } from '../lib/route'
import { openLink, telegram } from '../lib/telegram'
import { matches } from '../lib/useMedia'
import { useDirty } from '../lib/unsaved'
import { useBlobUrl } from '../lib/useBlobUrl'
import { canEditPrices } from '../lib/roles'
import { BookingLinks } from './BookingLinks'
import { PhoneInput } from './PhoneInput'
import { PhoneListInput } from './PhoneListInput'
import { SetupChecklist } from './SetupChecklist'
import { hoursText } from './setupSteps'
import { phoneText } from '../team/texts'
import './about.css'
import { phoneFromInput, phonesFromInput, phonesToInput, phoneToInput } from './phone'
import { Loading } from '../layout/Loading'

type Me = Schemas['BookingViewsMe']
type Clinic = Schemas['ClinicView']

const FIELDS = ['brandName', 'phones', 'whatsappPhone', 'legalName', 'address', 'city', 'mapUrl', 'googleReviewUrl', 'supportTelegram', 'supportPhone', 'workEnd', 'workDays'] as const

/**
 * «О клинике»: что видят пациенты (название, телефоны, WhatsApp, адрес, 2ГИС, часы), как работают врачи
 * (независимо, свой склад), кто отвечает за данные (для согласия). Меняет только руководитель (с 2026-11-13,
 * как цены и часы клиники); остальные смотрят. Админу ещё предоплата («с чистого листа» — в «Данных»).
 * Вид (2026-11-26, владелец: «настройки простые — поправь дизайн»): сверху «Так клиника видна пациентам» со счётчиком
 * «Заполнено N из 6», ниже поля карточками-группами; одна колонка, на широком экране подпись слева — поле справа.
 */
export function AboutTab({ me }: { me: Me }) {
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')) })
  if (clinic.isPending) return <Loading />
  if (clinic.error) return <p className="error">{clinic.error.message}</p>
  return (
    <>
      <SetupChecklist me={me} />
      <AboutForm me={me} clinic={clinic.data} />
      {clinic.data.code && <BookingLinks clinicCode={clinic.data.code} />}
      {me.admin && <DepositSettings />}
    </>
  )
}

/** Поле «О клинике» на странице: id для перехода из «Осталось заполнить». */
const fieldId = (k: string) => `about-${k}`

/** Перейти к полю: прокрутить к нему и поставить курсор (в «только просмотре» поле выключено — только прокрутка). */
function focusField(k: string) {
  const box = document.getElementById(fieldId(k))
  const target = box?.matches('input, textarea, button') ? box : box?.querySelector<HTMLElement>('input, textarea, button')
  ;(target ?? box)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  target?.focus({ preventScroll: true })
}

/**
 * Строка формы: на широком экране подпись слева, поле справа; подсказка и ошибка — под полем.
 * Подсказка — вне <label>: иначе она вошла бы в название поля для экранного диктора.
 */
function Row({ hint, error, children }: { hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="about-row">
      {children}
      {hint && <p className="hint">{hint}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

/** Карточка-группа полей: заголовок и одна строка, зачем это пациентам. */
function Group({ title, hint, children }: { title: string; hint: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section className="card-block about-card" aria-labelledby={id}>
      <header className="about-card-head">
        <h2 id={id}>{title}</h2>
        <p className="hint">{hint}</p>
      </header>
      {children}
    </section>
  )
}

/** Буква в кружке вместо логотипа: «Стоматология «Улыбка»» → «У» (по названию в кавычках, если оно есть). */
function initialOf(name: string): string {
  const quoted = /[«"„“]([^»"”]+)/.exec(name)?.[1]
  return ((quoted ?? name).trim()[0] ?? '?').toUpperCase()
}

const httpUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim()) ? s.trim() : null

function AboutForm({ me, clinic: c }: { me: Me; clinic: Clinic }) {
  const client = useQueryClient()
  const canEdit = canEditPrices(me)
  const [f, setF] = useState({
    brandName: c.brandName ?? '', phones: phonesToInput(c.phones), whatsappPhone: phoneToInput(c.whatsappPhone), legalName: c.legalName ?? '', address: c.address ?? '', city: c.city ?? '',
    mapUrl: c.mapUrl ?? '', googleReviewUrl: c.googleReviewUrl ?? '', supportTelegram: c.supportTelegram ? `@${c.supportTelegram}` : '', supportPhone: phoneToInput(c.supportPhone),
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
  // Что заполнено — по введённому сейчас, не по сохранённому. Обязательные — те же, что в жёлтой подсказке
  // «Заполните „О клинике“» (AdminNotices): название клиники или ИП (для согласия) и адрес
  const fill: Fill[] = [
    { key: 'brandName', title: 'Название', done: Boolean(f.brandName.trim()) },
    { key: 'legalName', title: 'Клиника или ИП', done: Boolean(f.legalName.trim()), required: true },
    { key: 'phones', title: 'Телефон', done: f.phones.some((p) => p.trim()) },
    { key: 'address', title: 'Адрес', done: Boolean(f.address.trim()), required: true },
    { key: 'city', title: 'Город', done: Boolean(f.city) },
    { key: 'mapUrl', title: 'Ссылка 2ГИС', done: Boolean(f.mapUrl.trim()) },
  ]

  return (
    <form className="about-page" aria-label="О клинике" onSubmit={submit}>
      {!canEdit && <p className="tone-wait about-readonly">Только просмотр: «О клинике», цены и часы клиники меняет руководитель.</p>}
      <Preview f={f} hours={hoursText(c)} fill={fill} page={page} />

      <fieldset className="about-cards" disabled={!canEdit}>
        <Group title="Название и юр. данные" hint="Название пациенты видят в боте, на странице клиники и в напоминаниях.">
          <Row error={err('brandName')}>
            <label className="field"><span>Название для пациентов</span>
              <input id={fieldId('brandName')} value={f.brandName} maxLength={100} placeholder="Стоматология «Улыбка»" onChange={text('brandName')} /></label>
          </Row>
          <Row error={err('legalName')} hint="Кто отвечает за данные пациентов: это название пациент видит в согласии и в «Политике обработки данных».">
            <label className="field"><span>Клиника или ИП</span>
              <input id={fieldId('legalName')} value={f.legalName} maxLength={150} placeholder="ИП Садыкова А. или Стоматология «Улыбка»" onChange={text('legalName')} /></label>
          </Row>
        </Group>

        <Group title="Адрес и как добраться" hint="Адрес и маршрут пациенты видят при записи и в напоминаниях бота.">
          <Row error={err('address')}>
            <label className="field"><span>Адрес</span>
              {/* Город не выбран, а в адресе он есть — подставляем сами: одним действием меньше */}
              <input id={fieldId('address')} value={f.address} maxLength={200} placeholder="Например: Бишкек, ул. Шевченко 6" onChange={(e) => changeAddress(e.target.value)} /></label>
          </Row>
          <Row error={err('city')} hint="По городу клинику находят в каталоге /clinics и в боте.">
            <label className="field" id={fieldId('city')}><span>Город</span>
              <Select value={f.city} onChange={(e) => { setCityGuessed(false); set('city')(e.target.value) }}>
                <option value="">Не указан</option>
                {CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
              </Select></label>
          </Row>
          <Row error={err('mapUrl')} hint="В 2ГИС найдите кабинет → «Поделиться» → «Скопировать ссылку» и вставьте сюда.">
            <label className="field"><span>Ссылка 2ГИС</span>
              <input id={fieldId('mapUrl')} type="url" value={f.mapUrl} maxLength={300} placeholder="https://2gis.kg/bishkek/…" onChange={text('mapUrl')} /></label>
          </Row>
        </Group>

        <Group title="Связь" hint="На каждый номер у пациента своя кнопка «Позвонить», на WhatsApp — «Написать в WhatsApp».">
          <Row error={err('phones')} hint="Первый номер — главный, до трёх номеров.">
            <div className="field" id={fieldId('phones')}><span>Телефоны</span>
              <PhoneListInput label="Телефон клиники" values={f.phones} onChange={set('phones')} /></div>
          </Row>
          <Row error={err('whatsappPhone')} hint="Если WhatsApp на другом номере — укажите его. Пусто — кнопки «Написать в WhatsApp» нет.">
            <label className="field"><span>WhatsApp</span>
              <PhoneInput label="WhatsApp клиники" value={f.whatsappPhone} onChange={set('whatsappPhone')} /></label>
          </Row>
          {/* «Техподдержка приложения» убрана: у клиники своей нет — в /help бота контакты Tish.
              Старые значения уходят при сохранении как были (сервер их не стирает молча). */}
        </Group>

        <Group title="Отзывы и каталог" hint="После оценки приёма пациент увидит кнопки «Оставить отзыв в 2ГИС» и «Google».">
          <Row error={err('googleReviewUrl')} hint="Необязательно. Google Карты → карточка клиники → «Поделиться» (или «Получить больше отзывов»). При 1–3 ⭐ кнопки — мелко, под «Что было не так?».">
            <label className="field"><span>Отзывы в Google</span>
              <input type="url" value={f.googleReviewUrl} maxLength={300} placeholder="https://g.page/r/…/review" onChange={text('googleReviewUrl')} /></label>
          </Row>
          <label className="check about-listed"><input type="checkbox" checked={f.listed} onChange={flag('listed')} /> Показывать клинику в общем каталоге /clinics</label>
        </Group>

        <Group title="Как работают врачи" hint="Кто видит медкарты, выручку и материалы. Изменения — после «Сохранить».">
          {/* Карточки вместо галочек (2026-11-21, владелец): видно оба варианта и что каждый значит */}
          <ChoiceCards label="Медкарты и деньги врачей" disabled={!me.admin} value={f.independentDoctors ? 'own' : 'clinic'}
            onChange={(v) => set('independentDoctors')(v === 'own')} choices={[
              { value: 'clinic', icon: '🏥', title: 'Одна клиника',
                text: 'Общая касса и выручка. Врачи видят медкарты своих пациентов, в том числе общих; руководитель видит всё.' },
              { value: 'own', icon: '👤', title: 'Врачи работают отдельно',
                text: 'Как частные врачи в одном кабинете (например, аренда кресла): медкарты, заметки и выручку врача видит только он. Расписание и пациенты — общие.' },
            ]} />
          <h3 className="choice-cards-title">Склад</h3>
          <ChoiceCards label="Склад" disabled={!me.admin} value={f.separateSupplies ? 'own' : 'shared'}
            onChange={(v) => set('separateSupplies')(v === 'own')} choices={[
              { value: 'shared', icon: '📦', title: 'Один склад на всех', text: 'Материалы общие, закупает клиника.' },
              { value: 'own', icon: '🧳', title: 'Свой склад у каждого врача', text: 'Каждый врач закупает сам: видит и тратит свои материалы и общие.' },
            ]} />
          <p className="hint">Владелец кабинета (руководитель без своего приёма) видит всё при любой настройке.</p>
        </Group>
      </fieldset>

      {/* Ссылка на веб-версию нужна всем, и в «только просмотре» — вне выключенного fieldset */}
      <WebVersion />
      {/* Ошибка поля — и под полем, и в полосе: поле может быть выше, за краем экрана */}
      {canEdit && <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} savedText="«О клинике» сохранено — пациенты видят новое"
        error={save.error && (FIELDS.map((k) => err(k)).find(Boolean) ?? save.error.message)} />}
    </form>
  )
}

type Fill = { key: string; title: string; done: boolean; required?: boolean }
type AboutFields = { brandName: string; legalName: string; address: string; city: string; mapUrl: string; phones: string[]; whatsappPhone: string }

/**
 * «Так клиника видна пациентам» — сверху страницы, меняется сразу, пока вводят: кружок с буквой, название,
 * адрес с маршрутом в 2ГИС, телефоны, WhatsApp, часы и страница клиники (/c/<код>) — «Открыть» и «Скопировать».
 * В заголовке — «Заполнено N из M»; чего не хватает — ссылками к полям. На телефоне свёрнута (заголовок со
 * счётчиком виден), на компьютере раскрыта.
 */
function Preview({ f, hours, fill, page }: { f: AboutFields; hours: string; fill: Fill[]; page: string | null }) {
  const [open, setOpen] = useState(() => !matches('(max-width: 760px)'))
  const done = fill.filter((x) => x.done).length
  const missing = [...fill.filter((x) => !x.done && x.required), ...fill.filter((x) => !x.done && !x.required)]
  const needed = missing.some((x) => x.required)
  const phones = phonesFromInput(f.phones).filter(Boolean).map(phoneText)
  const wa = phoneFromInput(f.whatsappPhone)
  const name = f.brandName.trim()
  const address = f.address.trim()
  const place = f.city && address && !address.toLowerCase().includes(f.city.toLowerCase()) ? `${f.city}, ${address}` : address || f.city
  const map = httpUrl(f.mapUrl)
  return (
    <details className="card-block about-preview" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="about-preview-title">Так клиника видна пациентам</span>
        <span className={`about-fill ${needed ? 'todo' : done === fill.length ? 'done' : ''}`}>Заполнено {done} из {fill.length}</span>
      </summary>
      <div className="about-preview-body">
        <div className="about-id">
          <span className="about-avatar" aria-hidden="true">{name ? initialOf(name) : '?'}</span>
          <div className="about-id-text">
            <strong className={name ? 'about-name' : 'about-name empty'}>{name || 'Название не указано'}</strong>
            <span className={place ? '' : 'about-empty'}>{place || 'Адрес не указан'}</span>
            {map && <a href={map} target="_blank" rel="noopener noreferrer">Маршрут в 2ГИС</a>}
          </div>
        </div>
        <dl className="about-facts">
          <div><dt>Телефоны</dt><dd>{phones.length ? phones.map((p) => <span key={p} className="num">{p}</span>) : <span className="about-empty">не указаны</span>}</dd></div>
          <div><dt>WhatsApp</dt><dd>{wa ? <span className="num">{phoneText(wa)}</span> : <span className="about-empty">не указан — кнопки «Написать» нет</span>}</dd></div>
          <div><dt>Часы</dt><dd><span className="num">{hours}</span>
            <button type="button" className="link" aria-label="Изменить часы клиники" onClick={() => openSettings('hours')}>Изменить</button></dd></div>
        </dl>
        {page && <BookingPage url={page} />}
        {missing.length > 0 && (
          <p className={needed ? 'about-missing todo' : 'about-missing'}>
            <span>{needed ? 'Осталось заполнить:' : 'Можно дополнить:'}</span>
            {missing.map((x) => (
              <button key={x.key} type="button" className={x.required ? 'link about-req' : 'link'} onClick={() => focusField(x.key)}>
                {x.title}{x.required && <small> · {x.key === 'legalName' ? 'для согласия пациентов' : 'обязательно'}</small>}</button>
            ))}
          </p>
        )}
      </div>
    </details>
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
  // Новый QR — перечитать картинку (hasQr остаётся true)
  const [qrVersion, setQrVersion] = useState(0)
  const qrImage = useBlobUrl(st.hasQr ? `/api/clinic/deposit/qr?v=${qrVersion}` : null)
  const qrUrl = qrImage && qrImage !== 'error' ? qrImage.url : null
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
      setQrVersion((v) => v + 1)
      onSaved(d)
    },
  })
  const removeQr = useMutation<Deposit, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/clinic/deposit/qr')),
    onSuccess: (d) => {
      setDone('QR удалён')
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
        <p className="hint">Эти реквизиты и QR уходят и в напоминании о долге («Касса → Должники» → «Напомнить») — даже если предоплату не просите.
          QR в Telegram приходит картинкой, в WhatsApp — ссылкой на страницу с ним. Врач на аренде кресла указывает свои — в «Моём профиле».</p>
        <div className="qr-row">
          {qrUrl && <img className="pay-qr" src={qrUrl} alt="QR для предоплаты" />}
          <label className="btn">{st.hasQr ? 'Заменить QR' : 'Загрузить QR'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="QR для предоплаты"
              onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) qr.mutate(file) }} /></label>
          {st.hasQr && <button type="button" className="btn ghost" disabled={removeQr.isPending} onClick={() => removeQr.mutate()}>Удалить QR</button>}
        </div>
        {(qr.error || removeQr.error) && <p className="error" role="alert">{errorText(qr.error ?? removeQr.error)}</p>}
        {done && <p className="tone-ok" role="status">{done}</p>}
        <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} error={errorText(save.error)}
          label="Сохранить предоплату" savedText="Предоплата сохранена" onSave={() => save.mutate()} />
      </div>
    </section>
  )
}

/**
 * Страница клиники tish.kg/c/<код> — запись, «Позвонить», WhatsApp, врачи, услуги, адрес. В карточке
 * «Так клиника видна пациентам»: «Открыть», «Скопировать ссылку» и куда её ставить; подробно — раздел
 * руководства (#ssylka-na-zapis).
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
    <div className="about-page-link">
      <span className="about-page-label">Страница клиники — для Instagram, 2ГИС и рекламы</span>
      <a className="invite-link" href={url} target="_blank" rel="noopener noreferrer">{url}</a>
      <div className="actions">
        <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Открыть</a>
        <button type="button" className="btn" aria-label="Скопировать ссылку на страницу записи" onClick={() => void copy()}>Скопировать ссылку</button>
      </div>
      {copied === true && <p className="tone-ok" role="status">Ссылка на запись скопирована</p>}
      {copied === false && <p className="hint" role="status">Скопировать не получилось — нажмите на ссылку выше и удерживайте, затем «Копировать»</p>}
      <p className="hint">Поставьте в Instagram (Ссылки в профиле), 2ГИС (поле «Сайт»), Google Карты и рекламу. Своя ссылка для каждого места и QR — ниже,
        в «Ссылках для записи»; со скидкой — «Промокоды».{' '}
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
    <section className="card-block web-version" aria-label="Работать с компьютера">
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
    </section>
  )
}
