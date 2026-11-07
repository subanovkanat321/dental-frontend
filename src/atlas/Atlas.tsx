import { useEffect, useMemo, useRef, useState } from 'react'

import {
  CARIES_STAGES, isMode, MODE_STEPS, MODES, numberedLabels, PARTS, UI, WISDOM,
  type AtlasMode, type AtlasView, type Lang, type PartId, type WisdomPosition,
} from './content'
import type { AtlasEngine, ScreenPoint } from './engine/engine'
import { isFdi } from './fdi'
import { atlasLabels, infoText } from './labels'
import { Schematic } from './Schematic'
import { hasWebGL } from './webgl'
import { telegram } from '../lib/telegram'
import { Loading } from '../layout/Loading'
import './atlas.css'

export interface AtlasProps {
  initialView?: AtlasView
  initialMode?: AtlasMode
  /** Номер зуба FDI: открыть челюсть с выделенным зубом. */
  initialTooth?: number
  lang?: Lang
  /** Есть — показываем «Закрыть» (полноэкранный показ); нет — атлас встроен в другой экран. */
  onClose?: () => void
  /** Кнопка «На весь экран» (Fullscreen API; в Telegram его нет — там атлас и так во всё окно). */
  fullscreen?: boolean
}

type Status = 'loading' | 'ready' | 'nogl' | 'error'

/** Верхний ряд FDI (справа у пациента — слева на экране) и нижний — как в зубной формуле. */
const UPPER_ROW = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const LOWER_ROW = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

/**
 * 3D-атлас для показа пациенту: зуб в разрезе с номерами частей и роликами лечения, челюсть с выделением
 * зуба, положения зуба мудрости. three.js грузится отдельным чанком только здесь (import() в эффекте) —
 * основной бандл CRM не растёт. Без WebGL — плоская схема.
 */
export function Atlas({ initialView, initialMode, initialTooth, lang: initialLang = 'ru', onClose, fullscreen = false }: AtlasProps) {
  const startTooth = initialTooth != null && isFdi(initialTooth) ? initialTooth : null
  const [view, setView] = useState<AtlasView>(startTooth != null ? 'jaw' : initialView ?? 'tooth')
  const [mode, setMode] = useState<AtlasMode>(isMode(initialMode) ? initialMode : 'healthy')
  const [stage, setStage] = useState(1)
  const [part, setPart] = useState<PartId | null>(null)
  const [fdi, setFdi] = useState<number | null>(startTooth)
  const [wisdom, setWisdom] = useState<WisdomPosition>('vertical')
  const [roots, setRoots] = useState(false)
  const [lang, setLang] = useState<Lang>(initialLang)
  const [status, setStatus] = useState<Status>(() => (hasWebGL() ? 'loading' : 'nogl'))
  const [error, setError] = useState('')
  const [step, setStep] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [engine, setEngine] = useState<AtlasEngine | null>(null)
  const labelRefs = useRef<(HTMLButtonElement | null)[]>([])
  const stepRef = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  useEffect(() => {
    const onFull = () => setFull(document.fullscreenElement != null)
    document.addEventListener('fullscreenchange', onFull)
    return () => document.removeEventListener('fullscreenchange', onFull)
  }, [])
  const canFull = fullscreen && !telegram() && Boolean(document.fullscreenEnabled)
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void rootRef.current?.requestFullscreen?.()?.catch(() => undefined)
  }
  const t = UI[lang]

  const labels = useMemo(() => atlasLabels(view, mode, fdi, wisdom, lang), [view, mode, fdi, wisdom, lang])

  // Движок: создаём один раз (three.js — динамическим import), убираем при закрытии (dispose)
  useEffect(() => {
    if (status === 'nogl' || !canvasRef.current) return
    let cancelled = false
    let engine: AtlasEngine | null = null
    const canvas = canvasRef.current
    import('./engine/engine')
      .then(({ createAtlasEngine }) => {
        if (cancelled) return
        engine = createAtlasEngine(canvas, {
          onFrame: (points, s) => {
            placeLabels(labelRefs.current, points)
            if (s !== stepRef.current) {
              stepRef.current = s
              setStep(s)
            }
          },
          onLoading: (loading) => setStatus((st) => (st === 'error' ? st : loading ? 'loading' : 'ready')),
          onPickTooth: (code) => setFdi(code),
          onPickPart: (p) => setPart((cur) => (cur === p ? null : p)),
          onError: (message) => {
            setError(message)
            setStatus('error')
          },
        })
        setEngine(engine)
        setStatus('ready')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      })
    return () => {
      cancelled = true
      engine?.dispose()
    }
    // Движок создаётся один раз; status 'nogl' известен до первой отрисовки
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Состояние экрана → движок (движок появляется асинхронно — он в зависимостях)
  useEffect(() => { engine?.setView(view) }, [engine, view])
  useEffect(() => { engine?.setMode(mode) }, [engine, mode])
  useEffect(() => { engine?.setCariesStage(stage) }, [engine, stage])
  useEffect(() => { engine?.setPart(part) }, [engine, part])
  useEffect(() => { engine?.setTooth(fdi) }, [engine, fdi])
  useEffect(() => { engine?.setWisdom(wisdom) }, [engine, wisdom])
  useEffect(() => { engine?.setRoots(roots) }, [engine, roots])
  useEffect(() => { engine?.setAnchors(labels.map((l) => l.at)) }, [engine, labels])

  const chooseView = (v: AtlasView) => {
    setView(v)
    setPart(null)
  }
  const chooseMode = (m: AtlasMode) => {
    setMode(m)
    setPart(null)
    stepRef.current = 0
    setStep(0)
  }
  const steps = view === 'tooth' ? MODE_STEPS[mode] : undefined
  const info = infoText(view, mode, stage, part, fdi, wisdom, lang)

  return (
    <div ref={rootRef} className="atlas" data-view={view}>
      <header className="atlas-top">
        <strong className="atlas-title">{t.title}</strong>
        <div className="atlas-tabs" role="tablist" aria-label={t.title}>
          {(['tooth', 'jaw', 'wisdom'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'active' : ''} onClick={() => chooseView(v)}>{t[v]}</button>
          ))}
        </div>
        <div className="atlas-tools">
          <button type="button" onClick={() => setLang(lang === 'ru' ? 'ky' : 'ru')}>{t.lang}</button>
          {status !== 'nogl' && <button type="button" className="atlas-reset" aria-label={t.resetView} onClick={() => engine?.resetView()}>⟲ <span>{t.resetView}</span></button>}
          {canFull && <button type="button" aria-pressed={full} onClick={toggleFull}>{full ? t.exitFullscreen : t.fullscreen}</button>}
          {onClose && <button type="button" className="atlas-close" onClick={onClose} aria-label={t.close}>✕ <span>{t.close}</span></button>}
        </div>
      </header>

      <div className="atlas-stage">
        {status === 'nogl' ? (
          <div className="atlas-fallback">
            <p className="atlas-note">{t.noWebgl}</p>
            <Schematic lang={lang} part={part} onPart={(p) => setPart(p === part ? null : p)} />
          </div>
        ) : (
          <>
            <canvas ref={canvasRef} className="atlas-canvas" aria-label={t.hint} />
            <div className="atlas-labels" aria-hidden={false}>
              {labels.map((l, i) => (
                <button key={l.key} type="button" ref={(el) => { labelRefs.current[i] = el }}
                  className={['atlas-dot', l.part && part === l.part ? 'active' : '', typeof l.n === 'string' ? 'wide' : ''].join(' ').trim()}
                  aria-label={l.part ? `${l.n}. ${PARTS[l.part][lang].name}` : l.title}
                  onClick={() => l.part && setPart(part === l.part ? null : l.part)}>
                  {l.n}
                </button>
              ))}
            </div>
            {/* Два этапа: сначала грузится движок (three.js — свой чанк), потом строится модель */}
            {status === 'loading' && <Loading variant="overlay" tone="dark" text={engine ? t.loading : t.loadingEngine} />}
            {status === 'error' && <div className="atlas-loading error" role="alert">{error}</div>}
          </>
        )}

        {view === 'tooth' && (
          <ol className="atlas-legend">
            {numberedLabels(mode).map((l) => (
              <li key={l.part}>
                <button type="button" className={part === l.part ? 'active' : ''} onClick={() => setPart(part === l.part ? null : l.part)}>
                  <span className="atlas-num">{l.n}</span> {PARTS[l.part][lang].name}
                </button>
              </li>
            ))}
          </ol>
        )}

        {info && (
          <aside className="atlas-info" aria-live="polite">
            <h2>{info.name}</h2>
            <p>{info.text}</p>
          </aside>
        )}
      </div>

      <footer className="atlas-bottom">
        {view === 'tooth' && (
          <>
            {mode === 'caries' && (
              <div className="atlas-stages" role="radiogroup" aria-label={t.stage}>
                <span className="atlas-stage-title">{t.stage}:</span>
                {CARIES_STAGES.map((s, i) => (
                  <button key={i} type="button" role="radio" aria-checked={stage === i} className={stage === i ? 'active' : ''} onClick={() => setStage(i)}>
                    <span className="atlas-num">{i + 1}</span> {s[lang].name}
                  </button>
                ))}
                <input type="range" min={0} max={3} step={1} value={stage} aria-label={t.stage} onChange={(e) => setStage(Number(e.target.value))} />
              </div>
            )}
            {steps && (
              <div className="atlas-steps">
                <span>{steps[Math.min(step, steps.length - 1)]![lang]}</span>
                <button type="button" onClick={() => engine?.replay()}>↻ {t.replay}</button>
              </div>
            )}
            <div className="atlas-modes" role="tablist" aria-label={t.tooth}>
              {MODES.map((m) => (
                <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'active' : ''} onClick={() => chooseMode(m.id)}>{m[lang]}</button>
              ))}
            </div>
          </>
        )}
        {view === 'jaw' && (
          <div className="atlas-fdi">
            {[UPPER_ROW, LOWER_ROW].map((row, r) => (
              <div key={r} className="atlas-fdi-row">
                {row.map((code, i) => (
                  <button key={code} type="button" className={[fdi === code ? 'active' : '', i === 8 ? 'mid' : ''].join(' ').trim()} aria-pressed={fdi === code}
                    onClick={() => setFdi(fdi === code ? null : code)}>{code}</button>
                ))}
              </div>
            ))}
            <label className="atlas-check"><input type="checkbox" checked={roots} onChange={(e) => setRoots(e.target.checked)} /> {t.roots}</label>
          </div>
        )}
        {view === 'wisdom' && (
          <div className="atlas-modes">
            {WISDOM.map((w) => (
              <button key={w.id} type="button" aria-pressed={wisdom === w.id} className={wisdom === w.id ? 'active' : ''} onClick={() => setWisdom(w.id)}>{w[lang].name}</button>
            ))}
          </div>
        )}
      </footer>
    </div>
  )
}

/** Метки двигаем напрямую в DOM: 60 раз в секунду через React было бы расточительно. */
function placeLabels(els: (HTMLButtonElement | null)[], points: ScreenPoint[]): void {
  for (let i = 0; i < els.length; i++) {
    const el = els[i]
    const p = points[i]
    if (!el) continue
    if (!p) {
      el.style.visibility = 'hidden'
      continue
    }
    el.style.visibility = p.visible ? 'visible' : 'hidden'
    el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`
  }
}
