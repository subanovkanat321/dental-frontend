// Кадры и ролики для презентаций «Для пациента» (src/learn) — из нашего 3D-атласа (src/atlas), без стоков.
//   node scripts/learn-art.mjs                — всё: кадры WebP (640 и 1280 px) и ролики webm + mp4 в public/content/learn/,
//                                               точки подписей — в src/learn/shots.gen.ts
//   LEARN_ART=caries,filling node scripts/…   — только эти (по началу имени); shots.gen.ts дополняется, не теряя остальных
//   LEARN_ART_DRAFT=1 …                       — только PNG-черновики кадров в LEARN_ART_TMP (подобрать камеру)
//   LEARN_ART_URL=http://localhost:5173 …     — взять уже запущенный vite dev (иначе скрипт поднимает свой на :5199)
// Как работает: vite dev отдаёт служебную страницу tools/learn-art/index.html — один холст атласа без интерфейса.
// Скрипт ставит сцену (режим, стадия, камера) и время ролика, страница отдаёт PNG холста с прозрачным фоном
// и где на нём точки частей (эмаль, пульпа…). Chromium без видеокарты рисует WebGL программно (SwiftShader):
// медленно, но кадр зависит только от времени сцены. PNG → ffmpeg: WebP с прозрачностью; кадры роликов
// кладутся на цвет «пластины» слайда (#f4f7f7) → VP9 и H.264. Временные файлы удаляются.
// Playwright: из node_modules фронта, иначе из соседнего бэкенда (../dental/e2e) или PLAYWRIGHT_MODULE.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public/content/learn')
const GEN = path.join(ROOT, 'src/learn/shots.gen.ts')
const TMP = process.env.LEARN_ART_TMP || fs.mkdtempSync(path.join(os.tmpdir(), 'learn-art-'))
const ONLY = process.env.LEARN_ART ? process.env.LEARN_ART.split(',') : null
const DRAFT = !!process.env.LEARN_ART_DRAFT
/** Цвет пластины под рисунком слайда (.lsn-art в learn.css): фон роликов — в нём, без шва. */
const PLATE = '0xf4f7f7'
const FPS = 24

/** Камера: смотрим на target с направления атласа (спереди-справа-сверху, видны обе плоскости среза). */
const DIR = norm([2.65, 1.78, 5.0])
function norm(v) { const l = Math.hypot(...v); return v.map((x) => x / l) }
const cam = (target, dist, fov, dir = DIR) => ({ target, pos: target.map((t, i) => t + dir[i] * dist), fov })

/** Кадрирование: размер страницы (CSS px, ×2 — плотность) и камера. */
const FRAMES = {
  // Зуб в разрезе целиком: коронка, корни, кость, десна
  tooth: { w: 800, h: 960, ...cam([0.1, -0.62, 0], 5.0, 42) },
  // То же, но выше: коронка или части импланта ещё над зубом
  tall: { w: 800, h: 960, ...cam([0.1, -0.12, 0], 6.4, 42) },
  // Коронка крупно — стадии кариеса в карточках (на целом зубе мелкая точка не видна)
  crown: { w: 800, h: 640, ...cam([0.05, -0.05, 0], 2.7, 30) },
  // Зуб мудрости: участок челюсти сбоку
  wisdom: { w: 900, h: 640, target: [0.5, -0.75, 0], pos: [0.5, 0.15, 6.6], fov: 30 },
}

/**
 * Кадры: имя файла, кадрирование, сцена, время ролика t (с). Только те, что показывают слайды (topics.tsx);
 * конец роликов каналов и коронки — их постеры. Метки частей пишутся в shots.gen.ts для всех кадров зуба —
 * какие показать, решает слайд.
 */
const SHOTS = [
  { name: 'healthy', frame: 'tooth', set: { view: 'tooth', mode: 'healthy' } },
  // Кариес в дентине и до пульпы — целым зубом (слайды «что это»); все четыре стадии — крупно, для карточек
  ...[2, 3].map((s) => ({ name: `caries-${s + 1}`, frame: 'tooth', set: { view: 'tooth', mode: 'caries', stage: s } })),
  ...[0, 1, 2, 3].map((s) => ({ name: `caries-${s + 1}-close`, frame: 'crown', set: { view: 'tooth', mode: 'caries', stage: s } })),
  { name: 'filling', frame: 'tooth', set: { view: 'tooth', mode: 'filling' }, t: 5.4 },
  // Коронка ещё над зубом: точка подписи — где она в момент t (сдвиг по формулам ролика в engine/toothScene.ts)
  { name: 'crown-fit', frame: 'tall', set: { view: 'tooth', mode: 'crown', extra: { crown: [0.45, 1.25, 0] } }, t: 1.75 },
  { name: 'implant-parts', frame: 'tall', set: { view: 'tooth', mode: 'implant', extra: { crown: [0.4, 1.6, 0] } }, t: 4.3 },
  { name: 'implant', frame: 'tooth', set: { view: 'tooth', mode: 'implant' }, t: 5.6 },
  { name: 'wisdom', frame: 'wisdom', set: { view: 'wisdom', wisdom: 'mesial' }, t: 1.5, noLabels: true },
]

/**
 * Ролики: ролик режима атласа (TIMELINE в engine/toothScene.ts) от from до to секунд (кадрирование — frame,
 * по умолчанию зуб целиком), speed — ускорение,
 * hold — сколько секунд стоять на последнем кадре перед повтором. Постер — последний кадр (WebP).
 */
const CLIPS = [
  // Пломба — коронка крупно: на целом зубе полость мелкая, слоёв не видно
  { name: 'filling-clip', frame: 'crown', mode: 'filling', from: 0.6, to: 4.8, speed: 1, hold: 0.8 },
  { name: 'canals-clip', mode: 'endo', from: 0.2, to: 7.8, speed: 1.6, hold: 0.8 },
  // Коронка опускается сверху — кадр выше, чтобы её было видно с начала
  { name: 'crown-clip', frame: 'tall', mode: 'crown', from: 0.8, to: 2.8, speed: 0.8, hold: 1.2 },
  { name: 'implant-clip', mode: 'implant', from: 0.4, to: 5.2, speed: 1.15, hold: 0.8 },
]
const CLIP_W = 640

const pick = (list) => list.filter((s) => !ONLY || ONLY.some((o) => s.name.startsWith(o)))
const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] })

async function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_MODULE, 'playwright', path.resolve(ROOT, '../dental/e2e/node_modules/playwright/index.mjs')].filter(Boolean)
  for (const t of tries) {
    try { return await import(t) } catch { /* следующий */ }
  }
  throw new Error('Нет Playwright: npm i -D playwright или PLAYWRIGHT_MODULE=…/playwright/index.mjs')
}

async function startVite() {
  if (process.env.LEARN_ART_URL) return { url: process.env.LEARN_ART_URL, stop: () => undefined }
  const port = 5199
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], detached: true })
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('Local')) resolve() })
    proc.on('exit', (code) => reject(new Error(`vite завершился: ${code}`)))
  })
  return { url: `http://localhost:${port}`, stop: () => { try { process.kill(-proc.pid) } catch { /* уже нет */ } } }
}

async function openPage(browser, url, frame) {
  const page = await browser.newPage({ viewport: { width: frame.w, height: frame.h }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.error('  страница:', e.message))
  // Движок на «слабом» устройстве (мало ядер) берёт плотность 1,5 — для кадров нужна полная
  await page.addInitScript(() => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }))
  await page.goto(`${url}/tools/learn-art/index.html`)
  await page.waitForFunction(() => window.shot)
  await settle(page)
  return page
}

const advance = (page, ms) => page.evaluate((ms) => window.shot.advance(ms), ms)

/** Дождаться, пока движок построит сетки режима (Web Worker). */
async function settle(page) {
  // Сетки строит Web Worker в настоящем времени: ждём по 50 мс, время сцены идёт так же
  for (let i = 0; i < 2400; i++) {
    await advance(page, 50)
    await new Promise((r) => setTimeout(r, 50))
    const { loading, error } = await page.evaluate(() => ({ loading: window.shot.loading(), error: window.shot.error() }))
    if (error) throw new Error(error)
    if (!loading) return
  }
  throw new Error('модель не построилась')
}

async function setScene(page, frame, set) {
  await page.evaluate((s) => window.shot.set(s), { ...set, pos: frame.pos, target: frame.target, fov: frame.fov })
  await settle(page)
}

async function capture(page) {
  const { png, points } = await page.evaluate(() => window.shot.capture())
  return { buf: Buffer.from(png.split(',')[1], 'base64'), points }
}

// После уменьшения почти прозрачное (alpha 1–3 от округления) — в ноль: иначе на пластине виден прямоугольник кадра
const webp = (src, dest, width) => ff(['-i', src, '-vf', `scale=${width}:-2:flags=lanczos,format=rgba,lut=a='if(lt(val,6),0,val)'`, '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', '-pix_fmt', 'yuva420p', dest])
const round = (x) => Math.round(x * 1000) / 1000
/** Части, к которым слайды ставят подписи (Part в src/learn/callouts.ts; корень — по цементу, каналы — canal). */
const LABELLED = new Set(['enamel', 'dentin', 'pulp', 'canal', 'cementum', 'gum', 'bone', 'caries', 'filling', 'crown', 'stump', 'implant', 'abutment'])

async function shoot(browser, url, gen) {
  const byFrame = Object.groupBy(pick(SHOTS), (s) => s.frame)
  for (const [frameName, shots] of Object.entries(byFrame)) {
    const frame = FRAMES[frameName]
    const page = await openPage(browser, url, frame)
    for (const s of shots) {
      const t0 = Date.now()
      await setScene(page, frame, s.set)
      if (s.t != null) { await page.evaluate(() => window.shot.replay()); await advance(page, s.t * 1000) } else await advance(page, 1200)
      const { buf, points } = await capture(page)
      const png = path.join(TMP, `${s.name}.png`)
      fs.writeFileSync(png, buf)
      if (!DRAFT) {
        webp(png, path.join(OUT, `${s.name}-640.webp`), 640)
        webp(png, path.join(OUT, `${s.name}-1280.webp`), 1280)
        fs.rmSync(png)
      }
      const at = s.noLabels ? {} : Object.fromEntries(Object.entries(points).filter(([part, p]) => LABELLED.has(part) && p.visible && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1)
        .map(([part, p]) => [part, [round(p.x), round(p.y)]]))
      gen[s.name] = { w: frame.w, h: frame.h, at }
      console.log(`  ${s.name}: ${((Date.now() - t0) / 1000).toFixed(0)} с`)
    }
    await page.close()
  }
}

async function film(browser, url, gen) {
  for (const c of pick(CLIPS)) {
    const frame = FRAMES[c.frame ?? 'tooth']
    // Ролик — пол-плотности кадра: 640 px по ширине хватает, а программный WebGL рисует вчетверо быстрее
    const small = { ...frame, w: CLIP_W / 2, h: Math.round((CLIP_W / 2) * (frame.h / frame.w)) }
    const page = await openPage(browser, url, small)
    const t0 = Date.now()
    const dir = path.join(TMP, c.name)
    fs.mkdirSync(dir, { recursive: true })
    await setScene(page, small, { view: 'tooth', mode: c.mode })
    await page.evaluate(() => window.shot.replay())
    await advance(page, c.from * 1000)
    const n = Math.round(((c.to - c.from) / c.speed) * FPS)
    const step = (1000 * c.speed) / FPS
    for (let i = 0; i <= n; i++) {
      if (i) await advance(page, step)
      fs.writeFileSync(path.join(dir, `${String(i).padStart(4, '0')}.png`), (await capture(page)).buf)
    }
    // Постер — последний кадр; в ролике он же стоит hold секунд перед повтором
    const lastPng = path.join(dir, `${String(n).padStart(4, '0')}.png`)
    const holdFrames = Math.round(c.hold * FPS)
    for (let k = 1; k <= holdFrames; k++) fs.copyFileSync(lastPng, path.join(dir, `${String(n + k).padStart(4, '0')}.png`))
    const size = `${small.w * 2}x${small.h * 2}`
    const chain = `color=c=${PLATE}:s=${size}:r=${FPS}[bg];[bg][0:v]overlay=shortest=1,scale=${CLIP_W}:-2:flags=lanczos,format=yuv420p`
    const input = ['-framerate', String(FPS), '-i', path.join(dir, '%04d.png')]
    ff([...input, '-filter_complex', chain, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '33', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '1', '-an', path.join(OUT, `${c.name}.webm`)])
    ff([...input, '-filter_complex', chain, '-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-profile:v', 'high', '-movflags', '+faststart', '-an', path.join(OUT, `${c.name}.mp4`)])
    ff(['-i', lastPng, '-filter_complex', `color=c=${PLATE}:s=${size}[bg];[bg][0:v]overlay=shortest=1,scale=${CLIP_W}:-2:flags=lanczos`, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', path.join(OUT, `${c.name}-poster.webp`)])
    fs.rmSync(dir, { recursive: true, force: true })
    gen[c.name] = { w: CLIP_W, h: Math.round(CLIP_W * (frame.h / frame.w)), at: {} }
    const kb = (f) => Math.round(fs.statSync(path.join(OUT, f)).size / 1024)
    console.log(`  ${c.name}: ${n + holdFrames} кадров, webm ${kb(`${c.name}.webm`)} КБ, mp4 ${kb(`${c.name}.mp4`)} КБ, ${((Date.now() - t0) / 60000).toFixed(1)} мин`)
    await page.close()
  }
}

/** shots.gen.ts: размеры и точки подписей (доли ширины и высоты кадра). Старые записи сохраняются. */
function readGen() {
  if (!fs.existsSync(GEN)) return {}
  const m = fs.readFileSync(GEN, 'utf8').match(/export const SHOTS = (\{[\s\S]*?\}) as const/)
  return m ? JSON.parse(m[1]) : {}
}
function writeGen(gen) {
  const sorted = Object.fromEntries(Object.keys(gen).sort().map((k) => [k, gen[k]]))
  fs.writeFileSync(GEN, `// Создано scripts/learn-art.mjs — не править руками: node scripts/learn-art.mjs
/**
 * Кадры 3D-атласа для презентаций: public/content/learn/<имя>-640.webp и -1280.webp (ролики — <имя>.webm,
 * .mp4 и -poster.webp). w, h — пропорции кадра; at — где на кадре точка части (доли ширины и высоты) —
 * к ней ведёт подпись-выноска.
 */
export const SHOTS = ${JSON.stringify(sorted, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]')} as const

export type ShotName = keyof typeof SHOTS
`)
}

fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(TMP, { recursive: true })
const { chromium } = await loadPlaywright()
const vite = await startVite()
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const gen = readGen()
try {
  await shoot(browser, vite.url, gen)
  if (!DRAFT) writeGen(gen)
  if (!DRAFT) await film(browser, vite.url, gen)
  if (!DRAFT) writeGen(gen)
  else console.log(`  черновики: ${TMP}`)
} finally {
  await browser.close()
  vite.stop()
  if (!DRAFT && !process.env.LEARN_ART_TMP) fs.rmSync(TMP, { recursive: true, force: true })
}
