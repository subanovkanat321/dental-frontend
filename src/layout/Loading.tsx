import { useEffect, useState, type CSSProperties } from 'react'

import { useOnline } from '../lib/online'

/** Сколько ждём, прежде чем показать «Загрузка…»: быстрый ответ не успевает мигнуть спиннером. */
export const LOADING_DELAY_MS = 300

/**
 * Кружок-спиннер — только картинка (aria-hidden): в кнопке «Сохраняем…» имя кнопки остаётся её
 * текстом. Цвет — `currentColor` (в залитой кнопке белый, в обычной — цвет текста); в
 * `prefers-reduced-motion` не вращается, а мягко пульсирует (styles.css).
 */
export function Spinner({ size }: { size?: number }) {
  const style: CSSProperties | undefined = size ? { width: size, height: size } : undefined
  return <span className="spinner" aria-hidden="true" style={style} />
}

/**
 * «Загрузка…» со спиннером для долгих запросов и lazy-чанков (Suspense). Появляется через
 * {@link LOADING_DELAY_MS}: ответ за 0,1 с не мигает. `role="status"` — экранный диктор скажет
 * текст, не перебивая. Вид: `block` — по центру блока (список, карточка), `inline` — в строку
 * (подсказка под полем), `overlay` — поверх области (3D-атлас, `tone="dark"` — на тёмном фоне).
 * Без сети запросы React Query на паузе (fetchStatus 'paused') и ждут связь — тогда текст про связь,
 * а не вечная «Загрузка…».
 */
export function Loading({ text = 'Загрузка…', offlineText = 'Нет интернета — ждём связь…', variant = 'block', tone, delay = LOADING_DELAY_MS, className }: {
  text?: string
  /** Что писать без сети (Mini App пациента — на его языке). */
  offlineText?: string
  variant?: 'block' | 'inline' | 'overlay'
  tone?: 'dark'
  delay?: number
  className?: string
}) {
  const [shown, setShown] = useState(delay <= 0)
  const online = useOnline()
  useEffect(() => {
    if (delay <= 0) return
    const timer = setTimeout(() => setShown(true), delay)
    return () => clearTimeout(timer)
  }, [delay])
  if (!shown) return null
  const cls = ['loading', variant, tone, className].filter(Boolean).join(' ')
  const Tag = variant === 'inline' ? 'span' : 'div'
  return (
    <Tag className={cls} role="status" aria-live="polite">
      <Spinner />
      <span className="loading-text">{online ? text : offlineText}</span>
    </Tag>
  )
}

/**
 * Пока грузится чанк 3D-атласа (three.js): тёмный фон атласа сразу на весь экран — без вспышки
 * светлой CRM, — а спиннер «Загружаем 3D…» через ту же задержку.
 */
export function AtlasBoot() {
  return <div className="atlas-boot"><Loading variant="overlay" tone="dark" text="Загружаем 3D…" /></div>
}
