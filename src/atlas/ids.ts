/**
 * Самое маленькое о режимах и номерах зубов — то, что нужно маршруту в основном бандле CRM.
 * Тексты атласа (content.ts) сюда не тянем: они грузятся вместе с атласом, отдельным чанком.
 */
export const MODE_IDS = ['healthy', 'caries', 'endo', 'filling', 'crown', 'implant'] as const
export type AtlasMode = (typeof MODE_IDS)[number]

export const isMode = (v: unknown): v is AtlasMode => (MODE_IDS as readonly unknown[]).includes(v)

export function isFdi(code: number): boolean {
  const q = Math.floor(code / 10), n = code % 10
  return Number.isInteger(code) && q >= 1 && q <= 4 && n >= 1 && n <= 8
}
