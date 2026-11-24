import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { todayIn } from '../lib/time'
import { appointment, me, openPay, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { waitForSlow } from '../test/wait'

// Готовые метки, метки при записи и скидка по метке (V255 бэкенда, 2026-11-24). Пациенты вымышленные
type Tag = Schemas['PatientTagsTag']
type Me = Schemas['BookingViewsMe']
type Policy = Schemas['DiscountPoliciesPolicy']

const TAGS: Tag[] = [
  { id: 1, code: 'VIP', name: 'ВИП', color: 'yellow', position: 10, patients: 0 },
  { id: 2, name: 'Друг', color: 'green', position: 20, patients: 1, discountPercent: 10, discountReason: 'OTHER' },
  { id: 3, name: 'Родственник', color: 'blue', position: 30, patients: 0, discountPercent: 15, discountReason: 'FAMILY' },
  { id: 4, name: 'Боится', color: 'violet', position: 40, patients: 1 },
]

const reception: Me = { ...me, admin: false, reception: true, doctorId: undefined }
const at = (time: string) => new Date(`${todayIn()}T${time}:00+06:00`).toISOString()

afterEach(() => {
  window.location.hash = ''
})

describe('«Новая запись» → «Метки:»', () => {
  /** Расписание пустое, свободно 23:00; метки пациента — в его карточке, PUT меняет их на «сервере». */
  function backend(who: Me, tagIds: number[] = []) {
    let current: Schemas['PatientView'] = { id: 2, fullName: 'Вымышленная Айгуль', phone: '996700333444', telegram: false, tagIds }
    const log: string[] = []
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json(who)),
      http.get('*/api/patients/recent', () => HttpResponse.json([{ id: 2, fullName: 'Вымышленная Айгуль', phone: '996700333444', telegram: false }])),
      http.get('*/api/appointments', () => HttpResponse.json([])),
      http.get('*/api/appointments/by-patient/:id', () => HttpResponse.json({ patient: current, done: 0, noShow: 0, cancelled: 0, upcoming: [], past: [] })),
      http.get('*/api/patient-tags', () => HttpResponse.json(TAGS)),
      http.get('*/api/service-types', () => HttpResponse.json([])),
      http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, starts: [at('23:00')] })),
      http.put('*/api/patients/:id/tags/:tagId', async ({ request, params }) => {
        const body = (await request.json()) as { on: boolean }
        log.push(`PUT ${String(params.id)}/${String(params.tagId)} ${body.on}`)
        const ids = new Set(current.tagIds ?? [])
        if (body.on) ids.add(Number(params.tagId))
        else ids.delete(Number(params.tagId))
        current = { ...current, id: Number(params.id), tagIds: [...ids] }
        return HttpResponse.json(current)
      }),
      http.post('*/api/patients', async ({ request }) => {
        const body = (await request.json()) as { fullName: string }
        log.push(`POST patient ${body.fullName}`)
        current = { id: 77, fullName: body.fullName, phone: '996555000222', telegram: false, tagIds: [] }
        return HttpResponse.json(current, { status: 201 })
      }),
      http.post('*/api/appointments', async ({ request }) => {
        const body = (await request.json()) as { patientId: number }
        log.push(`POST appointment ${body.patientId}`)
        return HttpResponse.json(appointment(98, 1, '23:00', 'Вымышленный Новый'), { status: 201 })
      }),
    )
    return log
  }

  async function openForm() {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: '＋ Новая запись' }))
    return screen.getByRole('complementary', { name: 'Новая запись' })
  }

  test('выбранный пациент: метки из карточки, нажатие сразу ставит метку; подсказка о скидке', async () => {
    const log = backend(reception, [4])
    const form = await openForm()
    await userEvent.click(await within(form).findByRole('button', { name: /Вымышленная Айгуль/ }))
    const row = await within(form).findByRole('group', { name: 'Метки пациента' })
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Боится' })).toHaveAttribute('aria-pressed', 'true'))
    expect(within(row).getByRole('button', { name: 'ВИП ⭐' })).toHaveAttribute('aria-pressed', 'false')
    expect(row).not.toHaveTextContent('скидка')

    await userEvent.click(within(row).getByRole('button', { name: 'Друг' }))
    await waitForSlow(() => expect(within(row).getByRole('button', { name: 'Друг' })).toHaveAttribute('aria-pressed', 'true'))
    expect(row).toHaveTextContent('Друг: скидка 10 % при оплате')
    await userEvent.click(within(row).getByRole('button', { name: 'Боится' }))
    await waitForSlow(() => expect(within(row).getByRole('button', { name: 'Боится' })).toHaveAttribute('aria-pressed', 'false'))
    expect(log).toEqual(['PUT 2/2 true', 'PUT 2/4 false'])
  })

  test('новый пациент: отмеченные метки ставятся сразу после того, как он заведётся, до записи', async () => {
    const log = backend(reception)
    const form = await openForm()
    await userEvent.click(within(form).getByRole('button', { name: '＋ Новый пациент' }))
    await userEvent.type(within(form).getByLabelText('Имя и фамилия'), 'Вымышленный Новый')
    await userEvent.type(within(form).getByLabelText('Телефон'), '555 000 222')
    const row = await within(form).findByRole('group', { name: 'Метки пациента' })
    await userEvent.click(within(row).getByRole('button', { name: 'Друг' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Родственник' }))
    // Две метки со скидкой — подсказка о большей
    expect(row).toHaveTextContent('Родственник: скидка 15 % при оплате')
    expect(log).toEqual([])
    await userEvent.click(await within(form).findByRole('button', { name: '23:00' }))
    await userEvent.click(within(form).getByRole('button', { name: /^Записать( ·|$)/ }))
    await waitForSlow(() => expect(log).toContain('POST appointment 77'))
    expect(log).toEqual(['POST patient Вымышленный Новый', 'PUT 77/2 true', 'PUT 77/3 true', 'POST appointment 77'])
  })

  test('врач меток не ставит: видит метки пациента без кнопок', async () => {
    backend({ ...me, admin: false, reception: false }, [2])
    const form = await openForm()
    await userEvent.click(await within(form).findByRole('button', { name: /Вымышленная Айгуль/ }))
    const row = await within(form).findByLabelText('Метки пациента')
    expect(row).toHaveTextContent('Друг')
    expect(row).toHaveTextContent('Друг: скидка 10 % при оплате')
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('оплата: скидка по метке', () => {
  function backend(policy: Policy, who: Me = me) {
    const a = appointment(10, 1, '10:00', 'Бакыт М.', {
      status: 'DONE', servicePriceSom: 6000, version: 1,
      patient: { id: 10, fullName: 'Бакыт М.', phone: '996555123456', telegram: false, tagIds: [2, 4] },
    })
    const sent: Record<string, unknown>[] = []
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json(who)),
      http.get('*/api/clinic/discounts', () => HttpResponse.json(policy)),
      http.get('*/api/patient-tags', () => HttpResponse.json(TAGS)),
      http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [a] : [])),
      http.get('*/api/appointments/:id/payments', () => HttpResponse.json([])),
      http.get('*/api/service-types', () => HttpResponse.json([])),
      http.post('*/api/appointments/:id/payment', async ({ request }) => {
        sent.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json({ ...a, paidSom: 5400, chargeSom: 5400, paymentMethod: 'CASH' })
      }),
    )
    return sent
  }

  async function payForm() {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
    return openPay(screen.getByRole('complementary', { name: 'Карточка приёма' }))
  }

  test('подставлена сама: 10 %, «Другое» с названием метки; сохраняется как обычная скидка', async () => {
    const sent = backend({ who: 'ADMIN', maxPercent: 10, canGive: true, myMaxPercent: 100 })
    const form = await payForm()
    const discount = await within(form).findByRole('group', { name: 'Скидка' })
    expect(within(discount).getByLabelText('Скидка, %')).toHaveValue(10)
    expect(within(discount).getByRole('button', { name: 'Другое' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(discount).getByLabelText('Комментарий к скидке')).toHaveValue('Метка «Друг»')
    expect(within(form).getByText('🏷 Скидка по метке «Друг» — 10 %')).toBeInTheDocument()
    expect(within(discount).getByLabelText('Итог со скидкой')).toHaveTextContent(/К оплате 5\s400 сом/)
    await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату/ }))
    await waitForSlow(() => expect(sent).toEqual([{
      amountSom: 5400, method: 'CASH', priceSom: 6000, discount: { percent: 10, reason: 'OTHER', comment: 'Метка «Друг»' },
    }]))
  })

  test('«Убрать» — без скидки; «Подставить» возвращает', async () => {
    const sent = backend({ who: 'ADMIN', maxPercent: 10, canGive: true, myMaxPercent: 100 })
    const form = await payForm()
    const discount = await within(form).findByRole('group', { name: 'Скидка' })
    await userEvent.click(within(discount).getByRole('button', { name: 'Убрать' }))
    expect(within(form).queryByRole('group', { name: 'Скидка' })).not.toBeInTheDocument()
    expect(within(form).getByText(/Скидка по метке «Друг» — 10 %/)).toHaveClass('muted')
    await userEvent.click(within(form).getByRole('button', { name: 'Подставить' }))
    expect(within(form).getByLabelText('Скидка, %')).toHaveValue(10)
    await userEvent.click(within(form).getByRole('button', { name: 'Убрать' }))
    await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату/ }))
    await waitForSlow(() => expect(sent).toHaveLength(1))
    expect(sent[0]).not.toHaveProperty('discount')
    expect(sent[0]).toMatchObject({ amountSom: 6000, method: 'CASH' })
  })

  test('предел регистратуры 5 % меньше скидки по метке — не подставляем, подсказываем; скидки не дают — тоже', async () => {
    backend({ who: 'RECEPTION', maxPercent: 5, canGive: true, myMaxPercent: 5 }, reception)
    const { unmount } = renderApp()
    await userEvent.click(await screen.findByRole('button', { name: /Бакыт М\./ }))
    let form = await openPay(screen.getByRole('complementary', { name: 'Карточка приёма' }))
    expect(await within(form).findByText('🏷 Скидка по метке «Друг» — 10 %: больше вашего предела (5 %) — решает руководитель')).toBeInTheDocument()
    expect(within(form).queryByRole('group', { name: 'Скидка' })).not.toBeInTheDocument()
    expect(within(form).getByRole('button', { name: '＋ Скидка' })).toBeInTheDocument()
    unmount()

    backend({ who: 'ADMIN', maxPercent: 10, canGive: false }, reception)
    form = await payForm()
    expect(await within(form).findByText('🏷 Скидка по метке «Друг» — 10 %: скидку даёт руководитель')).toBeInTheDocument()
    expect(within(form).queryByRole('button', { name: '＋ Скидка' })).not.toBeInTheDocument()
  })
})

describe('«Настройки → Метки пациентов»: скидка и готовые', () => {
  beforeEach(() => {
    window.location.hash = '/settings/tags'
  })

  test('скидка по метке в строке и в правке; «＋ Добавить готовые» — только недостающие', async () => {
    let list = TAGS.map((t) => ({ ...t }))
    const sent: unknown[] = []
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json(me)),
      http.get('*/api/patient-tags', () => HttpResponse.json(list)),
      http.post('*/api/patient-tags/defaults', () => {
        sent.push('defaults')
        list = [...list, ...['Знакомый знакомого', 'Сотрудник клиники', 'По рекомендации']
          .map((name, i) => ({ id: 10 + i, name, color: 'gray', position: 50 + i * 10, patients: 0 }))]
        return HttpResponse.json(list)
      }),
      http.put('*/api/patient-tags/:id', async ({ request, params }) => {
        const body = (await request.json()) as Schemas['PatientTagsRequest']
        sent.push({ id: Number(params.id), ...body })
        list = list.map((t) => (t.id === Number(params.id) ? { ...t, ...body, discountPercent: body.discountPercent, discountReason: body.discountPercent ? 'OTHER' : undefined } : t))
        return HttpResponse.json(list)
      }),
    )
    renderApp()
    const tags = await screen.findByRole('list', { name: 'Метки клиники' })
    const friend = within(tags).getAllByRole('listitem')[1]!
    expect(friend).toHaveTextContent('скидка 10 %')

    const add = screen.getByRole('button', { name: '＋ Добавить готовые (3)' })
    await userEvent.click(add)
    expect(await within(tags).findByText('По рекомендации')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Добавить готовые/ })).not.toBeInTheDocument()

    await userEvent.click(within(tags).getByRole('button', { name: 'Изменить метку Боится' }))
    const edit = within(tags).getByRole('form', { name: 'Изменить метку Боится' })
    await userEvent.type(within(edit).getByLabelText('Скидка по метке, %'), '7')
    await userEvent.click(within(edit).getByRole('button', { name: 'Сохранить' }))
    await waitForSlow(() => expect(within(tags).getAllByRole('listitem')[3]).toHaveTextContent('скидка 7 %'))

    // Убрать скидку — пустое поле
    await userEvent.click(within(tags).getByRole('button', { name: 'Изменить метку Друг' }))
    const editFriend = within(tags).getByRole('form', { name: 'Изменить метку Друг' })
    expect(within(editFriend).getByLabelText('Скидка по метке, %')).toHaveValue(10)
    await userEvent.clear(within(editFriend).getByLabelText('Скидка по метке, %'))
    await userEvent.click(within(editFriend).getByRole('button', { name: 'Сохранить' }))
    await waitForSlow(() => expect(within(tags).getAllByRole('listitem')[1]).not.toHaveTextContent('скидка'))
    expect(sent).toEqual(['defaults', { id: 4, name: 'Боится', color: 'violet', discountPercent: 7 }, { id: 2, name: 'Друг', color: 'green' }])
  })
})

test('карточка записи: «🏷 ＋ Метка» — те же чипы, нажатие сразу ставит метку пациенту', async () => {
  const log: string[] = []
  const a = appointment(30, 1, '10:00', 'Вымышленная Айгуль')
  server.use(
    http.get('*/api/patient/me', () => HttpResponse.json(reception)),
    http.get('*/api/appointments', () => HttpResponse.json([a])),
    http.get('*/api/patient-tags', () => HttpResponse.json(TAGS)),
    http.put('*/api/patients/:id/tags/:tagId', async ({ request, params }) => {
      const body = (await request.json()) as { on: boolean }
      log.push(`PUT ${String(params.id)}/${String(params.tagId)} ${body.on}`)
      return HttpResponse.json({ ...a.patient, tagIds: [Number(params.tagId)] })
    }),
  )
  renderApp()
  await userEvent.click((await screen.findAllByRole('button', { name: /10:00.*Вымышленная Айгуль/ }))[0]!)
  const panel = screen.getByRole('complementary', { name: 'Карточка приёма' })
  await userEvent.click(within(panel).getByRole('button', { name: /＋ Метка/ }))
  const row = await within(panel).findByRole('group', { name: 'Метки пациента' })
  await userEvent.click(within(row).getByRole('button', { name: 'Боится' }))
  await waitFor(() => expect(log).toEqual([`PUT ${a.patient.id}/4 true`]))
  await waitFor(() => expect(within(row).getByRole('button', { name: 'Боится' })).toHaveAttribute('aria-pressed', 'true'))
})
