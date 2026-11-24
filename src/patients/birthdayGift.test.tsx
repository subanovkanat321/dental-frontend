import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import type { Schemas } from '../api/client'
import { addDays, todayIn } from '../lib/time'
import { appointment, me, openItem, openPay, renderApp } from '../test/fixtures'
import { server } from '../test/server'
import { choose, chosen } from '../test/select'
import { waitForSlow } from '../test/wait'
import { cleaningLine, giftOffer, inGiftWindow, prefillDraft, type Gift } from './birthdayGift'

// Подарок на день рождения одним касанием (2026-11-24). Пациенты вымышленные
type Policy = Schemas['DiscountPoliciesPolicy']
type Tag = Schemas['PatientTagsTag']

const today = todayIn()
/** Родился 30 лет назад — сегодня день рождения. */
const bornToday = `${Number(today.slice(0, 4)) - 30}${today.slice(4)}`
const ADMIN: Policy = { who: 'ADMIN', maxPercent: 10, canGive: true, myMaxPercent: 100 }

const PREVIEW = '🎂 С днём рождения!\n\nЗдравствуйте, Айгуль Асанова! …\n\n🎁 В подарок — скидка 10 % на лечение до 24 декабря. Назовите код ДР10 при записи или на приёме.'

function gift(extra: Partial<Gift> = {}): Gift {
  return {
    preset: 'PERCENT_10', active: true, promoCodeId: 7, code: 'ДР10', discountPercent: 10, validDays: 30, validUntil: addDays(today, 30),
    label: 'скидка 10 %', previewRu: PREVIEW, previewKy: '🎂 Туулган күнүңүз менен! … ДР10 кодун айтыңыз.', ...extra,
  }
}

afterEach(() => { window.location.hash = '' })

describe('срок и строка профчистки', () => {
  test('подарок — 30 дней после дня рождения и 7 до, через Новый год тоже', () => {
    expect(inGiftWindow('1990-03-10', '2026-03-10')).toBe(true)
    expect(inGiftWindow('1990-03-10', '2026-04-09')).toBe(true)
    expect(inGiftWindow('1990-03-10', '2026-04-10')).toBe(false)
    expect(inGiftWindow('1990-03-10', '2026-03-03')).toBe(true)
    expect(inGiftWindow('1990-03-10', '2026-03-02')).toBe(false)
    expect(inGiftWindow('1990-12-20', '2027-01-10')).toBe(true)
    expect(inGiftWindow('2000-02-29', '2027-02-28')).toBe(true)
    expect(inGiftWindow(undefined, '2026-03-10')).toBe(false)
  })

  test('строка чистки: услуга из настроек, иначе по названию; без чистки — подсказка без скидки', () => {
    const a = appointment(1, 1, '10:00', 'Тест', {
      patient: { id: 1, fullName: 'Тест', telegram: false, birthDate: bornToday },
      services: [
        { id: 1, serviceTypeId: 11, name: 'Лечение кариеса', priceSom: 4000, qty: 1, teeth: [36], amountSom: 4000 },
        { id: 2, serviceTypeId: 12, name: 'Ультразвуковая чистка', priceSom: 2500, qty: 1, teeth: [], amountSom: 2500 },
        { id: 3, serviceTypeId: 13, name: 'Air Flow', priceSom: 3000, qty: 1, teeth: [], amountSom: 3000 },
      ],
    })
    expect(cleaningLine(a)).toEqual({ name: 'Ультразвуковая чистка', priceSom: 2500 })
    expect(cleaningLine(a, 13)).toEqual({ name: 'Air Flow', priceSom: 3000 })
    // Скидка строки уже есть — дарим остаток за чистку
    const lineOff = { ...a, services: [{ ...a.services![1]!, discountSom: 500, netSom: 2000 }] }
    expect(cleaningLine(lineOff)).toEqual({ name: 'Ультразвуковая чистка', priceSom: 2000 })
    const cleaning = gift({ preset: 'CLEANING', code: 'ДРЧИСТКА', discountPercent: undefined, discountText: 'Бесплатная профчистка' })
    expect(giftOffer(cleaning, a)?.draft).toEqual({ kind: 'som', value: '2500', reason: 'PROMO', comment: 'Подарок на день рождения: профчистка' })
    const noCleaning = { ...a, services: [a.services![0]!] }
    expect(giftOffer(cleaning, noCleaning)).toMatchObject({ draft: null, why: expect.stringContaining('нет услуги чистки') })
    // Не именинник или подарок выключен — ничего
    expect(giftOffer(gift(), { ...a, patient: { ...a.patient, birthDate: '1990-01-01' } })).toBeNull()
    expect(giftOffer(gift({ active: false }), a)).toBeNull()
  })

  test('с меткой не складываем: подставляем бо́льшую в сомах и только в пределах политики', () => {
    const a = appointment(1, 1, '10:00', 'Тест', { patient: { id: 1, fullName: 'Тест', telegram: false, birthDate: bornToday } })
    const offer = giftOffer(gift(), a)
    const tag15 = { kind: 'percent' as const, value: '15', reason: 'FAMILY' as const, comment: 'Метка «Родственник»' }
    const tag5 = { ...tag15, value: '5' }
    expect(prefillDraft(offer, tag15, 6000, ADMIN)).toBe(tag15)
    expect(prefillDraft(offer, tag5, 6000, ADMIN)).toBe(offer!.draft)
    expect(prefillDraft(offer, null, 6000, { ...ADMIN, myMaxPercent: 5 })).toBeNull()
    expect(prefillDraft(offer, tag5, 6000, { ...ADMIN, myMaxPercent: 5 })).toBe(tag5)
  })
})

describe('оплата: подарок на день рождения', () => {
  function backend({ g = gift(), tagIds, extra = {} }: { g?: Gift; tagIds?: number[]; extra?: Partial<Schemas['AppointmentView']> } = {}) {
    const a = appointment(10, 1, '10:00', 'Вымышленная Айгуль', {
      status: 'DONE', servicePriceSom: 6000, version: 1,
      patient: { id: 10, fullName: 'Вымышленная Айгуль', phone: '996555123456', telegram: false, birthDate: bornToday, tagIds }, ...extra,
    })
    const tags: Tag[] = [{ id: 2, name: 'Родственник', color: 'blue', position: 20, patients: 1, discountPercent: 15, discountReason: 'FAMILY' },
      { id: 3, name: 'Друг', color: 'green', position: 30, patients: 1, discountPercent: 5, discountReason: 'OTHER' }]
    const sent: Record<string, unknown>[] = []
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json(me)),
      http.get('*/api/clinic/discounts', () => HttpResponse.json(ADMIN)),
      http.get('*/api/clinic/birthday-gift', () => HttpResponse.json(g)),
      http.get('*/api/patient-tags', () => HttpResponse.json(tags)),
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
    await userEvent.click(await screen.findByRole('button', { name: /Вымышленная Айгуль/ }))
    return openPay(screen.getByRole('complementary', { name: 'Карточка приёма' }))
  }

  test('подставлен сам: 10 %, «Акция», комментарий с кодом; «Убрать» и «Применить»', async () => {
    const sent = backend()
    const form = await payForm()
    const discount = await within(form).findByRole('group', { name: 'Скидка' })
    expect(within(discount).getByLabelText('Скидка, %')).toHaveValue(10)
    expect(within(discount).getByRole('button', { name: 'Акция' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(discount).getByLabelText('Комментарий к скидке')).toHaveValue('Подарок на день рождения (ДР10)')
    expect(within(form).getByText(/🎂 Подарок на день рождения: скидка 10 %/)).not.toHaveClass('muted')
    await userEvent.click(within(within(form).getByText(/🎂 Подарок на день рождения/)).getByRole('button', { name: 'Убрать' }))
    expect(within(form).queryByRole('group', { name: 'Скидка' })).not.toBeInTheDocument()
    await userEvent.click(within(form).getByRole('button', { name: 'Применить' }))
    expect(within(form).getByLabelText('Скидка, %')).toHaveValue(10)
    await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату/ }))
    await waitForSlow(() => expect(sent).toEqual([{
      amountSom: 5400, method: 'CASH', priceSom: 6000, discount: { percent: 10, reason: 'PROMO', comment: 'Подарок на день рождения (ДР10)' },
    }]))
  })

  test('бесплатная профчистка: скидка на цену строки чистки', async () => {
    backend({
      g: gift({ preset: 'CLEANING', code: 'ДРЧИСТКА', discountPercent: undefined, discountText: 'Бесплатная профчистка', label: 'бесплатная профчистка' }),
      extra: {
        servicesTotalSom: 6500,
        services: [
          { id: 1, name: 'Лечение кариеса', priceSom: 4000, qty: 1, teeth: [36], amountSom: 4000 },
          { id: 2, name: 'Профессиональная чистка', priceSom: 2500, qty: 1, teeth: [], amountSom: 2500 },
        ],
      },
    })
    const form = await payForm()
    const discount = await within(form).findByRole('group', { name: 'Скидка' })
    expect(within(discount).getByLabelText('Скидка, сом')).toHaveValue(2500)
    expect(within(discount).getByLabelText('Комментарий к скидке')).toHaveValue('Подарок на день рождения: профчистка')
    expect(within(form).getByText(/🎂 Подарок на день рождения: бесплатная профчистка \(2\s500 сом\)/)).toBeInTheDocument()
  })

  test('с меткой «Родственник» 15 % — подставлена она, подарок подсказкой; скидки не складываются', async () => {
    backend({ tagIds: [2] })
    const form = await payForm()
    const discount = await within(form).findByRole('group', { name: 'Скидка' })
    expect(within(discount).getByLabelText('Скидка, %')).toHaveValue(15)
    expect(within(discount).getByRole('button', { name: 'Родственник/сотрудник' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(form).getByText(/🎂 Подарок на день рождения: скидка 10 %/)).toHaveClass('muted')
    expect(within(form).getByText(/Скидки не складываются/)).toHaveTextContent(/Подставляем бо́льшую — по метке/)
    // Выбрали подарок — стоит он, не вместе с меткой
    await userEvent.click(within(form).getByRole('button', { name: 'Применить' }))
    expect(within(form).getByLabelText('Скидка, %')).toHaveValue(10)
    expect(within(form).getAllByRole('group', { name: 'Скидка' })).toHaveLength(1)
  })

  test('метка «Друг» 5 % меньше подарка — подставлен подарок', async () => {
    backend({ tagIds: [3] })
    const form = await payForm()
    const discount = await within(form).findByRole('group', { name: 'Скидка' })
    expect(within(discount).getByLabelText('Комментарий к скидке')).toHaveValue('Подарок на день рождения (ДР10)')
    expect(within(form).getByText(/Скидки не складываются/)).toHaveTextContent(/Подставляем бо́льшую — подарок/)
  })
})

describe('«Настройки → Дни рождения» → «🎁 Подарок на день рождения»', () => {
  test('карточки: скидка 15 % одним касанием, образец ru / ky, свой промокод и профчистка', async () => {
    let state = gift({ preset: 'NONE', active: false, promoCodeId: undefined, code: undefined, discountPercent: undefined, label: undefined,
      previewRu: '🎂 С днём рождения!\n\nЗдравствуйте, Айгуль Асанова!' })
    const puts: Schemas['BirthdaysGiftRequest'][] = []
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json(me)),
      http.get('*/api/clinic/birthday-settings', () => HttpResponse.json({ autoGreet: false, greetHour: 10 } satisfies Schemas['BirthdaysSettings'])),
      http.get('*/api/promo-codes', () => HttpResponse.json([
        { id: 3, code: 'TESTBDAY', discountPercent: 10, active: true, appointments: 0 },
      ] satisfies Schemas['PromoCodesCode'][])),
      http.get('*/api/service-types', () => HttpResponse.json([
        { id: 21, name: 'Лечение кариеса', durationMinutes: 60, active: true, priceSom: 4000 },
        { id: 22, name: 'Профчистка', durationMinutes: 60, active: true, priceSom: 2500 },
      ] satisfies Schemas['ServiceTypeView'][])),
      http.get('*/api/clinic/birthday-gift', () => HttpResponse.json(state)),
      http.put('*/api/clinic/birthday-gift', async ({ request }) => {
        const body = (await request.json()) as Schemas['BirthdaysGiftRequest']
        puts.push(body)
        state = body.preset === 'PERCENT_15'
          ? gift({ preset: 'PERCENT_15', code: 'ДР15', discountPercent: 15, label: 'скидка 15 %', previewRu: PREVIEW.replaceAll('10', '15') })
          : { ...state, preset: body.preset!, serviceId: body.serviceId, promoCodeId: body.promoCodeId }
        return HttpResponse.json(state)
      }),
    )
    renderApp()
    openItem('birthdays')
    const box = await screen.findByRole('region', { name: 'Подарок на день рождения' })
    const cards = within(box).getByRole('radiogroup', { name: 'Подарок на день рождения' })
    expect(within(cards).getByRole('radio', { name: /Без подарка/ })).toHaveAttribute('aria-checked', 'true')
    expect(within(cards).getAllByRole('radio')).toHaveLength(6)
    await userEvent.click(within(cards).getByRole('radio', { name: /Скидка 15 %/ }))
    await waitForSlow(() => expect(within(cards).getByRole('radio', { name: /Скидка 15 %/ })).toHaveAttribute('aria-checked', 'true'))
    expect(puts[0]).toEqual({ preset: 'PERCENT_15' })
    expect(within(box).getByLabelText('Образец поздравления')).toHaveTextContent('🎁 В подарок — скидка 15 % на лечение до 24 декабря')
    await userEvent.click(within(box).getByRole('button', { name: 'Кыргызча' }))
    expect(within(box).getByLabelText('Образец поздравления')).toHaveTextContent('кодун айтыңыз')

    // Свой промокод — сохраняется после выбора кода
    await userEvent.click(within(cards).getByRole('radio', { name: /Свой промокод/ }))
    expect(puts).toHaveLength(1)
    await choose(within(box).getByLabelText('Промокод в подарок'), 'TESTBDAY (−10%)')
    await waitForSlow(() => expect(puts[1]).toEqual({ preset: 'CUSTOM', promoCodeId: 3 }))

    // Профчистка — услуга прайса подставлена сама
    await userEvent.click(within(cards).getByRole('radio', { name: /Бесплатная профчистка/ }))
    await waitForSlow(() => expect(puts[2]).toEqual({ preset: 'CLEANING', serviceId: 22 }))
    await waitForSlow(() => expect(chosen(within(box).getByLabelText('Услуга профчистки'))).toContain('Профчистка · 2500 сом'))
  })
})

describe('список именинников', () => {
  test('«🎁 Подарок: скидка 10 % · изменить» и кто поздравлен с подарком и воспользовался', async () => {
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json(me)),
      http.get('*/api/appointments', () => HttpResponse.json([])),
      http.get('*/api/patients/recent', () => HttpResponse.json([])),
      http.get('*/api/birthdays/today', () => HttpResponse.json({
        date: today, promoCode: 'ДР10', gift: 'скидка 10 %',
        items: [
          { patient: { id: 5, fullName: 'Тест Именинница', phone: '996555000005', telegram: false }, age: 30,
            greetedAt: new Date().toISOString(), greetedVia: 'WHATSAPP', giftCode: 'ДР10', giftUsed: true },
        ],
      } satisfies Schemas['BirthdaysToday'])),
    )
    renderApp()
    const chips = await screen.findAllByRole('button', { name: /Сегодня день рождения/ }).catch(() => [])
    // Все поздравлены — полосы нет; список — в «Пациентах» → «🎂 Сегодня»
    if (!chips.length) {
      window.location.hash = '/patients'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      await userEvent.click(await screen.findByRole('button', { name: /🎂 Сегодня/ }))
    }
    const line = await screen.findByLabelText('Подарок на день рождения')
    expect(line).toHaveTextContent('🎁 Подарок: скидка 10 % (код ДР10) · изменить')
    expect(within(line).getByRole('link', { name: 'изменить' })).toHaveAttribute('href', '#/settings/birthdays')
    expect(screen.getByRole('list', { name: 'Сегодня день рождения' })).toHaveTextContent('🎁 ДР10 · использовал')
  })
})
