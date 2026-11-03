import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useSettings } from '../api/settings'
import { SaveBar } from '../layout/SaveBar'
import { applyTemplate, MAX_LENGTH, unknownVariables, usesVariable, VARIABLES, type Variable } from '../lib/reminderTemplate'
import { reminderText, type ReminderSettings } from '../lib/texts'
import { addDays, todayIn } from '../lib/time'
import { useDirty } from '../lib/unsaved'
import { SubHeader } from './SubHeader'
import './reminder.css'

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
 * «Настройки» → «Текст напоминания» (только админ): свой текст напоминания о приёме — для бота и
 * WhatsApp/SMS из карточки приёма. Переменные — кнопками в позицию курсора, предпросмотр на
 * вымышленном пациенте, ru и ky.
 */
export function ReminderTextPage({ me, onBack }: { me: Me; onBack: () => void }) {
  const settings = useSettings()
  return (
    <section className="schedule-main">
      <SubHeader title="Текст напоминания" onBack={onBack} />
      {settings.isPending ? <p className="hint">Загрузка…</p>
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
      client.setQueryData<Settings>(['settings'], (old) => ({ ...old, reminderTemplate: saved.ru, reminderTemplateKy: saved.ky }))
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
  const doctor = (me.doctors ?? []).find((d) => d.active !== false)?.fullName ?? 'Айгерим Садыкова'
  // Неизвестная переменная в любом из двух текстов: сервер всё равно не сохранит (422)
  const invalid = tooLong || unknownVariables(texts.ru).length > 0 || unknownVariables(texts.ky).length > 0
  const serverError = save.error && (save.error.fieldErrors.reminderTemplate ?? save.error.fieldErrors.reminderTemplateKy ?? save.error.message)
  const tomorrow10 = `${addDays(todayIn(), 1)}T04:00:00Z` // 10:00 по Бишкеку
  const whatsapp = reminderText({ startAt: tomorrow10, serviceName: SAMPLE.service, patient: { fullName: SAMPLE.name, telegram: false } },
    { ...settings, reminderTemplate: ru ?? undefined }, doctor)

  return (
    <form className="form reminder-text" aria-label="Текст напоминания" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <section className="card-block">
        <p className="hint">
          Это сообщение получает пациент перед приёмом: от бота клиники — накануне или по кнопке «Напомнить в Telegram», и из
          карточки приёма — в WhatsApp и SMS. Кнопки «Приду» и «Нужно перенести» бот добавит сам, в WhatsApp и SMS — строку
          «Ответьте 1 — приду, 2 — перенести» и ссылку на бота.
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
      <section className="card-block" aria-label="Предпросмотр">
        <h2>Предпросмотр</h2>
        <p className="hint">Вымышленный пациент «{SAMPLE.name}», приём завтра в 10:00.</p>
        <div className="reminder-previews">
          <figure className="reminder-preview" aria-label="Telegram">
            <figcaption>Telegram</figcaption>
            <p className="reminder-bubble">{botPreview(lang, ru, ky, settings, doctor)}</p>
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
      <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} savedText="Текст напоминания сохранён"
        disabled={invalid} error={serverError} />
    </form>
  )
}
