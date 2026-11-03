/**
 * Картинка «До / после» для соцсетей — рисуется в браузере на <canvas>, на сервер не уходит.
 * Здесь только геометрия и рисование, без React: так их легко проверить и переиспользовать.
 *
 * Координаты: холст — в пикселях готовой картинки (ширина 1080, как любит Instagram). Кадр фото
 * (crop) и закрытые области (hides) — в долях самого снимка (0…1): двигаешь или увеличиваешь фото —
 * полоса на глазах едет вместе с ним и не открывает лицо.
 */

export type Format = 'post' | 'portrait' | 'story'

export const FORMATS: Record<Format, { w: number; h: number; label: string }> = {
  post: { w: 1080, h: 1080, label: 'Пост 1:1' },
  portrait: { w: 1080, h: 1350, label: 'Пост 4:5' },
  story: { w: 1080, h: 1920, label: 'Сторис 9:16' },
}

/** side — рядом (слева «до»), stack — сверху «до», снизу «после» */
export type Layout = 'side' | 'stack'

/** Прямоугольник: на холсте — в пикселях, у закрытой области — в долях снимка. */
export type Box = { x: number; y: number; w: number; h: number }

/** zoom ≥ 1 — во сколько раз крупнее «заполнить рамку»; cx, cy — какая точка снимка в центре рамки. */
export type Crop = { zoom: number; cx: number; cy: number }

export const FIT: Crop = { zoom: 1, cx: 0.5, cy: 0.5 }

export type Picture = CanvasImageSource & { width: number; height: number }

export type Shot = { image: Picture; crop: Crop; hides: Box[] }

/** bar — чёрная полоса (надёжно), pixel — крупная мозаика */
export type HideStyle = 'bar' | 'pixel'

export type Design = {
  format: Format
  layout: Layout
  procedure: string
  doctor: string
  clinic: string
  /** Маленькая подпись «сделано в Tish» в углу */
  watermark: boolean
  dark: boolean
  hideStyle: HideStyle
}

const PAD = 48
const GAP = 16

/** Где на холсте шапка (процедура), две рамки фото и подвал (врач, клиника). */
export function frames(d: Pick<Design, 'format' | 'layout' | 'procedure'>): { before: Box; after: Box; header: Box; footer: Box } {
  const { w, h } = FORMATS[d.format]
  const tall = d.format === 'story'
  const headerH = d.procedure.trim() ? (tall ? 200 : 120) : PAD
  const footerH = tall ? 220 : 130
  const area: Box = { x: PAD, y: headerH, w: w - 2 * PAD, h: h - headerH - footerH }
  const header: Box = { x: PAD, y: 0, w: w - 2 * PAD, h: headerH }
  const footer: Box = { x: PAD, y: h - footerH, w: w - 2 * PAD, h: footerH }
  if (d.layout === 'side') {
    const half = (area.w - GAP) / 2
    return { header, footer, before: { ...area, w: half }, after: { ...area, x: area.x + half + GAP, w: half } }
  }
  const half = (area.h - GAP) / 2
  return { header, footer, before: { ...area, h: half }, after: { ...area, y: area.y + half + GAP, h: half } }
}

/** Где на холсте рисуется весь снимок, чтобы он закрыл рамку (как object-fit: cover) с учётом кадра. */
export function placement(frame: Box, image: { width: number; height: number }, crop: Crop): Box {
  const scale = Math.max(frame.w / image.width, frame.h / image.height) * crop.zoom
  const w = image.width * scale
  const h = image.height * scale
  return { x: frame.x + frame.w / 2 - crop.cx * w, y: frame.y + frame.h / 2 - crop.cy * h, w, h }
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** Кадр, при котором в рамке нет пустых полос: центр не уезжает дальше края снимка. */
export function clampCrop(frame: Box, image: { width: number; height: number }, crop: Crop): Crop {
  const zoom = clamp(crop.zoom, 1, 4)
  const p = placement(frame, image, { ...crop, zoom })
  const hx = frame.w / 2 / p.w
  const hy = frame.h / 2 / p.h
  return { zoom, cx: clamp(crop.cx, hx, 1 - hx), cy: clamp(crop.cy, hy, 1 - hy) }
}

/** Фото и где на нём улыбка (доли снимка — так отвечает «✨ Подогнать кадр»). */
export type SmileShot = { frame: Box; image: { width: number; height: number }; smile: Box }

/**
 * Кадр «до» и «после» так, чтобы улыбки были одного размера и в одном месте рамки: ширина улыбки — около
 * 70 % рамки (но по высоте не больше 80 %), центр улыбки — в центре рамки. Одна общая доля на оба фото:
 * если одну улыбку крупнее не сделать (масштаб упёрся в 1 или maxZoom) — вторую подстраиваем под неё.
 * Сами фото не меняются — только кадр, его можно поправить руками.
 */
export function fitSmiles(shots: [SmileShot, SmileShot], maxZoom = 3): [Crop, Crop] {
  // Размер улыбки в долях рамки при zoom = 1
  const at1 = shots.map(({ frame, image, smile }) => {
    const base = Math.max(frame.w / image.width, frame.h / image.height)
    return { w: (smile.w * image.width * base) / frame.w, h: (smile.h * image.height * base) / frame.h }
  })
  let t = 0.7
  for (const a of at1) t = Math.min(t, (0.8 * a.w) / a.h)
  for (const a of at1) t = Math.max(t, a.w)
  for (const a of at1) t = Math.min(t, a.w * maxZoom)
  const crop = (i: 0 | 1): Crop => {
    const { frame, image, smile } = shots[i]
    const zoom = clamp(t / at1[i]!.w, 1, maxZoom)
    return clampCrop(frame, image, { zoom, cx: smile.x + smile.w / 2, cy: smile.y + smile.h / 2 })
  }
  return [crop(0), crop(1)]
}

/** Точка холста → доли снимка (для закрытых областей). */
export function toImage(p: Box, x: number, y: number): { u: number; v: number } {
  return { u: (x - p.x) / p.w, v: (y - p.y) / p.h }
}

/** Прямоугольник из двух углов (тянуть можно в любую сторону), обрезанный по снимку. */
export function boxFrom(a: { u: number; v: number }, b: { u: number; v: number }): Box {
  const x1 = clamp(Math.min(a.u, b.u), 0, 1)
  const y1 = clamp(Math.min(a.v, b.v), 0, 1)
  const x2 = clamp(Math.max(a.u, b.u), 0, 1)
  const y2 = clamp(Math.max(a.v, b.v), 0, 1)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export function inside(b: Box, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
}

const INK = { light: { bg: '#FFFFFF', text: '#0F2A30', muted: '#4C6268', faint: '#75898E' }, dark: { bg: '#0F2A30', text: '#FFFFFF', muted: '#C8D3D5', faint: '#9AAEB2' } }
const DISPLAY = 'Geologica, "Golos Text", system-ui, sans-serif'
const BODY = '"Golos Text", system-ui, sans-serif'
const PRIMARY = '#0E8A80'

function roundRect(ctx: CanvasRenderingContext2D, b: Box, r: number) {
  ctx.beginPath()
  ctx.moveTo(b.x + r, b.y)
  ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, r)
  ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, r)
  ctx.arcTo(b.x, b.y + b.h, b.x, b.y, r)
  ctx.arcTo(b.x, b.y, b.x + b.w, b.y, r)
  ctx.closePath()
}

/** Длинный текст — с многоточием, чтобы не вылез за край. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  let t = text
  while (t.length > 1 && ctx.measureText(t).width > max) t = t.slice(0, -2) + '…'
  return t
}

/**
 * Закрыть область: чёрная полоса или мозаика из ~6 крупных квадратов по длинной стороне —
 * глаза по ней не узнать. Без ctx.filter: он есть не во всех браузерах (Safari).
 */
function hide(ctx: CanvasRenderingContext2D, shot: Shot, p: Box, b: Box, style: HideStyle, makeCanvas: () => HTMLCanvasElement) {
  const r = { x: p.x + b.x * p.w, y: p.y + b.y * p.h, w: b.w * p.w, h: b.h * p.h }
  if (r.w < 1 || r.h < 1) return
  if (style === 'bar') {
    ctx.fillStyle = '#000000'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    return
  }
  const k = 6 / Math.max(r.w, r.h)
  const tmp = makeCanvas()
  tmp.width = Math.max(1, Math.round(r.w * k))
  tmp.height = Math.max(1, Math.round(r.h * k))
  const t = tmp.getContext('2d')
  if (!t) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    return
  }
  const { width, height } = shot.image
  t.drawImage(shot.image, b.x * width, b.y * height, b.w * width, b.h * height, 0, 0, tmp.width, tmp.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tmp, r.x, r.y, r.w, r.h)
  ctx.imageSmoothingEnabled = true
}

function photo(ctx: CanvasRenderingContext2D, frame: Box, shot: Shot, label: string, accent: string, d: Design,
  makeCanvas: () => HTMLCanvasElement) {
  const p = placement(frame, shot.image, shot.crop)
  ctx.save()
  roundRect(ctx, frame, 24)
  ctx.clip()
  ctx.drawImage(shot.image, p.x, p.y, p.w, p.h)
  for (const b of shot.hides) hide(ctx, shot, p, b, d.hideStyle, makeCanvas)
  // Подпись «ДО» / «ПОСЛЕ» — плашкой в левом верхнем углу рамки
  ctx.font = `600 34px ${DISPLAY}`
  const tw = ctx.measureText(label).width
  const pill = { x: frame.x + 20, y: frame.y + 20, w: tw + 44, h: 58 }
  ctx.fillStyle = accent
  roundRect(ctx, pill, 29)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(label, pill.x + 22, pill.y + pill.h / 2 + 1)
  ctx.restore()
}

/** Нарисовать всю картинку. makeCanvas — для мозаики (в тестах подменяется). */
export function drawBeforeAfter(ctx: CanvasRenderingContext2D, d: Design, before: Shot, after: Shot,
  makeCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')) {
  const { w, h } = FORMATS[d.format]
  const ink = d.dark ? INK.dark : INK.light
  const f = frames(d)
  ctx.save()
  ctx.fillStyle = ink.bg
  ctx.fillRect(0, 0, w, h)

  const procedure = d.procedure.trim()
  if (procedure) {
    ctx.fillStyle = ink.text
    ctx.font = `600 ${d.format === 'story' ? 64 : 52}px ${DISPLAY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(fit(ctx, procedure, f.header.w), w / 2, f.header.y + f.header.h / 2 + 4)
  }

  photo(ctx, f.before, before, 'ДО', 'rgba(15, 42, 48, 0.78)', d, makeCanvas)
  photo(ctx, f.after, after, 'ПОСЛЕ', PRIMARY, d, makeCanvas)

  // Подвал: врач крупнее, клиника — под ним; «сделано в Tish» — мелко справа
  const doctor = d.doctor.trim()
  const clinic = d.clinic.trim()
  const mid = f.footer.y + f.footer.h / 2
  const textW = f.footer.w - (d.watermark ? 260 : 0)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  if (doctor) {
    ctx.fillStyle = ink.text
    ctx.font = `600 38px ${DISPLAY}`
    ctx.fillText(fit(ctx, doctor, textW), f.footer.x, clinic ? mid - 24 : mid)
  }
  if (clinic) {
    ctx.fillStyle = ink.muted
    ctx.font = `400 30px ${BODY}`
    ctx.fillText(fit(ctx, clinic, textW), f.footer.x, doctor ? mid + 26 : mid)
  }
  if (d.watermark) {
    ctx.fillStyle = ink.faint
    ctx.font = `400 22px ${BODY}`
    ctx.textAlign = 'right'
    ctx.fillText('сделано в Tish', f.footer.x + f.footer.w, f.footer.y + f.footer.h - 32)
  }
  ctx.restore()
}
