import { useEffect, type RefObject } from 'react'

/** Меньше этого — дрожание округления и полоски Safari, не «меню висит». */
const MIN_LIFT = 4

/**
 * На сколько пикселей нижнее меню телефона (`.sidebar`, position: fixed; bottom: 0) стоит выше настоящего
 * низа экрана. `drop` — на сколько мы его уже опустили (иначе после сдвига замер дал бы 0 и меню прыгнуло бы
 * обратно). Низ экрана — самое нижнее из того, что знает браузер: окно, видимая часть (visualViewport) и
 * высота «большого» экрана (100lvh, только в установленном приложении — в Safari там ещё панель адреса).
 */
export function navLift(screenBottoms: readonly number[], menuBottom: number, drop: number): number {
  const bottom = Math.max(...screenBottoms.filter((n) => Number.isFinite(n) && n > 0))
  const lift = Math.round(bottom - (menuBottom - drop))
  return lift >= MIN_LIFT ? lift : 0
}

/**
 * iPhone (iOS 26: Safari с плавающей панелью и установленное приложение после клавиатуры или системного листа)
 * ставит `position: fixed; bottom: 0` не у низа экрана, а выше — на высоту панели Safari (~80 px) или клавиатуры
 * (до ~240 px). Страница же докручивается до настоящего низа: под меню оставалась серая полоса (отступ
 * рабочей области снизу), а меню закрывало последний блок страницы, и докрутить его было нельзя (2026-11-13,
 * «Клиника → Услуги и цены», «Профосмотр по умолчанию»).
 *
 * Замер — тот же на любом экране: низ экрана минус низ меню. Дальше:
 * - меню не двигаем (в установленном приложении опускание на `--nav-drop` по замеру 100lvh уводило его за край
 *   экрана — подписи вкладок пропадали, 2026-11-14); `--nav-drop` в crm.css остаётся 0;
 * - отступ страницы снизу растёт на зазор (`--nav-gap`): последний блок докручивается выше меню.
 * Компьютер и обычный телефон (Chrome, Android, Telegram) — зазор 0, ничего не меняется.
 */
export function useNavGap(menu: RefObject<HTMLElement | null>, phone: boolean) {
  useEffect(() => {
    const root = document.documentElement
    const clear = () => {
      root.style.removeProperty('--nav-gap')
      root.style.removeProperty('--nav-drop')
      delete root.dataset.navDrop
    }
    if (!phone) {
      clear()
      return
    }
    let frame = 0
    const drop = 0
    const fit = () => {
      frame = 0
      const el = menu.current
      if (!el) return
      const vv = window.visualViewport
      // Клавиатура открыта (видимая часть заметно ниже окна) — зазор от неё, меню и так под клавиатурой: не трогаем
      if (vv && vv.height < window.innerHeight - 120) return
      const bottoms = [window.innerHeight, root.clientHeight, vv ? vv.offsetTop + vv.height : 0]
      const lift = navLift(bottoms, el.getBoundingClientRect().bottom, drop)
      // Меню НЕ опускаем (2026-11-14): в установленном приложении замер «100lvh» оказался ниже настоящего края
      // экрана, меню уезжало вниз и подписи вкладок пропадали. Только запас снизу у страницы — он безопасен.
      if (lift) root.style.setProperty('--nav-gap', `${lift}px`)
      else clear()
    }
    const later = () => { if (!frame) frame = requestAnimationFrame(fit) }
    // После клавиатуры iOS отдаёт размеры не сразу — перемерить ещё раз чуть позже
    const settle = () => { later(); window.setTimeout(later, 350) }
    fit()
    settle()
    const vv = window.visualViewport
    vv?.addEventListener('resize', later)
    vv?.addEventListener('scroll', later)
    window.addEventListener('resize', later)
    window.addEventListener('orientationchange', settle)
    document.addEventListener('focusout', settle)
    document.addEventListener('visibilitychange', settle)
    return () => {
      vv?.removeEventListener('resize', later)
      vv?.removeEventListener('scroll', later)
      window.removeEventListener('resize', later)
      window.removeEventListener('orientationchange', settle)
      document.removeEventListener('focusout', settle)
      document.removeEventListener('visibilitychange', settle)
      cancelAnimationFrame(frame)
      clear()
    }
  }, [menu, phone])
}
