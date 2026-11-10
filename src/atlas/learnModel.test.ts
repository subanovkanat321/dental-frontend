import { buildLearn, LEARN_ANCHORS, lesionBlob, SECTION_IDS, SEGMENT_IDS, chipCut, boneCrest, BONE_TOP, gumTop, type LearnGeoId } from './geometry/learnModel'
import { rootOuter, TISSUES } from './geometry/toothModel'

/** Сетки сцен презентаций (крупный шаг — быстро): в каждой есть то, ради чего сцена. */
const MUST: Partial<Record<LearnGeoId, string[]>> = {
  plaque: ['plaque', 'enamel', 'gum'],
  tartar: ['tartar'],
  'tartar-below': ['tartar', 'tartarDeep'],
  perio: ['tartarDeep', 'cortical'],
  'pulp-dead': ['caries', 'pulp'],
  abscess: ['lesion'],
  spot: ['spot'],
  'crack-chip': ['filling', 'gutta'],
  sealant: ['sealant'],
  socket: ['clot', 'gumCap', 'newBone'],
  kid: ['enamel', 'germEnamel', 'follicle'],
  'kid-deep': ['caries', 'lesion'],
  'kid-lost': ['germEnamel'],
  'wisdom-half': ['l2tooth', 'lgum'],
  'wisdom-decay': ['l1caries'],
  'gap-3': ['u1tooth', 'ugum', 'lcortical'],
}

describe('сцены презентаций (learnModel)', () => {
  it.each([...SECTION_IDS, ...SEGMENT_IDS])('%s: есть точки подписей; сетки строятся, нужные части на месте', (id) => {
    expect(LEARN_ANCHORS[id]).toBeDefined()
    const names = buildLearn(id, 0.05).map((m) => m.name)
    expect(names.length).toBeGreaterThan(3)
    for (const n of MUST[id] ?? []) expect(names, n).toContain(n)
  })

  it('убыль кости опускает гребень и десну; очаг у корня — у верхушки, скол — у края коронки', () => {
    expect(boneCrest(0.85, 0, 0)).toBeCloseTo(BONE_TOP)
    expect(boneCrest(0.6, 0, 1)).toBeLessThan(boneCrest(0.6, 0, 0.45))
    expect(gumTop(0.6, 0, { boneLoss: 1 })).toBeLessThan(gumTop(0.6, 0))
    expect(gumTop(0.6, 0, { swollen: true })).toBeGreaterThan(gumTop(0.6, 0))
    expect(lesionBlob(0.4, -1.9, 0)).toBeLessThan(0)
    expect(lesionBlob(0.4, -1.0, 0)).toBeGreaterThan(0)
    // Скол убирает угол коронки, а не корень
    expect(chipCut(0.5, 0.8, 0)).toBeGreaterThan(0)
    expect(chipCut(0.3, -0.5, 0)).toBeLessThan(0)
    expect(rootOuter(0.4, -1.8, 0)).toBeLessThan(0.05)
  })

  it('метки разреза — внутри своей ткани здорового зуба (как в атласе)', () => {
    const a = LEARN_ANCHORS.tartar
    for (const t of ['enamel', 'dentin', 'pulp', 'gum', 'bone'] as const) {
      const [x, y, z] = a[t]!
      expect(TISSUES[t](x, y, z - 0.004), t).toBeLessThan(0)
    }
  })
})
