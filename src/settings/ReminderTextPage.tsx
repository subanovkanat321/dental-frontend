import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useSettings } from '../api/settings'
import { SaveBar } from '../layout/SaveBar'
import { applyTemplate, MAX_LENGTH, unknownVariables, usesVariable, VARIABLES, type Variable } from '../lib/reminderTemplate'
import { appointmentPhone, forAppointment, reminderText, repeatReminderText, soonText, type ReminderSettings } from '../lib/texts'
import { addDays, todayIn } from '../lib/time'
import { useDirty } from '../lib/unsaved'
import { SubHeader } from './SubHeader'
import './reminder.css'
import { Loading } from '../layout/Loading'

type Me = Schemas['BookingViewsMe']
type Settings = Schemas['SettingsControllerSettings']
type Lang = 'ru' | 'ky'

/**
 * Стандартный текст в виде шаблона — с него начинается редактор. Совпадает с ним — сохраняем пусто
 * (null), и бот шлёт свой стандартный текст из messages.properties (с «Нажмите кнопку ниже…»).
 */
const STANDARD_RU = 'Здравствуйте, {имя}! 👋 Напоминаем: {когда} приём у стоматолога 🦷'

const STANDARD_KY = 'Саламатсызбы, {имя}! 👋 Эскертебиз: {когда} тиш дарыгеринин кабыл алуусу 🦷'

/** Стандартное напоминание бота целиком — reminder.text бэкенда (messages*.properties). */
const STANDARD_BOT: Record<Lang, string> = {
  ru: `${STANDARD_RU} Нажмите кнопку ниже: «Приду» или «Нужно перенести».`,
  ky: `${STANDARD_KY} Төмөндөгү баскычты басыңыз: «Келем» же «Жылдыруу керек».`,
}

const BUTTONS: Record<Lang, [string, string]> = { ru: ['👍 Приду', '🔄 Нужно перенести'], ky: ['👍 Келем', '🔄 Жылдыруу керек'] }

const ADDRESS: Record<Lang, string> = { ru: '📍 Адрес: ', ky: '📍 Дарек: ' }

/** Вымышленный пациент предпросмотра: завтра в 10:00. */
const SAMPLE = { name: 'Айгуль', service: 'Осмотр и консультация', when: { ru: 'завтра в 10:00', ky: 'эртең саат 10:00' } }

/** Свой шаблон из поля: пусто или стандартный — null (стандартный текст). */
function own(lang: Lang, text: string): string | null {
  const t = text.trim()
  return !t || (lang === 'ru' && t === STANDARD_RU) ? null : t
}

/**
 * Что пришлёт бот (как PatientReminders.reminderText бэкенда): свой ky → он; нет — свой русский
 * (и {когда} по-русски); нет и его — стандартный. Адрес строкой — если нет {адрес}, подпись — если
 * нет {клиника}. {бот} в боте пустой.
 */
function botPreview(lang: Lang, ru: string | null, ky: string | null, s: ReminderSettings, doctor: string): string {
  const useKy = lang === 'ky' && ky != null
  const template = useKy ? ky : ru
  const textLang: Lang = template != null && !useKy ? 'ru' : lang
  const values: Partial<Record<Variable, string | null | undefined>> = {
    имя: SAMPLE.name, когда: SAMPLE.when[textLang], врач: doctor, услуга: SAMPLE.service,
    клиника: s.clinicName, адрес: s.clinicAddress, телефон: s.clinicPhone, бот: '',
  }
  let text = applyTemplate(template ?? STANDARD_BOT[lang], values)
  if (s.clinicAddress && (template == null || !usesVariable(template, 'адрес'))) text += `\n${ADDRESS[textLang]}${s.clinicAddress}`
  if (s.clinicSignature && (template == null || !usesVariable(template, 'клиника'))) text += `\n${s.clinicSignature}`
  return text
}

/**
 * «Настройки» → «Напоминание о приёме» (только админ): свой текст напоминания о приёме — для бота и
 * WhatsApp/SMS из карточки приёма. Переменные — кнопками в позицию курсора, предпросмотр на
 * вымышленном пациенте, ru и ky.
 */
export function ReminderTextPage({ me, onBack }: { me: Me; onBack: () => void }) {
  const settings = useSettings()
  return (
    <section className="schedule-main">
      <SubHeader title="Напоминание о приёме" onBack={onBack} />
      {settings.isPending ? <Loading />
        : settings.error ? <p className="error">{settings.error.message}</p>
          : <Editor me={me} settings={settings.data} />}
    </section>
  )
}

function Editor({ me, settings }: { me: Me; settings: Settings }) {
  const client = useQueryClient()
  const [lang, setLang] = useState<Lang>('ru')
  const [texts, setTexts] = useState<Record<Lang, string>>({
    ru: settings.reminderTemplate ?? STANDARD_RU,
    ky: settings.reminderTemplateKy ?? '',
  })
  const field = useRef<HTMLTextAreaElement>(null)
  const ru = own('ru', texts.ru)
  const ky = own('ky', texts.ky)
  const { dirty, commit } = useDirty({ ru, ky })
  const save = useMutation<Schemas['ClinicServiceReminderTemplates'], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/clinic/reminder-template', { body: { reminderTemplate: ru ?? undefined, reminderTemplateKy: ky ?? undefined } })),
    onSuccess: (saved) => {
      commit()
      client.setQueryData<Settings>(['settings'], (old) => old && ({ ...old, reminderTemplate: saved.ru, reminderTemplateKy: saved.ky }))
    },
  })
  const text = texts[lang]
  const change = (value: string) => {
    save.reset()
    setTexts((t) => ({ ...t, [lang]: value }))
  }
  const insert = (variable: Variable) => {
    const el = field.current
    const token = `{${variable}}`
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    change(text.slice(0, start) + token + text.slice(end))
    // Курсор — сразу после вставленной переменной: можно печатать дальше
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }
  const unknown = unknownVariables(text)
  const tooLong = text.trim().length > MAX_LENGTH
  const noWhen = text.trim() !== '' && !usesVariable(text, 'когда')
  const active = (me.doctors ?? []).filter((d) => d.active !== false)
  // Предпросмотр «номер врача» — на враче, который указал «Телефон для пациентов» (если такой есть)
  const sample = (settings.reminderContact === 'DOCTOR' ? active.find((d) => settings.doctorPhones?.[String(d.id)]) : null) ?? active[0]
  const doctor = sample?.fullName ?? 'Айгерим Садыкова'
  const preview = forAppointment(settings, sample?.id)
  // Неизвестная переменная в любом из двух текстов: сервер всё равно не сохранит (422)
  const invalid = tooLong || unknownVariables(texts.ru).length > 0 || unknownVariables(texts.ky).length > 0
  const serverError = save.error && (save.error.fieldErrors.reminderTemplate ?? save.error.fieldErrors.reminderTemplateKy ?? save.error.message)
  const tomorrow10 = `${addDays(todayIn(), 1)}T04:00:00Z` // 10:00 по Бишкеку
  const whatsapp = reminderText({ startAt: tomorrow10, serviceName: SAMPLE.service, patient: { fullName: SAMPLE.name, telegram: false } },
    { ...preview, reminderTemplate: ru ?? undefined }, doctor)

  return (
    <form className="form reminder-text" aria-label="Текст напоминания" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <section className="card-block">
        <p className="hint">
          Это сообщение получает пациент перед приёмом: от бота клиники — накануне или по кнопке «Напомнить в Telegram», и из
          карточки приёма — в WhatsApp и SMS (пока своего текста нет — там короткая карточка: дата, врач, адрес, карта, телефон). Кнопки «Приду» и «Нужно перенести» бот добавит сам, к своему тексту в WhatsApp и SMS — строку
          «Ответьте 1 — приду, 2 — перенести», адрес, телефон («Номер в напоминаниях»), ссылку на карту из «О клинике» и ссылку на бота. Это текст первого напоминания: нажали «Напомнить» ещё раз —
          уходит стандартный текст повтора. А за 2 часа до приёма бот сам пишет записавшимся через него короткое «⏰ Ждём вас» —
          этот текст не меняется (он ниже, для справки).
        </p>
        <div className="segments" role="group" aria-label="Язык текста">
          <button type="button" aria-pressed={lang === 'ru'} onClick={() => setLang('ru')}>Русский</button>
          <button type="button" aria-pressed={lang === 'ky'} onClick={() => setLang('ky')}>Кыргызский</button>
        </div>
        <label className="field">
          <span>{lang === 'ru' ? 'Текст по-русски' : 'Текст по-кыргызски'}</span>
          <textarea ref={field} rows={6} value={text}
            placeholder={lang === 'ky' ? (ru ? 'Пусто — уйдёт русский текст клиники' : STANDARD_KY) : STANDARD_RU}
            aria-invalid={unknown.length > 0 || tooLong} onChange={(e) => change(e.target.value)} />
        </label>
        <div className="reminder-vars" role="group" aria-label="Вставить переменную">
          {VARIABLES.map(([name, title]) => (
            <button key={name} type="button" className="chip" title={title} onClick={() => insert(name)}>{`{${name}}`}</button>
          ))}
        </div>
        <p className={`hint num${tooLong ? ' error' : ''}`}>{text.trim().length} / {MAX_LENGTH}</p>
        {unknown.length > 0 && (
          <p className="error" role="alert">
            {unknown.length === 1 ? 'Неизвестная переменная ' : 'Неизвестные переменные '}{unknown.map((v) => `{${v}}`).join(', ')} —
            пациент увидит её как есть. Можно: {VARIABLES.map(([v]) => `{${v}}`).join(', ')}.
          </p>
        )}
        {noWhen && <p className="reminder-warning" role="status">Нет {'{когда}'} — пациент не узнает, когда приём.</p>}
        {lang === 'ky' && !text.trim() && (
          <p className="hint">{ru ? 'Кыргызоязычным пациентам уйдёт русский текст клиники.' : 'Кыргызоязычным пациентам уйдёт стандартный текст на кыргызском.'}</p>
        )}
        <div className="actions">
          <button type="button" className="btn" disabled={lang === 'ru' ? texts.ru.trim() === STANDARD_RU : !texts.ky.trim()}
            onClick={() => change(lang === 'ru' ? STANDARD_RU : '')}>Вернуть стандартный текст</button>
        </div>
      </section>
      <ReminderContact settings={settings} doctors={active} sample={sample} />
      <section className="card-block" aria-label="Предпросмотр">
        <h2>Предпросмотр</h2>
        <p className="hint">Вымышленный пациент «{SAMPLE.name}», приём завтра в 10:00.</p>
        <div className="reminder-previews">
          <figure className="reminder-preview" aria-label="Telegram">
            <figcaption>Telegram</figcaption>
            <p className="reminder-bubble">{botPreview(lang, ru, ky, preview, doctor)}</p>
            <div className="reminder-buttons" aria-hidden="true">
              {BUTTONS[lang].map((b) => <span key={b}>{b}</span>)}
            </div>
          </figure>
          <figure className="reminder-preview" aria-label="WhatsApp и SMS">
            <figcaption>WhatsApp и SMS</figcaption>
            <p className="reminder-bubble">{whatsapp}</p>
            {lang === 'ky' && <p className="hint">В WhatsApp и SMS уходит русский текст: язык пациента CRM не знает.</p>}
          </figure>
        </div>
      </section>
      <section className="card-block" aria-label="Другие сообщения о приёме">
        <h2>Другие сообщения о приёме</h2>
        <p className="hint">Их клиника не меняет — показаны по-русски на том же вымышленном пациенте.</p>
        <div className="reminder-previews">
          <figure className="reminder-preview" aria-label="Повторное напоминание">
            <figcaption>Повторное напоминание — если нажать «Напомнить» ещё раз</figcaption>
            <p className="reminder-bubble">{repeatReminderText({ startAt: tomorrow10, patient: { fullName: SAMPLE.name, telegram: true } }, settings, doctor)}</p>
          </figure>
          <figure className="reminder-preview" aria-label="За 2 часа до приёма">
            <figcaption>За 2 часа до приёма — в Telegram</figcaption>
            <p className="reminder-bubble">{soonText(`${todayIn()}T04:00:00Z`, preview)}</p>
          </figure>
        </div>
      </section>
      <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} savedText="Текст напоминания сохранён"
        disabled={invalid} error={serverError} />
    </form>
  )
}

type Doctor = NonNullable<Me['doctors']>[number]
type Contact = Settings['reminderContact']

const CONTACTS: [Contact, string, string][] = [
  ['CLINIC', 'Номер клиники', 'телефоны из «О клинике» — как было всегда.'],
  ['DOCTOR', 'Номер врача приёма', 'его «Телефон для пациентов»; врач номер не указал — уйдёт номер клиники.'],
]

/**
 * «Номер в напоминаниях» (V252 бэкенда): чей телефон получает пациент в сообщениях о своём приёме — напоминание и
 * {телефон}, «Нужно перенести», «⏰ Ждём вас», «Запись подтверждена», WhatsApp-напоминание из CRM. Сохраняется сразу,
 * как «Оценка приёма»; сервер разрешает только руководителю. Ниже — какой номер уйдёт и у кого из врачей номера нет.
 */
function ReminderContact({ settings, doctors, sample }: { settings: Settings; doctors: Doctor[]; sample?: Doctor }) {
  const client = useQueryClient()
  const change = useMutation<Schemas['ClinicControllerReminderContactRequest'], ApiError, Contact>({
    mutationFn: (reminderContact) => unwrap(api.PUT('/api/clinic/reminder-contact', { body: { reminderContact } })),
    onSuccess: (saved) => client.setQueryData<Settings>(['settings'], (old) => old && ({ ...old, reminderContact: saved.reminderContact ?? old.reminderContact })),
  })
  const value = change.isPending ? change.variables : settings.reminderContact
  const phones = settings.doctorPhones ?? {}
  const shown = appointmentPhone({ ...settings, reminderContact: value }, sample?.id)
  const without = doctors.filter((d) => !phones[String(d.id)]).map((d) => d.fullName)
  return (
    <section className="card-block form" aria-label="Номер в напоминаниях">
      <fieldset>
        <legend>Номер в напоминаниях</legend>
        {CONTACTS.map(([contact, title, hint]) => (
          <label key={contact} className="check">
            <input type="radio" name="reminder-contact" value={contact} checked={value === contact} disabled={change.isPending}
              onChange={() => change.mutate(contact)} />
            <span><strong>{title}</strong><span className="hint"> — {hint}</span></span>
          </label>
        ))}
      </fieldset>
      <p className="reminder-phone" role="status">
        {shown.phone
          ? <>В напоминание уйдёт: <strong className="num">{shown.phone}</strong> — {shown.doctor ? `номер врача ${sample?.fullName ?? ''}` : 'номер клиники'}.</>
          : 'Номера нет: заполните телефоны в «О клинике».'}
      </p>
      {value === 'DOCTOR' && without.length > 0 && (
        <p className="hint small">
          Без «Телефона для пациентов»: {without.join(', ')} — их пациентам уйдёт номер клиники. Номер врач указывает в «Моём
          профиле» → «Для пациентов», руководитель — в карточке врача в «Персонале».
        </p>
      )}
      <p className="hint small">
        Номер врача уходит только в сообщениях о его приёме и его работе: напоминание ({'{телефон}'}), ответ на «Нужно
        перенести», «⏰ Ждём вас», «Запись подтверждена», напоминание о долге (если весь долг — за приёмы этого врача),
        памятка после процедуры («Телефон врача»), квитанция, план лечения и приглашение вернуться. Помощь бота,
        «Позвонить в клинику» и поздравления — всегда с номером клиники.
      </p>
      {change.error && <p className="error" role="alert">{change.error.fieldErrors.reminderContact ?? change.error.message}</p>}
    </section>
  )
}
