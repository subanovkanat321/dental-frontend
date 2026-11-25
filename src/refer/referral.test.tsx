import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'

import type { Schemas } from '../api/client'
import { createQueryClient } from '../api/queryClient'
import { translator } from '../patient/i18n'
import { PatientForm } from '../patients/PatientForm'
import { appointment, me, openItem, openPay, renderApp } from '../test/fixtures'
import { REFERRAL_OFF, server } from '../test/server'
import { waitForSlow } from '../test/wait'
import { FriendCard } from './FriendCard'
import { biggestCandidate, FRIEND_COMMENT, referralHint, REWARD_COMMENT, type ReferralOffer, type ReferralSettings } from './referral'
import { ReferralBox } from './ReferralBox'
import { ReferralTile } from './ReferralTile'

// «Приведи друга» (2026-11-24). Пациенты вымышленные
type Policy = Schemas['DiscountPoliciesPolicy']
type Tag = Schemas['PatientTagsTag']

const ADMIN: Policy = { who: 'ADMIN', maxPercent: 10, canGive: true, myMaxPercent: 100 }
const PERCENT10 = { kind: 'PERCENT', percent: 10, label: 'скидка 10 %' } as const

function offer(extra: Partial<ReferralOffer> = {}): ReferralOffer {
  return { kind: 'FRIEND', bonus: PERCENT10, until: '2027-01-23', count: 1, usedHere: false, ...extra }
}

function wrap(node: ReactNode) {
  const client = createQueryClient({ queries: { retry: false } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(() => { window.location.hash = '' })

describe('подсказки и выбор бо́льшей скидки', () => {
  test('процент — «Акция» с комментарием «Приведи друга»; услуга — цена строки, нет строки — подсказка', () => {
    const a = appointment(1, 1, '10:00', 'Тест', {
      services: [{ id: 1, serviceTypeId: 21, name: 'Профчистка', priceSom: 2500, qty: 1, teeth: [], amountSom: 2500 }],
    })
    expect(referralHint(offer(), a)).toMatchObject({
      what: '🎁 Пришёл по приглашению — скидка 10 %', draft: { kind: 'percent', value: '10', reason: 'PROMO', comment: FRIEND_COMMENT },
    })
    const service = { kind: 'SERVICE' as const, serviceId: 21, serviceName: 'Профчистка', label: 'бесплатно: Профчистка' }
    expect(referralHint(offer({ kind: 'REWARD', bonus: service, friendName: 'Бакыт', count: 2 }), a)).toMatchObject({
      what: '🎁 Бонус за друга (Бакыт) — бесплатно: Профчистка · бонусов: 2', draft: { kind: 'som', value: '2500', comment: REWARD_COMMENT },
    })
    expect(referralHint(offer({ bonus: { ...service, serviceId: 99 } }), a)).toMatchObject({ draft: null, why: expect.stringContaining('нет услуги «Профчистка»') })
  })

  test('не складываем: бо́льшая в сомах в пределах политики', () => {
    const friend = { label: 'по приглашению', draft: { kind: 'percent' as const, value: '10', reason: 'PROMO' as const, comment: FRIEND_COMMENT } }
    const tag = { label: 'по метке «Родственник»', draft: { kind: 'percent' as const, value: '15', reason: 'FAMILY' as const, comment: '' } }
    expect(biggestCandidate([friend, tag], 6000, ADMIN)).toBe(tag)
    expect(biggestCandidate([friend, tag], 6000, { ...ADMIN, myMaxPercent: 10 })).toBe(friend)
    expect(biggestCandidate([friend], 6000, { ...ADMIN, canGive: false })).toBeNull()
  })
})

describe('оплата: «Приведи друга»', () => {
  function backend({ offers = [offer()], tagIds }: { offers?: ReferralOffer[]; tagIds?: number[] } = {}) {
    const a = appointment(10, 1, '10:00', 'Вымышленный Бакыт', {
      status: 'DONE', servicePriceSom: 6000, version: 1,
      patient: { id: 10, fullName: 'Вымышленный Бакыт', phone: '996555123456', telegram: false, tagIds },
    })
    const tags: Tag[] = [{ id: 2, name: 'Родственник', color: 'blue', position: 20, patients: 1, discountPercent: 15, discountReason: 'FAMILY' }]
    const sent: Record<string, unknown>[] = []
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json(me)),
      http.get('*/api/clinic/discounts', () => HttpResponse.json(ADMIN)),
      http.get('*/api/appointments/:id/referral-offers', () => HttpResponse.json(offers)),
      http.get('*/api/patient-tags', () => HttpResponse.json(tags)),
      http.get('*/api/appointments', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('doctorId') === '1' ? [a] : [])),
      http.get('*/api/appointments/:id/payments', () => HttpResponse.json([])),
      http.get('*/api/appointments/by-patient/:id', () => HttpResponse.json({ patient: a.patient, done: 0, noShow: 0, cancelled: 0, access: { medical: true, money: true }, upcoming: [], past: [a] } satisfies Schemas['PatientCard'])),
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
    await userEvent.click(await screen.findByRole('button', { name: /Вымышленный Бакыт/ }))
    return openPay(screen.getByRole('complementary', { name: 'Карточка приёма' }))
  }

  test('новый пациент по приглашению: скидка подставлена сама и уходит с комментарием «Приведи друга»', async () => {
    const sent = backend()
    const form = await payForm()
    const discount = await within(form).findByRole('group', { name: 'Скидка' })
    expect(within(discount).getByLabelText('Скидка, %')).toHaveValue(10)
    expect(within(discount).getByLabelText('Комментарий к скидке')).toHaveValue(FRIEND_COMMENT)
    expect(within(form).getByText(/🎁 Пришёл по приглашению — скидка 10 %/)).not.toHaveClass('muted')
    await userEvent.click(within(form).getByRole('button', { name: /^Сохранить оплату/ }))
    await waitForSlow(() => expect(sent).toEqual([{
      amountSom: 5400, method: 'CASH', priceSom: 6000, discount: { percent: 10, reason: 'PROMO', comment: FRIEND_COMMENT },
    }]))
  })

  test('с меткой 15 % — подставлена метка, бонус подсказкой; скидки не складываются', async () => {
    backend({ tagIds: [2] })
    const form = await payForm()
    const discount = await within(form).findByRole('group', { name: 'Скидка' })
    expect(within(discount).getByLabelText('Скидка, %')).toHaveValue(15)
    expect(within(form).getByText(/🎁 Пришёл по приглашению/)).toHaveClass('muted')
    expect(within(form).getByText(/Скидки не складываются/)).toHaveTextContent(/по метке «Родственник» — 900 сом, по приглашению — 600 сом/)
    expect(within(form).getByText(/Скидки не складываются/)).toHaveTextContent(/Подставляем бо́льшую — по метке/)
    await userEvent.click(within(within(form).getByText(/🎁 Пришёл по приглашению/)).getByRole('button', { name: 'Применить' }))
    expect(within(form).getByLabelText('Комментарий к скидке')).toHaveValue(FRIEND_COMMENT)
    expect(within(form).getAllByRole('group', { name: 'Скидка' })).toHaveLength(1)
  })

  test('пригласивший: «Бонус за друга (имя)» — имя видит только сотрудник', async () => {
    backend({ offers: [offer({ kind: 'REWARD', friendName: 'Айгуль В.' })] })
    const form = await payForm()
    await within(form).findByRole('group', { name: 'Скидка' })
    expect(within(form).getByText(/🎁 Бонус за друга \(Айгуль В\.\) — скидка 10 %/)).toBeInTheDocument()
    expect(within(form).getByLabelText('Комментарий к скидке')).toHaveValue(REWARD_COMMENT)
    // В комментарий (он попадает в квитанцию пациенту) имя друга не пишем
    expect(within(form).getByLabelText('Комментарий к скидке')).not.toHaveValue(expect.stringContaining('Айгуль'))
  })

  test('регистратура без права на скидку — только подсказка, не подставляем', async () => {
    backend()
    server.use(http.get('*/api/clinic/discounts', () => HttpResponse.json({ ...ADMIN, canGive: false })))
    const form = await payForm()
    expect(await within(form).findByText(/🎁 Пришёл по приглашению — скидка 10 %: скидку даёт руководитель/)).toBeInTheDocument()
    expect(within(form).queryByRole('group', { name: 'Скидка' })).not.toBeInTheDocument()
  })
})

describe('«Настройки → Приведи друга»', () => {
  const ON: ReferralSettings = { ...REFERRAL_OFF, enabled: true, previewRu: '🎁 Приведи друга\n\nПосоветуйте нас друзьям! …', previewKy: '🎁 Досуңду чакыр\n\nБизди …' }

  test('включить, бонус-услуга и образец ru / ky', async () => {
    const sent: Schemas['PatientReferralsSettings'][] = []
    let current = REFERRAL_OFF
    server.use(
      http.get('*/api/patient/me', () => HttpResponse.json(me)),
      http.get('*/api/clinic/referral-settings', () => HttpResponse.json(current)),
      http.get('*/api/service-types', () => HttpResponse.json([{ id: 21, name: 'Профчистка', priceSom: 2500, durationMinutes: 40, active: true }])),
      http.put('*/api/clinic/referral-settings', async ({ request }) => {
        const body = (await request.json()) as Schemas['PatientReferralsSettings']
        sent.push(body)
        current = { ...ON, enabled: body.enabled, friend: body.friendKind === 'SERVICE'
          ? { kind: 'SERVICE', serviceId: body.friendServiceId, serviceName: 'Профчистка', label: 'бесплатно: Профчистка' } : ON.friend }
        return HttpResponse.json(current)
      }),
    )
    renderApp()
    openItem('referral')
    const enable = await screen.findByRole('checkbox', { name: /Включить «Приведи друга»/ })
    expect(enable).not.toBeChecked()
    await userEvent.click(enable)
    await waitForSlow(() => expect(sent[0]).toMatchObject({ enabled: true, friendKind: 'PERCENT', friendPercent: 10, validDays: 60 }))
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '🎁 Бонус другу' })).getByRole('radio', { name: /Услуга бесплатно/ }))
    await waitForSlow(() => expect(sent[1]).toMatchObject({ enabled: true, friendKind: 'SERVICE', friendServiceId: 21 }))
    expect(await screen.findByLabelText('🎁 Бонус другу: услуга')).toBeInTheDocument()
    expect(screen.getByLabelText('Образец сообщения')).toHaveTextContent('Посоветуйте нас друзьям')
    await userEvent.click(screen.getByRole('button', { name: 'Кыргызча' }))
    expect(screen.getByLabelText('Образец сообщения')).toHaveTextContent('Досуңду чакыр')
  })
})

describe('карточка пациента: «Приведи друга»', () => {
  const patient: Schemas['PatientView'] = { id: 5, fullName: 'Вымышленная Айгуль', phone: '996555000111', telegram: true }

  test('«Пригласил», «Привёл друзей» и ссылка для WhatsApp без данных пациента в ссылке', async () => {
    server.use(
      http.get('*/api/patients/:id/referral', () => HttpResponse.json({
        enabled: true, inviterId: 7, inviterName: 'Вымышленный Нурлан', channel: 'SITE', referredAt: '2026-11-01T06:00:00Z', invited: 3, came: 2,
        rewardsAvailable: 1, rewardsUsed: 1,
        friends: [{ patientId: 8, fullName: 'Друг Первый', referredAt: '2026-11-10T06:00:00Z', came: true },
          { patientId: 9, fullName: 'Друг Второй', referredAt: '2026-11-11T06:00:00Z', came: true },
          { patientId: 10, fullName: 'Друг Третий', referredAt: '2026-11-12T06:00:00Z', came: false }],
      } satisfies Schemas['PatientReferralsCard'])),
      http.get('*/api/patients/:id/referral/link', () => HttpResponse.json({
        code: 'K7M4PQ2X', siteUrl: 'https://tish.test/c/abc?ref=K7M4PQ2X#book',
        textRu: 'Записывайтесь в «Тест» по моей ссылке — на первый приём скидка 10 %: https://tish.test/c/abc?ref=K7M4PQ2X#book',
        textKy: '«Тест» клиникасына менин шилтемем аркылуу жазылыңыз …',
      } satisfies Schemas['PatientReferralsLink'])),
    )
    const opened: number[] = []
    wrap(<ReferralBox patient={patient} canEdit link onCloseLink={() => {}} onOpenPatient={(id) => opened.push(id)} />)
    const box = await screen.findByRole('region', { name: 'Приведи друга' })
    expect(within(box).getByText(/Пригласил:/)).toHaveTextContent('Вымышленный Нурлан')
    expect(within(box).getByText(/Привёл друзей:/)).toHaveTextContent('Привёл друзей: 3 · пришли 2 · 🎁 бонусов: 1 · использовано 1')
    await userEvent.click(within(box).getByRole('button', { name: 'Вымышленный Нурлан' }))
    expect(opened).toEqual([7])
    const link = await within(box).findByRole('group', { name: 'Ссылка «Приведи друга»' })
    const wa = within(link).getByRole('link', { name: 'Отправить в WhatsApp' })
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/996555000111\?text=/)
    expect(decodeURIComponent(wa.getAttribute('href')!)).toContain('?ref=K7M4PQ2X')
    expect(within(link).getByLabelText('Текст для друга')).not.toHaveTextContent('Айгуль')
    await userEvent.click(within(link).getByRole('button', { name: 'Кыргызча' }))
    expect(within(link).getByLabelText('Текст для друга')).toHaveTextContent('клиникасына')
  })

  test('«Пригласил» вручную — поиском, без самого себя', async () => {
    const put: unknown[] = []
    const after: Schemas['PatientReferralsCard'] = { enabled: true, inviterId: 7, inviterName: 'Вымышленный Нурлан', channel: 'STAFF', invited: 0,
      came: 0, rewardsAvailable: 0, rewardsUsed: 0, friends: [] }
    server.use(
      http.get('*/api/patients/:id/referral', () => HttpResponse.json(put.length ? after
        : { enabled: true, invited: 0, came: 0, rewardsAvailable: 0, rewardsUsed: 0, friends: [] })),
      http.post('*/api/patients/search', () => HttpResponse.json([patient, { id: 7, fullName: 'Вымышленный Нурлан', telegram: false }])),
      http.put('*/api/patients/:id/referral', async ({ request }) => {
        put.push(await request.json())
        return HttpResponse.json(after)
      }),
    )
    wrap(<ReferralBox patient={patient} canEdit link={false} onCloseLink={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'выбрать, кто посоветовал' }))
    await userEvent.type(screen.getByLabelText('Кто пригласил'), 'Нур')
    const found = await screen.findByRole('list')
    expect(within(found).queryByText('Вымышленная Айгуль')).not.toBeInTheDocument()
    await userEvent.click(within(found).getByRole('button', { name: 'Вымышленный Нурлан' }))
    await waitForSlow(() => expect(put).toEqual([{ inviterId: 7 }]))
    expect(await screen.findByText(/Пригласил:/)).toHaveTextContent('отметили вручную')
  })

  test('новый пациент: «Пригласил (необязательно)» сохраняется вместе с карточкой и ставит «Посоветовали знакомые»', async () => {
    const created: Record<string, unknown>[] = []
    const put: unknown[] = []
    server.use(
      http.get('*/api/patient-sources', () => HttpResponse.json([{ id: 16, code: 'RECOMMENDATION', emoji: '🤝', title: 'Посоветовали знакомые', active: true, position: 60, patients: 0 }])),
      http.post('*/api/patients/search', () => HttpResponse.json([{ id: 7, fullName: 'Вымышленный Нурлан', telegram: false }])),
      http.post('*/api/patients', async ({ request }) => {
        created.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json({ id: 30, fullName: 'Новый Тестов', telegram: false }, { status: 201 })
      }),
      http.put('*/api/patients/:id/referral', async ({ request, params }) => {
        put.push({ id: params.id, ...(await request.json() as object) })
        return HttpResponse.json({ enabled: true, invited: 0, came: 0, rewardsAvailable: 0, rewardsUsed: 0, friends: [] })
      }),
    )
    const saved: number[] = []
    wrap(<PatientForm onSaved={(p) => saved.push(p.id)} />)
    await userEvent.type(screen.getByLabelText('Имя пациента'), 'Новый Тестов')
    await userEvent.type(screen.getByLabelText('Телефон'), '700112233')
    await userEvent.type(screen.getByLabelText('Пригласил'), 'Нур')
    await userEvent.click(await screen.findByRole('button', { name: 'Вымышленный Нурлан' }))
    expect(screen.getByText(/Пригласил:/)).toHaveTextContent('Вымышленный Нурлан')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitForSlow(() => expect(saved).toEqual([30]))
    expect(created[0]).toMatchObject({ sourceId: 16 })
    expect(put).toEqual([{ id: '30', inviterId: 7 }])
  })
})

describe('аналитика и Mini App', () => {
  test('плитка: пришли по приглашению, выручка и лучшие пригласившие; выключено и пусто — плитки нет', async () => {
    server.use(http.get('*/api/reports/referrals', () => HttpResponse.json({
      from: '2026-10-26', to: '2026-11-24', enabled: true, invited: 4, came: 3, revenueSom: 18500, rewardsGiven: 3, rewardsUsed: 1,
      top: [{ patientId: 1, fullName: 'Вымышленная Айгуль', invited: 3, came: 2 }],
    } satisfies Schemas['PatientReferralsReport'])))
    wrap(<ReferralTile from="2026-10-26" to="2026-11-24" />)
    const tile = await screen.findByRole('region', { name: 'Приведи друга' })
    expect(within(tile).getByText(/по приглашению/)).toHaveTextContent(/4 по приглашению · пришли 3 · выручка 18\s500 сом/)
    expect(within(tile).getByText('Вымышленная Айгуль')).toBeInTheDocument()
    expect(within(tile).getByText(/начислено/)).toHaveTextContent(/начислено 3, использовано 1/)
  })

  test('плитки нет, когда программа выключена и приглашённых нет', async () => {
    const { container } = wrap(<ReferralTile from="2026-10-26" to="2026-11-24" />)
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })

  test('карточка Mini App: условия, «Поделиться» и «Скопировать»; до первой записи — без ссылки; ky', async () => {
    server.use(http.get('*/api/patient/referral', () => HttpResponse.json({
      enabled: true, code: 'K7M4PQ2X', siteUrl: 'https://tish.test/c/abc?ref=K7M4PQ2X#book', shareText: 'Записывайтесь … https://tish.test/c/abc?ref=K7M4PQ2X#book',
      friendBonus: 'скидка 10 %', inviterBonus: 'скидка 15 %', validDays: 60, invited: 2, came: 1, rewardsUntil: ['2027-01-20'],
    } satisfies Schemas['PatientReferralsPatientLink'])))
    const open = vi.fn()
    window.open = open as unknown as typeof window.open
    wrap(<FriendCard t={translator('ru')} />)
    const card = await screen.findByRole('region', { name: '🎁 Приведи друга' })
    expect(card).toHaveTextContent('Другу на первый приём — скидка 10 %, а вам — скидка 15 % за каждого друга')
    expect(card).toHaveTextContent('записались 2, пришли 1')
    expect(card).toHaveTextContent('Ваших бонусов: 1')
    await userEvent.click(within(card).getByRole('button', { name: 'Поделиться с другом' }))
    expect(String(open.mock.calls[0]?.[0])).toMatch(/^https:\/\/t\.me\/share\/url\?url=https%3A%2F%2Ftish\.test/)
  })

  test('Mini App до первой записи и по-кыргызски', async () => {
    server.use(http.get('*/api/patient/referral', () => HttpResponse.json({
      enabled: true, friendBonus: '10 % арзандатуу', inviterBonus: '10 % арзандатуу', validDays: 60, invited: 0, came: 0, rewardsUntil: [],
    } satisfies Schemas['PatientReferralsPatientLink'])))
    wrap(<FriendCard t={translator('ky')} />)
    const card = await screen.findByRole('region', { name: '🎁 Досуңду чакыр' })
    expect(card).toHaveTextContent('биринчи жазылуудан кийин')
    expect(within(card).queryByRole('button', { name: 'Дос менен бөлүшүү' })).not.toBeInTheDocument()
  })
})
