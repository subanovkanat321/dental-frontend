import type * as THREE from 'three'

import type { MeshData } from '../../src/atlas/geometry/mesher'
import type { createMaterials } from '../../src/atlas/engine/materials'
import type { ToolName } from './instruments'

/** Ключ дорожки: [время, значение] или [время, значение, 'l' — линейно | 's' — скачком]. */
export type Key = [number, number] | [number, number, 'l' | 's']

/** Какое лечение показывает ролик — модуль в procs/. */
export type ProcedureName = 'filling' | 'canal' | 'crown' | 'implant' | 'cleaning'

export interface Scenario {
  width?: number
  height?: number
  procedure?: ProcedureName
  /** Дорожки: cam* — камера; стадии лечения (у каждой процедуры свои); инструменты — по имени. */
  tracks: Record<string, Key[]>
  /** Момент «до» для сравнения до/после (стадии берутся из этого времени). */
  beforeAt?: number
  /**
   * «Толчки» камеры на смене шага (в такт «вжух»): быстрый наезд zoom (доля расстояния, минус — ближе)
   * и крен roll (градусы), затухают за ~1 с.
   */
  kicks?: { t: number; zoom?: number; roll?: number }[]
}

export type State = Record<string, number>

/** Поза инструмента: кончик (от рабочей точки), ось ручки и куда изогнута ручка. */
export interface Pose {
  at: [number, number, number]
  dir: [number, number, number]
  side: [number, number, number]
}

export interface ProcCtx {
  scene: THREE.Scene
  /** Сетка из MeshData с материалом (скрыта, тени включены). */
  mk(m: MeshData, mat: THREE.Material, order?: number): THREE.Mesh
  phys(p: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial
  /** Эмаль с цветом по вершинам, «живой» поверхностью и мокрым лаком. */
  toothMat: THREE.MeshPhysicalMaterial
  /** То же, но поверх совпадающих граней (пломба в полости). */
  toothOverMat: THREE.MeshPhysicalMaterial
  gumMat: THREE.MeshPhysicalMaterial
  /** Материалы 3D-атласа (ткани в разрезе), с мокрым лаком на эмали и десне. */
  atlas(): ReturnType<typeof createMaterials>
}

export interface Procedure {
  /** Рабочая точка: сюда смотрит камера по умолчанию и приходят инструменты. */
  work: [number, number, number]
  /** Позы инструментов этой процедуры (остальные — по умолчанию). */
  poses?: Partial<Record<ToolName, Pose>>
  /** Куда бьёт струя воды (пистолет вода-воздух, шприц для промывки). */
  waterTarget?: [number, number, number]
  /** Ткани и материалы по состоянию. */
  apply(s: State): void
  /** Поверхность для капель воды и где им можно лежать. */
  drops?: { mesh: MeshData; ok(x: number, y: number, z: number, nz: number): boolean }
}
