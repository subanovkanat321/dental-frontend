import type { Schemas } from '../api/client'

/** Подпись готовой картинки «до / после» в «Снимках и фото» — по ней её узнаём и не берём исходным фото. */
export const COMPOSITE = 'До / после · Instagram'

export function isComposite(f: Schemas['PatientFilesView']): boolean {
  return f.caption === COMPOSITE
}
