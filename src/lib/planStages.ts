/**
 * Этапы плана лечения (V140): «сначала — потом». Процедуры группой по номеру этапа (по возрастанию,
 * внутри — как пришли с сервера) и сумма за этап. Цены нет — в сумму не входит.
 */
export function stagesOf<T extends { stage?: number; priceSom?: number | null }>(items: T[]): { stage: number; items: T[]; total: number }[] {
  const byStage = new Map<number, T[]>()
  for (const item of items) {
    const n = item.stage ?? 1
    byStage.set(n, [...(byStage.get(n) ?? []), item])
  }
  return [...byStage.entries()].sort(([a], [b]) => a - b)
    .map(([stage, list]) => ({ stage, items: list, total: list.reduce((sum, x) => sum + (x.priceSom ?? 0), 0) }))
}
