/// <reference lib="webworker" />
/**
 * Сетки считаются в Web Worker — отдельном потоке браузера: пока строится модель (около секунды),
 * экран не замирает, кнопки и вращение работают. Готовые массивы передаём без копирования (transfer).
 */
import { buildJawShapes } from './jawModel'
import type { MeshData } from './mesher'
import { createToothBuilder, type ToothGroup } from './toothModel'

export type GeometryRequest = { group: ToothGroup | 'jaw' }
export type GeometryResponse = { group: ToothGroup | 'jaw'; meshes: [string, MeshData][] } | { group: ToothGroup | 'jaw'; error: string }

const tooth = createToothBuilder()

self.onmessage = (e: MessageEvent<GeometryRequest>) => {
  const { group } = e.data
  try {
    const meshes: [string, MeshData][] = group === 'jaw' ? buildJawShapes() : tooth.build(group)
    const transfer: Transferable[] = []
    for (const [, m] of meshes) {
      transfer.push(m.positions.buffer, m.normals.buffer, m.indices.buffer)
      if (m.uvs) transfer.push(m.uvs.buffer)
      if (m.colors) transfer.push(m.colors.buffer)
    }
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ group, meshes } satisfies GeometryResponse, transfer)
  } catch (err) {
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ group, error: String(err) } satisfies GeometryResponse)
  }
}
