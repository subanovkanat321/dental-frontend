/**
 * Текст для поста «до / после» — по шаблону, без ИИ: работает без ключа и бесплатно. Данных
 * пациента на входе нет вовсе (ни имени, ни возраста, ни телефона) — значит, и в текст они попасть
 * не могут. Только работа, сроки, клиника и ссылка на запись.
 */

export type PostStyle = 'short' | 'full' | 'emoji'

export const POST_STYLES: [PostStyle, string][] = [['short', 'Коротко'], ['full', 'Подробно'], ['emoji', 'С эмодзи']]

export type PostInput = {
  /** Что сделали: «Отбеливание», «Реставрация 2 зубов» */
  procedure: string
  /** Сколько заняло: «2 визита», «3 недели»; пусто — не пишем */
  duration: string
  doctor: string
  clinic: string
  address?: string | null
  phone?: string | null
  /** Ссылка на запись: страница клиники на сайте */
  bookingUrl?: string | null
}

/** Польза для читателя и хэштеги — по словам в названии услуги; не узнали — общее. */
const TOPICS: { match: RegExp; benefit: string[]; tags: string[] }[] = [
  {
    match: /отбел/i,
    benefit: ['Улыбка светлее на несколько тонов — бережно для эмали.', 'Результат видно сразу после процедуры.'],
    tags: ['#отбеливаниезубов', '#белыезубы'],
  },
  {
    match: /реставр|винир|композит/i,
    benefit: ['Форма и цвет зубов — как свои, но лучше.', 'Скол или тёмный зуб больше не мешает улыбаться.'],
    tags: ['#реставрациязубов', '#эстетическаястоматология'],
  },
  {
    match: /имплант/i,
    benefit: ['Новый зуб, который выглядит и жуёт как свой.', 'Без съёмных протезов и неудобств.'],
    tags: ['#имплантациязубов', '#имплантыбишкек'],
  },
  {
    match: /брекет|элайнер|ортодонт|прикус/i,
    benefit: ['Ровные зубы — красивая улыбка и здоровый прикус.', 'Лечение под контролем врача на каждом этапе.'],
    tags: ['#брекеты', '#ортодонт'],
  },
  {
    match: /чистк|гигиен|налёт|налет|камн/i,
    benefit: ['Чистые и гладкие зубы, свежее дыхание.', 'Профгигиена раз в полгода бережёт от кариеса.'],
    tags: ['#профгигиена', '#чисткизубов'],
  },
  {
    match: /корон|протез/i,
    benefit: ['Крепкий зуб с естественным цветом и формой.', 'Можно снова спокойно жевать и улыбаться.'],
    tags: ['#коронки', '#протезированиезубов'],
  },
  {
    match: /пломб|кариес|лечен/i,
    benefit: ['Зуб снова целый и не болит.', 'Пломбу не отличить от своего зуба.'],
    tags: ['#лечениезубов', '#кариес'],
  },
]

const GENERAL = { benefit: ['Здоровая и красивая улыбка — без боли и страха.', 'Подберём лечение под вашу ситуацию.'], tags: ['#лечениезубов'] }

/** 5–8 хэштегов: город и стоматология всегда, плюс по услуге. */
export function hashtags(procedure: string): string[] {
  const topic = TOPICS.find((t) => t.match.test(procedure)) ?? GENERAL
  return [...new Set(['#стоматологБишкек', '#бишкек', '#стоматология', '#доипосле', ...topic.tags, '#улыбка'])].slice(0, 8)
}

function benefit(procedure: string): string[] {
  return (TOPICS.find((t) => t.match.test(procedure)) ?? GENERAL).benefit
}

/** Строки без пустых: нет адреса или телефона — строки просто нет. */
const lines = (...items: (string | false | null | undefined)[]) => items.filter((s): s is string => Boolean(s && s.trim())).join('\n')

export function buildPost(style: PostStyle, input: PostInput): string {
  const work = input.procedure.trim() || 'Наша работа'
  const duration = input.duration.trim()
  const doctor = input.doctor.trim()
  const clinic = input.clinic.trim()
  const [first, second] = benefit(work)
  const tags = hashtags(work).join(' ')
  const book = input.bookingUrl ? `Записаться: ${input.bookingUrl}` : 'Записаться — по телефону или в директ.'

  if (style === 'short') {
    return lines(
      `${work}: до и после.`,
      first,
      '',
      book,
      clinic && [clinic, input.phone].filter(Boolean).join(' · '),
      '',
      tags,
    ).replace(/\n{3,}/g, '\n\n')
  }
  if (style === 'emoji') {
    return lines(
      `✨ ${work} — до и после`,
      duration && `⏱ ${duration}`,
      `😁 ${first}`,
      second && `💎 ${second}`,
      doctor && `👩‍⚕️ Врач: ${doctor}`,
      '',
      `📅 ${book}`,
      clinic && `🦷 ${clinic}`,
      input.address && `📍 ${input.address}`,
      input.phone && `📞 ${input.phone}`,
      '',
      tags,
    ).replace(/\n{3,}/g, '\n\n')
  }
  return lines(
    `${work} — результат до и после.`,
    duration && `Сколько заняло: ${duration}.`,
    '',
    `${first} ${second ?? ''}`.trim(),
    doctor && `Работу выполнил(а) врач ${doctor}.`,
    '',
    'Хотите так же? Запишитесь на консультацию — расскажем, что подойдёт именно вам.',
    book,
    '',
    clinic,
    input.address && `Адрес: ${input.address}`,
    input.phone && `Телефон: ${input.phone}`,
    '',
    tags,
  ).replace(/\n{3,}/g, '\n\n')
}

/** «Сколько заняло» по датам снимков: тот же день — «1 визит», дальше — дни, недели, месяцы. */
export function durationBetween(from?: string | null, to?: string | null): string {
  if (!from || !to) return ''
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
  if (!Number.isFinite(days) || days < 0) return ''
  if (days === 0) return '1 визит'
  if (days < 14) return `${days} ${plural(days, 'день', 'дня', 'дней')}`
  if (days < 60) {
    const w = Math.round(days / 7)
    return `${w} ${plural(w, 'неделя', 'недели', 'недель')}`
  }
  const m = Math.round(days / 30)
  return `${m} ${plural(m, 'месяц', 'месяца', 'месяцев')}`
}

function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return one
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few
  return many
}

/**
 * Ссылка на ChatGPT с готовой просьбой: переписать пост живее, по правилам рекламы врача. Уходит
 * только текст поста — в нём нет пациента (услуга, сроки, контакты клиники); вопрос откроется в
 * ChatGPT человека, наш ИИ и баланс не тратятся.
 */
export function chatGptUrl(post: string): string {
  const ask = 'Ты SMM-специалист стоматологической клиники в Бишкеке. Улучши текст поста для Instagram '
    + 'о результате лечения «до / после»: живее и короче, на русском. Нельзя обещать «100%», «без боли», «гарантию» '
    + 'и писать цены, которых нет в тексте. Сохрани адрес, телефон, ссылку на запись и 5–8 хэштегов. Дай 2 варианта.\n\n'
    + `Текст:\n${post}`
  return `https://chatgpt.com/?q=${encodeURIComponent(ask)}`
}
