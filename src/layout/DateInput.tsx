import type { InputHTMLAttributes } from 'react'

/** '2026-11-02' → «2 ноября 2026» (дата без часового пояса — как есть). */
function dateText(date: string, weekday = false): string {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric', weekday: weekday ? 'short' : undefined })
    .format(d).replace(/ г\.?$/, '')
}

/**
 * Поле даты в стиле CRM: видно «2 ноября 2026» по-русски (браузер с английским языком показывал
 * «11/02/2026»), а под ним — обычное поле даты браузера, прозрачное: нажатие открывает его календарь,
 * клавиатура и скринридер работают как с обычным полем, подпись (label / aria-label) — у него.
 */
export function DateInput({ value, className, weekday, iconOnly, placeholder = 'Выберите дату', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & {
  value: string
  /** «пн, 2 нояб. 2026» — когда важен день недели */
  weekday?: boolean
  /** Только значок календаря: дата уже крупно рядом (заголовок дня в «Расписании») */
  iconOnly?: boolean
}) {
  return (
    <span className={['date-input', iconOnly ? 'icon-only' : '', className].filter(Boolean).join(' ')} title={iconOnly ? 'Выбрать дату' : undefined}>
      <span className="date-face" aria-hidden="true">
        <svg className="date-ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4.5" width="14" height="12.5" rx="2" /><path d="M3 8.5h14M7 2.5v4M13 2.5v4" /></svg>
        {/* Текст — через CSS (attr): не попадает в текст подписи <label>, поле называется её словами */}
        {!iconOnly && <span className={value ? 'date-text' : 'date-text hint'} data-text={value ? dateText(value, weekday) : placeholder} />}
      </span>
      <input type="date" value={value} {...props}
        onClick={(e) => {
          // Chrome открывает календарь только по значку — здесь по нажатию на всё поле
          try {
            e.currentTarget.showPicker?.()
          } catch {
            // уже открыт или браузер не умеет — обычное поле
          }
          props.onClick?.(e)
        }} />
    </span>
  )
}
