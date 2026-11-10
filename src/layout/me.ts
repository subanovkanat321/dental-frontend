import type { Schemas } from '../api/client'

type Me = Schemas['BookingViewsMe']

/** Инициалы для кружка блока «Я»: «Айгерим Садыкова» → «АС», «Асель» → «А». */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'
}

/** Кто вошёл: имя (врачу — как в его карточке) и фото врача, если есть. */
export function whoAmI(me: Me): { name: string; photo?: string } {
  const own = (me.doctors ?? []).find((d) => d.id === me.doctorId)
  return { name: own?.fullName ?? me.fullName ?? 'Без имени', photo: own?.photoUrl }
}
