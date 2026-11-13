import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, howToVideos, unwrap, type Schemas } from '../api/client'
import { inTelegram } from '../lib/telegram'
import { shortDate } from '../lib/time'
import { EmptyState } from '../layout/EmptyState'
import { Loading } from '../layout/Loading'
import { durationText, groupMaterials, MATERIAL_LINKS, materialTitle, noMusicOf, posterOf, postPlace, sizeText, type Material } from './materials'
import { SubHelp } from '../layout/PageHead'

type Listing = Schemas['MaterialsListing']

/** Ссылка из списка — от корня сайта; Telegram открывает только полный адрес. */
function absolute(url: string): string {
  return new URL(url, window.location.origin).href
}

/**
 * «Платформа → Материалы» — только владелец платформы (сервер отвечает 403 остальным): ролики, презентация,
 * инструкция и картинки из docs/marketing на сервере — по группам «для чего». У каждого — превью, длительность,
 * размер, дата и «Открыть / Скачать / Поделиться». Опубликованное в Instagram или в группе Tish — ссылкой на пост
 * (V211): сам файл после публикации на сервере можно не хранить. «Устарел» — интерфейс в нём уже другой, пересоздать.
 * Файлы — по подписанным ссылкам из списка (на 6 ч): плеер и новая вкладка не умеют ставить заголовок входа Mini App.
 */
export function MaterialsTab() {
  const list = useQuery<Listing, ApiError>({
    queryKey: ['platform-materials'],
    queryFn: () => unwrap(api.GET('/api/platform/materials')),
    // Ссылки живут 6 ч; при каждом фокусе не перечитываем — иначе плеер начнёт ролик заново
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
  // Названия роликов «Как сделать» — из того же белого списка, что «Помощь → Видео»
  const howTo = useQuery({ queryKey: ['howto-videos'], queryFn: howToVideos, staleTime: 10 * 60_000 })
  const titles = Object.fromEntries((howTo.data ?? []).map((h) => [h.id, h.title]))
  const files = list.data?.files ?? []
  const groups = groupMaterials(files)
  const stale = groups.flatMap((g) => g.files).filter((f) => f.stale && f.url)
  return (
    <>
      <SubHelp title="Материалы">Что показать и отправить: рекламный ролик и презентация — клиникам, ролики «Как сделать» — врачам,
        рилсы и картинки — в Instagram. Опубликовали в Instagram или группе — сохраните ссылку на пост: файл на сервере больше не нужен.</SubHelp>
      <section className="card-block" aria-label="Материалы">
        {list.error && <p className="error" role="alert">Не удалось загрузить материалы: {list.error.message}</p>}
        {list.isPending && <Loading />}
        {list.data && !list.data.configured && (
          <EmptyState compact title="Каталог материалов не подключён">На сервере нужен MARKETING_DIR — после обновления
            по README («Платформа → Материалы») он подключается сам. Ссылки ниже работают и без него.</EmptyState>
        )}
        {list.data?.configured && files.length === 0 && (
          <EmptyState compact title="Файлов пока нет">Положите их в docs/marketing репозитория и обновите сервер.</EmptyState>
        )}
        {stale.length > 0 && (
          <div className="materials-stale" role="note" aria-label="Устарели">
            <strong>Устарели после изменений интерфейса 13 ноября (персонал, касса, кресла, помощь) — пересоздать:</strong>
            <ul>{[...new Set(stale.map((f) => groupName(f, groups)))].map((name) => <li key={name}>{name}</li>)}</ul>
          </div>
        )}
      </section>
      {groups.map(({ group, files: items }) => (
        <section key={group.id} className="card-block" aria-label={group.title}>
          <h2>{group.title}</h2>
          <p className="hint">{group.purpose}</p>
          {group.id === 'guide' && (
            <p className="hint">Для одной роли — печатная версия на сайте:{' '}
              <a href="/guide?print=1" target="_blank" rel="noopener noreferrer">tish.kg/guide?print=1</a>.</p>
          )}
          <ul className="materials-cards">
            {(group.id === 'howto' ? byHowToOrder(items, howTo.data ?? []) : items).map((f) => <MaterialCard key={f.path} file={f} all={files} title={materialTitle(f, titles)} onExpired={() => void list.refetch()} />)}
          </ul>
        </section>
      ))}
      <LinksBlock />
    </>
  )
}

/** Ролики «Как сделать» — в порядке «Помощи → Видео» (белый список сервера), а не по алфавиту файлов. */
function byHowToOrder(files: Material[], order: Schemas['MaterialsHowToVideo'][]): Material[] {
  const rank = (f: Material) => {
    const i = order.findIndex((h) => `${h.id}.mp4` === f.name)
    return i < 0 ? order.length : i
  }
  return [...files].sort((a, b) => rank(a) - rank(b))
}

function groupName(f: Material, groups: ReturnType<typeof groupMaterials>): string {
  return groups.find((g) => g.files.includes(f))?.group.title ?? f.name ?? ''
}

/** «Ссылки»: сайт-визитка, /join и Instagram — открыть или скопировать, чтобы отправить клинике. */
function LinksBlock() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
    } catch {
      setCopied(null)
    }
  }
  return (
    <section className="card-block" aria-label="Ссылки">
      <h2>Ссылки</h2>
      <p className="hint">Отправить клинике вместо файла: страницы открываются с телефона.</p>
      <ul className="materials-list">
        {MATERIAL_LINKS.map((l) => (
          <li key={l.url}>
            <span className="materials-name">
              <span className="strong">{l.title}</span>
              <span className="hint small">{l.url}</span>
            </span>
            <span className="actions">
              <a className="btn small" href={l.url} target="_blank" rel="noreferrer" onClick={inTelegram(l.url)} aria-label={`Открыть: ${l.title}`}>Открыть</a>
              <button type="button" className="btn small" onClick={() => void copy(l.url)} aria-label={`Скопировать ссылку: ${l.title}`}>
                {copied === l.url ? 'Скопировано' : 'Скопировать ссылку'}</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Карточка материала: превью, название, длительность · размер · дата, пометка «устарел», кнопки. */
function MaterialCard({ file, all, title, onExpired }: { file: Material; all: Material[]; title: string; onExpired: () => void }) {
  const poster = file.kind === 'video' ? posterOf(file, all) : file.kind === 'image' ? file : null
  const facts = [durationText(file.seconds), file.url ? sizeText(file.size) : 'файла на сервере нет', file.modified ? shortDate(file.modified) : null]
    .filter(Boolean).join(' · ')
  return (
    <li className="materials-card">
      <Preview file={file} poster={poster} title={title} onExpired={onExpired} />
      <div className="materials-card-body">
        <span className="strong">{title}{file.stale && <> <span className="badge-stale">устарел</span></>}</span>
        <span className="hint small"><span className="num">{facts}</span>{file.url && <> · {file.name}</>}</span>
        {file.stale && <span className="hint small">{file.stale}</span>}
        <Buttons file={file} title={title} />
        <NoMusic file={noMusicOf(file, all)} title={title} />
        {/* Ссылка на пост — для того, что публикуют в Instagram; рекламный ролик нужен файлом (WhatsApp, /join) */}
        {(file.section === 'reels' || file.section === 'instagram' || (file.section === 'video' && !/^promo-v/.test(file.folder ?? ''))) && <PostLink file={file} title={title} />}
      </div>
    </li>
  )
}

/**
 * Превью: картинка-обложка с «▶» — плеер появляется по нажатию (двадцать плееров сразу грузили бы двадцать
 * роликов); без обложки — первый кадр (preload="metadata"). Файла нет — значок места публикации.
 */
function Preview({ file, poster, title, onExpired }: { file: Material; poster: Material | null; title: string; onExpired: () => void }) {
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!file.url) return <div className="materials-thumb materials-thumb-empty" aria-hidden="true">{file.postUrl ? '↗' : '—'}</div>
  if (file.kind === 'video') {
    if (!playing && poster?.url) {
      return (
        <button type="button" className="materials-thumb" onClick={() => setPlaying(true)} aria-label={`Смотреть: ${title}`}>
          <img src={poster.url} alt="" loading="lazy" /><span className="materials-play" aria-hidden="true">▶</span>
        </button>
      )
    }
    return (
      <div className="materials-thumb">
        <video controls autoPlay={playing} preload="metadata" playsInline src={file.url} aria-label={title} onError={() => setFailed(true)} />
        {failed && (
          <span className="error small" role="alert">Не проигрывается: ссылка могла устареть.{' '}
            <button type="button" className="btn small" onClick={() => { setFailed(false); onExpired() }}>Обновить</button></span>
        )}
      </div>
    )
  }
  if (poster?.url) return <div className="materials-thumb"><img src={poster.url} alt={`Картинка ${file.name}`} loading="lazy" /></div>
  return <div className="materials-thumb materials-thumb-empty" aria-hidden="true">{file.kind === 'pdf' ? 'PDF' : file.kind === 'pptx' ? 'PPTX' : '📄'}</div>
}

/**
 * «Открыть» — во вкладке (в Telegram — браузером телефона), «Скачать» — файлом, «Поделиться» — постоянной ссылкой
 * (пост, /join, «Помощь → Видео») или самим файлом через меню телефона; иначе — ссылка на 6 ч в буфер.
 * Опубликованное — «Открыть в Instagram ↗» вместо файла.
 */
function Buttons({ file, title }: { file: Material; title: string }) {
  const [note, setNote] = useState('')
  const share = async () => {
    setNote('')
    const permanent = file.postUrl ?? (file.shareUrl ? absolute(file.shareUrl) : null)
    try {
      if (permanent) {
        if (navigator.share) await navigator.share({ title, url: permanent })
        else { await navigator.clipboard.writeText(permanent); setNote('Ссылка скопирована') }
        return
      }
      if (file.url && navigator.canShare) {
        const blob = await fetch(absolute(file.url)).then((r) => r.blob())
        const shared = new File([blob], file.name ?? 'file', { type: blob.type })
        if (navigator.canShare({ files: [shared] })) {
          await navigator.share({ files: [shared], title })
          return
        }
      }
      await navigator.clipboard.writeText(absolute(file.url ?? ''))
      setNote('Ссылка скопирована — работает 6 часов')
    } catch {
      // Отменили меню «Поделиться» — ничего
    }
  }
  const open = file.url ? absolute(file.url) : null
  const download = file.downloadUrl ? absolute(file.downloadUrl) : null
  return (
    <span className="actions">
      {file.postUrl && (
        <a className="btn small primary" href={file.postUrl} target="_blank" rel="noreferrer" onClick={inTelegram(file.postUrl)}
          aria-label={`Открыть в ${postPlace(file.postUrl)}: ${title}`}>{`Открыть в ${postPlace(file.postUrl)} ↗`}</a>
      )}
      {file.groupUrl && (
        <a className="btn small" href={file.groupUrl} target="_blank" rel="noreferrer" onClick={inTelegram(file.groupUrl)}
          aria-label={`В группе Tish: ${title}`}>В группе ↗</a>
      )}
      {!file.postUrl && open && <a className="btn small" href={open} target="_blank" rel="noreferrer" onClick={inTelegram(open)} aria-label={`Открыть: ${title}`}>Открыть</a>}
      {!file.postUrl && download && <a className="btn small" href={download} download={file.name} onClick={inTelegram(download)} aria-label={`Скачать: ${title}`}>Скачать</a>}
      {(file.postUrl || file.url) && <button type="button" className="btn small" onClick={() => void share()} aria-label={`Поделиться: ${title}`}>Поделиться</button>}
      {note && <span className="hint small" role="status">{note}</span>}
    </span>
  )
}

/** Версия рилса без музыки (наложить трендовый звук в Instagram) — ссылкой «Скачать». */
function NoMusic({ file, title }: { file: Material | null; title: string }) {
  if (!file?.downloadUrl) return null
  const download = absolute(file.downloadUrl)
  return (
    <span className="hint small">Без музыки — под свой звук в Instagram:{' '}
      <a href={download} download={file.name} onClick={inTelegram(download)} aria-label={`Скачать без музыки: ${title}`}>скачать</a>
      {file.size ? <> · <span className="num">{sizeText(file.size)}</span></> : null}</span>
  )
}

/** «Опубликовано в Instagram»: ссылка на пост — показываем её вместо файла; пусто — убрать. */
function PostLink({ file, title }: { file: Material; title: string }) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(file.postUrl ?? '')
  const save = useMutation<Listing, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/materials/link', { body: { path: file.path, url } })),
    onSuccess: (listing) => {
      client.setQueryData(['platform-materials'], listing)
      setOpen(false)
    },
  })
  if (!open) {
    return (
      <button type="button" className="link small" onClick={() => setOpen(true)} aria-label={`Ссылка на публикацию: ${title}`}>
        {file.postUrl ? 'Изменить ссылку на пост' : 'Опубликовали? Сохранить ссылку на пост'}</button>
    )
  }
  return (
    <form className="row-fields" aria-label={`Ссылка на публикацию: ${title}`} onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <label className="field"><span>Ссылка на пост в Instagram или сообщение в Telegram</span>
        <input type="url" value={url} placeholder="https://www.instagram.com/reel/…" onChange={(e) => setUrl(e.target.value)} /></label>
      {save.error && <p className="error" role="alert">{save.error.fieldErrors.url ?? save.error.message}</p>}
      <span className="actions">
        <button type="submit" className="btn small primary" disabled={save.isPending}>Сохранить</button>
        <button type="button" className="btn small" onClick={() => setOpen(false)}>Отмена</button>
      </span>
    </form>
  )
}
