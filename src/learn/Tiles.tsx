import type { Lang } from './catalog'
import { TOPIC_LIST, type Topic } from './topics'

/** Обложки тем: рисунок первого слайда на светлой пластине, название и сколько слайдов. */
export function TopicTiles({ lang, onOpen, href }: { lang: Lang; onOpen?: (topic: Topic) => void; href?: (topic: Topic) => string }) {
  return (
    <ul className="learn-grid">
      {TOPIC_LIST.map((t) => {
        const inner = (
          <>
            <div className="learn-art">{t.cover(lang)}</div>
            <strong>{t.title[lang]}</strong>
            <span>{lang === 'ky' ? `${t.slides.length} слайд · ~1 мүнөт` : `${t.slides.length} слайдов · ~1 минута`}</span>
          </>
        )
        return (
          <li key={t.slug}>
            {href
              ? <a className="learn-tile" href={href(t)}>{inner}</a>
              : <button type="button" className="learn-tile" onClick={() => onOpen?.(t)}>{inner}</button>}
          </li>
        )
      })}
    </ul>
  )
}
