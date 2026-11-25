import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'

type Me = Schemas['BookingViewsMe']

/** Инициалы для кружка блока «Я»: «Айгерим Садыкова» → «АС», «Асель» → «А». */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'
}

/**
 * Кто вошёл: имя (врачу — как в его карточке) и фото врача, если есть. memberName — имя сотрудника в «Персонале»
 * (GET /api/me/name): у руководителя или регистратора без карточки пациента в боте me.fullName пуст, а внизу меню
 * было «Без имени» (QA 2026-11-25).
 */
export function whoAmI(me: Me, memberName?: string | null): { name: string; photo?: string } {
  const own = (me.doctors ?? []).find((d) => d.id === me.doctorId)
  return { name: own?.fullName ?? me.fullName ?? (memberName?.trim() || 'Без имени'), photo: own?.photoUrl }
}

/** {@link whoAmI} с именем из «Персонала», если своего нет: запрос — только тогда (тот же кэш, что у ProfileNotice). */
export function useWhoAmI(me: Me): { name: string; photo?: string } {
  const own = me.doctorId != null && (me.doctors ?? []).some((d) => d.id === me.doctorId)
  const member = useQuery({
    queryKey: ['me-name'],
    queryFn: () => unwrap(api.GET('/api/me/name')),
    enabled: !own && !me.fullName,
    staleTime: 10 * 60_000,
  })
  return whoAmI(me, member.data?.fullName)
}
