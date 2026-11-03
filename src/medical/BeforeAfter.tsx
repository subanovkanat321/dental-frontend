import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'

import { api, ApiError, fetchBlob, unwrap, type Schemas } from '../api/client'
import { useMe } from '../api/me'
import { Select } from '../layout/Select'
import { formatPhone } from '../lib/phone'
import { useClose } from '../lib/useClose'
import { shortDate, todayIn } from '../lib/time'
import {
  boxFrom, clampCrop, drawBeforeAfter, FIT, FORMATS, frames, inside, placement, toImage,
  type Box, type Design, type Format, type Picture, type Shot,
} from './beforeAfterDraw'
import { buildPost, durationBetween, POST_STYLES, type PostStyle } from './postText'
import { Thumb } from './Thumb'
import './beforeAfter.css'

type FileView = Schemas['PatientFilesView']
type Consent = Schemas['PublicationConsentsView']
type Scope = NonNullable<Consent['scope']>

/**
 * Согласие на публикацию фото и кнопка «Собрать картинку «до / после»» — в блоке снимков медкарты. Согласие
 * отдельное от согласия на обработку данных; ставит и снимает врач (и админ), ассистент только
 * видит. Без согласия собрать картинку нельзя.
 */
export function PublicationBlock({ patientId, files, readOnly }: { patientId: number; files: FileView[]; readOnly: boolean }) {
  const client = useQueryClient()
  const consent = useQuery({
    queryKey: ['publication-consent', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/publication-consent', { params: { path: { patientId } } })),
  })
  const give = useMutation<Consent, ApiError, Scope>({
    mutationFn: (scope) => unwrap(api.PUT('/api/patients/{patientId}/publication-consent', { params: { path: { patientId } }, body: { scope } })),
    onSuccess: (fresh) => client.setQueryData(['publication-consent', patientId], fresh),
  })
  const revoke = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/patients/{patientId}/publication-consent', { params: { path: { patientId } } })),
    onSuccess: () => client.setQueryData(['publication-consent', patientId], {} satisfies Consent),
  })
  const [open, setOpen] = useState(false)
  const scope = consent.data?.scope
  const busy = give.isPending || revoke.isPending
  const error = give.error ?? revoke.error
  const why = !scope ? 'Сначала отметьте согласие пациента на публикацию.'
    : files.length < 2 ? 'Нужно хотя бы два фото: «до» и «после».' : null

  if (consent.isPending || consent.isError) return null
  return (
    <div className="publication">
      <h3>Картинка «до / после» для Instagram</h3>
      {/* Как это работает — по шагам, с отметкой сделанного: без ИИ, из ваших же фото */}
      <ol className="ba-steps">
        <li className={files.length >= 2 ? 'done' : undefined}>Загрузите выше фото «до» (перед лечением) и «после» (в конце){files.length >= 2 ? ' ✓' : ''}</li>
        <li className={scope ? 'done' : undefined}>Отметьте согласие пациента на публикацию{scope ? ' ✓' : ''}</li>
        <li>«Собрать картинку»: выберите фото, пост или сторис, при необходимости закройте глаза — скачайте картинку и скопируйте готовый текст поста</li>
      </ol>
      <p className="hint small">Это не ИИ: картинка собирается из ваших фото прямо на телефоне и никуда не отправляется.</p>
      <label className="check">
        <input type="checkbox" checked={Boolean(scope)} disabled={readOnly || busy}
          onChange={(e) => (e.target.checked ? give.mutate('NO_FACE') : revoke.mutate())} />
        <span>Пациент согласен(на) на публикацию фото в соцсетях клиники и врача</span>
      </label>
      {scope && (
        <div className="segments" role="group" aria-label="Что можно публиковать">
          <button type="button" aria-pressed={scope === 'NO_FACE'} disabled={readOnly || busy} onClick={() => give.mutate('NO_FACE')}>Без лица</button>
          <button type="button" aria-pressed={scope === 'WITH_FACE'} disabled={readOnly || busy} onClick={() => give.mutate('WITH_FACE')}>С лицом</button>
        </div>
      )}
      <p className="hint small">
        {scope && consent.data?.givenAt
          ? `Отметил(а) ${consent.data.givenBy ?? 'сотрудник'}, ${shortDate(consent.data.givenAt)}. Отозвал — снимите галочку.`
          : 'Отдельно от согласия на обработку данных. Лучше — письменно или сообщением от пациента.'}
        {readOnly && ' Согласие отмечает врач.'}
      </p>
      {error && <p className="error" role="alert">{error.message}</p>}
      <div className="publication-action">
        <button type="button" className="btn" disabled={Boolean(why)} aria-describedby={why ? `ba-why-${patientId}` : undefined}
          onClick={() => setOpen(true)}>Собрать картинку «до / после»</button>
        {why && <span id={`ba-why-${patientId}`} className="hint small">{why}</span>}
      </div>
      {open && scope && <BeforeAfter patientId={patientId} files={files} scope={scope} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** Снимок «до» — самое раннее фото, «после» — самое позднее (список с сервера — от новых к старым). */
function defaults(files: FileView[]): [number, number] {
  const photos = files.filter((f) => f.kind === 'PHOTO')
  const pool = photos.length >= 2 ? photos : files
  return [pool[pool.length - 1]?.id ?? 0, pool[0]?.id ?? 0]
}

/** Снимок целиком → картинка для холста. createImageBitmap быстрее; где его нет — обычный <img>. */
async function picture(blob: Blob): Promise<Picture> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob)
  const img = new Image()
  img.src = URL.createObjectURL(blob)
  await img.decode()
  return img
}

type Side = 'before' | 'after'
type Drag = { side: Side; mode: 'move' | 'hide'; x: number; y: number; cx: number; cy: number }

/**
 * Конструктор «До / после»: два фото, раскладка и формат, подписи; кадр — перетаскиванием и
 * ползунком; «Скрыть глаза» — врач сам рисует прямоугольник (никакого распознавания лиц).
 * Готовая картинка — только в браузере: скачать PNG или «Поделиться»; на сервер не уходит.
 */
function BeforeAfter({ patientId, files, scope, onClose }: { patientId: number; files: FileView[]; scope: Scope; onClose: () => void }) {
  const close = useClose(onClose)
  const me = useMe().data
  const [ids, setIds] = useState<Record<Side, number>>(() => {
    const [before, after] = defaults(files)
    return { before, after }
  })
  const [images, setImages] = useState<Record<number, Picture>>({})
  const [shots, setShots] = useState<Record<Side, { crop: typeof FIT; hides: Box[] }>>({
    before: { crop: FIT, hides: [] }, after: { crop: FIT, hides: [] },
  })
  const myDoctor = me?.doctors?.find((d) => d.id === (me.doctorId ?? me.assistantOf?.[0]))?.fullName ?? ''
  const [design, setDesign] = useState<Design>({
    format: 'portrait', layout: 'side', procedure: '', doctor: myDoctor, clinic: me?.clinic?.brandName || me?.clinic?.name || '',
    watermark: true, dark: false, hideStyle: 'bar',
  })
  const [mode, setMode] = useState<'move' | 'hide'>(scope === 'NO_FACE' ? 'hide' : 'move')
  const [status, setStatus] = useState('')
  const takenOn = (id: number) => files.find((f) => f.id === id)?.takenOn
  const [duration, setDuration] = useState(() => durationBetween(takenOn(ids.before), takenOn(ids.after)))
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag | null>(null)
  const [draft, setDraft] = useState<{ side: Side; box: Box } | null>(null)
  const set = (patch: Partial<Design>) => setDesign((d) => ({ ...d, ...patch }))

  // Загрузить выбранные снимки целиком (миниатюры для картинки мало)
  useEffect(() => {
    let alive = true
    for (const id of [ids.before, ids.after]) {
      if (images[id]) continue
      fetchBlob(`/api/patients/${patientId}/files/${id}`).then(picture)
        .then((img) => alive && setImages((all) => ({ ...all, [id]: img })))
        .catch(() => alive && setStatus('Фото не открылось — выберите другое'))
    }
    return () => { alive = false }
  }, [ids, images, patientId])

  const before = images[ids.before]
  const after = images[ids.after]
  const shot = (side: Side): Shot | null => {
    const image = side === 'before' ? before : after
    if (!image) return null
    const hides = draft?.side === side ? [...shots[side].hides, draft.box] : shots[side].hides
    return { image, crop: shots[side].crop, hides }
  }

  useEffect(() => {
    const c = canvas.current
    const b = shot('before')
    const a = shot('after')
    if (!c || !b || !a) return
    const { w, h } = FORMATS[design.format]
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (ctx) drawBeforeAfter(ctx, design, b, a)
  })

  /** Точка указателя → пиксели холста (на экране он уменьшен стилями). */
  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const k = r.width ? e.currentTarget.width / r.width : 1
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }
  }
  const sideAt = (x: number, y: number): Side | null => {
    const f = frames(design)
    return inside(f.before, x, y) ? 'before' : inside(f.after, x, y) ? 'after' : null
  }
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = point(e)
    const side = sideAt(x, y)
    if (!side || !shot(side)) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { side, mode, x, y, ...shots[side].crop }
  }
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const g = drag.current
    const s = g && shot(g.side)
    if (!g || !s) return
    const { x, y } = point(e)
    const frame = frames(design)[g.side]
    const p = placement(frame, s.image, s.crop)
    if (g.mode === 'move') {
      const crop = clampCrop(frame, s.image, { zoom: s.crop.zoom, cx: g.cx - (x - g.x) / p.w, cy: g.cy - (y - g.y) / p.h })
      setShots((all) => ({ ...all, [g.side]: { ...all[g.side], crop } }))
    }
    else {
      setDraft({ side: g.side, box: boxFrom(toImage(p, g.x, g.y), toImage(p, x, y)) })
    }
  }
  const up = () => {
    const g = drag.current
    drag.current = null
    if (g?.mode === 'hide' && draft && draft.box.w > 0.01 && draft.box.h > 0.01) {
      setShots((all) => ({ ...all, [draft.side]: { ...all[draft.side], hides: [...all[draft.side].hides, draft.box] } }))
    }
    setDraft(null)
  }
  const zoom = (side: Side, value: number) => {
    const s = shot(side)
    if (!s) return
    setShots((all) => ({ ...all, [side]: { ...all[side], crop: clampCrop(frames(design)[side], s.image, { ...all[side].crop, zoom: value }) } }))
  }
  const pick = (side: Side, id: number) => {
    const next = { ...ids, [side]: id }
    setIds(next)
    setDuration(durationBetween(takenOn(next.before), takenOn(next.after)))
    setShots((all) => ({ ...all, [side]: { crop: FIT, hides: [] } }))
  }

  const blob = () => new Promise<Blob>((resolve, reject) => {
    const c = canvas.current
    if (!c) return reject(new Error('canvas'))
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png')
  })
  // В имени файла — ни имени пациента, ни номера карточки
  const fileName = `do-posle-${todayIn()}.png`
  const download = async () => {
    try {
      const url = URL.createObjectURL(await blob())
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setStatus('Картинка скачана')
    }
    catch {
      setStatus('Не получилось собрать картинку')
    }
  }
  const canShare = typeof navigator.canShare === 'function'
  const share = async () => {
    try {
      const file = new File([await blob()], fileName, { type: 'image/png' })
      if (!navigator.canShare?.({ files: [file] })) return void download()
      await navigator.share({ files: [file] })
    }
    catch (e) {
      // Закрыли окно «Поделиться» — это не ошибка
      if (!(e instanceof DOMException && e.name === 'AbortError')) setStatus('Не получилось поделиться — скачайте PNG')
    }
  }

  const services = me?.services ?? []
  const hidesCount = shots.before.hides.length + shots.after.hides.length
  const ready = Boolean(before && after)

  return createPortal(
    <div className="ba-root" role="dialog" aria-modal="true" aria-label="До / после">
      <div className="ba-panel">
        <header className="toolbar">
          <h2>До / после</h2>
          <button type="button" className="btn" onClick={close}>Закрыть</button>
        </header>
        {scope === 'NO_FACE' && (
          <p className="ba-warning" role="note">Согласие — только без лица: закройте глаза полосой («Скрыть глаза» — потяните прямоугольник по фото).</p>
        )}
        <div className="ba-body">
          <div className="ba-preview">
            <canvas ref={canvas} aria-label="Готовая картинка" className={mode === 'hide' ? 'hiding' : undefined}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
            {!ready && <p className="hint">Загружаем фото…</p>}
            <div className="segments" role="group" aria-label="Что делает палец по фото">
              <button type="button" aria-pressed={mode === 'move'} onClick={() => setMode('move')}>Двигать фото</button>
              <button type="button" aria-pressed={mode === 'hide'} onClick={() => setMode('hide')}>Скрыть глаза</button>
            </div>
          </div>
          <div className="ba-tools">
            {(['before', 'after'] as Side[]).map((side) => (
              <fieldset key={side} className="ba-pick">
                <legend>{side === 'before' ? 'Фото «до»' : 'Фото «после»'}</legend>
                <div className="ba-thumbs" role="group" aria-label={side === 'before' ? 'Фото до' : 'Фото после'}>
                  {files.map((f) => (
                    <button key={f.id} type="button" aria-pressed={ids[side] === f.id} onClick={() => pick(side, f.id!)}
                      aria-label={`${f.caption ?? 'Снимок'}${f.takenOn ? `, ${shortDate(`${f.takenOn}T12:00:00Z`)}` : ''}`}>
                      <Thumb path={`/api/patients/${patientId}/files/${f.id}?thumb=true`} alt="" />
                    </button>
                  ))}
                </div>
                <label className="field"><span>Масштаб</span>
                  <input type="range" min={1} max={3} step={0.05} value={shots[side].crop.zoom}
                    aria-label={side === 'before' ? 'Масштаб фото до' : 'Масштаб фото после'}
                    onChange={(e) => zoom(side, Number(e.target.value))} />
                </label>
                {shots[side].hides.length > 0 && (
                  <button type="button" className="link" onClick={() => setShots((all) => ({ ...all, [side]: { ...all[side], hides: [] } }))}>
                    Убрать полосы ({shots[side].hides.length})
                  </button>
                )}
              </fieldset>
            ))}
            <div className="segments wrap" role="group" aria-label="Формат">
              {(Object.keys(FORMATS) as Format[]).map((f) => (
                <button key={f} type="button" aria-pressed={design.format === f}
                  onClick={() => set({ format: f, layout: f === 'story' ? 'stack' : design.layout })}>{FORMATS[f].label}</button>
              ))}
            </div>
            <div className="segments" role="group" aria-label="Раскладка">
              <button type="button" aria-pressed={design.layout === 'side'} onClick={() => set({ layout: 'side' })}>Рядом</button>
              <button type="button" aria-pressed={design.layout === 'stack'} onClick={() => set({ layout: 'stack' })}>Сверху и снизу</button>
            </div>
            {services.length > 0 && (
              <Select aria-label="Процедура из услуг" value="" onChange={(e) => e.target.value && set({ procedure: e.target.value })}>
                <option value="">Процедура из услуг…</option>
                {services.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </Select>
            )}
            <label className="field"><span>Процедура</span>
              <input value={design.procedure} maxLength={60} placeholder="Например, отбеливание" onChange={(e) => set({ procedure: e.target.value })} />
            </label>
            <label className="field"><span>Врач</span>
              <input value={design.doctor} maxLength={60} onChange={(e) => set({ doctor: e.target.value })} />
            </label>
            <label className="field"><span>Клиника</span>
              <input value={design.clinic} maxLength={60} onChange={(e) => set({ clinic: e.target.value })} />
            </label>
            {hidesCount > 0 && (
              <div className="segments" role="group" aria-label="Как скрыть">
                <button type="button" aria-pressed={design.hideStyle === 'bar'} onClick={() => set({ hideStyle: 'bar' })}>Чёрная полоса</button>
                <button type="button" aria-pressed={design.hideStyle === 'pixel'} onClick={() => set({ hideStyle: 'pixel' })}>Мозаика</button>
              </div>
            )}
            <label className="check"><input type="checkbox" checked={design.dark} onChange={(e) => set({ dark: e.target.checked })} /> <span>Тёмный фон</span></label>
            <label className="check"><input type="checkbox" checked={design.watermark} onChange={(e) => set({ watermark: e.target.checked })} /> <span>Подпись «сделано в Tish»</span></label>
          </div>
        </div>
        <PostText procedure={design.procedure} duration={duration} onDuration={setDuration} doctor={design.doctor} clinic={design.clinic} />
        <footer className="actions">
          <button type="button" className="btn primary" disabled={!ready} onClick={() => void download()}>Скачать PNG</button>
          {canShare && <button type="button" className="btn" disabled={!ready} onClick={() => void share()}>Поделиться</button>}
          {status && <span role="status" className="hint">{status}</span>}
        </footer>
        <p className="hint small">Картинка собирается на этом устройстве и на сервер не сохраняется.</p>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Готовый текст для описания поста — по шаблону (три варианта), без ИИ. Пациента в нём нет:
 * на входе только работа, сроки, врач и клиника. Текст можно поправить и скопировать.
 */
function PostText({ procedure, duration, onDuration, doctor, clinic }: {
  procedure: string; duration: string; onDuration: (v: string) => void; doctor: string; clinic: string
}) {
  const me = useMe().data
  const c = me?.clinic
  const phone = c?.phones?.[0] ?? c?.whatsappPhone
  const [style, setStyle] = useState<PostStyle>('full')
  // Своя правка держится, пока не выбрали другой вариант или «Собрать заново»
  const [own, setOwn] = useState<string | null>(null)
  const [copied, setCopied] = useState('')
  const text = own ?? buildPost(style, {
    procedure, duration, doctor, clinic, address: c?.address, phone: phone ? formatPhone(phone) : null,
    bookingUrl: c?.code ? `${window.location.origin}/c/${c.code}` : null,
  })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('Текст скопирован')
    }
    catch {
      setCopied('Не получилось скопировать — выделите текст и скопируйте вручную')
    }
  }
  return (
    <section className="ba-post" aria-label="Текст для поста">
      <h3>Текст для поста</h3>
      <div className="ba-post-row">
        <div className="segments" role="group" aria-label="Вариант текста">
          {POST_STYLES.map(([k, name]) => (
            <button key={k} type="button" aria-pressed={style === k} onClick={() => { setStyle(k); setOwn(null) }}>{name}</button>
          ))}
        </div>
        <label className="field"><span>Сколько заняло</span>
          <input value={duration} maxLength={40} placeholder="Например, 2 визита" onChange={(e) => onDuration(e.target.value)} />
        </label>
      </div>
      <textarea aria-label="Текст поста" rows={10} maxLength={2200} value={text} onChange={(e) => setOwn(e.target.value)} />
      <div className="actions">
        <button type="button" className="btn" onClick={() => void copy()}>Скопировать текст</button>
        {own != null && <button type="button" className="link" onClick={() => setOwn(null)}>Собрать заново</button>}
        {copied && <span role="status" className="hint">{copied}</span>}
      </div>
    </section>
  )
}
