import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useState, type FormEvent } from 'react'

import { api, ApiError, staticJson, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { addDays, dayTitle, monthRange, shortDate, todayIn, weekLabel } from '../lib/time'
import { useDirty } from '../lib/unsaved'
import { EmptyState } from '../layout/EmptyState'
import { DateInput } from '../layout/DateInput'
import { TimeInput } from '../layout/TimeInput'
import { MonthPicker } from '../layout/MonthPicker'
import { Select } from '../layout/Select'
import { Loading, Spinner } from '../layout/Loading'
import { inTelegram } from '../lib/telegram'

type Post = Schemas['ContentPostsPost']
type Draft = Schemas['ContentPostsDraft']
type Kind = NonNullable<Post['kind']>
type Instagram = Schemas['InstagramTokensState']
type ReelsAdded = Schemas['ContentPostsReelsAdded']
type Settings = Schemas['ContentSettingsSettings']
type SettingsUpdate = Schemas['ContentSettingsUpdate']

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
 * ставит их по одному в день на 19:30 вперемешку с уже запланированными; бот пришлёт видео и кнопку в
 * это время. «Рилсы — автоматически» — новые ролики встают в план сами, а рилс в 19:30 сам выходит в Instagram.
 * После публикации пост или рилс сразу уходит и в сторис (галочка «Также в сторис» у поста и «Сторис —
 * автоматически»); не вышла — причина под постом и «Повторить сторис».
 */
export function ContentTab() {
  const client = useQueryClient()
  const today = todayIn()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [editing, setEditing] = useState<Post | 'new' | null>(null)
  // Форма поста после «Сохранить» закрывается — подтверждение показывает план
  const [postSaved, setPostSaved] = useState(false)
  // По умолчанию — только ждущие публикации; «Все» — вместе с опубликованными и пропущенными
  const [showAll, setShowAll] = useState(false)
  // Этот месяц: план — с сегодняшнего дня и на 2 месяца вперёд (рилсы по одному в день уходят за месяц),
  // прошедшие дни месяца — внизу, свёрнуты. Другой месяц — как был, целиком
  const current = month === today.slice(0, 7)
  const monthOnly = monthRange(month)
  const ahead = addDays(today, 60)
  const range = current && ahead > monthOnly.to ? { from: monthOnly.from, to: ahead } : monthOnly
  const list = useQuery({
    queryKey: ['platform-content', month],
    queryFn: () => unwrap(api.GET('/api/platform/content', { params: { query: range } })),
    // Рилс (и его сторис) публикуется в фоне (Instagram обрабатывает видео минуты) — план перечитываем, пока не выйдет
    refetchInterval: (query) => (query.state.data?.some((p) => p.instagramPublishing || p.storyPublishing) ? 15_000 : false),
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

  const loaded = list.data ?? []
  const done = loaded.filter((p) => p.status !== 'PLANNED').length
  const posts = showAll ? loaded : loaded.filter((p) => p.status === 'PLANNED')
  const upcoming = current ? posts.filter((p) => p.publishOn! >= today) : posts
  const past = current ? posts.filter((p) => p.publishOn! < today) : []
  const byWeek = (items: Post[]) => {
    const weeks = new Map<string, Post[]>()
    for (const p of items) {
      const key = weekStart(p.publishOn!)
      weeks.set(key, [...(weeks.get(key) ?? []), p])
    }
    return [...weeks.entries()]
  }
  const planned = (current ? loaded.filter((p) => p.publishOn! >= today) : loaded).filter((p) => p.status === 'PLANNED').length
  const card = (p: Post) => <PostCard key={p.id} post={p} today={today} instagram={instagram.data?.enabled === true}
    onEdit={() => { setPostSaved(false); setEditing(p) }} onChanged={() => void refresh()} />
  const weeksOf = (items: Post[]) => byWeek(items).map(([start, list]) => (
    <section key={start} className="content-week" aria-label={`Неделя ${weekLabel(start)}`}>
      <h3>{weekLabel(start)}</h3>
      {list.map(card)}
    </section>
  ))
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
        <ReelsAuto instagram={instagram.data?.enabled === true} instagramKnown={instagram.data != null}
          onChanged={() => void refresh()} />
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => { setPostSaved(false); setEditing('new') }}>＋ Добавить пост</button>
          <button type="button" className="btn" disabled={load.isPending} onClick={() => load.mutate()}>Загрузить готовый план</button>
          <button type="button" className="btn" disabled={addReels.isPending}
            onClick={() => void ask('Добавить новые готовые рилсы в план — по одному в день в 19:30, начиная с ближайшего дня? '
              + 'Ещё не опубликованные рилсы переставятся, чтобы шли вперемешку; посты плана и рилсы, которые вы меняли сами, останутся как есть.')
              .then((ok) => ok && addReels.mutate())}>
            {addReels.isPending ? <><Spinner />Добавляю…</> : 'Добавить рилсы в план (по одному в день)'}
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
        {list.isPending ? <Loading /> : loaded.length === 0 ? (
          <EmptyState title="В этом месяце постов нет">Добавьте пост или загрузите готовый план.</EmptyState>
        ) : (
          <>
            <div className="content-filter">
              <div className="segments" role="group" aria-label="Какие посты показать">
                <button type="button" aria-pressed={!showAll} onClick={() => setShowAll(false)}>Ждут публикации · {planned}</button>
                <button type="button" aria-pressed={showAll} onClick={() => setShowAll(true)}>Все{done ? ` · опубликовано и пропущено ${done}` : ''}</button>
              </div>
              {current && <span className="hint">с сегодняшнего дня</span>}
            </div>
            {upcoming.length ? weeksOf(upcoming) : (
              <p className="hint">{showAll ? 'С сегодняшнего дня в плане пусто.' : 'Всё опубликовано — ждущих публикации нет.'}</p>
            )}
            {past.length > 0 && (
              <details className="content-past">
                <summary>{showAll ? 'Прошедшие дни этого месяца' : 'Прошедшие дни — не опубликованы'}: {past.length}</summary>
                {weeksOf(past)}
              </details>
            )}
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
  if (r.moved) parts.push(`переставлено, чтобы шли вперемешку: ${r.moved}`)
  if (r.added && r.already) parts.push(`уже были в плане: ${r.already}`)
  if (r.missing?.length) parts.push(`нет в каталоге на сервере: ${r.missing.join(', ')}`)
  return parts.join(' · ')
}

/** «19:30:00» → «19:30». */
function hhmm(time: string | undefined): string {
  return (time ?? '').slice(0, 5)
}

/**
 * «Рилсы — автоматически» и «Сторис — автоматически»: сохраняются сразу, каждая своим полем (другое
 * сервер не трогает). Включили рилсы — сервер тут же ставит новые ролики в план (итог придёт в
 * Telegram), поэтому план перечитываем. Без Instagram автопубликации нет — предупреждаем.
 */
function ReelsAuto({ instagram, instagramKnown, onChanged }: { instagram: boolean; instagramKnown: boolean; onChanged: () => void }) {
  const client = useQueryClient()
  const settings = useQuery({
    queryKey: ['platform-content-settings'],
    queryFn: () => unwrap(api.GET('/api/platform/content/settings')),
  })
  const save = useMutation<Settings, ApiError, SettingsUpdate>({
    mutationFn: (body) => unwrap(api.PUT('/api/platform/content/settings', { body })),
    onSuccess: (saved, sent) => {
      client.setQueryData(['platform-content-settings'], saved)
      // Сервер добавляет рилсы в фоне — перечитаем план чуть позже
      if (sent.reelsAuto && saved.reelsAuto) setTimeout(onChanged, 2000)
    },
  })
  if (settings.isPending) return null
  if (settings.error) return <p className="error">{settings.error.message}</p>
  const on = Boolean(settings.data.reelsAuto)
  // Нет поля (старый сервер) — как по умолчанию на сервере: включено
  const stories = settings.data.storiesAuto !== false
  return (
    <div className="content-reels-auto">
      <label className="check"><input type="checkbox" checked={on} disabled={save.isPending}
        onChange={(e) => save.mutate({ reelsAuto: e.target.checked })} /> Рилсы — автоматически</label>
      <p className="hint">Новые ролики после обновления сервера сами встают в план (вперемешку, по одному в день в 19:30) — бот сообщит, какие.
        В 19:30 рилс сам публикуется в Instagram, итог придёт в Telegram. Если публикация не удалась — бот пришлёт видео с кнопками, как обычно.</p>
      {on && instagramKnown && !instagram && (
        <p className="notice tone-wait" role="alert">Instagram не подключён — рилсы будут вставать в план, но публиковать их придётся вручную
          (бот пришлёт видео с кнопками). Подключите Instagram на сервере, чтобы они выходили сами.</p>
      )}
      <label className="check"><input type="checkbox" checked={stories} disabled={save.isPending}
        onChange={(e) => save.mutate({ storiesAuto: e.target.checked })} /> Сторис — автоматически</label>
      <p className="hint">Опубликованный в Instagram пост или рилс сразу уходит и в сторис — той же картинкой (у карусели — первой) или видео.
        Подписи и ссылки на пост у сторис нет — так устроен Instagram. Для одного поста можно снять галочку «Также в сторис».</p>
      {save.error && <p className="error" role="alert">{save.error.message}</p>}
    </div>
  )
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
  // «📤 В сторис» / «Повторить сторис»: картинка — сразу (200), видео рилса — в фоне (202, итог в Telegram)
  const story = useMutation<Post, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/content/{id}/story', { params: { path: { id: post.id! } } })),
    onSuccess: onChanged,
    onError: onChanged,
  })
  // «📲 Прислать в бот»: видео/картинки и подпись — в Telegram сейчас, чтобы сохранить и выложить вручную
  const toBot = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/content/{id}/to-telegram', { params: { path: { id: post.id! } } })),
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
  // Опубликованный (отметкой «Опубликовал» или через Instagram) и пропущенный — без кнопки публикации
  const canPublish = instagram && post.status === 'PLANNED' && !post.instagramMediaId && !post.instagramPublishing
    && (post.kind === 'REELS' ? reel : images.length > 0)
  // Сторис после поста: пост в Instagram, сам не сторис и есть из чего (видео рилса или картинка)
  const storyable = !!post.instagramMediaId && post.kind !== 'STORIES' && (post.kind === 'REELS' ? reel : images.length > 0)
  const storyBusy = post.storyPublishing || story.isPending
  const canStory = instagram && storyable && !post.storyMediaId && !storyBusy
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
        {storyable && post.storyMediaId && <span className="chip small s-ok">✓ в сторис</span>}
        {storyable && storyBusy && <span className="chip small s-wait" role="status"><Spinner />Выкладывается в сторис</span>}
      </header>
      <h4>{post.title}</h4>
      {/* Почему Instagram отказал в прошлый раз (раньше — только в лог и в Telegram): пост вернулся в план */}
      {post.instagramError && !post.instagramPublishing && !post.instagramMediaId && (
        <p className="error" role="alert">⚠️ Не опубликовано в Instagram{post.instagramErrorAt ? ` (${shortDate(post.instagramErrorAt, true)})` : ''}: {post.instagramError}</p>
      )}
      {/* Сторис не вышла — пост уже опубликован, повторить можно отдельно */}
      {storyable && post.storyError && !post.storyMediaId && !storyBusy && (
        <p className="error" role="alert">⚠️ Сторис: ошибка{post.storyErrorAt ? ` (${shortDate(post.storyErrorAt, true)})` : ''}: {post.storyError}</p>
      )}
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
        {canStory && (
          <button type="button" className="btn small" onClick={() => story.mutate()}>
            {post.storyError ? 'Повторить сторис' : '📤 В сторис'}
          </button>
        )}
        {post.status === 'PLANNED' ? (
          <>
            <button type="button" className="btn small" disabled={action.isPending} onClick={() => action.mutate('done')}>Опубликовал</button>
            <button type="button" className="btn small" disabled={action.isPending} onClick={() => action.mutate('postpone')}>На завтра</button>
            <button type="button" className="btn small" disabled={action.isPending} onClick={() => action.mutate('skip')}>Пропустить</button>
          </>
        ) : <button type="button" className="btn small" disabled={action.isPending} onClick={() => action.mutate('plan')}>Вернуть в план</button>}
        <button type="button" className="btn small" disabled={toBot.isPending} onClick={() => toBot.mutate()}>
          {toBot.isPending ? <><Spinner />Отправляю…</> : '📲 Прислать в бот'}
        </button>
        <button type="button" className="btn small" onClick={onEdit}>Изменить</button>
        <button type="button" className="btn small danger" disabled={action.isPending}
          onClick={() => void ask(`Удалить «${post.title}» из плана?`).then((ok) => ok && action.mutate('delete'))}>Удалить</button>
      </div>
      {action.error && <p className="error" role="alert">{action.error.message}</p>}
      {publish.error && <p className="error" role="alert">{publish.error.message}</p>}
      {story.error && story.error.code !== 'instagram-story-failed' && <p className="error" role="alert">{story.error.message}</p>}
      {toBot.isSuccess && <p className="tone-ok" role="status">Отправили в Telegram — откройте бота: видео можно сохранить, подпись — скопировать.</p>}
      {toBot.error && <p className="error" role="alert">{toBot.error.message}</p>}
    </article>
  )
}

/**
 * Плеер рилса — как в «Материалах»: подписанная ссылка сервера (видео и обложка без заголовка входа),
 * preload="none" — месяц рилсов не качается целиком при открытии плана. Ссылка устарела — перечитать план.
 */
function ReelPlayer({ post, onExpired }: { post: Post; onExpired: () => void }) {
  const [failed, setFailed] = useState(false)
  // «Скачать» — та же подписанная ссылка с download=true: сервер отдаёт файл под своим именем.
  // В Telegram ссылку открываем в браузере телефона (в Mini App скачивание не работает)
  const download = new URL(`${post.videoUrl}&download=true`, window.location.origin).href
  const file = post.video?.split('/').pop()
  return (
    <figure className="content-reel">
      <video controls preload="none" playsInline src={post.videoUrl} poster={post.coverUrl}
        aria-label={`Рилс: ${post.title}`} onError={() => setFailed(true)} />
      <a className="btn small" href={download} download={file} onClick={inTelegram(download)}
        aria-label={`Скачать рилс: ${post.title}`}>⬇ Скачать видео</a>
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
  const [story, setStory] = useState(post?.story ?? true)
  const { dirty } = useDirty({ date, time, kind, title, caption, images, note, story })
  const save = useMutation<Post, ApiError>({
    mutationFn: () => {
      const body: Draft = { date, kind, title, caption, note, images: images.split('\n').map((s) => s.trim()).filter(Boolean), ...(time ? { time } : {}), story }
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
          <TimeInput value={time} onChange={setTime} /></label>
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
        {kind !== 'STORIES' && (
          <label className="check"><input type="checkbox" checked={story} onChange={(e) => setStory(e.target.checked)} /> Также в сторис
            <span className="hint"> — после публикации в Instagram та же картинка (видео рилса) сразу уйдёт в сторис</span></label>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>Отмена</button>
        </div>
        <SaveBar dirty={dirty} saving={save.isPending} saved={false} error={save.error && (Object.values(errors)[0] ?? save.error.message)} />
      </form>
    </section>
  )
}
