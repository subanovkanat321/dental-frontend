import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { Schemas } from '../api/client'
import { useBack } from '../lib/back'
import { openHelpChat } from '../lib/helpChat'
import { openMine } from '../lib/route'
import { useMedia } from '../lib/useMedia'
import { useSwipeDown } from '../layout/useSwipeDown'
import {
  hashPlaceParts, pageIndex, pagesOf, placeHash, placeOf, readLast, resolvePlace, saveLast, searchBook, startPages,
  type BookPage, type Hit, type Place,
} from '../help/book'
import { CHAPTERS, chaptersFor, sectionId, type GuideChapter, type GuideRole } from '../site/guide/content'
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
 * глав → глава → разделы. Компьютер — на всю ширину: оглавление слева (поиск — над ним), текст посередине, на широком
 * экране справа — «Видео по главе» и «Не нашли ответ?»; главная — «Продолжить чтение» и «С чего начать» для роли, а не
 * дубль оглавления карточками (2026-11-14, владелец). Телефон — кнопка «☰ Оглавление» (нижний лист, свайп вниз
 * закрывает), без открытой страницы — «Продолжить чтение» и оглавление на весь экран. Внизу — «‹ Предыдущая |
 * Следующая ›», сверху — «где я» (Руководство › Касса › Общие расходы). Адрес раздела — #/help/guide/<глава>/<раздел>;
 * где остановились — в localStorage (не ПДн).
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
  // Третья колонка — только где для неё есть место (иначе текст сжался бы); без matchMedia (тесты) — без неё
  const wide = useMedia('(min-width: 1400px)')
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
  const search = (
    <input type="search" className="book-search" placeholder="Поиск по руководству" aria-label="Поиск по руководству"
      value={query} onChange={(e) => setQuery(e.target.value)} />
  )
  const last = page ? undefined : lastPageIn(chapters)

  return (
    <div className="schedule-main guide-book manual" ref={top}>
      <SubHeader title="Руководство" onBack={onBack} />
      {/* Телефон — поиск и «☰ Оглавление» строкой сверху; компьютер — поиск в колонке оглавления, по сетке */}
      {phone && (
        <div className="book-tools">
          {page && <button type="button" className="btn" aria-haspopup="dialog" onClick={() => setSheet(true)}>☰ Оглавление</button>}
          {search}
        </div>
      )}
      <div className={wide && !phone ? 'book with-aside' : 'book'}>
        {!phone && <nav className="book-toc" aria-label="Оглавление">{search}{toc}</nav>}
        <div className="book-main">
          {hits ? <Results hits={hits} all={all} onAll={() => setAll(true)} onGo={go} />
            : page ? (
              <>
                <Crumbs page={page} onGo={go} />
                <Reader page={page} number={chapters.indexOf(page.chapter) + 1} onGo={go} />
                <Pager prev={pages[index - 1]} next={pages[index + 1]} onGo={go} />
              </>
            ) : phone ? (
              <>
                {last && <Continue page={last} onGo={go} />}
                <nav className="book-toc" aria-label="Оглавление">{toc}</nav>
              </>
            ) : <Cover chapters={chapters} last={last} role={role} onGo={go} />}
        </div>
        {wide && !phone && <Aside chapter={hits ? null : page?.chapter ?? null} />}
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

/** Где остановились — если это место есть в показанных главах. */
function lastPageIn(chapters: GuideChapter[]): BookPage | undefined {
  const place = resolvePlace(readLast() ?? [], chapters)
  const pages = pagesOf(chapters)
  return place ? pages[pageIndex(pages, place)] : undefined
}

/** «Продолжить чтение: Новая запись ›» — одной строкой-кнопкой, с главой мелко. */
function Continue({ page, onGo }: { page: BookPage; onGo: (p: Place) => void }) {
  const title = page.section ? page.section.title : page.chapter.title
  return (
    <button type="button" className="book-continue" onClick={() => onGo(placeOf(page))} aria-label={`Продолжить чтение: ${title}`}>
      <span className="book-continue-text">
        <span className="hint">Продолжить чтение{page.section ? ` · ${page.chapter.title}` : ''}</span>
        <strong>{title}</strong>
      </span>
      <span className="book-continue-go" aria-hidden="true">›</span>
    </button>
  )
}

/**
 * Компьютер без открытой страницы: «Продолжить чтение» и «С чего начать» для роли. Главы — только в оглавлении слева:
 * сетка карточек глав дублировала его один в один. «Новое» не показываем — у разделов нет даты обновления.
 */
function Cover({ chapters, last, role, onGo }: { chapters: GuideChapter[]; last?: BookPage; role: GuideRole; onGo: (p: Place) => void }) {
  const start = startPages(role, chapters)
  return (
    <section className="book-cover" aria-label="Руководство Tish">
      <h2>Руководство Tish</h2>
      <p className="hint">Как работать в Tish — по главам, шаг за шагом, с картинками. Главы — в оглавлении слева, поиск — над ним.</p>
      {last && <Continue page={last} onGo={onGo} />}
      {start.length > 0 && (
        <section className="book-start" aria-labelledby="book-start">
          <h3 id="book-start">С чего начать</h3>
          <ol className="book-picks">
            {start.map((p) => (
              <li key={sectionId(p.section!)}>
                <button type="button" className="book-pick" onClick={() => onGo(placeOf(p))}>
                  <span className="book-pick-chapter">{p.chapter.title}</span>
                  <strong>{p.section!.title}</strong>
                  {p.section!.text && <span className="hint book-pick-text">{p.section!.text}</span>}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  )
}

/**
 * Широкий экран — колонка справа, чтобы не было пустой половины: ролики к разделам открытой главы (в «Видео: как
 * сделать») и «Не нашли ответ?» — помощник и «Написать в Tish». На главной и в поиске — ссылка на все ролики.
 */
function Aside({ chapter }: { chapter: GuideChapter | null }) {
  const videos = chapter ? chapter.sections.filter((s) => s.video) : []
  return (
    <aside className="book-aside" aria-label="Ещё по теме">
      <section className="book-aside-block">
        <h3>{chapter ? 'Видео по главе' : 'Видео: как сделать'}</h3>
        {videos.length > 0 ? (
          <ul>
            {videos.map((s) => (
              <li key={sectionId(s)}><button type="button" className="link" onClick={() => openMine('help', `videos/${s.video}`)}>{s.title}</button></li>
            ))}
          </ul>
        ) : <p className="hint">Ролики по 20–40 секунд: запись, перенос, касса, склад.</p>}
        <button type="button" className="btn small" onClick={() => openMine('help', 'videos')}>Все видео</button>
      </section>
      <section className="book-aside-block">
        <h3>Не нашли ответ?</h3>
        <p className="hint">Помощник ответит сразу; не знает — передаст команде Tish.</p>
        <button type="button" className="btn small" onClick={() => openHelpChat()}>Спросить помощника</button>
        <button type="button" className="link" onClick={() => openMine('help', 'support')}>Написать в Tish</button>
      </section>
    </aside>
  )
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
