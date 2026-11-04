/**
 * Автопереход к следующему полю формы: выбрали в списке, дату в календаре, набрали телефон
 * целиком или нажали «Далее» на клавиатуре — фокус сам уходит в следующее поле. Включается
 * у формы атрибутом `data-advance`: в других формах (фильтры, настройки) ничего не меняется.
 */

/** Поля, куда можно перейти: ввод, текст, наши списки (combobox) и календари (кнопка с диалогом). */
const FIELDS = [
  'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled])',
  'button[role=combobox]:not([disabled])',
  'button[aria-haspopup=dialog]:not([disabled])',
].join(',')

/** Поле и его «соседи» внутри одного составного поля (телефон: номер и код страны) — одно целое. */
function groupOf(el: Element): Element {
  return el.closest('.phone') ?? el
}

/**
 * Перевести фокус на следующее поле после `from` — только внутри формы с `data-advance`.
 * @return true — перешли
 */
export function focusNext(from: Element | null): boolean {
  const form = from?.closest('[data-advance]')
  if (!from || !form) return false
  const group = groupOf(from)
  const fields = [...form.querySelectorAll<HTMLElement>(FIELDS)].filter((el) => !el.closest('[aria-hidden=true], [hidden]'))
  const next = fields.find((el) => !group.contains(el) && (group.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))
  if (!next) return false
  next.focus()
  next.scrollIntoView?.({ block: 'nearest' })
  return true
}

/**
 * «Enter» / «Далее» на клавиатуре телефона в однострочном поле — следующее поле, а не отправка
 * формы. На последнем поле — обычная отправка. Вешается на `onKeyDown` формы.
 */
export function advanceOnEnter(e: { key: string; target: EventTarget; preventDefault: () => void; nativeEvent?: { isComposing?: boolean } }) {
  const t = e.target as HTMLElement
  if (e.key !== 'Enter' || e.nativeEvent?.isComposing || !(t instanceof HTMLInputElement)) return
  if (['checkbox', 'radio', 'submit', 'button', 'search'].includes(t.type)) return
  if (focusNext(t)) e.preventDefault()
}

/** Сколько цифр в полном номере по примеру страны: «555 123 456» → 9. */
export function phoneDigits(example: string): number {
  return example.replace(/\D/g, '').length
}

/**
 * Шаг формы без поля ввода (кнопки услуг, сетка времени): выбрали — показать следующий шаг.
 * Прокручиваем к нему плавно; `focus` — ещё и фокус (кнопке «Записать»: Enter сразу отправит).
 * Клавиатура телефона при этом не открывается — фокус только на кнопках.
 */
export function reveal(el: HTMLElement | null, focus = false) {
  if (!el) return
  if (focus) el.focus({ preventScroll: true })
  // Через кадр: выбор ещё дорисует форму («Приём: 09:00–10:30», новая сетка времени) — иначе
  // прокрутка считает по старой высоте и не доезжает
  const go = () => el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(go))
  else go()
}
