import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { OFFER } from '../lib/brand'
import { DEMO_PATH } from '../lib/demo'
import { TOUR_START, TOUR_STEPS } from './tourSteps'
import { getJson, useDemoEnabled, type Links } from './web'
import './tour.css'

/*
 * «Тур по Tish» (/tour) — для владельцев клиник, которые ещё не клиенты (шаг 7А, по опыту Dentist Plus: их публичный
 * «Тур по системе» — для продаж). Десять коротких шагов: большой скриншот телефона, заголовок в одну строку и польза
 * в 1–2 предложения — не список функций. На телефоне — карусель на весь экран (свайп, точки, стрелки, клавиши ←/→) и
 * липкая кнопка «Попробовать бесплатно» внизу; на компьютере — простой список сверху вниз. Подробности для тех, кто
 * уже работает, — в руководстве (/guide); здесь — только то, что помогает решиться.
 * Кнопка ведёт на регистрацию с меткой канала: /start?from=tour → «Платформа → Аналитика → Откуда пришли клиники»
 * (V237 бэкенда; метка tour — только для регистрации, ClinicSignups.SIGNUP_ONLY). Скриншоты — на вымышленной клинике
 * («Стоматология «Тест»», пациенты «… Тестов»), public/tour, WebP 600×1298; грузятся лениво, кроме первого.
 */

const IMG = `${import.meta.env.BASE_URL}tour/`

/** На телефоне шаги — карусель (как в CSS: max-width 759px). */
const PHONE = '(max-width: 759px)'

export function Tour() {
  const track = useRef<HTMLOListElement>(null)
  const [current, setCurrent] = useState(0)
  const [links, setLinks] = useState<Links>({})
  // «Посмотреть демо» — рядом с итоговой кнопкой, только когда демо включено (GET /web/demo)
  const demo = useDemoEnabled()
  // Липкая кнопка не дублирует большую кнопку внизу страницы: та на экране — липкую прячем
  const final = useRef<HTMLElement>(null)
  const [atFinal, setAtFinal] = useState(false)
  useEffect(() => {
    const el = final.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setAtFinal(Boolean(e?.isIntersecting)), { threshold: 0.2 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => { void getJson<Links>('/web/links').then(({ data }) => setLinks(data ?? {})) }, [])
  const wa = links.supportWhatsapp ? `https://wa.me/${links.supportWhatsapp}` : null

  // Текущий шаг карусели — по прокрутке ленты (свайп, стрелки, точки — всё через scrollLeft)
  useEffect(() => {
    const el = track.current
    if (!el) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!el.clientWidth) return
        setCurrent(Math.max(0, Math.min(TOUR_STEPS.length - 1, Math.round(el.scrollLeft / el.clientWidth))))
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [])

  const go = useCallback((i: number) => {
    const n = Math.max(0, Math.min(TOUR_STEPS.length - 1, i))
    setCurrent(n)
    const el = track.current
    if (!el) return
    const phone = window.matchMedia?.(PHONE).matches ?? false
    const smooth = !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
    if (phone) el.scrollTo?.({ left: n * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' })
    else document.getElementById(`step-${n + 1}`)?.scrollIntoView?.({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  }, [])

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(current + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(current - 1) }
  }

  const step = TOUR_STEPS[current] ?? TOUR_STEPS[0]!
  return (
    <div className="tour">
      <header className="tour-top">
        <a className="tour-brand" href="/about" aria-label="Tish — всё о программе">
          <img src={`${import.meta.env.BASE_URL}tishka-icon.svg`} alt="" width={20} height={30} /> Tish</a>
        <nav className="tour-top-links" aria-label="Ссылки">
          <a href="/login">Вход для клиники</a>
          <a className="tour-btn primary small" href={TOUR_START}>{OFFER}</a>
        </nav>
      </header>

      <main>
        <section className="tour-hero" aria-labelledby="tour-title">
          <p className="tour-eyebrow">Тур по Tish · 2 минуты</p>
          <h1 id="tour-title">Как клиника работает в Tish — за 10 шагов</h1>
          <p className="tour-lead">От записи пациента до отчёта руководителю. Скриншоты — настоящая программа на вымышленной клинике.</p>
        </section>

        <section className="tour-carousel" aria-roledescription="карусель" aria-label="Шаги тура" onKeyDown={onKey}>
          {/* Телефон: стрелки и где я — «Шаг 3 из 10» с полоской — над шагом, точки — под ним; компьютер — их нет, шаги списком */}
          <div className="tour-progress">
            <button type="button" className="tour-arrow" onClick={() => go(current - 1)} disabled={current === 0} aria-label="Предыдущий шаг">‹</button>
            <span className="tour-progress-mid" aria-hidden="true">
              <span className="tour-progress-text num">Шаг {current + 1} из {TOUR_STEPS.length}</span>
              <span className="tour-progress-bar"><span style={{ width: `${((current + 1) / TOUR_STEPS.length) * 100}%` }} /></span>
            </span>
            <button type="button" className="tour-arrow" onClick={() => go(current + 1)} disabled={current === TOUR_STEPS.length - 1} aria-label="Следующий шаг">›</button>
          </div>
          <p className="sr-only" aria-live="polite">Шаг {current + 1} из {TOUR_STEPS.length}: {step.title}</p>
          <ol ref={track} className="tour-steps" tabIndex={0} aria-label="Шаги: листайте влево и вправо или нажимайте стрелки">
            {TOUR_STEPS.map((s, i) => (
              <li key={s.img} id={`step-${i + 1}`} className="tour-step" aria-roledescription="слайд" aria-label={`Шаг ${i + 1} из ${TOUR_STEPS.length}`}>
                <div className="tour-shot">
                  <div className="tour-phone">
                    <img src={`${IMG}${s.img}.webp`} alt={s.alt} width={600} height={1298} decoding="async"
                      loading={i === 0 ? 'eager' : 'lazy'} fetchPriority={i === 0 ? 'high' : undefined} />
                  </div>
                </div>
                <div className="tour-copy">
                  <p className="tour-num"><span className="num">{String(i + 1).padStart(2, '0')}</span> из {TOUR_STEPS.length}</p>
                  <h2>{s.title}</h2>
                  <p>{s.text}</p>
                  <a className="tour-btn primary tour-step-cta" href={TOUR_START}>{OFFER}</a>
                </div>
              </li>
            ))}
          </ol>
          <div className="tour-nav">
            <div className="tour-dots" role="group" aria-label="Перейти к шагу">
              {TOUR_STEPS.map((s, i) => (
                <button key={s.img} type="button" className="tour-dot" aria-label={`Шаг ${i + 1}: ${s.title}`}
                  aria-current={i === current ? 'step' : undefined} onClick={() => go(i)} />
              ))}
            </div>
          </div>
        </section>

        <section ref={final} className="tour-final" aria-labelledby="tour-final">
          <h2 id="tour-final">Попробуйте на своей клинике</h2>
          <p className="tour-lead">{OFFER}: всё приложение, без ограничений и без предоплаты. Клиника создаётся за пару минут — с телефона или компьютера.</p>
          <div className="tour-ctas">
            <a className="tour-btn primary big" href={TOUR_START}>{OFFER}</a>
            {demo && <a className="tour-btn big" href={DEMO_PATH}><span aria-hidden="true">👀</span> Посмотреть демо</a>}
            {wa && <a className="tour-btn big" href={wa} target="_blank" rel="noopener noreferrer"><span aria-hidden="true">💬</span> Спросить в WhatsApp</a>}
          </div>
          <p className="tour-note">Хотите подробнее? <a href="/about">Всё о Tish</a> · <a href="/guide">Руководство со скриншотами</a> · <a href="/join#form">Помогите подключить</a></p>
          <p className="tour-note">Скриншоты — настоящая программа на вымышленной клинике: все имена и телефоны придуманы.</p>
        </section>
      </main>

      <footer className="tour-footer"><a href="/go">tish.kg</a> · <a href="/login">Вход для клиники</a> · © {new Date().getFullYear()} Tish</footer>

      {/* Телефон: кнопка всегда под пальцем */}
      <div className={`tour-sticky${atFinal ? ' hidden' : ''}`} aria-hidden={atFinal || undefined}>
        <a className="tour-btn primary" href={TOUR_START} tabIndex={atFinal ? -1 : undefined}>{OFFER}</a>
      </div>
    </div>
  )
}
