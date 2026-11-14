import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useBack } from '../lib/back'
import { EmptyState } from '../layout/EmptyState'
import { Loading } from '../layout/Loading'
import { Segments } from '../layout/Segments'
import { TISH_INSTAGRAM, TISH_INSTAGRAM_NAME } from '../lib/brand'
import { openLink } from '../lib/telegram'
import { SubHeader } from './SubHeader'
import { howToVideos, type HowToVideo } from '../api/client'
import { duration, groupVideos } from './howto'
import './howto.css'

/** Для поиска: строчные, «ё» как «е». */
function fold(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е')
}

const WATCHED = 'tish.howto.watched'

/** Просмотренные ролики — id через запятую (не ПДн); хранилище недоступно — без отметок. */
function readWatched(): Set<string> {
  try {
    return new Set((window.localStorage.getItem(WATCHED) ?? '').split(',').filter(Boolean))
  } catch {
    return new Set()
  }
}

function saveWatched(ids: Set<string>): void {
  try {
    window.localStorage.setItem(WATCHED, [...ids].join(','))
  } catch {
    // не запомним — не страшно
  }
}

/** Ролик из адреса: #/help/videos/zapis (ссылка «🎬 Видео» из руководства). */
function videoInHash(): string | null {
  const [name, item, id] = window.location.hash.replace(/^#\/?/, '').split('/')
  return name === 'help' && item === 'videos' && id ? id : null
}

/**
 * «Помощь → Видео: как сделать»: короткие ролики по одной функции — карточками (обложка, название, длительность,
 * «✓ Просмотрено»), группами по разделам Tish, с поиском. Нажал — просмотрщик на весь экран с «Следующее видео ›».
 * Ролики отдаёт бэкенд из docs/marketing/howto (/web/materials/howto, белый список); сняты на вымышленной клинике.
 */
export function HowToPage({ onBack }: { onBack: () => void }) {
  const list = useQuery({ queryKey: ['howto-videos'], queryFn: howToVideos, staleTime: 10 * 60_000 })
  const [openId, setOpenId] = useState<string | null>(videoInHash)
  const [query, setQuery] = useState('')
  const [section, setSection] = useState<string | null>(null)
  const [watched, setWatched] = useState(readWatched)
  const videos = useMemo(() => list.data ?? [], [list.data])
  const groups = useMemo(() => groupVideos(videos), [videos])
  const words = fold(query).trim().split(' ').filter(Boolean)
  const shown = videos.filter((v) => (!section || v.section === section)
    && words.every((w) => fold(`${v.title} ${v.lead} ${v.section}`).includes(w)))
  const open = openId ? videos.find((v) => v.id === openId) ?? null : null
  const next = open ? videos[videos.indexOf(open) + 1] ?? null : null

  const closePlayer = () => {
    setOpenId(null)
    // Открыли по ссылке из руководства (#/help/videos/zapis) — без ролика в адресе: обновили страницу — список, а не тот же ролик
    if (videoInHash()) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#/help/videos`)
  }
  const markWatched = (id: string) => setWatched((w) => {
    if (w.has(id)) return w
    const n = new Set(w).add(id)
    saveWatched(n)
    return n
  })

  return (
    <div className="schedule-main howto-page">
      <SubHeader title="Видео: как сделать" onBack={onBack} />
      {list.isPending ? <Loading />
        : list.isError ? <p className="error" role="alert">Не удалось загрузить список видео — проверьте интернет и откройте снова</p>
          : !videos.length ? (
            <EmptyState title="Видео пока нет" action={<button type="button" className="btn" onClick={() => openLink(TISH_INSTAGRAM)}>Instagram {TISH_INSTAGRAM_NAME}</button>}>
              Ролики скоро появятся здесь. Пока — короткие видео в Instagram Tish и «Руководство» в «Помощи».
            </EmptyState>
          ) : (
            <>
              <p className="hint howto-intro">Ролики по 20–40 секунд, без звука — шаги подписями. Просмотрено: {videos.filter((v) => watched.has(v.id)).length} из {videos.length}</p>
              <div className="howto-tools">
                <input type="search" className="book-search" placeholder="Найти видео: запись, касса…" aria-label="Поиск видео"
                  value={query} onChange={(e) => setQuery(e.target.value)} />
                {/* Разделов много: на телефоне — выпадающий список (layout/Segments), на компьютере — таблетки */}
                <Segments label="Раздел" className="wrap" value={section ?? ''} onChange={(v) => setSection(v || null)}
                  options={[{ value: '', label: 'Все' }, ...groups.map(([name]) => ({ value: name, label: name }))]} />
              </div>
              {!shown.length ? <p className="hint" role="status">Ничего не нашли — попробуйте другое слово или «Все».</p>
                : (
                  // Каждая группа — свой блок: заголовок на всю ширину и своя сетка, новая группа — с новой строки
                  // (потоком группы путались: «Расписание» продолжалось в строке «Начала работы»). Выбран раздел —
                  // заголовок не нужен: он уже на таблетке фильтра
                  <div className="howto-groups">
                    {groupVideos(shown).map(([name, items]) => (
                      <section key={name} className="howto-group" aria-label={name}>
                        {!section && <h2>{name}</h2>}
                        <ul className="howto-grid">
                          {items.map((v) => <li key={v.id}><Tile video={v} watched={watched.has(v.id)} onOpen={() => setOpenId(v.id)} /></li>)}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
            </>
          )}
      {open && <HowToPlayer key={open.id} video={open} next={next} onWatched={() => markWatched(open.id)}
        onNext={() => next && setOpenId(next.id)} onClose={closePlayer} />}
    </div>
  )
}

function Tile({ video: v, watched, onOpen }: { video: HowToVideo; watched: boolean; onOpen: () => void }) {
  const time = duration(v.seconds)
  return (
    <button type="button" className="howto-tile" onClick={onOpen} aria-label={`${v.title}${time ? `, ${time}` : ''}${watched ? ', просмотрено' : ''}`}>
      <span className="howto-cover">
        {v.poster ? <img src={v.poster} alt="" loading="lazy" width={360} height={640} />
          : <span className="howto-noposter" aria-hidden="true">🎬</span>}
        <span className="howto-play" aria-hidden="true">▶</span>
        {time && <span className="howto-time" aria-hidden="true">{time}</span>}
        {watched && <span className="howto-seen" aria-hidden="true">✓ Просмотрено</span>}
      </span>
      <span className="howto-title">{v.title}</span>
      <span className="howto-lead hint">{v.lead}</span>
    </button>
  )
}

/** Просмотрщик поверх всего экрана: ✕, «назад» телефона и Esc закрывают; досмотрели — «Следующее видео ›». */
function HowToPlayer({ video, next, onWatched, onNext, onClose }: {
  video: HowToVideo; next: HowToVideo | null; onWatched: () => void; onNext: () => void; onClose: () => void
}) {
  useBack(onClose)
  const close = useRef<HTMLButtonElement>(null)
  const [ended, setEnded] = useState(false)
  useEffect(() => {
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="howto-player" role="dialog" aria-modal="true" aria-label={video.title}>
      <div className="howto-player-head">
        <div className="howto-player-title"><strong>{video.title}</strong><span>{video.section}</span></div>
        <button ref={close} type="button" className="btn ghost" aria-label="Закрыть видео" onClick={onClose}>✕</button>
      </div>
      {/* playsInline: на iPhone ролик играет здесь, а не в системном плеере; во весь экран — кнопкой плеера */}
      <video src={video.video} poster={video.poster ?? undefined} controls playsInline autoPlay preload="metadata"
        onEnded={() => { onWatched(); setEnded(true) }} onTimeUpdate={(e) => {
          const v = e.currentTarget
          // Досмотрели почти до конца — уже просмотрено (последние кадры — заставка)
          if (v.duration > 0 && v.currentTime / v.duration > 0.8) onWatched()
        }} />
      <div className={ended ? 'howto-player-foot ended' : 'howto-player-foot'}>
        {next ? <button type="button" className="btn primary" onClick={onNext}>Следующее видео › <span className="howto-next-title">{next.title}</span></button>
          : <span>Это последнее видео — вы посмотрели всё</span>}
      </div>
    </div>
  )
}
