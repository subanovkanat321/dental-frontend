import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

import { useBack } from '../lib/back'
import { PART_KEY, PART_TEXT, placeCallouts } from './callouts'
import type { Lang } from './catalog'
import { POSTER_UI, POSTERS, type Mark, type Poster, type PosterSlug } from './posters'
import { SHOTS, type ShotName } from './shots.gen'
import './learn.css'

type Props = {
  start: PosterSlug
  onClose: () => void
  /** Язык снаружи (презентация на языке пациента); без него — свой переключатель с русского */
  lang?: Lang
  onLang?: (lang: Lang) => void
}

/**
 * Плакаты во весь экран — для ТВ и монитора в кабинете: ← → или кнопки — соседний плакат, цифры 1–9 или
 * нажатие на подпись — выделить часть («вот здесь»), F — весь экран, Esc — снять выделение, ещё раз — закрыть.
 * Отдельный чанк (React.lazy): кадры 1280 px скачиваются, только когда плакат открыли.
 */
export default function PosterView({ start, onClose, lang: outer, onLang }: Props) {
  const [own, setOwn] = useState<Lang>('ru')
  const lang = outer ?? own
  const setLang = onLang ?? setOwn
  const [index, setIndex] = useState(() => Math.max(0, POSTERS.findIndex((p) => p.slug === start)))
  const [active, setActive] = useState<number | null>(null)
  const last = POSTERS.length - 1
  const poster = POSTERS[index]!
  const count = poster.kind === 'anatomy' ? poster.legend.length : poster.panels.length
  const root = useRef<HTMLDivElement>(null)
  useBack(onClose)

  const go = useCallback((to: number) => {
    setIndex(Math.max(0, Math.min(last, to)))
    setActive(null)
  }, [last])
  const pick = useCallback((i: number) => setActive((a) => (a === i ? null : i)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(index + 1) }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(index - 1) }
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(last)
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= count) pick(Number(e.key) - 1)
      else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') toggleFull(root.current)
      else if (e.key === 'Escape') { if (active != null) setActive(null); else onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, last, count, active, go, pick, onClose])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    root.current?.focus()
    return () => {
      document.body.style.overflow = prev
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined)
    }
  }, [])

  return createPortal(
    <div ref={root} className="lsn lsn-overlay pst" role="dialog" aria-modal aria-label={`${POSTER_UI.poster[lang]}: ${poster.title[lang]}`} tabIndex={-1} lang={lang}>
      <header className="lsn-top">
        <span className="lsn-kicker"><span>{POSTER_UI.poster[lang]} {index + 1} / {POSTERS.length}</span><span>{poster.title[lang]}</span></span>
        <div className="lsn-dots" aria-hidden="true">
          {POSTERS.map((p, i) => <button type="button" tabIndex={-1} key={p.slug} className={i === index ? 'on' : ''} onClick={() => go(i)} />)}
        </div>
        <div className="lsn-lang" role="group" aria-label="Тил / Язык">
          <button type="button" aria-pressed={lang === 'ru'} onClick={() => setLang('ru')}>RU</button>
          <button type="button" aria-pressed={lang === 'ky'} onClick={() => setLang('ky')}>KG</button>
        </div>
        {typeof document.documentElement.requestFullscreen === 'function' && (
          <button type="button" className="lsn-close pst-full" onClick={() => toggleFull(root.current)} aria-label={POSTER_UI.full[lang]} title={`${POSTER_UI.full[lang]} (F)`}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
        <button type="button" className="lsn-close" onClick={onClose} aria-label={POSTER_UI.close[lang]}>✕</button>
      </header>
      <div className="lsn-stage">
        <PosterBody key={poster.slug} poster={poster} lang={lang} active={active} onPick={pick} />
        <p className="lsn-disclaimer pst-disclaimer">{POSTER_UI.disclaimer[lang]}</p>
      </div>
      <nav className="lsn-nav">
        <button type="button" className="lsn-arrow" onClick={() => go(index - 1)} disabled={index === 0} aria-label={POSTER_UI.prev[lang]}>‹</button>
        <span className="lsn-count" aria-live="polite">{poster.title[lang]}</span>
        <button type="button" className="lsn-arrow next" onClick={() => go(index + 1)} disabled={index === last} aria-label={POSTER_UI.next[lang]}>›</button>
      </nav>
    </div>,
    document.body,
  )
}

function toggleFull(el: HTMLElement | null) {
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined)
  else void el?.requestFullscreen?.().catch(() => undefined)
}

const label = (m: Mark, lang: Lang) => (m.label ?? PART_TEXT[m.part])[lang]

function PosterBody({ poster, lang, active, onPick }: { poster: Poster; lang: Lang; active: number | null; onPick: (i: number) => void }) {
  const head = (
    <header className="pst-head">
      <h2 className="lsn-title">{poster.title[lang]}</h2>
      <p className="lsn-lead">{poster.lead[lang]}</p>
    </header>
  )
  if (poster.kind === 'anatomy') {
    return (
      <section className="lsn-slide pst-anat">
        <div className="lsn-art lsn-art-3d pst-plate">
          <Figure shot={poster.shot} alt={poster.alt[lang]} marks={poster.legend} lang={lang} numbered active={active} onPick={onPick} />
        </div>
        <div className="pst-side">
          {head}
          <ol className="pst-legend">
            {poster.legend.map((row, i) => (
              <li key={row.part}>
                <button type="button" className={active === i ? 'on' : ''} aria-pressed={active === i} onClick={() => onPick(i)}>
                  <b className="pst-n">{i + 1}</b>
                  <span><strong>{label(row, lang)}</strong> <span>{row.text[lang]}</span></span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </section>
    )
  }
  return (
    <section className="lsn-slide pst-stages">
      {head}
      {/* Пластины одной высоты: пропорции — по самому высокому кадру ряда (у челюсти кадр шире, у зуба — выше) */}
      <ol className="pst-panels" style={{ '--n': poster.panels.length, '--par': Math.min(...poster.panels.map((p) => SHOTS[p.shot].w / SHOTS[p.shot].h)) } as CSSProperties}>
        {poster.panels.map((p, i) => (
          <li key={p.shot} className={active === i ? 'pst-panel on' : active != null ? 'pst-panel dim' : 'pst-panel'}>
            <div className="pst-plate"><Figure shot={p.shot} alt={p.alt[lang]} marks={p.marks} lang={lang} /></div>
            <button type="button" className="pst-cap" aria-pressed={active === i} onClick={() => onPick(i)}>
              <span className="pst-cap-title"><b className="pst-n">{i + 1}</b>{p.title[lang]}</span>
              <span className="pst-cap-text">{p.text[lang]}</span>
            </button>
          </li>
        ))}
      </ol>
      {poster.note && <p className="lsn-note">{poster.note[lang]}</p>}
    </section>
  )
}

/** Кадр 3D с подписями по краям и линиями к тканям; у «строения» подписи с номерами и нажимаются. */
function Figure({ shot, alt, marks, lang, numbered, active, onPick }: {
  shot: ShotName; alt: string; marks: Mark[]; lang: Lang; numbered?: boolean; active?: number | null; onPick?: (i: number) => void
}) {
  const s = SHOTS[shot]
  const at = s.at as Record<string, readonly [number, number] | undefined>
  const points = marks.flatMap((m, i) => {
    const p = m.at ?? at[PART_KEY[m.part] ?? m.part]
    return p ? [{ key: m.part, x: p[0], y: p[1], i }] : []
  })
  const placed = placeCallouts(points).map((p) => ({ ...p, i: points.find((q) => q.key === p.key)!.i }))
  const h = (100 * s.h) / s.w
  const src = (w: number) => `/content/learn/${shot}-${w}.webp`
  return (
    <figure className="lsn-3d pst-fig" style={{ '--ar': `${s.w} / ${s.h}` } as CSSProperties}>
      <img src={src(1280)} srcSet={`${src(640)} 640w, ${src(1280)} 1280w`} sizes={numbered ? '(max-width: 760px) 92vw, 50vw' : '(max-width: 760px) 50vw, 25vw'} alt={alt} decoding="async" />
      <svg className="lsn-leaders pst-leaders" viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden="true">
        {placed.map((p) => (
          <g key={p.key} className={active === p.i ? 'on' : undefined}>
            <line x1={p.x * 100} y1={p.y * h} x2={p.side === 'l' ? 4 : 96} y2={p.ly * h} vectorEffect="non-scaling-stroke" />
            <circle cx={p.x * 100} cy={p.y * h} r={active === p.i ? 1.6 : 1} />
          </g>
        ))}
      </svg>
      {placed.map((p) => {
        const text = label(marks[p.i]!, lang)
        const style = { top: `${p.ly * 100}%` }
        return onPick
          ? <button type="button" key={p.key} className={active === p.i ? 'lsn-callout pst-callout on' : 'lsn-callout pst-callout'} data-side={p.side} style={style}
            onClick={() => onPick(p.i)} aria-label={`${p.i + 1}. ${text}`}>{numbered && <b className="pst-n">{p.i + 1}</b>}{text}</button>
          : <span key={p.key} className="lsn-callout pst-callout" data-side={p.side} style={style}>{text}</span>
      })}
    </figure>
  )
}
