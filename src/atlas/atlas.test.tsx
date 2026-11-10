import { act, fireEvent, render, screen } from '@testing-library/react'

import { Atlas } from './Atlas'
import { MODE_LABELS, MODES, numberedLabels, PARTS, type PartId } from './content'
import type { AtlasEngine, EngineCallbacks } from './engine/engine'
import { stepAt, groupsFor } from './engine/toothScene'
import { ALL_FDI, fdiToIndex, indexToFdi, toothTitle } from './fdi'
import { toothPlacement } from './geometry/jawModel'
import { makeGrid, sample, surfaceNets } from './geometry/mesher'
import { sdSphere } from './geometry/sdf'
import { CUT_X, TISSUES, type Tissue } from './geometry/toothModel'
import { readAtlasRoute } from './route'

// WebGL в jsdom нет: проверку подменяем, а движок three.js — фальшивкой, которая запоминает вызовы
const webgl = vi.hoisted(() => ({ ok: true }))
vi.mock('./webgl', () => ({ hasWebGL: () => webgl.ok }))
const engine = vi.hoisted(() => ({ api: null as AtlasEngine | null, cb: null as EngineCallbacks | null }))
vi.mock('./engine/engine', () => ({
  createAtlasEngine: (_canvas: HTMLCanvasElement, cb: EngineCallbacks) => {
    engine.cb = cb
    engine.api = {
      setView: vi.fn(), setMode: vi.fn(), setCariesStage: vi.fn(), setPart: vi.fn(), setTooth: vi.fn(), setWisdom: vi.fn(),
      setRoots: vi.fn(), setAnchors: vi.fn(), replay: vi.fn(), resetView: vi.fn(), setCameraPose: vi.fn(), setCustom: vi.fn(), dispose: vi.fn(),
    }
    return engine.api
  },
}))

/** Какая ткань модели под меткой части (сосуды лежат в канале). */
const TISSUE_OF: Partial<Record<PartId, Tissue>> = {
  enamel: 'enamel', dentin: 'dentin', pulp: 'pulp', vessels: 'canal', canal: 'canal', cementum: 'cementum', pdl: 'pdl', bone: 'bone', gum: 'gum',
}

describe('метки атласа', () => {
  it('каждая метка здорового зуба стоит внутри своей ткани (по формулам модели)', () => {
    for (const l of MODE_LABELS.healthy) {
      const [x, y, z] = l.at
      // Метка на плоскости среза; ткань проверяем чуть внутри оставшейся части
      const inside = Math.abs(x - CUT_X) < 0.01 ? TISSUES[TISSUE_OF[l.part]!](x - 0.004, y, z) : TISSUES[TISSUE_OF[l.part]!](x, y, z - 0.004)
      expect(inside, l.part).toBeLessThan(0)
    }
  })

  it('номера по порядку с единицы, у каждой части есть текст на двух языках', () => {
    for (const m of MODES) {
      const labels = numberedLabels(m.id)
      expect(labels.map((l) => l.n)).toEqual(labels.map((_, i) => i + 1))
      for (const l of labels) {
        expect(PARTS[l.part].ru.name).not.toBe('')
        expect(PARTS[l.part].ky.text.length).toBeGreaterThan(20)
      }
    }
  })

  it('ролики: шаг по времени и группы сеток режима', () => {
    expect(stepAt('endo', 0)).toBe(0)
    expect(stepAt('endo', 2)).toBe(1)
    expect(stepAt('endo', 6)).toBe(2)
    expect(stepAt('healthy', 5)).toBe(0)
    expect(groupsFor('healthy')).toEqual(['base'])
    expect(groupsFor('implant')).toEqual(['base', 'implant'])
  })
})

describe('номера зубов FDI', () => {
  it('номер → индекс сетки в челюсти и обратно', () => {
    expect(fdiToIndex(11)).toBe(0)
    expect(fdiToIndex(18)).toBe(7)
    expect(fdiToIndex(21)).toBe(8)
    expect(fdiToIndex(36)).toBe(21)
    expect(fdiToIndex(48)).toBe(31)
    for (const bad of [0, 9, 10, 19, 50, 36.5, -11]) expect(fdiToIndex(bad)).toBeNull()
    expect(ALL_FDI.map(fdiToIndex)).toEqual([...Array(32).keys()])
    expect(ALL_FDI.every((code) => indexToFdi(fdiToIndex(code)!) === code)).toBe(true)
  })

  it('подпись зуба', () => {
    expect(toothTitle(36, 'ru')).toBe('36 — первый моляр, низ слева')
    expect(toothTitle(11, 'ru')).toBe('11 — центральный резец, верх справа')
  })

  it('места на дуге: справа у пациента — слева на экране, верх — выше, зубы не наезжают друг на друга', () => {
    for (const code of ALL_FDI) {
      const p = toothPlacement(code)
      expect(Math.sign(p.x), String(code)).toBe([1, 4].includes(Math.floor(code / 10)) ? -1 : 1)
      expect(p.upper).toBe(code < 30)
      expect(p.y > 0).toBe(code < 30)
    }
    for (const q of [1, 2, 3, 4]) {
      for (let n = 1; n < 8; n++) {
        const a = toothPlacement(q * 10 + n), b = toothPlacement(q * 10 + n + 1)
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.5)
      }
    }
  })
})

describe('мешер (Surface Nets)', () => {
  it('сфера: вершины на поверхности, нормали наружу, сетка замкнута', () => {
    const g = makeGrid([-1, -1, -1], [1, 1, 1], 0.1)
    const mesh = surfaceNets(g, sample(g, (x, y, z) => sdSphere(x, y, z, 0.7)))
    expect(mesh.indices.length).toBeGreaterThan(300)
    for (let v = 0; v < mesh.positions.length; v += 3) {
      const [x, y, z] = [mesh.positions[v]!, mesh.positions[v + 1]!, mesh.positions[v + 2]!]
      expect(Math.abs(Math.hypot(x, y, z) - 0.7)).toBeLessThan(0.05)
      expect(x * mesh.normals[v]! + y * mesh.normals[v + 1]! + z * mesh.normals[v + 2]!).toBeGreaterThan(0)
    }
    // Замкнутая поверхность: каждое ребро — у двух треугольников
    const edges = new Map<string, number>()
    for (let t = 0; t < mesh.indices.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = mesh.indices[t + e]!, b = mesh.indices[t + ((e + 1) % 3)]!
        const key = a < b ? `${a}-${b}` : `${b}-${a}`
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
    expect([...edges.values()].every((n) => n === 2)).toBe(true)
  })
})

describe('адрес атласа', () => {
  it('#/atlas, режим или номер зуба, /atlas', () => {
    expect(readAtlasRoute('#/atlas', '/')).toEqual({})
    expect(readAtlasRoute('#/atlas/caries', '/')).toEqual({ mode: 'caries' })
    expect(readAtlasRoute('#/atlas/36', '/')).toEqual({ tooth: 36 })
    expect(readAtlasRoute('#/atlas/99', '/')).toEqual({})
    expect(readAtlasRoute('#/patients', '/')).toBeNull()
    expect(readAtlasRoute('', '/atlas')).toEqual({})
  })
})

describe('<Atlas />', () => {
  beforeEach(() => {
    webgl.ok = true
    engine.api = null
    engine.cb = null
  })

  it('без WebGL — понятное сообщение и плоская схема с теми же номерами', () => {
    webgl.ok = false
    render(<Atlas />)
    expect(screen.getByText(/3D не работает/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Схема зуба в разрезе' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '3. Пульпа' }))
    expect(screen.getByRole('heading', { name: 'Пульпа' })).toBeInTheDocument()
  })

  it('кнопки режимов, стадии кариеса и выбор зуба уходят в 3D-движок; закрыли — движок освобождён', async () => {
    const { unmount } = render(<Atlas />)
    await vi.waitFor(() => expect(engine.api).not.toBeNull())
    const api = engine.api!
    fireEvent.click(screen.getByRole('tab', { name: 'Кариес' }))
    expect(api.setMode).toHaveBeenLastCalledWith('caries')
    fireEvent.click(screen.getByRole('radio', { name: /Пульпа/ }))
    expect(api.setCariesStage).toHaveBeenLastCalledWith(3)
    expect(screen.getByRole('heading', { name: 'Кариес: пульпа' })).toBeInTheDocument()
    // Метки режима — в движок (точки модели), подписи — в легенду
    expect(api.setAnchors).toHaveBeenLastCalledWith(numberedLabels('caries').map((l) => l.at))

    fireEvent.click(screen.getByRole('tab', { name: 'Челюсть' }))
    expect(api.setView).toHaveBeenLastCalledWith('jaw')
    fireEvent.click(screen.getByRole('button', { name: '36' }))
    expect(api.setTooth).toHaveBeenLastCalledWith(36)
    expect(screen.getByRole('heading', { name: '36 — первый моляр, низ слева' })).toBeInTheDocument()
    // Нажали на зуб в 3D — движок сообщил номер
    act(() => engine.cb!.onPickTooth(11))
    expect(screen.getByRole('heading', { name: '11 — центральный резец, верх справа' })).toBeInTheDocument()

    unmount()
    expect(api.dispose).toHaveBeenCalled()
  })

  it('initialTooth открывает челюсть с выделенным зубом; кыргызский язык', async () => {
    render(<Atlas initialTooth={46} lang="ky" />)
    await vi.waitFor(() => expect(engine.api).not.toBeNull())
    expect(engine.api!.setView).toHaveBeenLastCalledWith('jaw')
    expect(engine.api!.setTooth).toHaveBeenLastCalledWith(46)
    expect(screen.getByRole('tab', { name: 'Жаак' })).toHaveAttribute('aria-selected', 'true')
  })

  it('метки двигаются по кадрам движка, невидимые скрыты', async () => {
    render(<Atlas />)
    await vi.waitFor(() => expect(engine.cb).not.toBeNull())
    act(() => engine.cb!.onFrame([{ x: 100, y: 50, visible: true }, { x: 0, y: 0, visible: false }], 0))
    const dots = document.querySelectorAll<HTMLButtonElement>('.atlas-dot')
    expect(dots[0]!.style.transform).toContain('translate(100.0px, 50.0px)')
    expect(dots[0]!.style.visibility).toBe('visible')
    expect(dots[1]!.style.visibility).toBe('hidden')
  })
})
