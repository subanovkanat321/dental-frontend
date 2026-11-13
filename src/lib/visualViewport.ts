/**
 * iPhone (Safari, Telegram): клавиатура сдвигает видимую часть страницы, а после неё сдвиг иногда остаётся.
 * Карточка на весь экран (.panel, position: fixed) тогда уезжала верхом за край вместе с ✕, и прокрутить
 * к нему было нельзя: страница под открытой карточкой не прокручивается (tokens.css / crm.css). Поэтому:
 * - --vv-top / --vv-height — где сейчас видимая часть экрана: по ним карточка встаёт ровно в неё (tokens.css / crm.css);
 * - клавиатура закрылась, а карточка открыта — страницу обратно в начало.
 */
export function startVisualViewport(): void {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement
  const panelOpen = () => document.querySelector('.workspace .panel') != null
    && window.matchMedia?.('(max-width: 760px)').matches === true
  let keyboard = false
  const update = () => {
    root.style.setProperty('--vv-top', `${Math.max(0, Math.round(vv.offsetTop))}px`)
    root.style.setProperty('--vv-height', `${Math.round(vv.height)}px`)
    const open = vv.height < window.innerHeight - 120
    if (keyboard && !open && panelOpen()) window.scrollTo(0, 0)
    keyboard = open
  }
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  // Ушли с поля, а на другое не перешли — клавиатура закрывается: вернуть страницу на место
  document.addEventListener('focusout', () => {
    window.setTimeout(() => {
      const el = document.activeElement
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      if (!typing && panelOpen()) {
        window.scrollTo(0, 0)
        update()
      } else if (!typing && vv.offsetTop > 0) {
        // Без карточки: видимая часть осталась сдвинутой после клавиатуры (iOS) — снизу серая полоса, а
        // нижнее меню висит над ней. Толчок прокрутки на 1px туда и обратно возвращает её на место, не
        // теряя места на странице (меню у низа держит ещё layout/navGap.ts)
        const y = window.scrollY
        window.scrollTo(window.scrollX, y > 0 ? y - 1 : y + 1)
        window.scrollTo(window.scrollX, y)
        update()
      }
    }, 150)
  })
  update()
}
