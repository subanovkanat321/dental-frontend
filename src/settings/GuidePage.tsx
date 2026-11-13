import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { Schemas } from '../api/client'
import { useBack } from '../lib/back'
import { openMine } from '../lib/route'
import { useMedia } from '../lib/useMedia'
import { useSwipeDown } from '../layout/useSwipeDown'
import {
  hashPlaceParts, pageIndex, pagesOf, placeHash, placeOf, readLast, resolvePlace, saveLast, searchBook,
  type BookPage, type Hit, type Place,
} from '../help/book'
import { CHAPTERS, chaptersFor, sectionId, type GuideChapter } from '../site/guide/content'
import { Figure } from '../site/guide/Figure'
import { guideRole } from './guides'
import { SubHeader } from './SubHeader'
import '../site/guide/guide.css'
import '../help/book.css'

type Me = Schemas['BookingViewsMe']

/** Есть ли место в этих главах (у роли нет главы «Касса» — ссылка на неё откроет «Все главы»). */
function inChapters(place: Place, chapters: GuideChapter[]): boolean {
  return pageIndex(pagesOf(chapters), place) >= 0
}

/** С чего открыть: место из адреса (подсказка «?», бот, закладка), иначе — где остановились, иначе — оглавление. */
function startPlace(): Place | null {
  const parts = hashPlaceParts()
  return resolvePlace(parts?.length ? parts : readLast() ?? [], CHAPTERS)
}

/**
 * «Помощь → Руководство» — книга прямо в Tish (главы из site/guide/content.ts, те же, что на сайте /guide): оглавление
 * глав → глава → разделы. Компьютер — оглавление слева, текст справа; телефон — кнопка «☰ Оглавление» (нижний лист,
 * свайп вниз закрывает), без открытой страницы — оглавление на весь экран. Внизу — «‹ Предыдущая | Следующая ›»,
 * сверху — «где я» (Руководство › Касса › Общие расходы) и поиск по заголовкам и тексту. Адрес раздела —
 * #/help/guide/<глава>/<раздел>; где остановились — в localStorage (не ПДн).
 */
export function GuidePage({ me, onBack }: { me: Me; onBack: () => void }) {
  const role = guideRole(me)
  const [state, setState] = useState(() => {
    const place = startPlace()
    // Место не для этой роли (ссылка коллеги, старая закладка) — «Все главы», а не пустая страница
    return { place, all: place != null && !inChapters(place, chaptersFor(role)) }
  })
  const { place, all } = state
  const chapters = useMemo(() => chaptersFor(all ? null : role), [all, role])
  const pages = useMemo(() => pagesOf(chapters), [chapters])
  const index = place ? pageIndex(pages, place) : -1
  const page = index >= 0 ? pages[index]! : null
  const [query, setQuery] = useState('')
  const [sheet, setSheet] = useState(false)
  const phone = useMedia('(max-width: 760px)')
  const top = useRef<HTMLDivElement>(null)

  const go = (next: Place | null) => {
    setState((s) => ({ place: next, all: s.all || (next != null && !inChapters(next, chaptersFor(role))) }))
    setQuery('')
    setSheet(false)
  }

  // Адрес — за открытой страницей (replaceState: листание не копит шаги «назад», «‹ Назад» уводит из руководства);
  // где остановились — запомнить. Новая страница — с её начала.
  useLayoutEffect(() => {
    const hash = `#${placeHash(page ? placeOf(page) : null)}`
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash}`)
    if (page) saveLast(placeOf(page))
    window.scrollTo?.(0, 0)
  }, [page])

  // Ссылка на раздел, пока руководство открыто (подсказка «?» сверху, бот) — туда же
  useEffect(() => {
    const onHash = () => {
      const parts = hashPlaceParts()
      if (!parts?.length) return
      const next = resolvePlace(parts, CHAPTERS)
      if (next) go(next)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  })

  const setAll = (next: boolean) => setState((s) => ({
    all: next,
    // Свою роль выбрали, а открыта чужая глава — к оглавлению
    place: s.place && !next && !inChapters(s.place, chaptersFor(role)) ? null : s.place,
  }))

  const toc = <Toc chapters={chapters} page={page} all={all} onAll={setAll} onGo={go} />
  const hits = query.trim() ? searchBook(query, chapters) : null

  return (
    <div className="schedule-main guide-book manual" ref={top}>
      <SubHeader title="Руководство" onBack={onBack} />
      <div className="book-tools">
        {phone && page && <button type="button" className="btn" aria-haspopup="dialog" onClick={() => setSheet(true)}>☰ Оглавление</button>}
        <input type="search" className="book-search" placeholder="Поиск по руководству" aria-label="Поиск по руководству"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="book">
        {!phone && <nav className="book-toc" aria-label="Оглавление">{toc}</nav>}
        <div className="book-main">
          {hits ? <Results hits={hits} all={all} onAll={() => setAll(true)} onGo={go} />
            : page ? (
              <>
                <Crumbs page={page} onGo={go} />
                <Reader page={page} number={chapters.indexOf(page.chapter) + 1} onGo={go} />
                <Pager prev={pages[index - 1]} next={pages[index + 1]} onGo={go} />
              </>
            ) : phone ? <nav className="book-toc" aria-label="Оглавление">{toc}</nav> : <Cover chapters={chapters} onGo={go} />}
        </div>
      </div>
      {sheet && <TocSheet onClose={() => setSheet(false)}>{toc}</TocSheet>}
    </div>
  )
}

/** Оглавление: «Для меня / Все главы», главы по порядку; у открытой — её разделы. */
function Toc({ chapters, page, all, onAll, onGo }: {
  chapters: GuideChapter[]; page: BookPage | null; all: boolean; onAll: (all: boolean) => void; onGo: (p: Place) => void
}) {
  return (
    <>
      <div className="segments" role="group" aria-label="Какие главы">
        <button type="button" aria-pressed={!all} onClick={() => onAll(false)}>Для меня</button>
        <button type="button" aria-pressed={all} onClick={() => onAll(true)}>Все главы</button>
      </div>
      <ol className="book-chapters">
        {chapters.map((c, i) => {
          const open = page?.chapter.id === c.id
          return (
            <li key={c.id} className={open ? 'open' : undefined}>
              <button type="button" className="book-chapter" aria-current={open && !page?.section ? 'page' : undefined}
                aria-expanded={open} onClick={() => onGo({ chapter: c.id })}>
                <span className="book-num">{i + 1}</span> {c.title}
              </button>
              {open && (
                <ol className="book-sections">
                  {c.sections.map((s) => {
                    const id = sectionId(s)
                    return (
                      <li key={id}>
                        <button type="button" aria-current={page?.section && sectionId(page.section) === id ? 'page' : undefined}
                          onClick={() => onGo({ chapter: c.id, section: id })}>{s.title}</button>
                      </li>
                    )
                  })}
                </ol>
              )}
            </li>
          )
        })}
      </ol>
    </>
  )
}

/** Телефон: оглавление нижним листом; свайп вниз, фон, «назад» и ✕ закрывают. */
function TocSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useBack(onClose)
  const box = useRef<HTMLDivElement>(null)
  useSwipeDown(box, onClose)
  // Открытый раздел — посередине списка; прокручивается только список, шапка листа («Оглавление ✕») остаётся на месте
  useEffect(() => {
    const list = box.current?.querySelector<HTMLElement>('.book-toc')
    const current = list?.querySelector<HTMLElement>('[aria-current=page]')
    if (list && current) list.scrollTop = current.offsetTop - list.offsetTop - list.clientHeight / 2
  }, [])
  return createPortal(
    <div className="ui-select-backdrop confirm-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} role="dialog" aria-modal="true" aria-label="Оглавление" className="confirm sheet book-sheet"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <div className="block-head" data-sheet-grip>
          <h2>Оглавление</h2>
          <button type="button" className="btn ghost small" aria-label="Закрыть" onClick={onClose}>✕</button>
        </div>
        <nav className="book-toc" aria-label="Главы">{children}</nav>
      </div>
    </div>,
    document.body,
  )
}

/** Где я: Руководство › Касса › Общие расходы. */
function Crumbs({ page, onGo }: { page: BookPage; onGo: (p: Place | null) => void }) {
  return (
    <nav className="book-crumbs" aria-label="Где я">
      <ol>
        <li><button type="button" className="link" onClick={() => onGo(null)}>Руководство</button></li>
        <li>{page.section
          ? <button type="button" className="link" onClick={() => onGo({ chapter: page.chapter.id })}>{page.chapter.title}</button>
          : <span aria-current="page">{page.chapter.title}</span>}</li>
        {page.section && <li><span aria-current="page">{page.section.title}</span></li>}
      </ol>
    </nav>
  )
}

/** Страница книги: начало главы (вступление и разделы) или раздел — текст, шаги, картинка, совет. */
function Reader({ page, number, onGo }: { page: BookPage; number: number; onGo: (p: Place) => void }) {
  const { chapter, section: s } = page
  if (!s) {
    return (
      <article className="book-page" aria-labelledby="book-title">
        <p className="book-kicker">Глава {number}</p>
        <h2 id="book-title">{chapter.title}</h2>
        <p className="manual-intro">{chapter.intro}</p>
        <ol className="book-list">
          {chapter.sections.map((x) => (
            <li key={sectionId(x)}><button type="button" className="link" onClick={() => onGo({ chapter: chapter.id, section: sectionId(x) })}>{x.title}</button></li>
          ))}
        </ol>
      </article>
    )
  }
  return (
    <article className="book-page manual-section" aria-labelledby="book-title">
      <h2 id="book-title">{s.title}</h2>
      {s.text && <p>{s.text}</p>}
      {s.steps.length > 0 && <ol className="manual-steps">{s.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
      {/* Ролик к разделу — в «Видео: как сделать» (свой просмотрщик, «следующее видео»); «назад» вернёт сюда */}
      {s.video && <p className="manual-video"><button type="button" className="link" onClick={() => openMine('help', `videos/${s.video}`)}>🎬 Видео: как это сделать</button></p>}
      {s.image && <Figure image={s.image} />}
      {s.tip && <p className="manual-tip"><strong>Совет.</strong> {s.tip}</p>}
    </article>
  )
}

function pageTitle(p: BookPage): string {
  return p.section ? p.section.title : `Глава: ${p.chapter.title}`
}

/** Внизу страницы: «‹ Предыдущая | Следующая ›» с названиями. */
function Pager({ prev, next, onGo }: { prev?: BookPage; next?: BookPage; onGo: (p: Place) => void }) {
  return (
    <nav className="book-pager" aria-label="Листать">
      {prev ? (
        <button type="button" className="btn book-prev" onClick={() => onGo(placeOf(prev))} aria-label={`Предыдущая: ${pageTitle(prev)}`}>
          <span>‹ Предыдущая</span><small>{pageTitle(prev)}</small>
        </button>
      ) : <span />}
      {next && (
        <button type="button" className="btn book-next" onClick={() => onGo(placeOf(next))} aria-label={`Следующая: ${pageTitle(next)}`}>
          <span>Следующая ›</span><small>{pageTitle(next)}</small>
        </button>
      )}
    </nav>
  )
}

/** Компьютер без открытой страницы: «продолжить чтение» и главы карточками. */
function Cover({ chapters, onGo }: { chapters: GuideChapter[]; onGo: (p: Place) => void }) {
  const last = resolvePlace(readLast() ?? [], chapters)
  const lastPage = last ? pagesOf(chapters)[pageIndex(pagesOf(chapters), last)] : undefined
  return (
    <section className="book-cover" aria-label="Главы руководства">
      <h2>Руководство Tish</h2>
      <p className="hint">Как работать в Tish — по главам, шаг за шагом, с картинками. Номера на картинках совпадают с шагами.</p>
      {lastPage && (
        <p><button type="button" className="btn primary" onClick={() => onGo(placeOf(lastPage))}>Продолжить: {lastPage.chapter.title}{lastPage.section ? ` › ${lastPage.section.title}` : ''}</button></p>
      )}
      <ol className="book-cards">
        {chapters.map((c, i) => (
          <li key={c.id}>
            <button type="button" className="book-card" onClick={() => onGo({ chapter: c.id })}>
              <span className="book-num">{i + 1}</span>
              <strong>{c.title}</strong>
              <span className="hint">{c.sections.length} {plural(c.sections.length)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

function plural(n: number): string {
  const d = n % 10
  const h = n % 100
  if (d === 1 && h !== 11) return 'раздел'
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 'раздела'
  return 'разделов'
}

/** Результаты поиска: «Касса › Общие расходы» и отрывок с найденным словом. */
function Results({ hits, all, onAll, onGo }: { hits: Hit[]; all: boolean; onAll: () => void; onGo: (p: Place) => void }) {
  if (!hits.length) {
    return (
      <div className="book-results" role="status">
        <p>Ничего не нашли. Попробуйте другое слово — например, «оплата», «пароль», «склад».</p>
        {!all && <button type="button" className="btn" onClick={onAll}>Искать во всех главах</button>}
      </div>
    )
  }
  return (
    <section className="book-results" aria-label="Результаты поиска">
      <p className="hint" role="status">Найдено: {hits.length}</p>
      <ul>
        {hits.map((h) => {
          const place: Place = h.section ? { chapter: h.chapter.id, section: sectionId(h.section) } : { chapter: h.chapter.id }
          return (
            <li key={placeHash(place)}>
              <button type="button" className="book-hit" onClick={() => onGo(place)}>
                <strong>{h.chapter.title}{h.section ? ` › ${h.section.title}` : ''}</strong>
                <span className="hint">{h.snippet[0]}<mark>{h.snippet[1]}</mark>{h.snippet[2]}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
