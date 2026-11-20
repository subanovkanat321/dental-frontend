import { assignText, byTooth, dueText, overdueCount, parseTeeth } from './planSteps'
import { defaultStart, STARTERS, starterSteps } from './planTemplates'

test('срок этапа: «до 15 дек», другой год — с годом; врач и срок одной строкой', () => {
  expect(dueText('2026-12-15', '2026-11-20')).toBe('до 15 дек')
  expect(dueText('2027-01-05', '2026-11-20')).toBe('до 5 янв 2027')
  expect(assignText({ doctorName: 'Дастан Т.', dueOn: '2026-12-15' }, '2026-11-20')).toBe('Дастан Т. · до 15 дек')
  expect(assignText({}, '2026-11-20')).toBe('')
})

test('просрочено — только несделанные; по зубам — по номеру, полость рта последней; зубы из текста', () => {
  expect(overdueCount([
    { id: 1, stage: 1, overdue: true }, { id: 2, stage: 1, overdue: true, doneAt: '2026-11-01T00:00:00Z' }, { id: 3, stage: 1 },
  ])).toBe(1)
  expect(byTooth([{ tooth: 46 }, { tooth: null }, { tooth: 16 }, { tooth: 46 }]).map((g) => [g.tooth, g.items.length]))
    .toEqual([[16, 1], [46, 2], [null, 1]])
  expect(parseTeeth('36, 46 36;x 11')).toEqual([36, 46, 11])
})

test('готовые шаблоны: услуга из прайса по названию; «начать с этапа» — после последнего этапа плана, если помещается', () => {
  const steps = starterSteps(STARTERS[0]!, [
    { id: 1, name: 'Имплант Osstem', durationMinutes: 60, active: true },
    { id: 2, name: 'Коронка на имплант', durationMinutes: 60, active: true },
    { id: 3, name: 'Формирователь', durationMinutes: 30, active: false },
  ])
  expect(steps.map((s) => s.serviceTypeId)).toEqual([undefined, 1, undefined, 2])
  const t = { id: 1, title: 'x', shared: false, editable: true, usesTeeth: false, steps: [{ title: 'a', stage: 1, perTooth: false }, { title: 'b', stage: 3, perTooth: false }] }
  expect(defaultStart([], t)).toBe(1)
  expect(defaultStart([{ id: 1, stage: 2 }], t)).toBe(3)
  expect(defaultStart([{ id: 1, stage: 8 }], t)).toBe(1)
})
