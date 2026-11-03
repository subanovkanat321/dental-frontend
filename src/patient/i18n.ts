import { addDays, timeOf, todayIn, ZONE } from '../lib/time'

/**
 * Язык экранов пациента: русский или кыргызский (персонал — на русском). Все тексты — здесь, в
 * одном месте: перевод может проверить носитель языка, не читая код. Перенесено из static/js/i18n.js.
 */
export type Lang = 'ru' | 'ky'

const TEXTS: Record<Lang, Record<string, string>> = {
  ru: {
    langRu: 'Русский',
    langKy: 'Кыргызча',
    bookTitle: 'Запись к стоматологу',
    pickDoctorSub: 'Выберите врача, услугу и удобное время — врач подтвердит запись',
    pickServiceSub: 'Выберите услугу и удобное время — врач подтвердит запись',
    doctor: 'Врач',
    unavailable: 'Запись пока недоступна — позвоните в клинику.',
    yourBooking: 'Ваша запись',
    waitingYou: 'Ждём вас в клинике 😊',
    defaultService: 'Приём у стоматолога',
    requested: '⏳ Ждёт подтверждения врача — ответ придёт в этот чат',
    scheduled: '✅ Подтверждена',
    moveOther: 'Перенести на другое время',
    waitlistJoin: 'Хочу раньше — напишите, если освободится',
    depositAsk: 'Клиника просит предоплату {sum} сом',
    depositWhy: 'Так время точно останется за вами. Переведите по QR или реквизитам ниже и нажмите «Я оплатил(а)». Сумма войдёт в оплату приёма.',
    depositPaid: '✅ Я оплатил(а)',
    depositReceipt: 'Приложить чек (по желанию)',
    depositReported: 'Предоплата {sum} сом: клиника проверяет перевод',
    depositReceived: 'Предоплата {sum} сом получена — ждём вас',
    waitlistOn: '🔔 Вы в листе ожидания. Освободится время раньше — бот сразу напишет, запишетесь одной кнопкой.',
    waitlistLeave: 'Больше не нужно',
    clinicPhone: '📞 Вопросы — по телефону клиники: {phone}',
    call: '📞 Позвонить',
    writeWhatsapp: '💬 Написать в WhatsApp',
    cancel: 'Отменить запись',
    cancelSure: 'Точно отменить? Нажмите ещё раз',
    moveTitle: 'Перенести запись',
    moveNow: 'Сейчас: {when}. Новое время подтвердит врач.',
    day: 'День',
    days: 'Дни',
    time: 'Время',
    freeTime: 'Свободное время',
    loading: 'Загрузка…',
    noFree: 'На этот день свободного времени нет',
    busySlot: 'занято',
    dayOff: 'Выходной',
    otherDay: 'Выберите другой день',
    move: 'Перенести',
    pickTime: 'Выберите время',
    moved: '✅ Запись перенесена — ждём подтверждения врача',
    cancelled: 'Запись отменена. Записаться снова можно здесь же — на любое свободное время.',
    nearestFree: 'Показать ближайшее свободное время',
    taken: 'Это время уже заняли — выберите другое',
    service: 'Услуга',
    min: 'мин',
    otherServices: 'Другое',
    news: 'Новости клиники',
    chooseClinic: 'Выберите клинику',
    chooseClinicSub: 'В какую клинику хотите записаться? Потом можно сменить.',
    otherClinic: 'другая клиника',
    clinicSearch: 'Название или адрес клиники',
    cities: 'Город',
    allCities: 'Все города',
    clinicsNone: 'Ничего не нашлось — попробуйте другое слово.',
    clinicsAll: 'Показать все клиники',
    newsNone: 'Новостей пока нет.',
    newsOn: '🔔 Присылать новости в бот',
    newsOff: '🔕 Не присылать новости',
    newsSubscribed: 'Новые новости приходят вам в бот. Не чаще раза в день.',
    newsOffer: 'Акции, изменения в расписании, новые врачи. Включите — и новые новости будут приходить в бот, не чаще раза в день.',
    pickServiceFirst: 'Сначала выберите услугу',
    phoneFromTelegram: 'номер из Telegram',
    openFromBot: 'Откройте запись из бота в Telegram',
    needPhone: 'Без номера записаться нельзя: на него придёт напоминание',
    gettingPhone: 'Получаем номер…',
    sharePhone: 'Поделиться номером',
    phoneLost: 'Номер не дошёл — попробуйте ещё раз',
    pickService: 'Выберите услугу',
    nameRequired: 'Укажите имя пациента',
    phoneRequired: 'Поделитесь номером телефона',
    consentRequired: 'Нужно согласие на обработку данных',
    otherDoctor: '‹ Другой врач',
    patientName: 'Имя пациента',
    comment: 'Комментарий для врача (необязательно)',
    commentHint: 'Например: болит зуб справа внизу, удобнее утром',
    sourceQuestion: 'Откуда вы о нас узнали?',
    sourceOptional: 'Необязательно — можно пропустить',
    promoHave: '🎟 У меня есть промокод',
    promoLabel: 'Промокод (если есть)',
    promoPlaceholder: 'Например: ZUBY10',
    promoCheck: 'Проверить',
    promoAccepted: 'Промокод принят',
    promoClinicApplies: 'Скидку применяет клиника на приёме.',
    promoInvalid: 'Такого промокода нет или срок закончился. Проверьте написание или уберите промокод — записаться можно и без него.',
    promoBooking: 'Промокод {code} — скидку применяет клиника на приёме',
    promoRemove: 'Убрать',
    phone: 'Телефон',
    consent: 'Согласен(на), что {holder} обрабатывает мои данные (имя и телефон) для записи на приём и напоминаний о нём',
    holderDefault: 'клиника',
    privacy: 'Политика обработки данных',
    privacyTitle: 'Как мы обращаемся с вашими данными',
    privacyWho: 'Кто отвечает за данные',
    privacyWhat: 'Какие данные',
    privacyWhatText: 'Имя и телефон, ваш Telegram (чтобы бот писал вам), записи на приём, ответы на напоминания и оценки. Врач может вести заметки о лечении.',
    privacyWhy: 'Зачем',
    privacyWhyText: 'Чтобы записать вас к врачу, напомнить о приёме и связаться, если время изменится. Рекламу не присылаем, данные никому не продаём и не передаём.',
    privacyWhere: 'Где хранятся',
    privacyWhereText: 'На защищённом сервере клиники, соединение зашифровано. Видят только сотрудники клиники; медицинские заметки — ваш врач и администратор клиники.',
    privacyRights: 'Ваши права',
    privacyRightsText: 'Вы можете узнать, какие данные о вас хранятся, исправить их, отозвать согласие и попросить удалить данные (Закон КР «Об информации персонального характера»). Напишите или позвоните в клинику.',
    privacyContact: 'Связаться с клиникой: {phone}',
    back: '‹ Назад',
    book: 'Записаться',
    findUs: 'Как нас найти',
    open2gis: 'Открыть в 2ГИС',
    cantBook: 'Не получается записаться? ',
    support: '🛟 Техподдержка',
    serviceBot: 'Это служебный бот записи клиники.',
    bookBy: 'Записаться на приём: {phone}',
    doctorPhoto: 'Фото врача',
    noConnection: 'Нет связи с сервером',
    today: 'Сегодня',
    tomorrow: 'Завтра',
    whenAt: '{when}, в {time}',
    stepService: '① Услуга',
    stepTime: '② День и время',
    stepData: '③ Ваши данные',
    nextService: 'Выберите услугу ↑',
    nextTime: 'Далее: выбрать время ↓',
    nextData: 'Далее: ваши данные ↓',
    noFreeSoon: 'В ближайшие дни свободного времени нет.',
    // Ошибки сервера по коду — своими словами на языке пациента (сервер отвечает по-русски)
    errPaused: 'Клиника сейчас не принимает новые записи через бота.',
    errClinicPaused: 'Запись онлайн временно недоступна.',
    settingUp: '🛠 Клиника ещё настраивается — запись скоро.',
    errStale: 'Данные только что изменились — экран обновлён, попробуйте ещё раз.',
    elsewhere: 'У вас запись в «{clinic}»: {when}',
    elsewhereOpen: 'Открыть эту клинику',
    errBookingOff: 'Запись через бота сейчас выключена.',
    errAlreadyBooked: 'У вас уже есть запись — сначала отмените её.',
    errNoBooking: 'Сначала запишитесь — потом можно попросить время раньше.',
    errBookingGone: 'Записи больше нет — возможно, её уже отменили.',
    errAlreadyWaiting: 'Вы уже в листе ожидания.',
    errDepositClosed: 'Предоплату уже проверяют или она получена.',
    callClinic: 'Позвоните в клинику: {phone}',
    contactClinic: 'Свяжитесь с клиникой.',
    oldTelegram: 'Этот Telegram не умеет делиться номером из приложения. Обновите Telegram или отправьте номер боту в чат: 📎 → «Контакт», затем откройте запись заново.',
    // «Кого записываем?» — себя, родственника из семьи или нового (запись детей с Telegram мамы)
    whoTitle: 'Кого записываем?',
    whoSelf: 'Себя',
    whoAdd: '＋ Ребёнка или родственника',
    whoBooked: 'уже записан(а)',
    relativeName: 'Имя и фамилия',
    relativeBirth: 'Дата рождения (необязательно)',
    relativeRelation: 'Кем приходится вам',
    relCHILD: 'Ребёнок',
    relSPOUSE: 'Супруг(а)',
    relPARENT: 'Родитель',
    relSIBLING: 'Брат или сестра',
    relOTHER: 'Другой родственник',
    relativePhone: 'Его телефон (необязательно)',
    relativePhoneHint: 'Пусто — напоминания придут вам, в этот чат',
    relativeNameRequired: 'Укажите имя родственника',
    relativeBirthInvalid: 'Проверьте дату рождения',
    relativePhoneInvalid: 'Проверьте номер телефона',
    relativeRelationRequired: 'Выберите, кем приходится вам',
    relativeDefault: 'этого человека',
    yourName: 'Ваше имя',
    yourPhone: 'Ваш телефон',
    consentFor: 'Я законный представитель: {name} (или записываю с его согласия). Согласен(на), что {holder} обрабатывает наши данные (имена, телефон, дату рождения) для записи на приём и напоминаний о нём',
    myBookings: 'Мои записи',
    bookingOf: 'Запись: {name}',
    forMe: 'Вы',
    bookAnother: '＋ Записать ещё — себя или ребёнка',
    allBookings: '‹ Все записи',
    errTooMany: 'Записей уже много — сначала сходите на приём или отмените одну из них.',
    errRelativesLimit: 'Больше родственников добавить нельзя — остальных запишет клиника.',
    // Запись на сайте без Telegram (site/WebBooking)
    webTitle: 'Запись на сайте',
    webSub: 'Без Telegram: выберите врача, услугу и время — клиника позвонит, чтобы подтвердить запись',
    webStepDoctor: 'Врач',
    webPhoneHint: 'На этот номер позвонит клиника, чтобы подтвердить запись',
    webPhoneRequired: 'Укажите номер телефона',
    webSubmit: 'Записаться',
    webSending: 'Отправляем…',
    webSentTitle: 'Заявка отправлена',
    webSentText: 'Клиника позвонит вам, чтобы подтвердить запись. Если планы изменятся — позвоните в клинику.',
    webTgHint: 'Есть Telegram? Там бот напомнит о приёме накануне и время можно перенести самому.',
    webTgLink: 'Записаться в Telegram',
    webPhoneBooked: 'На этот номер уже есть запись в клинике. Чтобы перенести её или записать ещё кого-то, позвоните',
    webTooMany: 'С этого устройства сегодня уже было несколько заявок — позвоните в клинику, и вас запишут.',
    webOff: 'Онлайн-запись сейчас закрыта.',
    webClose: '‹ К странице клиники',
    webPrivacyText: 'Имя и телефон, записи на приём и комментарий к ним. Врач может вести заметки о лечении.',
    webWhen: 'Когда',
    webAddress: 'Адрес',
    webPhoneClinic: 'Телефон клиники',
    webNoServices: 'Онлайн-запись к этому врачу пока недоступна — позвоните в клинику.',
  },
  ky: {
    langRu: 'Русский',
    langKy: 'Кыргызча',
    bookTitle: 'Тиш дарыгерине жазылуу',
    pickDoctorSub: 'Дарыгерди, кызматты жана ыңгайлуу убакытты тандаңыз — дарыгер жазылууну ырастайт',
    pickServiceSub: 'Кызматты жана ыңгайлуу убакытты тандаңыз — дарыгер жазылууну ырастайт',
    doctor: 'Дарыгер',
    unavailable: 'Азырынча жазылуу мүмкүн эмес — клиникага чалыңыз.',
    yourBooking: 'Сиздин жазылууңуз',
    waitingYou: 'Сизди клиникада күтөбүз 😊',
    defaultService: 'Тиш дарыгеринин кабыл алуусу',
    requested: '⏳ Дарыгердин ырастоосун күтүүдө — жооп ушул чатка келет',
    scheduled: '✅ Ырасталды',
    moveOther: 'Башка убакытка жылдыруу',
    waitlistJoin: 'Эртерээк келгим келет — убакыт бошосо жазыңыз',
    depositAsk: 'Клиника {sum} сом алдын ала төлөм сурайт',
    depositWhy: 'Ошондо убакыт сөзсүз сизге калат. QR же төмөнкү реквизиттер боюнча которуп, «Төлөдүм» баскычын басыңыз. Сумма дарылоонун төлөмүнө кошулат.',
    depositPaid: '✅ Төлөдүм',
    depositReceipt: 'Чекти тиркөө (каалоо боюнча)',
    depositReported: 'Алдын ала төлөм {sum} сом: клиника которууну текшерип жатат',
    depositReceived: 'Алдын ала төлөм {sum} сом алынды — сизди күтөбүз',
    waitlistOn: '🔔 Сиз күтүү тизмесиндесиз. Эртерээк убакыт бошосо, бот дароо жазат — бир баскыч менен жазыласыз.',
    waitlistLeave: 'Кереги жок',
    clinicPhone: '📞 Суроолор боюнча — клиниканын телефону: {phone}',
    call: '📞 Чалуу',
    writeWhatsapp: '💬 WhatsApp’ка жазуу',
    cancel: 'Жазылууну жокко чыгаруу',
    cancelSure: 'Чын эле жокко чыгарасызбы? Дагы бир жолу басыңыз',
    moveTitle: 'Жазылууну жылдыруу',
    moveNow: 'Азыр: {when}. Жаңы убакытты дарыгер ырастайт.',
    day: 'Күн',
    days: 'Күндөр',
    time: 'Убакыт',
    freeTime: 'Бош убакыт',
    loading: 'Жүктөлүүдө…',
    noFree: 'Бул күнү бош убакыт жок',
    busySlot: 'бош эмес',
    dayOff: 'Дем алыш күн',
    otherDay: 'Башка күндү тандаңыз',
    move: 'Жылдыруу',
    pickTime: 'Убакытты тандаңыз',
    moved: '✅ Жазылуу жылдырылды — дарыгердин ырастоосун күтөбүз',
    cancelled: 'Жазылуу жокко чыгарылды. Кайра ушул жерден каалаган бош убакытка жазылсаңыз болот.',
    nearestFree: 'Эң жакын бош убакытты көрсөтүү',
    taken: 'Бул убакыт бош эмес — башкасын тандаңыз',
    service: 'Кызмат',
    min: 'мүн.',
    otherServices: 'Башка',
    news: 'Клиниканын жаңылыктары',
    chooseClinic: 'Клиниканы тандаңыз',
    chooseClinicSub: 'Кайсы клиникага жазылгыңыз келет? Кийин алмаштырса болот.',
    otherClinic: 'башка клиника',
    clinicSearch: 'Клиниканын аталышы же дареги',
    cities: 'Шаар',
    allCities: 'Бардык шаарлар',
    clinicsNone: 'Эч нерсе табылган жок — башка сөз менен издеңиз.',
    clinicsAll: 'Бардык клиникаларды көрсөтүү',
    newsNone: 'Жаңылыктар азырынча жок.',
    newsOn: '🔔 Жаңылыктарды ботко жөнөтүү',
    newsOff: '🔕 Жаңылыктарды жөнөтпөө',
    newsSubscribed: 'Жаңы жаңылыктар ботко келет. Күнүнө бир жолудан көп эмес.',
    newsOffer: 'Акциялар, графиктеги өзгөрүүлөр, жаңы дарыгерлер. Күйгүзсөңүз — жаңы жаңылыктар ботко келет, күнүнө бир жолудан көп эмес.',
    pickServiceFirst: 'Адегенде кызматты тандаңыз',
    phoneFromTelegram: 'Telegram’дагы номер',
    openFromBot: 'Жазылууну Telegram’дагы боттон ачыңыз',
    needPhone: 'Номерсиз жазылууга болбойт: эскертме ушул номерге келет',
    gettingPhone: 'Номер алынууда…',
    sharePhone: 'Номер менен бөлүшүү',
    phoneLost: 'Номер келген жок — дагы бир жолу аракет кылыңыз',
    pickService: 'Кызматты тандаңыз',
    nameRequired: 'Бейтаптын атын жазыңыз',
    phoneRequired: 'Телефон номериңиз менен бөлүшүңүз',
    consentRequired: 'Маалыматтарды иштетүүгө макулдук керек',
    otherDoctor: '‹ Башка дарыгер',
    patientName: 'Бейтаптын аты',
    comment: 'Дарыгерге комментарий (милдеттүү эмес)',
    commentHint: 'Мисалы: оң жактагы астыңкы тиш ооруйт, эртең менен ыңгайлуу',
    sourceQuestion: 'Биз жөнүндө кайдан билдиңиз?',
    sourceOptional: 'Милдеттүү эмес — өткөрүп жиберсеңиз болот',
    promoHave: '🎟 Менде промокод бар',
    promoLabel: 'Промокод (болсо)',
    promoPlaceholder: 'Мисалы: ZUBY10',
    promoCheck: 'Текшерүү',
    promoAccepted: 'Промокод кабыл алынды',
    promoClinicApplies: 'Арзандатууну клиника кабыл алууда колдонот.',
    promoInvalid: 'Мындай промокод жок же мөөнөтү бүттү. Жазылышын текшериңиз же промокодду алып салыңыз — ансыз деле жазылса болот.',
    promoBooking: 'Промокод {code} — арзандатууну клиника кабыл алууда колдонот',
    promoRemove: 'Алып салуу',
    phone: 'Телефон',
    consent: '{holder} менин маалыматтарымды (атымды жана телефонумду) кабыл алууга жазуу жана эскертүү үчүн иштетишине макулмун',
    holderDefault: 'Клиника',
    privacy: 'Маалыматтарды иштетүү саясаты',
    privacyTitle: 'Сиздин маалыматтарыңыз менен кантип иштейбиз',
    privacyWho: 'Маалыматтар үчүн ким жооп берет',
    privacyWhat: 'Кандай маалыматтар',
    privacyWhatText: 'Атыңыз жана телефонуңуз, Telegram (бот сизге жазышы үчүн), кабыл алууга жазылуулар, эскертмелерге жооптор жана баалар. Дарыгер дарылоо боюнча жазуулар жүргүзө алат.',
    privacyWhy: 'Эмне үчүн',
    privacyWhyText: 'Сизди дарыгерге жазуу, кабыл алуу тууралуу эскертүү жана убакыт өзгөрсө байланышуу үчүн. Жарнама жибербейбиз, маалыматтарды эч кимге сатпайбыз жана бербейбиз.',
    privacyWhere: 'Кайда сакталат',
    privacyWhereText: 'Клиниканын корголгон серверинде, байланыш шифрленген. Клиниканын кызматкерлери гана көрөт; медициналык жазууларды — сиздин дарыгериңиз жана клиниканын администратору.',
    privacyRights: 'Сиздин укуктарыңыз',
    privacyRightsText: 'Сиз тууралуу кандай маалыматтар сакталганын билип, аларды оңдоп, макулдугуңузду кайтарып алып жана өчүрүүнү сурай аласыз (КР «Жеке мүнөздөгү маалымат жөнүндө» мыйзамы). Клиникага жазыңыз же чалыңыз.',
    privacyContact: 'Клиника менен байланышуу: {phone}',
    back: '‹ Артка',
    book: 'Жазылуу',
    findUs: 'Бизди кантип табасыз',
    open2gis: '2ГИСте ачуу',
    cantBook: 'Жазыла албай жатасызбы? ',
    support: '🛟 Техникалык колдоо',
    serviceBot: 'Бул клиниканын кызматтык жазылуу боту.',
    bookBy: 'Кабыл алууга жазылуу: {phone}',
    doctorPhoto: 'Дарыгердин сүрөтү',
    noConnection: 'Сервер менен байланыш жок',
    today: 'Бүгүн',
    tomorrow: 'Эртең',
    whenAt: '{when}, саат {time}',
    stepService: '① Кызмат',
    stepTime: '② Күн жана убакыт',
    stepData: '③ Сиздин маалыматтар',
    nextService: 'Кызматты тандаңыз ↑',
    nextTime: 'Андан ары: убакыт тандоо ↓',
    nextData: 'Андан ары: маалыматтарыңыз ↓',
    noFreeSoon: 'Жакынкы күндөрү бош убакыт жок.',
    errPaused: 'Клиника азыр бот аркылуу жаңы жазылууларды кабыл албай жатат.',
    errClinicPaused: 'Онлайн жазылуу убактылуу жеткиликсиз.',
    settingUp: '🛠 Клиника азыр даярдалып жатат — жазылуу жакында ачылат.',
    errStale: 'Маалымат жаңы эле өзгөрдү — экран жаңыртылды, кайра аракет кылыңыз.',
    elsewhere: 'Сиз «{clinic}» клиникасына жазылгансыз: {when}',
    elsewhereOpen: 'Ушул клиниканы ачуу',
    errBookingOff: 'Бот аркылуу жазылуу азыр өчүрүлгөн.',
    errAlreadyBooked: 'Сизде жазылуу бар — адегенде аны жокко чыгарыңыз.',
    errNoBooking: 'Адегенде жазылыңыз — андан кийин эртерээк убакыт сурасаңыз болот.',
    errBookingGone: 'Жазылуу жок — балким, ал жокко чыгарылгандыр.',
    errAlreadyWaiting: 'Сиз күтүү тизмесиндесиз.',
    errDepositClosed: 'Алдын ала төлөм текшерилип жатат же алынып калган.',
    callClinic: 'Клиникага чалыңыз: {phone}',
    contactClinic: 'Клиника менен байланышыңыз.',
    oldTelegram: 'Бул Telegram колдонмодон номер бөлүшө албайт. Telegram’ды жаңыртыңыз же номериңизди ботко чатка жөнөтүңүз: 📎 → «Контакт», андан кийин жазылууну кайра ачыңыз.',
    whoTitle: 'Кимди жаздырабыз?',
    whoSelf: 'Өзүмдү',
    whoAdd: '＋ Баланы же тууганды',
    whoBooked: 'жазылган',
    relativeName: 'Аты-жөнү',
    relativeBirth: 'Туулган күнү (милдеттүү эмес)',
    relativeRelation: 'Сизге ким болот',
    relCHILD: 'Балам',
    relSPOUSE: 'Жубайым',
    relPARENT: 'Ата-энем',
    relSIBLING: 'Бир тууганым',
    relOTHER: 'Башка тууганым',
    relativePhone: 'Анын телефону (милдеттүү эмес)',
    relativePhoneHint: 'Бош болсо — эскертмелер сизге, ушул чатка келет',
    relativeNameRequired: 'Тууганыңыздын атын жазыңыз',
    relativeBirthInvalid: 'Туулган күндү текшериңиз',
    relativePhoneInvalid: 'Телефон номерин текшериңиз',
    relativeRelationRequired: 'Сизге ким болорун тандаңыз',
    relativeDefault: 'бул адам',
    yourName: 'Сиздин атыңыз',
    yourPhone: 'Сиздин телефонуңуз',
    consentFor: 'Мен мыйзамдуу өкүлмүн: {name} (же анын макулдугу менен жаздырып жатам). {holder} биздин маалыматтарыбызды (аттарыбызды, телефонду, туулган күндү) кабыл алууга жазуу жана эскертүү үчүн иштетишине макулмун',
    myBookings: 'Менин жазылууларым',
    bookingOf: 'Жазылуу: {name}',
    forMe: 'Сиз',
    bookAnother: '＋ Дагы жаздыруу — өзүңүздү же баланы',
    allBookings: '‹ Бардык жазылуулар',
    errTooMany: 'Жазылуулар көп — адегенде кабыл алууга барыңыз же бирөөсүн жокко чыгарыңыз.',
    errRelativesLimit: 'Мындан көп тууган кошууга болбойт — калгандарын клиника жазат.',
    // Сайтта Telegram’сыз жазылуу (site/WebBooking)
    webTitle: 'Сайтта жазылуу',
    webSub: 'Telegram’сыз: дарыгерди, кызматты жана убакытты тандаңыз — клиника жазылууну ырастоо үчүн чалат',
    webStepDoctor: 'Дарыгер',
    webPhoneHint: 'Жазылууну ырастоо үчүн клиника ушул номерге чалат',
    webPhoneRequired: 'Телефон номериңизди жазыңыз',
    webSubmit: 'Жазылуу',
    webSending: 'Жөнөтүлүүдө…',
    webSentTitle: 'Өтүнмө жөнөтүлдү',
    webSentText: 'Жазылууну ырастоо үчүн клиника сизге чалат. Пландарыңыз өзгөрсө — клиникага чалыңыз.',
    webTgHint: 'Telegram барбы? Анда бот кабыл алуу тууралуу бир күн мурун эскертет, убакытты өзүңүз которсоңуз болот.',
    webTgLink: 'Telegram аркылуу жазылуу',
    webPhoneBooked: 'Бул номерге клиникада жазылуу бар. Аны которуу же дагы бирөөнү жазуу үчүн чалыңыз',
    webTooMany: 'Бүгүн бул түзмөктөн бир нече өтүнмө болду — клиникага чалыңыз, сизди жазышат.',
    webOff: 'Онлайн жазылуу азыр жабык.',
    webClose: '‹ Клиниканын барагына',
    webPrivacyText: 'Атыңыз жана телефонуңуз, кабыл алууга жазылуулар жана аларга комментарий. Дарыгер дарылоо боюнча жазуулар жүргүзө алат.',
    webWhen: 'Качан',
    webAddress: 'Дарек',
    webPhoneClinic: 'Клиниканын телефону',
    webNoServices: 'Бул дарыгерге онлайн жазылуу азырынча жок — клиникага чалыңыз.',
  },
};

const KY_MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
// С воскресенья — как getUTCDay()
const KY_WEEKDAYS = ['жекшемби', 'дүйшөмбү', 'шейшемби', 'шаршемби', 'бейшемби', 'жума', 'ишемби']
const KY_WEEKDAYS_SHORT = ['Жк', 'Дш', 'Шш', 'Шр', 'Бш', 'Жм', 'Иш']
const RU_WEEKDAY_ON = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу']

/** «ky…» — кыргызский, всё остальное — русский. */
export function normalizeLang(code?: string | null): Lang {
  return typeof code === 'string' && code.toLowerCase().startsWith('ky') ? 'ky' : 'ru'
}

export type T = (key: string, vars?: Record<string, string | number>) => string

/** Тексты языка; {name} — подстановки. Нет перевода — русский (лучше, чем пустая строка). */
export function translator(lang: Lang): T {
  return (key, vars = {}) => (TEXTS[lang][key] ?? TEXTS.ru[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''))
}

function dateOf(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(instant))
}

/** «сегодня» / «в среду, 3 июня» — и «бүгүн» / «3-июнь, шаршемби». */
function whenText(lang: Lang, startAt: string, now = new Date()): string {
  const day = dateOf(startAt)
  const today = todayIn(now)
  if (day === today) return lang === 'ru' ? 'сегодня' : 'бүгүн'
  if (day === addDays(today, 1)) return lang === 'ru' ? 'завтра' : 'эртең'
  const date = new Date(`${day}T00:00:00Z`)
  if (lang === 'ky') return `${date.getUTCDate()}-${KY_MONTHS[date.getUTCMonth()]}, ${KY_WEEKDAYS[date.getUTCDay()]}`
  const dayMonth = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(date)
  return `${RU_WEEKDAY_ON[date.getUTCDay()]}, ${dayMonth}`
}

/** «Завтра, в 10:00» — дата и время записи целиком. */
export function whenAt(lang: Lang, startAt: string, now = new Date()): string {
  const text = translator(lang)('whenAt', { when: whenText(lang, startAt, now), time: timeOf(startAt) })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Лента дней: «Сегодня», «Завтра», «Ср 3» — «Бүгүн», «Эртең», «Шр 3». */
export function bookingDays(lang: Lang, today: string, n: number): { date: string; label: string }[] {
  const t = translator(lang)
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(today, i)
    if (i === 0) return { date, label: t('today') }
    if (i === 1) return { date, label: t('tomorrow') }
    const d = new Date(`${date}T00:00:00Z`)
    const label = lang === 'ky' ? `${KY_WEEKDAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()}`
      : new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', weekday: 'short', day: 'numeric' }).format(d).replace(',', '')
    return { date, label: label.charAt(0).toUpperCase() + label.slice(1) }
  })
}

type Break = { start?: string; end?: string; title?: string; emoji?: string }

/** Перерыв над сеткой. Название («Джума-намаз») — как его ввёл врач. */
export function breakNote(lang: Lang, b: Break): string {
  const title = b.title ?? ''
  if (lang === 'ky') {
    return b.start ? `${b.emoji ?? ''} ${timeOf(b.start)}–${timeOf(b.end!)} — ${title}, дарыгер кабыл албайт` : `${b.emoji ?? ''} ${title} — бул күнү кабыл алуу жок`
  }
  if (!b.start) return `${b.emoji ?? ''} ${title} — в этот день приёма нет`
  return `${b.emoji ?? ''} С ${timeOf(b.start)} до ${timeOf(b.end!)} — ${title.charAt(0).toLowerCase()}${title.slice(1)}, врач не принимает`
}

/** «от 1 500 сом» / «1 500 сомдон баштап»; цены нет — null. */
export function priceText(lang: Lang, som?: number | null): string | null {
  if (som == null) return null
  const n = new Intl.NumberFormat('ru-RU').format(som)
  return lang === 'ky' ? `${n} сомдон баштап` : `от ${n} сом`
}

export { serviceEmoji } from '../lib/serviceEmoji'

export function initials(name = ''): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('')
}
