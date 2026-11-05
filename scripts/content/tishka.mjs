// Тишка — маскот Tish (весёлый зуб, SVG) для картинок контент-плана. Основа — tishka() из
// ../dental/docs/marketing/instagram/gen.mjs (позы wave, phone, bell, card, heart, party); здесь добавлены
// поза brush (со щёткой) и настроения: happy, wink, wow (удивился), think (задумался), love (влюблён в чистые зубы).
//   tishka('brush', 'wow') → строка <svg viewBox="-40 0 400 380">

const INK = '#1B3A40'

const arm = (x1, y1, x2, y2) => `<path d="M${x1},${y1} Q${(x1 + x2) / 2 + (x2 > x1 ? 10 : -10)},${(y1 + y2) / 2 + 18} ${x2},${y2}" stroke="${INK}" stroke-width="13" fill="none" stroke-linecap="round"/><circle cx="${x2}" cy="${y2}" r="17" fill="#fff" stroke="${INK}" stroke-width="7"/>`

const ITEMS = {
  phone: `<g transform="translate(262,150) rotate(12)"><rect x="-6" y="-70" width="78" height="140" rx="16" fill="${INK}"/><rect x="2" y="-58" width="62" height="112" rx="9" fill="#2AABEE"/>
    <path d="M14,-8 L52,-24 L44,22 L33,12 L25,20 L26,8 Z" fill="#fff"/><circle cx="33" cy="62" r="4" fill="#fff"/></g>`,
  bell: `<g transform="translate(282,130) rotate(18)"><path d="M0,-52 C-34,-52 -40,-18 -40,8 L-52,30 L52,30 L40,8 C40,-18 34,-52 0,-52 Z" fill="#FFC531" stroke="${INK}" stroke-width="7"/>
    <circle cx="0" cy="40" r="11" fill="#FFC531" stroke="${INK}" stroke-width="7"/><path d="M-62,-30 Q-74,-8 -64,14 M62,-30 Q74,-8 64,14" stroke="#FF5A5F" stroke-width="7" fill="none" stroke-linecap="round"/></g>`,
  card: `<g transform="translate(270,150) rotate(10)"><rect x="-10" y="-74" width="96" height="128" rx="12" fill="#fff" stroke="${INK}" stroke-width="7"/><rect x="18" y="-86" width="40" height="22" rx="6" fill="#0E8A80"/>
    <path d="M8,-40 h60 M8,-18 h60 M8,4 h40" stroke="#9BB5B9" stroke-width="7" stroke-linecap="round"/><path d="M10,28 l12,12 l24,-26" stroke="#1DB66B" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`,
  heart: `<g transform="translate(286,140) rotate(-10)"><path d="M0,30 C-60,-10 -40,-60 0,-34 C40,-60 60,-10 0,30 Z" fill="#FF5A7A" stroke="${INK}" stroke-width="7"/></g>`,
  party: `<g transform="translate(286,120) rotate(20)"><path d="M0,40 L-26,-60 L26,-60 Z" fill="#FF5A7A" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><circle cx="0" cy="-66" r="10" fill="#FFC531" stroke="${INK}" stroke-width="6"/>
    <path d="M-14,-30 L12,-30 M-8,-2 L8,-2" stroke="#fff" stroke-width="6" stroke-linecap="round"/></g>`,
  // Щётка в правой руке: ручка, головка, щетина и капля пасты
  brush: `<g transform="translate(300,92) rotate(-28)"><rect x="-12" y="-6" width="24" height="120" rx="12" fill="#FF6B8A" stroke="${INK}" stroke-width="7"/>
    <rect x="-16" y="-62" width="32" height="56" rx="10" fill="#fff" stroke="${INK}" stroke-width="7"/><path d="M-8,-62 v-22 M0,-62 v-24 M8,-62 v-22" stroke="#7FD3F7" stroke-width="7" stroke-linecap="round"/>
    <path d="M-10,-92 q10,-16 22,0 q-10,8 -22,0 Z" fill="#fff" stroke="${INK}" stroke-width="5"/></g>`,
  wave: '',
}

const EYES = {
  happy: `<ellipse cx="122" cy="150" rx="17" ry="22" fill="${INK}"/><ellipse cx="180" cy="150" rx="17" ry="22" fill="${INK}"/><circle cx="128" cy="141" r="6" fill="#fff"/><circle cx="186" cy="141" r="6" fill="#fff"/><circle cx="117" cy="160" r="3" fill="#fff"/><circle cx="175" cy="160" r="3" fill="#fff"/>`,
  wink: `<ellipse cx="122" cy="150" rx="17" ry="22" fill="${INK}"/><circle cx="128" cy="141" r="6" fill="#fff"/><path d="M165,152 Q180,140 195,152" stroke="${INK}" stroke-width="8" fill="none" stroke-linecap="round"/>`,
  wow: `<ellipse cx="122" cy="148" rx="20" ry="26" fill="${INK}"/><ellipse cx="180" cy="148" rx="20" ry="26" fill="${INK}"/><circle cx="129" cy="138" r="7" fill="#fff"/><circle cx="187" cy="138" r="7" fill="#fff"/>
    <path d="M100,108 Q118,96 136,106 M166,106 Q184,96 202,108" stroke="${INK}" stroke-width="7" fill="none" stroke-linecap="round"/>`,
  think: `<ellipse cx="124" cy="150" rx="16" ry="20" fill="${INK}"/><ellipse cx="182" cy="150" rx="16" ry="20" fill="${INK}"/><circle cx="131" cy="140" r="6" fill="#fff"/><circle cx="189" cy="140" r="6" fill="#fff"/>
    <path d="M104,118 Q120,112 138,118 M166,108 Q184,98 200,106" stroke="${INK}" stroke-width="7" fill="none" stroke-linecap="round"/>`,
  love: `<path d="M122,166 C96,148 104,124 122,138 C140,124 148,148 122,166 Z" fill="#FF5A7A" stroke="${INK}" stroke-width="5"/><path d="M180,166 C154,148 162,124 180,138 C198,124 206,148 180,166 Z" fill="#FF5A7A" stroke="${INK}" stroke-width="5"/>`,
}

const MOUTH = {
  happy: `<path d="M130,182 Q151,206 172,182 Q151,196 130,182 Z" fill="#E9475F" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`,
  wow: `<ellipse cx="151" cy="194" rx="14" ry="17" fill="#E9475F" stroke="${INK}" stroke-width="6"/>`,
  think: `<path d="M136,192 Q152,184 168,190" stroke="${INK}" stroke-width="7" fill="none" stroke-linecap="round"/>`,
}

/** @param pose wave | phone | bell | card | heart | party | brush  @param mood happy | wink | wow | think | love */
export function tishka(pose = 'wave', mood = 'happy') {
  const rightArm = pose === 'wave' || pose === 'brush' ? arm(232, 180, 300, 92) : arm(232, 185, 268, 170)
  const leftArm = pose === 'party' ? arm(68, 180, 2, 92) : mood === 'think' ? arm(68, 190, 120, 214) : arm(68, 190, 30, 250)
  return `<svg viewBox="-40 0 400 380" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto;overflow:visible">
    <ellipse cx="150" cy="362" rx="110" ry="14" fill="rgba(15,42,48,.14)"/>
    ${mood === 'think' ? '' : leftArm}
    <path d="M118,322 q-4,22 -30,26 q-6,-14 8,-24 Z M182,322 q4,22 30,26 q6,-14 -8,-24 Z" fill="#0E8A80" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M60,110 C60,38 122,28 150,56 C178,28 240,38 240,110 C240,170 226,200 216,250 C206,300 196,332 180,332 C162,332 162,282 150,272 C138,282 138,332 120,332 C104,332 94,300 84,250 C74,200 60,170 60,110 Z"
      fill="#FFFFFF" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
    <path d="M84,96 C84,66 104,56 122,64" stroke="#D9F3F0" stroke-width="14" fill="none" stroke-linecap="round"/>
    <path d="M78,214 C110,232 190,232 222,214 L218,240 C186,256 114,256 82,240 Z" fill="#0E8A80" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M196,236 l26,34 l-22,6 Z" fill="#12A595" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
    ${EYES[mood] ?? EYES.happy}
    <circle cx="98" cy="182" r="14" fill="#FF9DB0" opacity=".8"/><circle cx="204" cy="182" r="14" fill="#FF9DB0" opacity=".8"/>
    ${MOUTH[mood] ?? MOUTH.happy}
    ${mood === 'think' ? leftArm : ''}
    ${rightArm}${ITEMS[pose] ?? ''}
  </svg>`
}
