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

export function createNaviiIcon(seed: string, title: string) {
  const palettes = [
    ['#f4c84a', '#b7791f', '#fff7c2'],
    ['#38bdf8', '#075985', '#e0f2fe'],
    ['#5ee0a0', '#047857', '#dcfce7'],
    ['#fb7185', '#9f1239', '#ffe4e6'],
    ['#c084fc', '#6b21a8', '#f3e8ff'],
  ]
  const hash = Math.abs(hashSeed(seed))
  const [start, end, shine] = palettes[hash % palettes.length]
  const tilt = (hash % 17) - 8
  const eyeOffset = hash % 3
  const smileDepth = 60 + (hash % 8)
  const safeTitle = escapeXml(title)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="${safeTitle}">
      <title>${safeTitle}</title>
      <defs>
        <radialGradient id="navii-grad-${hash}" cx="38%" cy="28%" r="70%">
          <stop offset="0%" stop-color="${start}" />
          <stop offset="100%" stop-color="${end}" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="39" fill="url(#navii-grad-${hash})" transform="rotate(${tilt} 50 50)" />
      <ellipse cx="38" cy="35" rx="12" ry="7" fill="${shine}" opacity="0.28" transform="rotate(-22 38 35)" />
      <circle cx="${38 - eyeOffset}" cy="48" r="4.6" fill="#111" />
      <circle cx="${62 + eyeOffset}" cy="48" r="4.6" fill="#111" />
      <path d="M36 ${smileDepth} Q50 ${smileDepth + 10} 64 ${smileDepth}" fill="none" stroke="#111" stroke-width="5" stroke-linecap="round" />
      <path d="M26 31 C32 18 45 13 58 17 C73 22 82 36 79 54 C76 72 61 84 43 80 C25 76 16 62 20 45 C21 39 23 35 26 31 Z" fill="none" stroke="${shine}" stroke-width="1.2" opacity="0.34" />
    </svg>
  `

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
