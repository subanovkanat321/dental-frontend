import type { HowToVideo } from '../api/client'

/** Длительность карточки: 22 → «0:22». */
export function duration(seconds?: number | null): string | null {
  if (seconds == null || seconds <= 0) return null
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Ролики группами по разделу Tish — в порядке списка бэкенда (Materials.HOWTO). */
export function groupVideos(list: HowToVideo[]): [string, HowToVideo[]][] {
  const groups = new Map<string, HowToVideo[]>()
  for (const v of list) groups.set(v.section, [...(groups.get(v.section) ?? []), v])
  return [...groups]
}
