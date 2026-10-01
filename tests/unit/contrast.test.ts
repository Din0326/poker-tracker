import { describe, expect, it } from 'vitest'
import { readTokens, type TokenMap } from '../../scripts/read-tokens.mjs'

// 9.3：深淺兩主題下文字對比度至少 WCAG AA（4.5:1）

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const backgrounds = ['--color-bg', '--color-surface', '--color-surface-raised']
const foregrounds = ['--color-text', '--color-text-muted', '--color-accent', '--color-danger', '--color-red', '--color-green', '--color-suit-red', '--color-suit-black']
const pairs: [string, string][] = [
  ...foregrounds.flatMap((fg) => backgrounds.map((bg): [string, string] => [fg, bg])),
  ['--color-on-accent', '--color-accent'],
  ['--color-on-danger', '--color-danger'],
]

const themes = readTokens()

describe.each(Object.entries(themes) as [string, TokenMap][])('%s 主題對比度', (_name, tokens) => {
  it.each(pairs)('%s 在 %s 上 ≥ 4.5', (fg, bg) => {
    const fgColor = tokens[fg]
    const bgColor = tokens[bg]
    expect(fgColor, fg).toBeDefined()
    expect(bgColor, bg).toBeDefined()
    expect(contrast(fgColor!, bgColor!)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('contrast 計算', () => {
  it('黑白對比為 21', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })
})
