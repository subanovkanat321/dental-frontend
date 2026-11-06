import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { inTelegram } from '../lib/telegram'
import { shortDate } from '../lib/time'
import { EmptyState } from '../layout/EmptyState'
import { Loading } from '../layout/Loading'
import { folderRank, folderTitle, MATERIAL_LINKS, sizeText, videoLabel } from './materials'

type Listing = Schemas['MaterialsListing']
type Material = Schemas['MaterialsMaterial']

/** Ссылка из списка — от корня сайта; Telegram открывает только полный адрес. */
function absolute(url: string): string {
  return new URL(url, window.location.origin).href
}

/**
 * «Платформа → Материалы» — только владелец платформы (сервер отвечает 403 остальным): готовые ролики,
 * презентация для клиник и картинки для Instagram из docs/marketing на сервере, ссылки на сайт-визитку и Instagram — не потерять и показать
 * клинике с телефона. Файлы — по подписанным ссылкам из списка (на 6 ч): плеер и новая вкладка не умеют
 * ставить заголовок входа Mini App. В Telegram «Открыть» и «Скачать» уходят в браузер телефона.
 */
export function MaterialsTab() {
  const list = useQuery<Listing, ApiError>({
    queryKey: ['platform-materials'],
    queryFn: () => unwrap(api.GET('/api/platform/materials')),
    // Ссылки живут 6 ч; при каждом фокусе не перечитываем — иначе плеер начнёт ролик заново
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
  const files = list.data?.files ?? []
  const videos = files.filter((f) => f.section === 'video')
  const decks = files.filter((f) => f.section === 'presentation')
  const instagram = files.filter((f) => f.section === 'instagram')
  const guides = files.filter((f) => f.section === 'guide')
  const other = files.filter((f) => f.section === 'other')
  return (
    <>
      <section className="card-block">
        <h2>Материалы</h2>
        <p className="hint">Рекламные ролики, презентация для клиник и картинки для Instagram — всегда под рукой: посмотреть,
          показать клинике или скачать на телефон.</p>
        {list.error && <p className="error" role="alert">Не удалось загрузить материалы: {list.error.message}</p>}
        {list.isPending && <Loading />}
        {list.data && !list.data.configured && (
          <EmptyState compact title="Каталог материалов не подключён">На сервере нужен MARKETING_DIR — после обновления
            по README («Платформа → Материалы») он подключается сам. Ссылки ниже работают и без него.</EmptyState>
        )}
        {list.data?.configured && files.length === 0 && (
          <EmptyState compact title="Файлов пока нет">Положите их в docs/marketing репозитория и обновите сервер.</EmptyState>
        )}
      </section>
      <LinksBlock />
      {videos.length > 0 && <VideosBlock files={videos} onExpired={() => void list.refetch()} />}
      {decks.length > 0 && (
        <section className="card-block" aria-label="Презентация">
          <h2>Презентация</h2>
          <ul className="materials-list">{decks.map((f) => <FileRow key={f.path} file={f} label={deckLabel(f)} />)}</ul>
        </section>
      )}
      {guides.length > 0 && (
        <section className="card-block" aria-label="Инструкция для клиник">
          <h2>Инструкция для клиник</h2>
          <p className="hint">Руководство Tish одним PDF — отправить клинике или распечатать. Для одной роли — печатная версия
            на сайте: <a href="/guide?print=1" target="_blank" rel="noopener noreferrer">tish.kg/guide?print=1</a> (вверху — выбор роли в обычной версии).</p>
          <ul className="materials-list">{guides.map((f) => <FileRow key={f.path} file={f} label={f.name ?? ''} />)}</ul>
        </section>
      )}
      {instagram.length > 0 && (
        <section className="card-block" aria-label="Instagram">
          <h2>Instagram</h2>
          <div className="materials-images">
            {instagram.filter((f) => f.kind === 'image').map((f) => <ImageCard key={f.path} file={f} />)}
          </div>
        </section>
      )}
      {other.length > 0 && (
        <section className="card-block" aria-label="Другое">
          <h2>Другое</h2>
          <ul className="materials-list">{other.map((f) => <FileRow key={f.path} file={f} label={f.name ?? ''} />)}</ul>
        </section>
      )}
    </>
  )
}

/** «Ссылки»: сайт-визитка и Instagram — открыть или скопировать, чтобы отправить клинике. */
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

function deckLabel(f: Material): string {
  return f.kind === 'pdf' ? 'Презентация · PDF' : f.kind === 'pptx' ? 'Презентация · PowerPoint' : (f.name ?? '')
}

/** Ролики по папкам: самая новая версия открыта сразу, остальные — свёрнуты (плееры грузятся при раскрытии). */
function VideosBlock({ files, onExpired }: { files: Material[]; onExpired: () => void }) {
  const folders = [...new Set(files.map((f) => f.folder ?? ''))]
    .sort((a, b) => folderRank(a) - folderRank(b) || a.localeCompare(b))
  const [first, ...rest] = folders
  return (
    <section className="card-block" aria-label="Ролики">
      <h2>Ролики</h2>
      <h3>{folderTitle(first ?? '')}</h3>
      <VideoGroup files={files.filter((f) => (f.folder ?? '') === (first ?? ''))} onExpired={onExpired} />
      {rest.map((folder) => <FolderDetails key={folder} folder={folder} files={files.filter((f) => (f.folder ?? '') === folder)} onExpired={onExpired} />)}
    </section>
  )
}

function FolderDetails({ folder, files, onExpired }: { folder: string; files: Material[]; onExpired: () => void }) {
  const [open, setOpen] = useState(false)
  const count = files.filter((f) => f.kind === 'video').length
  return (
    <details className="materials-folder" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{folderTitle(folder)} <span className="hint">· {count} {count === 1 ? 'ролик' : count < 5 ? 'ролика' : 'роликов'}</span></summary>
      {open && <VideoGroup files={files} onExpired={onExpired} />}
    </details>
  )
}

function VideoGroup({ files, onExpired }: { files: Material[]; onExpired: () => void }) {
  const videos = files.filter((f) => f.kind === 'video')
  const extras = files.filter((f) => f.kind !== 'video')
  return (
    <>
      <div className="materials-videos">{videos.map((f) => <VideoCard key={f.path} file={f} onExpired={onExpired} />)}</div>
      {extras.length > 0 && (
        <ul className="materials-list">
          {extras.map((f) => <FileRow key={f.path} file={f} label={f.kind === 'subtitles' ? `Субтитры · ${f.name}` : f.kind === 'image' ? `Обложка · ${f.name}` : (f.name ?? '')} />)}
        </ul>
      )}
    </>
  )
}

function VideoCard({ file, onExpired }: { file: Material; onExpired: () => void }) {
  const [failed, setFailed] = useState(false)
  const label = videoLabel(file.name ?? '', file.folder ?? '')
  return (
    <figure className="materials-video">
      <video controls preload="metadata" playsInline src={file.url} aria-label={label} onError={() => setFailed(true)} />
      <figcaption>
        <span className="strong">{label}</span>
        <span className="hint small">{file.name} · <span className="num">{sizeText(file.size ?? 0)}</span></span>
        {failed && (
          <span className="error small" role="alert">Ролик не проигрывается здесь: ссылка могла устареть (обновите) или браузер
            не знает этот формат — тогда «Открыть» или «Скачать».{' '}
            <button type="button" className="btn small" onClick={() => { setFailed(false); onExpired() }}>Обновить</button></span>
        )}
        <Buttons file={file} label={label} />
      </figcaption>
    </figure>
  )
}

function ImageCard({ file }: { file: Material }) {
  return (
    <figure className="materials-image">
      <img src={file.url} alt={`Картинка ${file.name}`} loading="lazy" />
      <figcaption>
        <span className="hint small">{file.name}</span>
        <Buttons file={file} label={file.name ?? ''} />
      </figcaption>
    </figure>
  )
}

function FileRow({ file, label }: { file: Material; label: string }) {
  return (
    <li>
      <span className="materials-name">
        <span className="strong">{label}</span>
        <span className="hint small">{file.name} · <span className="num">{sizeText(file.size ?? 0)}</span>
          {file.modified && <> · {shortDate(file.modified)}</>}</span>
      </span>
      <Buttons file={file} label={label} />
    </li>
  )
}

/** «Открыть» — во вкладке (в Telegram — браузером телефона), «Скачать» — файлом. */
function Buttons({ file, label }: { file: Material; label: string }) {
  const open = absolute(file.url ?? '')
  const download = absolute(file.downloadUrl ?? '')
  return (
    <span className="actions">
      <a className="btn small" href={open} target="_blank" rel="noreferrer" onClick={inTelegram(open)} aria-label={`Открыть: ${label}`}>Открыть</a>
      <a className="btn small" href={download} download={file.name} onClick={inTelegram(download)} aria-label={`Скачать: ${label}`}>Скачать</a>
    </span>
  )
}
