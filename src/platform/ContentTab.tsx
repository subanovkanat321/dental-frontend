import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useState, type FormEvent } from 'react'

import { api, ApiError, staticJson, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { addDays, dayTitle, monthRange, shortDate, todayIn, weekLabel } from '../lib/time'
import { useDirty } from '../lib/unsaved'
import { EmptyState } from '../layout/EmptyState'
import { DateInput } from '../layout/DateInput'
import { MonthPicker } from '../layout/MonthPicker'
import { Select } from '../layout/Select'
import { Loading, Spinner } from '../layout/Loading'

type Post = Schemas['ContentPostsPost']
type Draft = Schemas['ContentPostsDraft']
type Kind = NonNullable<Post['kind']>
type Instagram = Schemas['InstagramTokensState']
type ReelsAdded = Schemas['ContentPostsReelsAdded']

const KINDS: Record<Kind, string> = { POST: 'Пост', CAROUSEL: 'Карусель', REELS: 'Рилс', STORIES: 'Сторис' }
const STATUS: Record<NonNullable<Post['status']>, [string, string]> = {
  PLANNED: ['В плане', 's-wait'], DONE: ['Опубликован', 's-ok'], SKIPPED: ['Пропущен', 's-quiet'],
}
/** Готовый план — статичный файл из сборки фронта (public/content/plan.json). */
const PLAN_URL = '/content/plan.json'

/** Понедельник недели этого дня. */
function weekStart(date: string): string {
  return addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7))
}

/**
 * «Платформа → Контент» (только владелец): контент-план Instagram на месяц, по неделям. Картинки —
 * файлы сайта /content/…; пост дня бот присылает в 10:00, кнопки там те же, что здесь. Instagram
 * подключён на сервере — пост, карусель, сторис и рилс с видео публикуются кнопкой (сервер сам
 * выкладывает). Рилсы — готовые ролики из docs/marketing/reels на сервере: «Добавить рилсы в план»
 * ставит их по одному в день на 19:30; бот пришлёт видео и кнопку в это время.
 */
export function ContentTab() {
  const client = useQueryClient()
  const today = todayIn()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [editing, setEditing] = useState<Post | 'new' | null>(null)
  // Форма поста после «Сохранить» закрывается — подтверждение показывает план
  const [postSaved, setPostSaved] = useState(false)
  const range = monthRange(month)
  const list = useQuery({
    queryKey: ['platform-content', month],
    queryFn: () => unwrap(api.GET('/api/platform/content', { params: { query: range } })),
    // Рилс публикуется в фоне (Instagram обрабатывает видео минуты) — план перечитываем, пока не выйдет
    refetchInterval: (query) => (query.state.data?.some((p) => p.instagramPublishing) ? 15_000 : false),
  })
  const instagram = useQuery({
    queryKey: ['platform-content-instagram'],
    queryFn: () => unwrap(api.GET('/api/platform/content/instagram')),
  })
  const refresh = () => client.invalidateQueries({ queryKey: ['platform-content'] })
  const load = useMutation<Schemas['ContentPostsImported'] | null, ApiError>({
    mutationFn: async () => {
      const plan = await staticJson(PLAN_URL)
      if (plan == null) return null
      if (!Array.isArray(plan)) throw new ApiError(422, 'В plan.json должен быть список постов')
      return unwrap(api.POST('/api/platform/content/import', { body: plan as Draft[] }))
    },
    onSuccess: () => void refresh(),
  })
  const addReels = useMutation<ReelsAdded, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/content/reels')),
    onSuccess: (r) => {
      if (r.from) setMonth(r.from.slice(0, 7))
      void refresh()
    },
  })

  const posts = list.data ?? []
  const weeks = new Map<string, Post[]>()
  for (const p of posts) {
    const key = weekStart(p.publishOn!)
    weeks.set(key, [...(weeks.get(key) ?? []), p])
  }
  const planned = posts.filter((p) => p.status === 'PLANNED').length
  return (
    <>
      <section className="card-block">
        <div className="block-head content-month">
          <h2>Контент-план</h2>
          <span className="actions">
            {month !== today.slice(0, 7) && <button type="button" className="btn small" onClick={() => setMonth(today.slice(0, 7))}>Этот месяц</button>}
            <MonthPicker label="Месяц контент-плана" value={month} onChange={setMonth} />
          </span>
        </div>
        <p className="hint">Пост дня бот пришлёт вам в 10:00: картинки, текст для копирования и что снять. В 19:00 напомнит, если не отмечен.
          Запись со временем (рилс в 19:30) придёт в своё время — видео, подпись и кнопка «Опубликовать».</p>
        {instagram.data && <InstagramStatus state={instagram.data} />}
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => { setPostSaved(false); setEditing('new') }}>＋ Добавить пост</button>
          <button type="button" className="btn" disabled={load.isPending} onClick={() => load.mutate()}>Загрузить готовый план</button>
          <button type="button" className="btn" disabled={addReels.isPending}
            onClick={() => void ask('Добавить 6 готовых рилсов в план — по одному в день в 19:30, начиная с ближайшего дня? Посты плана останутся как есть.')
              .then((ok) => ok && addReels.mutate())}>
            {addReels.isPending ? <><Spinner />Добавляю…</> : 'Добавить рилсы в план (6 шт., по одному в день)'}
          </button>
        </div>
        {addReels.data && <p className="tone-ok" role="status">{reelsText(addReels.data)}</p>}
        {addReels.error && <p className="error" role="alert">{addReels.error.message}</p>}
        {load.isSuccess && (load.data == null
          ? <p className="hint" role="status">Плана пока нет</p>
          : <p className="tone-ok" role="status">План загружен: добавлено {load.data.added}, обновлено {load.data.updated}, без изменений {load.data.unchanged}{load.data.removed ? `, убрано из старого плана ${load.data.removed}` : ''}</p>)}
        {load.error && <p className="error" role="alert">{load.error.message}</p>}
      </section>
      {editing && <PostForm key={editing === 'new' ? 'new' : editing.id} post={editing === 'new' ? null : editing}
        today={today} onDone={() => { setEditing(null); setPostSaved(true); void refresh() }} onCancel={() => setEditing(null)} />}
      <SaveBar dirty={false} saving={false} saved={postSaved} savedText="Пост сохранён" />
      <section className="card-block" aria-label="Контент-план">
        {list.error && <p className="error">{list.error.message}</p>}
        {list.isPending ? <Loading /> : posts.length === 0 ? (
          <EmptyState title="В этом месяце постов нет">Добавьте пост или загрузите готовый план.</EmptyState>
        ) : (
          <>
            <p className="hint">Постов: {posts.length} · ждут публикации: {planned}</p>
            {[...weeks.entries()].map(([start, items]) => (
              <section key={start} className="content-week" aria-label={`Неделя ${weekLabel(start)}`}>
                <h3>{weekLabel(start)}</h3>
                {items.map((p) => <PostCard key={p.id} post={p} today={today} instagram={instagram.data?.enabled === true} onEdit={() => { setPostSaved(false); setEditing(p) }} onChanged={() => void refresh()} />)}
              </section>
            ))}
          </>
        )}
      </section>
    </>
  )
}

/** Итог «Добавить рилсы в план» одной строкой. */
function reelsText(r: ReelsAdded): string {
  const parts = r.added
    ? [`Рилсы добавлены: ${r.added}, по одному в день с ${shortDate(r.from!)} в ${hhmm(r.time)}`]
    : ['Новых рилсов нет — все уже в плане']
  if (r.added && r.already) parts.push(`уже были в плане: ${r.already}`)
  if (r.missing?.length) parts.push(`нет в каталоге на сервере: ${r.missing.join(', ')}`)
  return parts.join(' · ')
}

/** «19:30:00» → «19:30». */
function hhmm(time: string | undefined): string {
  return (time ?? '').slice(0, 5)
}

/** Подключён ли Instagram (переменные окружения сервера) и до когда токен — его сервер продлевает сам. */
function InstagramStatus({ state }: { state: Instagram }) {
  if (!state.enabled) {
    return (
      <p className="hint" role="note">
        Публиковать в Instagram кнопкой (здесь и в боте): пропишите <code>INSTAGRAM_USER_ID</code> и <code>INSTAGRAM_TOKEN</code> в .env на сервере и перезапустите приложение.
      </p>
    )
  }
  return (
    <p className="hint" role="note">
      📤 Instagram подключён{state.expiresAt ? ` · токен до ${shortDate(state.expiresAt)}, продлевается сам` : ''}
    </p>
  )
}

function PostCard({ post, today, instagram, onEdit, onChanged }: {
  post: Post; today: string; instagram: boolean; onEdit: () => void; onChanged: () => void
}) {
  const [copied, setCopied] = useState(false)
  // Публикация — секунды: Instagram скачивает картинки. Рилс — в фоне (ответ 202, итог — в Telegram).
  // Повторное нажатие сервер второй раз не выложит
  const publish = useMutation<Post, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/content/{id}/publish', { params: { path: { id: post.id! } } })),
    onSuccess: onChanged,
  })
  const action = useMutation<unknown, ApiError, 'done' | 'skip' | 'postpone' | 'plan' | 'delete'>({
    mutationFn: (what) => {
      const params = { params: { path: { id: post.id! } } }
      switch (what) {
        case 'done': return unwrap(api.POST('/api/platform/content/{id}/done', params))
        case 'skip': return unwrap(api.POST('/api/platform/content/{id}/skip', params))
        case 'postpone': return unwrap(api.POST('/api/platform/content/{id}/postpone', params))
        case 'plan': return unwrap(api.POST('/api/platform/content/{id}/plan', params))
        case 'delete': return unwrap(api.DELETE('/api/platform/content/{id}', params))
      }
    },
    onSuccess: onChanged,
  })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(post.caption ?? '')
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  const [status, cls] = STATUS[post.status ?? 'PLANNED']
  const date = post.publishOn!
  const late = post.status === 'PLANNED' && date < today
  const images = post.images ?? []
  const reel = post.kind === 'REELS' && !!post.video
  const canPublish = instagram && !post.instagramMediaId && !post.instagramPublishing
    && (post.kind === 'REELS' ? reel : images.length > 0)
  return (
    <article className={date === today ? 'content-post today' : 'content-post'} aria-label={post.title}>
      <header className="content-head">
        <span className="num">{dayTitle(date)}{date === today ? ' · сегодня' : ''}{post.publishTime ? ` · ${hhmm(post.publishTime)}` : ''}</span>
        <span className="chip small s-request">{KINDS[post.kind ?? 'POST']}</span>
        <span className={`chip small ${cls}`}>{status}</span>
        {late && <span className="tone-bad">не опубликован</span>}
        {post.instagramUrl
          ? <a className="chip small s-ok" href={post.instagramUrl} target="_blank" rel="noreferrer">В Instagram ↗</a>
          : post.instagramMediaId && <span className="chip small s-ok">В Instagram</span>}
        {post.instagramPublishing && <span className="chip small s-wait" role="status"><Spinner />Публикуется в Instagram</span>}
      </header>
      <h4>{post.title}</h4>
      {reel && (post.videoUrl
        ? <ReelPlayer post={post} onExpired={onChanged} />
        : <p className="tone-bad">Видео рилса нет на сервере ({post.video}) — проверьте каталог docs/marketing/reels.</p>)}
      {images.length > 0 && (
        <div className="content-thumbs">
          {images.map((src) => (
            <a key={src} href={src} target="_blank" rel="noreferrer">
              {/\.mp4$/i.test(src) ? <span className="content-video">🎬 видео</span> : <img src={src} alt={`Картинка: ${src.split('/').pop()}`} loading="lazy" />}
            </a>
          ))}
        </div>
      )}
      {post.caption && (
        <div className="content-caption">
          <p>{post.caption}</p>
          <button type="button" className="btn small" onClick={() => void copy()}>Скопировать</button>
          {copied && <span className="tone-ok" role="status">Скопировано</span>}
        </div>
      )}
      {post.note && <p className="hint"><b>{post.kind === 'REELS' ? 'Что снять: ' : 'Заметка: '}</b>{post.note}</p>}
      <div className="actions">
        {canPublish && (
          <button type="button" className="btn small primary" disabled={publish.isPending}
            onClick={() => void ask(reel
              ? `Опубликовать рилс «${post.title}» в Instagram? Он выйдет, как только Instagram обработает видео (до 5 минут); итог придёт в Telegram.`
              : `Опубликовать «${post.title}» в Instagram? Пост выйдет сразу.`).then((ok) => ok && publish.mutate())}>
            {publish.isPending ? <><Spinner />Публикую…</> : 'Опубликовать в Instagram'}
          </button>
        )}
        {post.status === 'PLANNED' ? (
          <>
            <button type="button" className="btn small" disabled={action.isPending} onClick={() => action.mutate('done')}>Опубликовал</button>
            <button type="button" className="btn small" disabled={action.isPending} onClick={() => action.mutate('postpone')}>На завтра</button>
            <button type="button" className="btn small" disabled={action.isPending} onClick={() => action.mutate('skip')}>Пропустить</button>
          </>
        ) : <button type="button" className="btn small" disabled={action.isPending} onClick={() => action.mutate('plan')}>Вернуть в план</button>}
        <button type="button" className="btn small" onClick={onEdit}>Изменить</button>
        <button type="button" className="btn small danger" disabled={action.isPending}
          onClick={() => void ask(`Удалить «${post.title}» из плана?`).then((ok) => ok && action.mutate('delete'))}>Удалить</button>
      </div>
      {action.error && <p className="error" role="alert">{action.error.message}</p>}
      {publish.error && <p className="error" role="alert">{publish.error.message}</p>}
    </article>
  )
}

/**
 * Плеер рилса — как в «Материалах»: подписанная ссылка сервера (видео и обложка без заголовка входа),
 * preload="none" — месяц рилсов не качается целиком при открытии плана. Ссылка устарела — перечитать план.
 */
function ReelPlayer({ post, onExpired }: { post: Post; onExpired: () => void }) {
  const [failed, setFailed] = useState(false)
  return (
    <figure className="content-reel">
      <video controls preload="none" playsInline src={post.videoUrl} poster={post.coverUrl}
        aria-label={`Рилс: ${post.title}`} onError={() => setFailed(true)} />
      {failed && (
        <figcaption className="error small" role="alert">Видео не проигрывается: ссылка могла устареть.{' '}
          <button type="button" className="btn small" onClick={() => { setFailed(false); onExpired() }}>Обновить</button>
        </figcaption>
      )}
    </figure>
  )
}

function PostForm({ post, today, onDone, onCancel }: { post: Post | null; today: string; onDone: () => void; onCancel: () => void }) {
  const [date, setDate] = useState(post?.publishOn ?? today)
  const [time, setTime] = useState(hhmm(post?.publishTime))
  const [kind, setKind] = useState<Kind>(post?.kind ?? 'POST')
  const [title, setTitle] = useState(post?.title ?? '')
  const [caption, setCaption] = useState(post?.caption ?? '')
  const [images, setImages] = useState((post?.images ?? []).join('\n'))
  const [note, setNote] = useState(post?.note ?? '')
  const { dirty } = useDirty({ date, time, kind, title, caption, images, note })
  const save = useMutation<Post, ApiError>({
    mutationFn: () => {
      const body: Draft = { date, kind, title, caption, note, images: images.split('\n').map((s) => s.trim()).filter(Boolean), ...(time ? { time } : {}) }
      return post
        ? unwrap(api.PUT('/api/platform/content/{id}', { params: { path: { id: post.id! } }, body }))
        : unwrap(api.POST('/api/platform/content', { body }))
    },
    onSuccess: onDone,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const errors = save.error?.fieldErrors ?? {}
  const label = post ? 'Изменить пост' : 'Новый пост'
  return (
    <section className="card-block">
      <h2>{label}</h2>
      <form className="form narrow" aria-label={label} onSubmit={submit}>
        <label className="field"><span>День</span><DateInput weekday required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {errors.date && <p className="error">{errors.date}</p>}
        <label className="field"><span>Время публикации (по Бишкеку) — бот пришлёт запись в это время; пусто — утром в 10:00</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        {errors.time && <p className="error">{errors.time}</p>}
        <label className="field"><span>Тип</span>
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {(Object.keys(KINDS) as Kind[]).map((k) => <option key={k} value={k}>{KINDS[k]}</option>)}
          </Select></label>
        <label className="field"><span>Название</span><input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        {errors.title && <p className="error">{errors.title}</p>}
        <label className="field"><span>Текст поста · {caption.length} / 4000</span>
          <textarea rows={5} maxLength={4000} value={caption} onChange={(e) => setCaption(e.target.value)} /></label>
        {errors.caption && <p className="error">{errors.caption}</p>}
        {post?.video && <p className="hint">Видео рилса: {post.video} — из каталога рилсов на сервере, здесь не меняется.</p>}
        <label className="field"><span>Картинки — адреса на сайте, по одной в строке</span>
          <textarea rows={3} value={images} placeholder="/content/2026-11-04-пост.png" onChange={(e) => setImages(e.target.value)} /></label>
        {errors.images && <p className="error">{errors.images}</p>}
        <label className="field"><span>{kind === 'REELS' ? 'Что снять' : 'Заметка для себя'}</span>
          <textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {errors.note && <p className="error">{errors.note}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>Отмена</button>
        </div>
        <SaveBar dirty={dirty} saving={save.isPending} saved={false} error={save.error && (Object.values(errors)[0] ?? save.error.message)} />
      </form>
    </section>
  )
}
