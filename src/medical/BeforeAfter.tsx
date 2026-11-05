import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'

import { api, ApiError, fetchBlob, unwrap, upload, type Schemas } from '../api/client'
import { useMe } from '../api/me'
import { Select } from '../layout/Select'
import { formatPhone } from '../lib/phone'
import { useClose } from '../lib/useClose'
import { openLink } from '../lib/telegram'
import { shortDate, todayIn } from '../lib/time'
import {
  boxFrom, clampCrop, drawBeforeAfter, FIT, fitSmiles, FORMATS, frames, inside, placement, toImage,
  type Box, type Design, type Format, type Picture, type Shot,
} from './beforeAfterDraw'
import { COMPOSITE, isComposite } from './composite'
import { buildPost, chatGptUrl, durationBetween, POST_STYLES, type PostStyle } from './postText'
import { Thumb } from './Thumb'
import { resizePhoto } from './thumb'
import './beforeAfter.css'

type FileView = Schemas['PatientFilesView']
type Consent = Schemas['PublicationConsentsView']
type Scope = NonNullable<Consent['scope']>
type AiStyle = NonNullable<Schemas['BeforeAfterAiTextRequest']['style']>
type AiLang = NonNullable<Schemas['BeforeAfterAiTextRequest']['lang']>

const AI_STYLE: Record<PostStyle, AiStyle> = { short: 'SHORT', full: 'FULL', emoji: 'EMOJI' }

/** «ИИ для постов» клиники (Настройки → ИИ-помощник): on — и ключ на сервере, и клиника включила. */
function usePostAi() {
  return useQuery({ queryKey: ['post-ai'], queryFn: () => unwrap(api.GET('/api/clinic/post-ai')), staleTime: 60_000 }).data?.on === true
}

/**
 * Согласие на публикацию фото и кнопка «Собрать картинку «до / после»» — в блоке снимков медкарты. Согласие
 * отдельное от согласия на обработку данных; ставит и снимает врач (и админ), ассистент только
 * видит. Без согласия собрать картинку нельзя.
 */
export function PublicationBlock({ patientId, files: all, readOnly }: { patientId: number; files: FileView[]; readOnly: boolean }) {
  const client = useQueryClient()
  // Готовые «до / после» — сами в «Снимках и фото»: исходными фото для новой картинки они не считаются
  const files = all.filter((f) => !isComposite(f))
  const made = all.length - files.length
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
      <h4>Собрать картинку «до / после»</h4>
      {/* Как это работает — по шагам, с отметкой сделанного: без ИИ, из ваших же фото */}
      <ol className="ba-steps">
        <li className={files.length >= 2 ? 'done' : undefined}>Загрузите выше фото «до» (перед лечением) и «после» (в конце){files.length >= 2 ? ' ✓' : ''}</li>
        <li className={scope ? 'done' : undefined}>Отметьте согласие пациента на публикацию{scope ? ' ✓' : ''}</li>
        <li className={made ? 'done' : undefined}>«Собрать картинку»: выберите фото, пост или сторис, при необходимости закройте глаза — скачайте картинку и скопируйте готовый текст поста{made ? ` ✓ готово: ${made} — в «Снимках и фото» с подписью «${COMPOSITE}»` : ''}</li>
      </ol>
      <p className="hint small">ИИ не меняет фото — только подбирает кадр и пишет текст. Картинка собирается из ваших фото прямо на телефоне.</p>
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
 * Если клиника включила «ИИ для постов» — «✨ Подогнать кадр»: сервер отправляет в ИИ уменьшенные
 * копии двух выбранных фото и получает, где на них улыбка; фото ИИ не меняет, только кадр.
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
  const aiOn = usePostAi()
  const fit = useMutation<Schemas['BeforeAfterAiFrames'], ApiError, void>({
    mutationFn: () => unwrap(api.POST('/api/patients/{patientId}/before-after/ai-frame', {
      params: { path: { patientId } }, body: { beforeFileId: ids.before, afterFileId: ids.after },
    })),
    onMutate: () => setStatus(''),
    onSuccess: (found) => {
      const b = images[ids.before]
      const a = images[ids.after]
      if (!b || !a || !found.before || !found.after) return
      const f = frames(design)
      const box = (r: Schemas['BeforeAfterAiRect']): Box => ({ x: r.x ?? 0, y: r.y ?? 0, w: r.w ?? 0, h: r.h ?? 0 })
      const [cb, ca] = fitSmiles([
        { frame: f.before, image: b, smile: box(found.before) },
        { frame: f.after, image: a, smile: box(found.after) },
      ])
      setShots((all) => ({ before: { ...all.before, crop: cb }, after: { ...all.after, crop: ca } }))
      setStatus('Кадр подогнан — при необходимости подвиньте фото пальцем')
    },
    onError: (e) => setStatus(e.message || 'Не удалось подогнать кадр — подвиньте его вручную'),
  })

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
  // Скачали или поделились — картинка сама сохраняется в «Снимки и фото» пациента: вышли из
  // приложения и вернулись — она там, собирать заново не нужно. Одна копия на каждую версию картинки
  const client = useQueryClient()
  const version = JSON.stringify([ids, shots, design])
  const savedVersion = useRef<string | null>(null)
  // Текст поста — вместе с картинкой (V153); поправили и «Скопировать» — обновляем сохранённый
  const postText = useRef('')
  const savedFile = useRef<number | null>(null)
  const updatePost = (text: string) => {
    if (savedFile.current == null) return
    void api.PUT('/api/patients/{patientId}/files/{fileId}/post-text', {
      params: { path: { patientId, fileId: savedFile.current } }, body: { text },
    }).then(() => client.invalidateQueries({ queryKey: ['files', patientId] }))
  }
  const keep = async (png: Blob) => {
    if (savedVersion.current === version) return
    savedVersion.current = version
    try {
      const file = new File([png], fileName, { type: 'image/png' })
      const form = new FormData()
      form.append('file', file, fileName)
      form.append('thumb', await resizePhoto(file, 400, 0.8), 'thumb.jpg')
      form.append('kind', 'OTHER')
      form.append('caption', COMPOSITE)
      form.append('takenOn', todayIn())
      if (postText.current.trim()) form.append('postText', postText.current.trim())
      const saved = await upload<FileView>(`/api/patients/${patientId}/files`, form)
      savedFile.current = saved.id ?? null
      void client.invalidateQueries({ queryKey: ['files', patientId] })
      setStatus((s) => `${s ? `${s} · ` : ''}сохранено в «Снимки и фото»`)
    }
    catch {
      savedVersion.current = null
      setStatus((s) => `${s ? `${s} · ` : ''}в медкарту не сохранилось — попробуйте ещё раз`)
    }
  }
  const download = async () => {
    try {
      const png = await blob()
      const url = URL.createObjectURL(png)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setStatus('Картинка скачана')
      void keep(png)
    }
    catch {
      setStatus('Не получилось собрать картинку')
    }
  }
  const canShare = typeof navigator.canShare === 'function'
  const share = async () => {
    try {
      const png = await blob()
      const file = new File([png], fileName, { type: 'image/png' })
      if (!navigator.canShare?.({ files: [file] })) return void download()
      void keep(png)
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
            {aiOn && (
              <button type="button" className="btn" disabled={!ready || fit.isPending} onClick={() => fit.mutate()}>
                {fit.isPending ? 'Ищем улыбку…' : '✨ Подогнать кадр'}
              </button>
            )}
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
        <PostText patientId={patientId} aiOn={aiOn} procedure={design.procedure} duration={duration} onDuration={setDuration}
          onText={(t) => { postText.current = t }} onCopied={updatePost}
          doctor={design.doctor} clinic={design.clinic} />
        <footer className="actions">
          <button type="button" className="btn primary" disabled={!ready} onClick={() => void download()}>Скачать PNG</button>
          {canShare && <button type="button" className="btn" disabled={!ready} onClick={() => void share()}>Поделиться</button>}
          {status && <span role="status" className="hint">{status}</span>}
        </footer>
        <p className="hint small">Картинка собирается на этом устройстве. Скачали или поделились — копия сохранится в «Снимки и фото» пациента (подпись «{COMPOSITE}»), собирать заново не придётся.</p>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Готовый текст для описания поста — по шаблону (три варианта); если клиника включила ИИ — ещё
 * «✨ Написать с ИИ» в том же варианте и на выбранном языке. Пациента в нём нет: на входе только
 * работа, сроки, врач и клиника (адрес, телефон и ссылку сервер дописывает сам, ИИ их не видит).
 * Текст можно поправить и скопировать.
 */
function PostText({ patientId, aiOn, procedure, duration, onDuration, doctor, clinic, onText, onCopied }: {
  patientId: number; aiOn: boolean; procedure: string; duration: string; onDuration: (v: string) => void; doctor: string; clinic: string
  /** Текущий текст — его сохранят вместе с картинкой */
  onText?: (text: string) => void
  /** Скопировали — обновить текст у уже сохранённой картинки */
  onCopied?: (text: string) => void
}) {
  const me = useMe().data
  const c = me?.clinic
  const phone = c?.phones?.[0] ?? c?.whatsappPhone
  const [style, setStyle] = useState<PostStyle>('full')
  // Своя правка держится, пока не выбрали другой вариант или «Собрать заново»
  const [own, setOwn] = useState<string | null>(null)
  const [copied, setCopied] = useState('')
  const [lang, setLang] = useState<AiLang>('RU')
  // Текст в поле — от ИИ: тогда «Другой вариант» просит написать иначе
  const [fromAi, setFromAi] = useState(false)
  const facts = {
    procedure, duration, doctor, clinic, address: c?.address, phone: phone ? formatPhone(phone) : null,
    bookingUrl: c?.code ? `${window.location.origin}/c/${c.code}` : null,
  }
  const text = own ?? buildPost(style, facts)
  useEffect(() => { onText?.(text) }, [text, onText])
  const write = useMutation<Schemas['BeforeAfterAiPostText'], ApiError, string | undefined>({
    mutationFn: (previous) => unwrap(api.POST('/api/patients/{patientId}/before-after/ai-text', {
      params: { path: { patientId } },
      body: {
        procedure: procedure.trim(), duration: duration.trim(), style: AI_STYLE[style], lang, doctor: doctor.trim(), clinic: clinic.trim(),
        address: facts.address ?? undefined, phone: facts.phone ?? undefined, bookingUrl: facts.bookingUrl ?? undefined, previous,
      },
    })),
    onMutate: () => setCopied(''),
    onSuccess: (r) => {
      if (!r.text) return
      setOwn(r.text)
      setFromAi(true)
    },
  })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('Текст скопирован')
      onCopied?.(text)
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
            <button key={k} type="button" aria-pressed={style === k} onClick={() => { setStyle(k); setOwn(null); setFromAi(false) }}>{name}</button>
          ))}
        </div>
        <label className="field"><span>Сколько заняло</span>
          <input value={duration} maxLength={40} placeholder="Например, 2 визита" onChange={(e) => onDuration(e.target.value)} />
        </label>
      </div>
      {aiOn && (
        <div className="ba-post-row">
          <div className="segments" role="group" aria-label="Язык текста ИИ">
            <button type="button" aria-pressed={lang === 'RU'} onClick={() => setLang('RU')}>Русский</button>
            <button type="button" aria-pressed={lang === 'KY'} onClick={() => setLang('KY')}>Кыргызча</button>
          </div>
          <button type="button" className="btn" disabled={write.isPending || !procedure.trim()}
            title={procedure.trim() ? undefined : 'Сначала укажите процедуру'}
            onClick={() => write.mutate(fromAi ? text : undefined)}>
            {write.isPending ? 'ИИ пишет…' : fromAi ? '✨ Другой вариант' : '✨ Написать с ИИ'}
          </button>
          {!procedure.trim() && <span className="hint small">Укажите процедуру — ИИ пишет о ней.</span>}
        </div>
      )}
      {write.error && <p className="error small" role="alert">{write.error.message}</p>}
      <textarea aria-label="Текст поста" rows={10} maxLength={2200} value={text} onChange={(e) => setOwn(e.target.value)} />
      {fromAi && own != null && <p className="hint small">Текст написал ИИ — проверьте перед публикацией: без обещаний и с верными фактами.</p>}
      <div className="actions">
        <button type="button" className="btn" onClick={() => void copy()}>Скопировать текст</button>
        {/* Бесплатная альтернатива нашему ИИ: ChatGPT в браузере с готовой просьбой и этим текстом */}
        <button type="button" className="btn" onClick={() => openLink(chatGptUrl(text))}
          title="Откроется ChatGPT с готовой просьбой улучшить этот текст — потом скопируйте ответ сюда">💬 Улучшить в ChatGPT</button>
        {own != null && <button type="button" className="link" onClick={() => { setOwn(null); setFromAi(false) }}>Собрать заново</button>}
        {copied && <span role="status" className="hint">{copied}</span>}
      </div>
    </section>
  )
}
