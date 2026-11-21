import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useSettings } from '../api/settings'
import { Loading } from '../layout/Loading'
import { SaveBar } from '../layout/SaveBar'
import { applyTemplate, DEBT_VARIABLES, MAX_LENGTH, unknownVariables, usesVariable, type DebtVariable } from '../lib/reminderTemplate'
import { howToPay, STANDARD_DEBT } from '../lib/debt'
import { useDirty } from '../lib/unsaved'
import { SubHeader } from './SubHeader'
import './reminder.css'

type Settings = Schemas['SettingsControllerSettings']

const NAMES = DEBT_VARIABLES.map(([name]) => name)

/** Вымышленные пациент и врач предпросмотра. */
const SAMPLE = { name: 'Айгуль', sum: '5 000 сом', doctor: 'Айгерим Садыкова' }

/**
 * «Настройки» → «Напоминание о долге» (только руководитель): вежливый текст, который уходит пациенту по кнопке
 * «Напомнить» в «Касса → Должники» и в карточке пациента — от бота клиники или в WhatsApp. Сумму и врачей подставляет
 * сервер, реквизиты — из «О клинике → Предоплата → Как перевести» (или врача, который берёт оплату сам).
 */
export function DebtTextPage({ onBack }: { onBack: () => void }) {
  const settings = useSettings()
  return (
    <section className="schedule-main">
      <SubHeader title="Напоминание о долге" onBack={onBack} />
      {settings.isPending ? <Loading />
        : settings.error ? <p className="error">{settings.error.message}</p>
          : <Editor settings={settings.data} />}
    </section>
  )
}

function Editor({ settings }: { settings: Settings }) {
  const client = useQueryClient()
  const [text, setText] = useState(settings.debtTemplate ?? STANDARD_DEBT)
  const field = useRef<HTMLTextAreaElement>(null)
  const own = !text.trim() || text.trim() === STANDARD_DEBT ? null : text.trim()
  const { dirty, commit } = useDirty({ own })
  const save = useMutation<Schemas['ClinicControllerDebtTemplate'], ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/clinic/debt-template', { body: { debtTemplate: own ?? undefined } })),
    onSuccess: (saved) => {
      commit()
      client.setQueryData<Settings>(['settings'], (old) => old && ({ ...old, debtTemplate: saved.debtTemplate }))
    },
  })
  const change = (value: string) => {
    save.reset()
    setText(value)
  }
  const insert = (variable: DebtVariable) => {
    const el = field.current
    const token = `{${variable}}`
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    change(text.slice(0, start) + token + text.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }
  const unknown = unknownVariables(text, NAMES)
  const tooLong = text.trim().length > MAX_LENGTH
  const noSum = text.trim() !== '' && !usesVariable(text, 'сумма')
  const preview = applyTemplate<DebtVariable>(own ?? STANDARD_DEBT, {
    имя: SAMPLE.name, сумма: SAMPLE.sum, врач: SAMPLE.doctor, клиника: settings.clinicName, оплата: howToPay(settings.paymentDetails), телефон: settings.clinicPhone,
  }, NAMES)
  const serverError = save.error && (save.error.fieldErrors.debtTemplate ?? save.error.message)

  return (
    <form className="form reminder-text" aria-label="Текст напоминания о долге" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <section className="card-block">
        <p className="hint">
          Это сообщение получает пациент, когда вы нажимаете «Напомнить» в «Касса → Должники» или в карточке пациента: от бота
          клиники, а без бота — в WhatsApp. Сумму подставит Tish — её в тексте не пишут. Напомнить одному пациенту можно не
          чаще раза в 3 дня. {'{врач}'} — врач(и) приёмов с долгом. Реквизиты для {'{оплата}'} — в «Клиника → О клинике →
          Предоплата за запись → Как перевести»; у врача на аренде кресла — его «Как оплатить мне» в «Моём профиле». QR в
          Telegram уходит картинкой, в WhatsApp — ссылкой.
        </p>
        <label className="field">
          <span>Текст напоминания</span>
          <textarea ref={field} rows={7} value={text} placeholder={STANDARD_DEBT}
            aria-invalid={unknown.length > 0 || tooLong} onChange={(e) => change(e.target.value)} />
        </label>
        <div className="reminder-vars" role="group" aria-label="Вставить переменную">
          {DEBT_VARIABLES.map(([name, title]) => (
            <button key={name} type="button" className="chip" title={title} onClick={() => insert(name)}>{`{${name}}`}</button>
          ))}
        </div>
        <p className={`hint num${tooLong ? ' error' : ''}`}>{text.trim().length} / {MAX_LENGTH}</p>
        {unknown.length > 0 && (
          <p className="error" role="alert">
            {unknown.length === 1 ? 'Неизвестная переменная ' : 'Неизвестные переменные '}{unknown.map((v) => `{${v}}`).join(', ')} —
            можно: {NAMES.map((v) => `{${v}}`).join(', ')}.
          </p>
        )}
        {noSum && <p className="reminder-warning" role="status">Нет {'{сумма}'} — пациент не узнает, сколько оплатить.</p>}
        <div className="actions">
          <button type="button" className="btn" disabled={text.trim() === STANDARD_DEBT} onClick={() => change(STANDARD_DEBT)}>Вернуть стандартный текст</button>
        </div>
      </section>
      <section className="card-block" aria-label="Предпросмотр">
        <h2>Предпросмотр</h2>
        <p className="hint">Вымышленный пациент «{SAMPLE.name}», врач {SAMPLE.doctor}, долг {SAMPLE.sum}. Пациенту, который выбрал в боте кыргызский, без своего
          текста уходит стандартный на кыргызском.</p>
        <figure className="reminder-preview" aria-label="Сообщение пациенту">
          <figcaption>Telegram и WhatsApp</figcaption>
          <p className="reminder-bubble">{`💳 Напоминание об оплате\n\n${preview}`}</p>
        </figure>
      </section>
      <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} savedText="Текст напоминания о долге сохранён"
        disabled={unknown.length > 0 || tooLong} error={serverError} />
    </form>
  )
}
