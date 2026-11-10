import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'

import { PART_KEY, PART_TEXT, placeCallouts, type Part } from './callouts'
import type { L, Lang } from './catalog'
import { SHOTS, type ShotName } from './shots.gen'

/**
 * Рисунок слайда: свой SVG (функция) или кадр 3D-атласа — картинка `{ img }` или короткий ролик `{ video }`.
 * Кадры и ролики сняты из нашего 3D (scripts/learn-art.mjs) и лежат в public/content/learn/: файл есть всегда,
 * WebGL у зрителя не нужен. SVG у кадра — запасной путь: файл не загрузился — показываем рисунок.
 */
export type ArtFn = (lang: Lang) => ReactNode
export type { Part } from './callouts'
export type Img3D = { img: ShotName; alt: L; labels?: Part[]; svg: ArtFn }
export type Video3D = { video: ClipName; alt: L; svg: ArtFn }
export type Art = ArtFn | Img3D | Video3D
export type ClipName = Extract<ShotName, `${string}-clip`>

const BASE = '/content/learn/'

type Place = 'slide' | 'card' | 'cover'
/** Какой ширины кадр на экране — браузер берёт 640 или 1280 px (srcset). */
const SIZES: Record<Place, string> = {
  slide: '(max-width: 760px) 92vw, 46vw',
  card: '(max-width: 760px) 45vw, 22vw',
  cover: '220px',
}

const reduceQuery = '(prefers-reduced-motion: reduce)'
function subscribeMotion(cb: () => void): () => void {
  const m = typeof window.matchMedia === 'function' ? window.matchMedia(reduceQuery) : null
  m?.addEventListener?.('change', cb)
  return () => m?.removeEventListener?.('change', cb)
}
const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia(reduceQuery).matches

/** Рисунок слайда, карточки стадии или обложки темы. */
export function ArtView({ art, lang, place = 'slide' }: { art: Art; lang: Lang; place?: Place }) {
  if (typeof art === 'function') return <>{art(lang)}</>
  if ('img' in art) return <Shot art={art} lang={lang} place={place} />
  return <Clip art={art} lang={lang} />
}

/** Пропорции кадра — рамка заранее нужного размера: подписи стоят точно на своих местах, страница не прыгает. */
const frameStyle = (name: ShotName) => ({ '--ar': `${SHOTS[name].w} / ${SHOTS[name].h}` }) as CSSProperties

function Shot({ art, lang, place }: { art: Img3D; lang: Lang; place: Place }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <>{art.svg(lang)}</>
  const src = (w: number) => `${BASE}${art.img}-${w}.webp`
  return (
    <figure className="lsn-3d" style={frameStyle(art.img)} data-place={place}>
      <img src={src(640)} srcSet={`${src(640)} 640w, ${src(1280)} 1280w`} sizes={SIZES[place]}
        // Обложка темы — украшение: название темы рядом, экранному диктору читать подпись кадра незачем
        alt={place === 'cover' ? '' : art.alt[lang]}
        loading="lazy" decoding="async" onError={() => setFailed(true)} />
      {art.labels && <Callouts name={art.img} labels={art.labels} lang={lang} />}
    </figure>
  )
}

function Clip({ art, lang }: { art: Video3D; lang: Lang }) {
  const [failed, setFailed] = useState(false)
  const reduce = useSyncExternalStore(subscribeMotion, reducedMotion, () => false)
  const last = useRef<HTMLSourceElement>(null)
  // Ошибка источника не всплывает до <video>: ловим на последнем <source> — значит, не подошёл ни один
  useEffect(() => {
    const el = last.current
    if (!el) return
    const fail = () => setFailed(true)
    el.addEventListener('error', fail)
    return () => el.removeEventListener('error', fail)
  }, [reduce])
  if (failed) return <>{art.svg(lang)}</>
  const poster = `${BASE}${art.video}-poster.webp`
  return (
    <figure className="lsn-3d" style={frameStyle(art.video)} data-place="slide">
      {reduce
        // Меньше движения (настройка системы) — только постер: последний кадр ролика
        ? <img src={poster} alt={art.alt[lang]} loading="lazy" decoding="async" onError={() => setFailed(true)} />
        : (
          <video autoPlay muted loop playsInline preload="metadata" poster={poster} aria-label={art.alt[lang]}>
            <source src={`${BASE}${art.video}.webm`} type="video/webm" />
            <source ref={last} src={`${BASE}${art.video}.mp4`} type="video/mp4" />
          </video>
        )}
    </figure>
  )
}

function Callouts({ name, labels, lang }: { name: ShotName; labels: Part[]; lang: Lang }) {
  const shot = SHOTS[name]
  const at = shot.at as Record<string, readonly [number, number] | undefined>
  const points = labels.flatMap((key) => {
    const p = at[PART_KEY[key] ?? key]
    return p ? [{ key, x: p[0], y: p[1] }] : []
  })
  const placed = placeCallouts(points)
  const h = (100 * shot.h) / shot.w
  return (
    <>
      <svg className="lsn-leaders" viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden="true">
        {placed.map((p) => (
          <g key={p.key}>
            <line x1={p.x * 100} y1={p.y * h} x2={p.side === 'l' ? 4 : 96} y2={p.ly * h} vectorEffect="non-scaling-stroke" />
            <circle cx={p.x * 100} cy={p.y * h} r={0.9} />
          </g>
        ))}
      </svg>
      {placed.map((p) => (
        <span key={p.key} className="lsn-callout" data-side={p.side} style={{ top: `${p.ly * 100}%` }}>{PART_TEXT[p.key][lang]}</span>
      ))}
    </>
  )
}
