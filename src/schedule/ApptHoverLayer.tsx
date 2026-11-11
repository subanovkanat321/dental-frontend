import { useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import type { Schemas } from '../api/client'
import { ApptHoverCard } from './ApptHoverCard'
import type { HoverStore } from './hoverStore'

type Me = Schemas['BookingViewsMe']

/** Всплывающая карточка приёма (useApptHover): подписана на хранилище наведения — перерисовывается только она. */
export function ApptHoverLayer({ store, id, me, doctorName }: {
  store: HoverStore
  id: string
  me: Me
  doctorName: (id: number | undefined) => string
}) {
  const shown = useSyncExternalStore(store.subscribe, store.get, store.get)
  useEffect(() => {
    if (!shown) return
    shown.el.setAttribute('aria-describedby', id)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') store.hide() }
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', store.hide, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', store.hide, true)
    }
  }, [shown, id, store])
  if (!shown) return null
  return createPortal(<ApptHoverCard id={id} a={shown.a} rect={shown.rect} me={me} doctor={doctorName(shown.a.doctorId)} />, document.body)
}
