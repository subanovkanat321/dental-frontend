import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, staticJson, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { addDays, dayTitle, monthRange, todayIn, weekLabel } from '../lib/time'
import { useDirty } from '../lib/unsaved'
import { EmptyState } from '../layout/EmptyState'
import { DateInput } from '../layout/DateInput'
import { MonthPicker } from '../layout/MonthPicker'
import { Select } from '../layout/Select'

type Post = Schemas['ContentPostsPost']
type Draft = Schemas['ContentPostsDraft']
type Kind = NonNullable<Post['kind']>

const KINDS: Record<Kind, string> = { POST: 'Пост', CAROUSEL: 'Карусель', REELS: 'Reels', STORIES: 'Сторис' }
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
 * файлы сайта /content/…; пост дня бот присылает в 10:00, кнопки там те же, что здесь.
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
        <p className="hint">Пост дня бот пришлёт вам в 10:00: картинки, текст для копирования и что снять. В 19:00 напомнит, если не отмечен.</p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => { setPostSaved(false); setEditing('new') }}>＋ Добавить пост</button>
          <button type="button" className="btn" disabled={load.isPending} onClick={() => load.mutate()}>Загрузить готовый план</button>
        </div>
        {load.isSuccess && (load.data == null
          ? <p className="hint" role="status">Плана пока нет</p>
          : <p className="tone-ok" role="status">План загружен: добавлено {load.data.added}, обновлено {load.data.updated}, без изменений {load.data.unchanged}</p>)}
        {load.error && <p className="error" role="alert">{load.error.message}</p>}
      </section>
      {editing && <PostForm key={editing === 'new' ? 'new' : editing.id} post={editing === 'new' ? null : editing}
        today={today} onDone={() => { setEditing(null); setPostSaved(true); void refresh() }} onCancel={() => setEditing(null)} />}
      <SaveBar dirty={false} saving={false} saved={postSaved} savedText="Пост сохранён" />
      <section className="card-block" aria-label="Контент-план">
        {list.error && <p className="error">{list.error.message}</p>}
        {list.isPending ? <p className="hint">Загрузка…</p> : posts.length === 0 ? (
          <EmptyState icon="🗓️" title="В этом месяце постов нет.">Добавьте пост или загрузите готовый план.</EmptyState>
        ) : (
          <>
            <p className="hint">Постов: {posts.length} · ждут публикации: {planned}</p>
            {[...weeks.entries()].map(([start, items]) => (
              <section key={start} className="content-week" aria-label={`Неделя ${weekLabel(start)}`}>
                <h3>{weekLabel(start)}</h3>
                {items.map((p) => <PostCard key={p.id} post={p} today={today} onEdit={() => { setPostSaved(false); setEditing(p) }} onChanged={() => void refresh()} />)}
              </section>
            ))}
          </>
        )}
      </section>
    </>
  )
}

function PostCard({ post, today, onEdit, onChanged }: { post: Post; today: string; onEdit: () => void; onChanged: () => void }) {
  const [copied, setCopied] = useState(false)
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
  return (
    <article className={date === today ? 'content-post today' : 'content-post'} aria-label={post.title}>
      <header className="content-head">
        <span className="num">{dayTitle(date)}{date === today ? ' · сегодня' : ''}</span>
        <span className="chip small s-request">{KINDS[post.kind ?? 'POST']}</span>
        <span className={`chip small ${cls}`}>{status}</span>
        {late && <span className="tone-bad">не опубликован</span>}
      </header>
      <h4>{post.title}</h4>
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
        {post.status === 'PLANNED' ? (
          <>
            <button type="button" className="btn small" disabled={action.isPending} onClick={() => action.mutate('done')}>Опубликовал</button>
            <button type="button" className="btn small" disabled={action.isPending} onClick={() => action.mutate('postpone')}>На завтра</button>
            <button type="button" className="btn small" disabled={action.isPending} onClick={() => action.mutate('skip')}>Пропустить</button>
          </>
        ) : <button type="button" className="btn small" disabled={action.isPending} onClick={() => action.mutate('plan')}>Вернуть в план</button>}
        <button type="button" className="btn small" onClick={onEdit}>Изменить</button>
        <button type="button" className="btn small danger" disabled={action.isPending}
          onClick={() => window.confirm(`Удалить «${post.title}» из плана?`) && action.mutate('delete')}>Удалить</button>
      </div>
      {action.error && <p className="error" role="alert">{action.error.message}</p>}
    </article>
  )
}

function PostForm({ post, today, onDone, onCancel }: { post: Post | null; today: string; onDone: () => void; onCancel: () => void }) {
  const [date, setDate] = useState(post?.publishOn ?? today)
  const [kind, setKind] = useState<Kind>(post?.kind ?? 'POST')
  const [title, setTitle] = useState(post?.title ?? '')
  const [caption, setCaption] = useState(post?.caption ?? '')
  const [images, setImages] = useState((post?.images ?? []).join('\n'))
  const [note, setNote] = useState(post?.note ?? '')
  const { dirty } = useDirty({ date, kind, title, caption, images, note })
  const save = useMutation<Post, ApiError>({
    mutationFn: () => {
      const body: Draft = { date, kind, title, caption, note, images: images.split('\n').map((s) => s.trim()).filter(Boolean) }
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
        <label className="field"><span>Тип</span>
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {(Object.keys(KINDS) as Kind[]).map((k) => <option key={k} value={k}>{KINDS[k]}</option>)}
          </Select></label>
        <label className="field"><span>Название</span><input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        {errors.title && <p className="error">{errors.title}</p>}
        <label className="field"><span>Текст поста · {caption.length} / 4000</span>
          <textarea rows={5} maxLength={4000} value={caption} onChange={(e) => setCaption(e.target.value)} /></label>
        {errors.caption && <p className="error">{errors.caption}</p>}
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
