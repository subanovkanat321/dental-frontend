import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { useBack } from '../lib/back'
import { EmptyState } from '../layout/EmptyState'
import { Loading } from '../layout/Loading'
import { TISH_INSTAGRAM, TISH_INSTAGRAM_NAME } from '../lib/brand'
import { openLink } from '../lib/telegram'
import { SubHeader } from './SubHeader'
import { howToVideos, type HowToVideo } from '../api/client'
import './howto.css'

/**
 * «Помощь → Видео: как сделать»: короткие ролики по одной функции (запись, перенос, касса…) — сетка обложек,
 * нажал — ролик во весь экран (на телефоне — на весь экран, на компьютере — по высоте окна). Ролики отдаёт
 * бэкенд из docs/marketing/howto (/web/materials/howto, белый список); сняты на вымышленной клинике.
 */
export function HowToPage({ onBack }: { onBack: () => void }) {
  const list = useQuery({ queryKey: ['howto-videos'], queryFn: howToVideos, staleTime: 10 * 60_000 })
  const [open, setOpen] = useState<HowToVideo | null>(null)
  return (
    <div className="schedule-main howto-page">
      <SubHeader title="Видео: как сделать" onBack={onBack} />
      {/* «Нажмите на ролик» — только когда есть на что нажимать */}
      {list.data?.length ? <p className="hint">Ролики по 20–40 секунд, без звука: шаги — подписями на экране. Нажмите на ролик.</p> : null}
      {list.isPending ? <Loading />
        : list.isError ? <p className="error" role="alert">Не удалось загрузить список видео — проверьте интернет и откройте снова</p>
          : !list.data.length ? (
            <EmptyState title="Видео пока нет" action={<button type="button" className="btn" onClick={() => openLink(TISH_INSTAGRAM)}>Instagram {TISH_INSTAGRAM_NAME}</button>}>
              Ролики скоро появятся здесь. Пока — короткие видео в Instagram Tish и «Руководство» в «Помощи».
            </EmptyState>
          )
            : (
              <ul className="howto-grid" aria-label="Видео-инструкции">
                {list.data.map((v) => (
                  <li key={v.id}>
                    <button type="button" className="howto-tile" onClick={() => setOpen(v)}>
                      {v.poster ? <img src={v.poster} alt="" loading="lazy" width={360} height={640} />
                        : <span className="howto-noposter" aria-hidden="true">🎬</span>}
                      <span className="howto-title">{v.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
      {open && <HowToPlayer video={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** Плеер поверх всего экрана: ✕, «назад» телефона и Esc закрывают. */
function HowToPlayer({ video, onClose }: { video: HowToVideo; onClose: () => void }) {
  useBack(onClose)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="howto-player" role="dialog" aria-modal="true" aria-label={video.title}>
      <div className="howto-player-head">
        <strong>{video.title}</strong>
        <button ref={close} type="button" className="btn ghost" aria-label="Закрыть видео" onClick={onClose}>✕</button>
      </div>
      {/* playsInline: на iPhone ролик играет здесь, а не в системном плеере; во весь экран — кнопкой плеера */}
      <video src={video.video} poster={video.poster ?? undefined} controls playsInline autoPlay preload="metadata" />
    </div>
  )
}
