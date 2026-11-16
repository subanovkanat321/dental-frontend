import { chromeIntent, inAppBrowser } from './inAppBrowser'

/** Настоящие userAgent приложений (версии — как в 2026, суть та же). */
const UA = {
  instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101 (iPhone14,5; iOS 18_1; ru_RU; ru; scale=3.00; 1170x2532; 657445698)',
  instagramAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Instagram 352.1.0.41.100 Android (34/14; 450dpi; 1080x2340; samsung; SM-A546E; a54x; s5e8835; ru_RU; 650378389)',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.40.110;FBBV/650000000;FBDV/iPhone13,2;FBMD/iPhone;FBSN/iOS;FBSV/17.6;FBSS/3;FBCR/;FBID/phone;FBLC/ru_RU;FBOP/80]',
  facebookAndroid: 'Mozilla/5.0 (Linux; Android 13; Redmi Note 12 Build/TKQ1.221114.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.146 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/478.0.0.42.119;]',
  messengerIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LightSpeed [FBAN/MessengerLiteForiOS;FBAV/470.0.0.29.109;FBBV/620000000;FBDV/iPhone12,1;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/2;FBCR/;FBID/phone;FBLC/ru_RU;FBOP/0]',
  tiktokAndroid: 'Mozilla/5.0 (Linux; Android 12; V2120 Build/SP1A.210812.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.179 Mobile Safari/537.36 trill_350303 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/35.3.3 ByteLocale/ru ByteFullLocale/ru Region/KG BytedanceWebview/d8a21c6',
  threadsIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Barcelona 352.0.0.25.88 (iPhone15,3; iOS 18_0; ru_RU; ru; scale=3.00; 1290x2796; 643000000) Instagram',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  telegramAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.86 Mobile Safari/537.36 Telegram-Android/11.4.2 (Samsung SM-S918B; Android 14; SDK 34; HIGH)',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
}

test('встроенные браузеры соцсетей узнаём по userAgent, с системой телефона', () => {
  expect(inAppBrowser(UA.instagramIos)).toEqual({ app: 'Instagram', os: 'ios' })
  expect(inAppBrowser(UA.instagramAndroid)).toEqual({ app: 'Instagram', os: 'android' })
  expect(inAppBrowser(UA.facebookIos)).toEqual({ app: 'Facebook', os: 'ios' })
  expect(inAppBrowser(UA.facebookAndroid)).toEqual({ app: 'Facebook', os: 'android' })
  expect(inAppBrowser(UA.messengerIos)).toEqual({ app: 'Facebook', os: 'ios' })
  expect(inAppBrowser(UA.tiktokAndroid)).toEqual({ app: 'TikTok', os: 'android' })
  expect(inAppBrowser(UA.threadsIos)).toEqual({ app: 'Threads', os: 'ios' })
})

test('обычные Safari, Chrome, Telegram и компьютер — не встроенный браузер', () => {
  for (const ua of [UA.safari, UA.chromeAndroid, UA.chromeIos, UA.telegramAndroid, UA.desktop, '']) {
    expect(inAppBrowser(ua)).toBeNull()
  }
})

test('Android: intent-ссылка открывает тот же адрес в Chrome, без Chrome — в браузере по умолчанию', () => {
  expect(chromeIntent('https://tish.kg/login')).toBe(
    'intent://tish.kg/login#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Ftish.kg%2Flogin;end')
})
