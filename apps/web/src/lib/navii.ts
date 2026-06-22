function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function hashSeed(seed: string) {
  return Array.from(seed).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0)
}

function pick<T>(items: T[], hash: number, salt = 0): T {
  return items[Math.abs(hash + salt) % items.length]
}

function starPath(cx: number, cy: number, outer: number, inner: number) {
  return Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5
    const radius = index % 2 === 0 ? outer : inner
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ') + ' Z'
}

export function createNaviiIcon(seed: string, title: string) {
  const palettes = [
    ['#f4c84a', '#b7791f', '#fff7c2', '#2b1c05'],
    ['#fcd116', '#006b3f', '#fff4b0', '#111111', 'ghana'],
    ['#ce1126', '#fcd116', '#fff1a8', '#111111', 'ghana'],
    ['#006b3f', '#fcd116', '#eaffd8', '#111111', 'ghana'],
    ['#ce1126', '#006b3f', '#ffe6e9', '#111111', 'ghana'],
    ['#fcd116', '#ce1126', '#fff4b0', '#111111', 'ghana'],
    ['#38bdf8', '#075985', '#e0f2fe', '#031a2b'],
    ['#5ee0a0', '#047857', '#dcfce7', '#06251b'],
    ['#fb7185', '#9f1239', '#ffe4e6', '#2e0611'],
    ['#c084fc', '#6b21a8', '#f3e8ff', '#220735'],
    ['#fb923c', '#9a3412', '#ffedd5', '#2d1205'],
    ['#a3e635', '#3f6212', '#ecfccb', '#142404'],
    ['#f0abfc', '#86198f', '#fae8ff', '#2d0632'],
  ]
  const silhouettes = [
    '<circle cx="50" cy="50" r="39" />',
    '<rect x="15" y="15" width="70" height="70" rx="23" />',
    '<path d="M50 10 87 50 50 90 13 50Z" />',
    '<path d="M50 10 C70 10 86 26 86 48 C86 72 71 88 50 90 C29 88 14 72 14 48 C14 26 30 10 50 10Z" />',
    '<path d="M50 10 82 28 82 72 50 90 18 72 18 28Z" />',
    '<path d="M24 18 C39 7 64 9 78 25 C91 40 86 67 68 82 C50 97 22 84 15 62 C9 43 10 28 24 18Z" />',
  ]
  const eyePairs = [
    (left: number, right: number) => `<circle cx="${left}" cy="48" r="4.6" /><circle cx="${right}" cy="48" r="4.6" />`,
    (left: number, right: number) => `<rect x="${left - 5}" y="44" width="10" height="8" rx="4" /><rect x="${right - 5}" y="44" width="10" height="8" rx="4" />`,
    (left: number, right: number) => `<path d="M${left - 5} 49 Q${left} 43 ${left + 5} 49" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" /><path d="M${right - 5} 49 Q${right} 43 ${right + 5} 49" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" />`,
    (left: number, right: number) => `<path d="M${left} 42 45 51 35 51Z" /><path d="M${right} 42 67 51 57 51Z" />`,
  ]
  const mouths = [
    (depth: number) => `<path d="M36 ${depth} Q50 ${depth + 10} 64 ${depth}" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" />`,
    (depth: number) => `<path d="M36 ${depth} C43 ${depth + 6} 57 ${depth + 6} 64 ${depth}" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" />`,
    (depth: number) => `<rect x="39" y="${depth - 2}" width="22" height="8" rx="4" />`,
    (depth: number) => `<path d="M39 ${depth + 2} Q50 ${depth - 4} 61 ${depth + 2}" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linecap="round" />`,
  ]
  const hash = Math.abs(hashSeed(seed))
  const [start, end, shine, ink, paletteFamily] = pick(palettes, hash)
  const isGhanaPalette = paletteFamily === 'ghana'
  const silhouette = pick(silhouettes, hash, 7)
  const eyes = pick(eyePairs, hash, 13)
  const mouth = pick(mouths, hash, 19)
  const tilt = (hash % 25) - 12
  const eyeOffset = hash % 3
  const smileDepth = 60 + (hash % 8)
  const leftEye = 38 - eyeOffset
  const rightEye = 62 + eyeOffset
  const decoration = isGhanaPalette ? 4 : hash % 4
  const gradientId = `navii-grad-${hash}`
  const safeTitle = escapeXml(title)
  const decoSvg = decoration === 0
    ? `<path d="M25 31 C34 20 45 16 58 18" fill="none" stroke="${shine}" stroke-width="3" stroke-linecap="round" opacity="0.46" />`
    : decoration === 1
      ? `<circle cx="72" cy="28" r="7" fill="${shine}" opacity="0.42" /><circle cx="27" cy="72" r="4" fill="${shine}" opacity="0.3" />`
      : decoration === 2
        ? `<path d="M23 34 34 25 43 35" fill="none" stroke="${shine}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.4" />`
        : decoration === 3
          ? `<path d="M67 21 78 32 68 42 57 31Z" fill="${shine}" opacity="0.34" />`
          : `
            <path d="M20 31 C38 22 61 22 80 31" fill="none" stroke="#ce1126" stroke-width="4" stroke-linecap="round" opacity="0.42" />
            <path d="M20 39 C38 30 61 30 80 39" fill="none" stroke="#fcd116" stroke-width="4" stroke-linecap="round" opacity="0.46" />
            <path d="M20 47 C38 38 61 38 80 47" fill="none" stroke="#006b3f" stroke-width="4" stroke-linecap="round" opacity="0.42" />
            <path d="${starPath(72, 29, 7, 3)}" fill="#111111" opacity="0.62" />
          `
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="${safeTitle}">
      <title>${safeTitle}</title>
      <defs>
        <radialGradient id="${gradientId}" cx="38%" cy="28%" r="70%">
          <stop offset="0%" stop-color="${start}" />
          <stop offset="100%" stop-color="${end}" />
        </radialGradient>
      </defs>
      <g transform="rotate(${tilt} 50 50)">
        <g fill="url(#${gradientId})">${silhouette}</g>
        <ellipse cx="38" cy="35" rx="12" ry="7" fill="${shine}" opacity="0.24" transform="rotate(-22 38 35)" />
        ${decoSvg}
        <g fill="${ink}" color="${ink}">${eyes(leftEye, rightEye)}</g>
        <g fill="${ink}" color="${ink}">${mouth(smileDepth)}</g>
        <path d="M22 31 C31 18 45 11 60 17 C76 23 84 38 80 56 C76 74 61 84 43 80 C25 76 15 62 20 45 C21 39 23 35 22 31 Z" fill="none" stroke="${shine}" stroke-width="1.2" opacity="0.3" />
      </g>
    </svg>
  `

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
