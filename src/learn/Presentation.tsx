import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import type { Lang } from './catalog'
import { fromSom, stepPrice, type PricedService } from './prices'
import { UI, type Slide, type Topic } from './topics'
import './learn.css'

type Props = {
  topic: Topic
  lang: Lang
  onLang?: (lang: Lang) => void
  /** Прайс клиники для «Цены ожидания»; пусто — слайд без чисел */
  services?: PricedService[]
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
 * Esc — закрыть). Крупный текст, на телефоне рисунок сверху, на планшете и компьютере — рядом с текстом.
 */
export function Presentation({ topic, lang, onLang, services = [], onClose, endActions, brand, overlay = true }: Props) {
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
    <div ref={root} className={overlay ? 'lsn lsn-overlay' : 'lsn'} style={{ '--lsn-bg': topic.bg } as React.CSSProperties}
      role="dialog" aria-modal={overlay || undefined} aria-label={topic.title[lang]} tabIndex={-1} lang={lang}>
      <header className="lsn-top">
        <span className="lsn-kicker"><span aria-hidden="true">{topic.emoji}</span> {brand && <span className="lsn-brand">{brand} · </span>}{topic.title[lang]}</span>
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
        <SlideView key={`${topic.slug}-${index}`} slide={slide} lang={lang} services={services} first={index === 0} topicTitle={topic.title[lang]} />
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

function SlideView({ slide, lang, services, first, topicTitle }: { slide: Slide; lang: Lang; services: PricedService[]; first: boolean; topicTitle: string }) {
  if (slide.kind === 'what') {
    return (
      <section className="lsn-slide lsn-what">
        <div className="lsn-art">{slide.art(lang)}</div>
        <div className="lsn-body">
          {first && <p className="lsn-topic">{topicTitle}</p>}
          <h2 className="lsn-title">{slide.title[lang]}</h2>
          <p className="lsn-text">{slide.text[lang]}</p>
        </div>
      </section>
    )
  }
  if (slide.kind === 'stages') {
    return (
      <section className="lsn-slide lsn-stages">
        <h2 className="lsn-title">{slide.title[lang]}</h2>
        <ol className="lsn-cards" data-n={slide.points.length}>
          {slide.points.map((p, i) => (
            <li key={i} className="lsn-card">
              <div className="lsn-card-art">{p.art?.(lang)}</div>
              <p><b className="lsn-num">{i + 1}</b> {p.text[lang]}</p>
            </li>
          ))}
        </ol>
      </section>
    )
  }
  if (slide.kind === 'wait') {
    const priced = slide.steps.map((s) => stepPrice(services, s.prices))
    const anyPrice = priced.some((p) => p != null)
    return (
      <section className="lsn-slide lsn-stages lsn-wait">
        <h2 className="lsn-title">{slide.title[lang]}</h2>
        <ol className="lsn-cards" data-n={slide.steps.length}>
          {slide.steps.map((s, i) => (
            <li key={i} className={i === 0 ? 'lsn-card now' : 'lsn-card'}>
              <div className="lsn-card-art">{s.art(lang)}</div>
              <p>{s.label[lang]}</p>
              {anyPrice && <p className="lsn-price">{priced[i] != null ? fromSom(priced[i]!, lang) : UI.pricier[lang]}</p>}
            </li>
          ))}
        </ol>
        <p className="lsn-sooner">{anyPrice ? UI.sooner[lang] : UI.noPrices[lang]}</p>
        {anyPrice && <p className="lsn-note">{UI.pricesNote[lang]}</p>}
      </section>
    )
  }
  return (
    <section className="lsn-slide lsn-list">
      {slide.art && <div className="lsn-art">{slide.art(lang)}</div>}
      <div className="lsn-body">
        <h2 className="lsn-title">{slide.title[lang]}</h2>
        {slide.text && <p className="lsn-text">{slide.text[lang]}</p>}
        <ul className={slide.numbered ? 'lsn-points numbered' : 'lsn-points'}>
          {slide.points.map((p, i) => (
            <li key={i}><span className="lsn-icon" aria-hidden="true">{slide.numbered ? i + 1 : p.icon}</span>
              <span>{slide.numbered && p.icon ? <span aria-hidden="true">{p.icon} </span> : null}{p.text[lang]}</span></li>
          ))}
        </ul>
      </div>
    </section>
  )
}
