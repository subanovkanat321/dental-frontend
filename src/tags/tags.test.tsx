import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { appointment, me, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

// Свои метки пациентов (V239 бэкенда), деньги и лечащий врач в шапке карточки пациента. Пациенты вымышленные
type Tag = Schemas['PatientTagsTag']
type Patient = Schemas['PatientView']
type Me = Schemas['BookingViewsMe']

const TAGS: Tag[] = [
  { id: 1, code: 'VIP', name: 'ВИП', color: 'yellow', position: 10, patients: 1 },
  { id: 2, name: 'Боится', color: 'violet', position: 20, patients: 2 },
  { id: 3, name: 'Опаздывает', color: 'orange', position: 30, patients: 0 },
]

afterEach(() => {
  window.location.hash = ''
})

describe('«Настройки → Метки пациентов»', () => {
  beforeEach(() => {
    window.location.hash = '/settings/tags'
  })

  test('руководитель добавляет, переименовывает и удаляет метку; «ВИП» удалить нельзя', async () => {
    let list = TAGS.map((t) => ({ ...t }))
    const sent: { method: string; body?: unknown; id?: string }[] = []
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: true })),
      http.get('*/api/patient-tags', () => HttpResponse.json(list)),
      http.post('*/api/patient-tags', async ({ request }) => {
        const body = (await request.json()) as Schemas['PatientTagsRequest']
        sent.push({ method: 'POST', body })
        list = [...list, { id: 9, position: 40, patients: 0, ...body }]
        return HttpResponse.json(list, { status: 201 })
      }),
      http.put('*/api/patient-tags/:id', async ({ request, params }) => {
        const body = (await request.json()) as Schemas['PatientTagsRequest']
        sent.push({ method: 'PUT', body, id: String(params.id) })
        list = list.map((t) => (t.id === Number(params.id) ? { ...t, ...body } : t))
        return HttpResponse.json(list)
      }),
      http.delete('*/api/patient-tags/:id', ({ params }) => {
        sent.push({ method: 'DELETE', id: String(params.id) })
        list = list.filter((t) => t.id !== Number(params.id))
        return HttpResponse.json(list)
      }),
    )
    renderApp()
    const tags = await screen.findByRole('list', { name: 'Метки клиники' })
    expect(within(tags).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('ВИП'), expect.stringContaining('Боится'), expect.stringContaining('Опаздывает')])
    expect(within(tags).queryByRole('button', { name: 'Удалить метку ВИП' })).not.toBeInTheDocument()

    const form = screen.getByRole('form', { name: 'Новая метка' })
    await userEvent.type(within(form).getByLabelText('Новая метка'), 'По рекомендации')
    await userEvent.click(within(form).getByRole('radio', { name: 'Зелёный' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Добавить' }))
    expect(await within(tags).findByText('По рекомендации')).toBeInTheDocument()

    await userEvent.click(within(tags).getByRole('button', { name: 'Изменить метку Опаздывает' }))
    const edit = within(tags).getByRole('form', { name: 'Изменить метку Опаздывает' })
    await userEvent.clear(within(edit).getByLabelText('Название'))
    await userEvent.type(within(edit).getByLabelText('Название'), 'Опаздывает часто')
    await userEvent.click(within(edit).getByRole('button', { name: 'Сохранить' }))
    expect(await within(tags).findByText('Опаздывает часто')).toBeInTheDocument()

    await userEvent.click(within(tags).getByRole('button', { name: 'Удалить метку Боится' }))
    expect(await screen.findByText('Удалить метку «Боится»? Она снимется у всех пациентов (2 пац.).')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    await waitForSlow(() => expect(within(tags).queryByText('Боится')).not.toBeInTheDocument())
    expect(sent).toEqual([
      { method: 'POST', body: { name: 'По рекомендации', color: 'green' } },
      { method: 'PUT', body: { name: 'Опаздывает часто', color: 'orange' }, id: '3' },
      { method: 'DELETE', id: '2' },
    ])
  })

  test('метку ни у кого — спрашиваем без «снимется у всех пациентов (ни у кого)»', async () => {
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: true })),
      http.get('*/api/patient-tags', () => HttpResponse.json(TAGS)),
    )
    renderApp()
    const tags = await screen.findByRole('list', { name: 'Метки клиники' })
    await userEvent.click(within(tags).getByRole('button', { name: 'Удалить метку Опаздывает' }))
    expect(await screen.findByText('Удалить метку «Опаздывает»?')).toBeInTheDocument()
    expect(screen.queryByText(/ни у кого\)/)).not.toBeInTheDocument()
  })

  test('ошибка сервера (дубль) — под формой; двенадцать меток — формы нет', async () => {
    let list = TAGS.map((t) => ({ ...t }))
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json({ ...me, admin: true })),
      http.get('*/api/patient-tags', () => HttpResponse.json(list)),
      http.post('*/api/patient-tags', () => HttpResponse.json({ status: 422, detail: 'Проверьте поля', errors: [{ field: 'name', message: 'Такая метка уже есть' }] }, { status: 422 })),
    )
    const view = renderApp()
    const form = await screen.findByRole('form', { name: 'Новая метка' })
    await userEvent.type(within(form).getByLabelText('Новая метка'), 'боится')
    await userEvent.click(within(form).getByRole('button', { name: 'Добавить' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Такая метка уже есть')
    view.unmount()

    list = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Метка ${i + 1}`, color: 'gray', position: i, patients: 0 }))
    renderApp()
    await screen.findByText('Метка 12')
    expect(screen.queryByRole('form', { name: 'Новая метка' })).not.toBeInTheDocument()
    expect(screen.getByText(/Это 12 меток/)).toBeInTheDocument()
  })
})

describe('шапка карточки пациента', () => {
  beforeEach(() => {
    window.location.hash = '/patients'
  })

  function backend(patient: Patient, { who = me, paidSom, debts = [], past = [] }: {
    who?: Me; paidSom?: number; debts?: Schemas['PaymentQueryDebt'][]; past?: Schemas['AppointmentView'][]
  } = {}) {
    let current = patient
    const sent: unknown[] = []
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json(who)),
      http.get('*/api/patients/recent', () => HttpResponse.json([current])),
      http.get('*/api/appointments', () => HttpResponse.json([])),
      http.get('*/api/patients/:id/family', () => new HttpResponse(null, { status: 204 })),
      http.get('*/api/appointments/debts', () => HttpResponse.json(debts)),
      http.get('*/api/patient-tags', () => HttpResponse.json(TAGS)),
      http.get('*/api/appointments/by-patient/:id', () => HttpResponse.json({ patient: current, done: past.length, noShow: 0, cancelled: 0, upcoming: [], past, paidSom })),
      http.put('*/api/patients/:id/tags/:tagId', async ({ request, params }) => {
        const body = (await request.json()) as { on: boolean }
        sent.push({ tagId: Number(params.tagId), ...body })
        const ids = new Set(current.tagIds ?? [])
        if (body.on) ids.add(Number(params.tagId))
        else ids.delete(Number(params.tagId))
        current = { ...current, tagIds: [...ids], vip: ids.has(1) }
        return HttpResponse.json(current)
      }),
    )
    return sent
  }

  async function openCard(name: string) {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name }))
    return screen.findByRole('complementary', { name: 'Карточка пациента' })
  }

  test('регистратура ставит и снимает метки из шапки; «ВИП» — она же ⭐', async () => {
    const sent = backend({ id: 7, fullName: 'Вымышленный Нурлан', phone: '996700223001', telegram: false, tagIds: [2] },
      { who: { ...me, admin: false, reception: true, doctorId: undefined } })
    const card = await openCard('Вымышленный Нурлан')
    const button = await within(card).findByRole('button', { name: 'Метки: Боится. Изменить' })
    await userEvent.click(button)
    const menu = screen.getByRole('menu', { name: 'Метки пациента' })
    expect(within(menu).getByRole('menuitemradio', { name: /Боится/ })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: /Опаздывает/ }))
    expect(await within(card).findByRole('button', { name: 'Метки: Боится, Опаздывает. Изменить' })).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: /^Метки:/ }))
    await userEvent.click(within(screen.getByRole('menu', { name: 'Метки пациента' })).getByRole('menuitemradio', { name: /ВИП/ }))
    expect(await within(card).findByRole('img', { name: 'ВИП — особое внимание' })).toBeInTheDocument()
    expect(sent).toEqual([{ tagId: 3, on: true }, { tagId: 1, on: true }])
  })

  test('врач видит метки чипами, но не меняет; без меток и денег — строк нет', async () => {
    backend({ id: 8, fullName: 'Вымышленная Жамиля', phone: '996700223002', telegram: false, tagIds: [2, 3] },
      { who: { ...me, admin: false, reception: false } })
    const card = await openCard('Вымышленная Жамиля')
    const line = await within(card).findByLabelText('Метки пациента')
    expect(line).toHaveTextContent('Боится')
    expect(line).toHaveTextContent('Опаздывает')
    expect(within(card).queryByRole('button', { name: /^Метки:/ })).not.toBeInTheDocument()
    expect(within(card).queryByText(/оплачено/)).not.toBeInTheDocument()
    expect(within(card).queryByText(/Лечащий врач/)).not.toBeInTheDocument()
  })

  test('деньги одной строкой: долг красным ведёт во вкладку «Деньги», оплачено — с сервера; лечащий врач — последнего приёма', async () => {
    const past = [
      appointment(31, 2, '10:00', 'Вымышленный Талант', { status: 'DONE', startAt: '2026-10-01T04:00:00Z', endAt: '2026-10-01T04:30:00Z' }),
      appointment(30, 1, '10:00', 'Вымышленный Талант', { status: 'DONE', startAt: '2026-09-01T04:00:00Z', endAt: '2026-09-01T04:30:00Z' }),
    ]
    backend({ id: 9, fullName: 'Вымышленный Талант', phone: '996700223003', telegram: false }, {
      paidSom: 52000, past,
      debts: [{ appointmentId: 31, patientId: 9, doctorId: 2, chargeSom: 6000, paidSom: 2000, debtSom: 4000, startAt: '2026-10-01T04:00:00Z' }],
    })
    const card = await openCard('Вымышленный Талант')
    const debt = await within(card).findByRole('button', { name: /Долг 4\s000 сом — открыть «Деньги»/ })
    expect(debt).toHaveClass('patient-debt')
    expect(within(card).getByText(/оплачено 52\s000 сом/)).toBeInTheDocument()
    expect(within(card).getByText('Лечащий врач: Дастан Т.')).toBeInTheDocument()
    await userEvent.click(debt)
    expect(within(card).getByRole('tab', { name: 'Деньги' })).toHaveAttribute('aria-selected', 'true')
  })

  test('ассистент денег не видит: сервер не прислал «оплачено», долгов нет — строки нет', async () => {
    backend({ id: 10, fullName: 'Вымышленная Асель', phone: '996700223004', telegram: false },
      { who: { ...me, admin: false, doctorId: undefined, assistantOf: [1] } })
    const card = await openCard('Вымышленная Асель')
    await within(card).findByRole('tab', { name: 'Визиты' })
    expect(within(card).queryByText(/оплачено|Долг/)).not.toBeInTheDocument()
  })
})
