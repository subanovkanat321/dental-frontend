import type { Lang } from './catalog'
import { ArtView } from './media'
import { TOPIC_LIST, type Topic } from './topics'

/**
 * Обложки тем: рисунок первого слайда на светлой пластине, название и сколько слайдов. `action` —
 * подпись-кнопка внизу обложки («Показать» в CRM): нажимается вся обложка, подпись — подсказка, что это кнопка.
 */
export function TopicTiles({ lang, onOpen, href, action }: { lang: Lang; onOpen?: (topic: Topic) => void; href?: (topic: Topic) => string; action?: string }) {
  return (
    <ul className="learn-grid">
      {TOPIC_LIST.map((t) => {
        const inner = (
          <>
            <div className="learn-art"><ArtView art={t.cover} lang={lang} place="cover" /></div>
            <strong>{t.title[lang]}</strong>
            <span>{lang === 'ky' ? `${t.slides.length} слайд · ~1 мүнөт` : `${t.slides.length} слайдов · ~1 минута`}</span>
            {action && <span className="learn-show" aria-hidden="true">{action}</span>}
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
