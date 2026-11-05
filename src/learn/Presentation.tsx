import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import type { Lang } from './catalog'
import { ICONS, type IconName } from './icons.gen'
import { UI, type ArtFn, type Photo, type Slide, type Topic } from './topics'
import './learn.css'

type Props = {
  topic: Topic
  lang: Lang
  onLang?: (lang: Lang) => void
  onClose?: () => void
  /** Под последним слайдом: «Отправить в Telegram», «Ссылка для WhatsApp», «Записаться» */
  endActions?: ReactNode
  /** Над заголовком мелко: название клиники на публичной странице */
  brand?: string | null
  /** Во весь экран поверх CRM (по умолчанию) или страницей сайта */
  overlay?: boolean
}

/**
 * Презентация темы: слайды во весь экран, листание стрелками, свайпом и клавиатурой (← → Home End,
 * Esc — закрыть). Строгий «атласный» вид: белый фон, крупный текст, на телефоне рисунок сверху,
 * на планшете и компьютере — рядом с текстом.
 */
export function Presentation({ topic, lang, onLang, onClose, endActions, brand, overlay = true }: Props) {
  const [index, setIndex] = useState(0)
  const slides = topic.slides
  const last = slides.length - 1
  const go = useCallback((to: number) => setIndex(Math.max(0, Math.min(last, to))), [last])
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !(e.target instanceof HTMLButtonElement))) { e.preventDefault(); setIndex((i) => Math.min(last, i + 1)) }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)) }
      else if (e.key === 'Home') setIndex(0)
      else if (e.key === 'End') setIndex(last)
      else if (e.key === 'Escape' && onClose) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [last, onClose])

  // Поверх CRM страница под презентацией не прокручивается; фокус — на презентацию (клавиатура, экранный диктор)
  useEffect(() => {
    if (!overlay) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    root.current?.focus()
    return () => { document.body.style.overflow = prev }
  }, [overlay])

  // Свайп: палец сдвинулся по горизонтали больше чем на 50 px и больше, чем по вертикали
  const start = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => { start.current = { x: e.clientX, y: e.clientY } }
  const onPointerUp = (e: React.PointerEvent) => {
    const s = start.current
    start.current = null
    if (!s) return
    const dx = e.clientX - s.x
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(index + (dx < 0 ? 1 : -1))
  }

  const slide = slides[index]!
  return (
    <div ref={root} className={overlay ? 'lsn lsn-overlay' : 'lsn'}
      role="dialog" aria-modal={overlay || undefined} aria-label={topic.title[lang]} tabIndex={-1} lang={lang}>
      <header className="lsn-top">
        <span className="lsn-kicker">{brand && <span className="lsn-brand">{brand}</span>}<span>{topic.title[lang]}</span></span>
        <div className="lsn-dots" aria-hidden="true">
          {slides.map((s, i) => <button type="button" tabIndex={-1} key={i} className={i <= index ? 'on' : ''} onClick={() => go(i)} aria-label={`${UI.slide[lang]} ${i + 1}`} data-kind={s.kind} />)}
        </div>
        {onLang && (
          <div className="lsn-lang" role="group" aria-label="Тил / Язык">
            <button type="button" aria-pressed={lang === 'ru'} onClick={() => onLang('ru')}>RU</button>
            <button type="button" aria-pressed={lang === 'ky'} onClick={() => onLang('ky')}>KG</button>
          </div>
        )}
        {onClose && <button type="button" className="lsn-close" onClick={onClose} aria-label={UI.close[lang]}>✕</button>}
      </header>
      <div className="lsn-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <SlideView key={`${topic.slug}-${index}`} slide={slide} lang={lang} step={index + 1} first={index === 0} topicTitle={topic.title[lang]} />
        {index === last && (
          <div className="lsn-end">
            {endActions && <div className="lsn-actions">{endActions}</div>}
            <p className="lsn-disclaimer">{UI.disclaimer[lang]}</p>
          </div>
        )}
      </div>
      <nav className="lsn-nav">
        <button type="button" className="lsn-arrow" onClick={() => go(index - 1)} disabled={index === 0} aria-label={UI.prev[lang]}>‹</button>
        <span className="lsn-count" aria-live="polite">{index + 1} / {slides.length}</span>
        <button type="button" className="lsn-arrow next" onClick={() => go(index + 1)} disabled={index === last} aria-label={UI.next[lang]}>›</button>
      </nav>
    </div>
  )
}

/** Пиктограмма Health Icons (контурная, цвета текста). */
export function Icon({ name }: { name: IconName }) {
  return <svg className="lsn-ico" viewBox="0 0 48 48" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">{ICONS[name]}</svg>
}

/** Атрибуция фото: «Фото: Автор, CC BY-SA 4.0, Wikimedia Commons» — со ссылкой на источник, если есть. */
function creditText(photo: Photo, lang: Lang): string {
  const c = photo.credit
  return `${UI.photo[lang]}: ${c.author}, ${c.license}, ${c.source}`
}

/** Рисунок слайда или настоящее фото с подписью-атрибуцией (тогда рисунок не показываем). */
function Visual({ art, photo, lang }: { art?: ArtFn; photo?: Photo; lang: Lang }) {
  if (photo) {
    return (
      <figure className="lsn-art lsn-photo">
        <img src={photo.src} alt={photo.alt[lang]} loading="lazy" decoding="async" />
        <figcaption className="lsn-credit">
          {photo.credit.url ? <a href={photo.credit.url} target="_blank" rel="noreferrer noopener">{creditText(photo, lang)}</a> : creditText(photo, lang)}
        </figcaption>
      </figure>
    )
  }
  return art ? <div className="lsn-art">{art(lang)}</div> : null
}

function SlideView({ slide, lang, step, first, topicTitle }: { slide: Slide; lang: Lang; step: number; first: boolean; topicTitle: string }) {
  const eyebrow = <p className="lsn-topic">{first ? topicTitle : String(step).padStart(2, '0')}</p>
  if (slide.kind === 'what') {
    return (
      <section className="lsn-slide lsn-what">
        <Visual art={slide.art} photo={slide.photo} lang={lang} />
        <div className="lsn-body">
          {eyebrow}
          <h2 className="lsn-title">{slide.title[lang]}</h2>
          <p className="lsn-text">{slide.text[lang]}</p>
        </div>
      </section>
    )
  }
  if (slide.kind === 'stages') {
    return (
      <section className="lsn-slide lsn-stages">
        <header className="lsn-head">
          {eyebrow}
          <h2 className="lsn-title">{slide.title[lang]}</h2>
          {slide.text && <p className="lsn-lead">{slide.text[lang]}</p>}
        </header>
        {slide.photo && <Visual photo={slide.photo} lang={lang} />}
        <ol className="lsn-cards" data-n={slide.points.length}>
          {slide.points.map((p, i) => (
            <li key={i} className="lsn-card">
              <div className="lsn-card-art">{p.art?.(lang)}</div>
              <p><span className="lsn-num">{i + 1}</span><span>{p.text[lang]}</span></p>
            </li>
          ))}
        </ol>
        {slide.note && <p className="lsn-note">{slide.note[lang]}</p>}
      </section>
    )
  }
  const visual = slide.art || slide.photo
  return (
    <section className={visual ? 'lsn-slide lsn-list' : 'lsn-slide lsn-list lsn-facts'}>
      {visual && <Visual art={slide.art} photo={slide.photo} lang={lang} />}
      <div className="lsn-body">
        {eyebrow}
        <h2 className="lsn-title">{slide.title[lang]}</h2>
        {slide.text && <p className="lsn-text">{slide.text[lang]}</p>}
        <ul className={slide.numbered ? 'lsn-points numbered' : 'lsn-points'}>
          {slide.points.map((p, i) => (
            <li key={i}>
              <span className="lsn-icon">
                {p.icon && <Icon name={p.icon} />}
                {slide.numbered && <b className="lsn-step" aria-label={`${i + 1}.`}>{i + 1}</b>}
              </span>
              <span>{p.text[lang]}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
