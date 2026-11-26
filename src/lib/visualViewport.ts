import { isStandalone } from '../pwa/pwa'

/** Видимая часть ниже окна больше чем на столько — открыта клавиатура. */
const KEYBOARD = 120
/** Экран «сжался» меньше, чем на столько, — дрожание округления, не залипание. */
const STUCK = 40

function typing(): boolean {
  const el = document.activeElement
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
    || (el instanceof HTMLElement && el.isContentEditable)
}

/**
 * Высота видимой части для карточки на весь экран. Обычно — сколько говорит браузер. Но установленное приложение
 * на iPhone иногда «залипает» после клавиатуры, системного листа или возврата из другого приложения (WhatsApp,
 * Telegram): браузер считает экран ниже настоящего, ничего не сообщая. Тогда карточка кончалась выше низа, под ней
 * виднелось расписание, а нижнее меню наезжало на кнопку «Приём состоялся» (2026-11-26). В установленном приложении
 * высота экрана без клавиатуры не меняется (нет панели Safari), поэтому без клавиатуры берём наибольшую виденную
 * в этой ориентации — карточка снова до настоящего низа. В Safari и Telegram высота законно меняется — там как есть.
 */
export function panelHeight(current: number, seenMax: number, standalone: boolean, keyboard: boolean): number {
  if (!standalone || keyboard || seenMax <= 0) return current
  return current < seenMax - STUCK ? seenMax : current
}

/**
 * iPhone (Safari, Telegram): клавиатура сдвигает видимую часть страницы, а после неё сдвиг иногда остаётся.
 * Карточка на весь экран (.panel, position: fixed) тогда уезжала верхом за край вместе с ✕, и прокрутить
 * к нему было нельзя: страница под открытой карточкой не прокручивается (tokens.css / crm.css). Поэтому:
 * - --vv-top / --vv-height — где сейчас видимая часть экрана: по ним карточка встаёт ровно в неё (tokens.css / crm.css);
 * - клавиатура закрылась, а карточка открыта — страницу обратно в начало;
 * - вернулись в приложение (из WhatsApp, Telegram, после блокировки) или коснулись экрана — перемерить и, если
 *   экран залип короче настоящего, «толкнуть» прокрутку и растянуть карточку до наибольшей высоты (panelHeight).
 */
export function startVisualViewport(): void {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement
  const standalone = isStandalone()
  const panelOpen = () => document.querySelector('.workspace .panel') != null
    && window.matchMedia?.('(max-width: 760px)').matches === true
  // Наибольшая высота без клавиатуры — отдельно для портрета и ландшафта
  const seen = { portrait: 0, landscape: 0 }
  const orient = () => (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait')
  let keyboard = false
  const update = () => {
    const open = vv.height < window.innerHeight - KEYBOARD
    const height = Math.round(vv.height)
    if (!open) seen[orient()] = Math.max(seen[orient()], height, window.innerHeight)
    root.style.setProperty('--vv-top', `${Math.max(0, Math.round(vv.offsetTop))}px`)
    root.style.setProperty('--vv-height', `${panelHeight(height, seen[orient()], standalone, open)}px`)
    if (keyboard && !open && panelOpen()) window.scrollTo(0, 0)
    keyboard = open
  }
  /** Экран залип: сдвинут после клавиатуры или короче наибольшего (установленное приложение). */
  const stuck = () => !typing() && (vv.offsetTop > 0
    || (standalone && Math.max(vv.height, window.innerHeight) < seen[orient()] - STUCK))
  // Толчок прокрутки на 1px туда и обратно возвращает видимую часть на место, не теряя места на странице
  // (меню у низа держит ещё layout/navGap.ts); с открытой карточкой страница не прокручивается — в начало
  const repair = () => {
    if (!stuck()) return update()
    if (panelOpen()) window.scrollTo(0, 0)
    else {
      const y = window.scrollY
      window.scrollTo(window.scrollX, y > 0 ? y - 1 : y + 1)
      window.scrollTo(window.scrollX, y)
    }
    update()
  }
  // iOS отдаёт размеры после возврата не сразу — проверить сейчас и ещё раз чуть позже
  const repairSoon = () => {
    repair()
    window.setTimeout(repair, 400)
  }
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  window.addEventListener('orientationchange', () => window.setTimeout(update, 400))
  window.addEventListener('pageshow', repairSoon)
  window.addEventListener('focus', repairSoon)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') repairSoon() })
  // Первое касание после залипания чинит сразу: размеры к этому времени уже настоящие
  document.addEventListener('touchstart', () => { if (stuck()) repair() }, { passive: true })
  // Ушли с поля, а на другое не перешли — клавиатура закрывается: вернуть страницу на место
  document.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (typing()) return
      if (panelOpen()) {
        window.scrollTo(0, 0)
        update()
      } else repair()
    }, 150)
  })
  update()
}
