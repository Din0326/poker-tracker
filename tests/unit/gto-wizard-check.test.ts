// SPEC-v2-hands 12.3 H5 第 1 項的準備：docs/gto-wizard-check/ 的驗證檔必須
// 1. 與目前的匯出程式同步（內容等於 exportPokerStars 重新產生的結果；匯出程式變更後此測試失敗，提醒執行 npm run gto-check）
// 2. 能被專案自己的 parsePokerStars 解析回來（每手都成功，且往返後牌局內容相同）
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePokerStars } from '../../src/domain/hands'
import { GTO_CHECK_ALL_FILE, GTO_CHECK_CASES, gtoWizardCheckFiles } from './helpers/gtoWizardCheck'

const dir = join(import.meta.dirname, '..', '..', 'docs', 'gto-wizard-check')
const read = (name: string) => readFileSync(join(dir, name), 'utf8')

describe('12.3 H5 GTO Wizard 驗證檔（docs/gto-wizard-check/）', () => {
  const expected = gtoWizardCheckFiles()

  it('目錄內的 .txt 恰為合併檔 all-6-hands.txt 與 6 個單手檔', () => {
    const txt = readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()
    expect(txt).toEqual([`${GTO_CHECK_ALL_FILE}.txt`, ...GTO_CHECK_CASES.map((c) => `${c.file}.txt`)].sort())
    expect(readdirSync(dir)).toContain('README.md')
  })

  for (const { name, text } of expected) {
    it(`${name} 與 exportPokerStars 重新產生的內容相同（不同時請執行 npm run gto-check）`, () => {
      const file = read(name)
      // 7.2：UTF-8 無 BOM、`\n` 換行、以單一 `\n` 結尾、只含 ASCII
      expect(file.charCodeAt(0)).not.toBe(0xfeff)
      expect(file).not.toContain('\r')
      expect(file.endsWith('\n') && !file.endsWith('\n\n')).toBe(true)
      expect(/^[\x20-\x7e\n]*$/.test(file)).toBe(true)
      expect(file).toBe(text)
    })

    it(`${name} 可被 parsePokerStars 解析，每手成功`, () => {
      const result = parsePokerStars(read(name))
      const count = name === `${GTO_CHECK_ALL_FILE}.txt` ? GTO_CHECK_CASES.length : 1
      expect(result.hands).toHaveLength(count)
      for (const h of result.hands) expect(h.ok, JSON.stringify(h)).toBe(true)
    })
  }

  it('往返：每個單手檔解析回來的牌局內容與案例資料相同（gameType、amountUnit、playedAt、detail、heroNet）', () => {
    GTO_CHECK_CASES.forEach((c, i) => {
      const source = c.build({ exportSeq: 101 + i })
      const [parsed] = parsePokerStars(read(`${c.file}.txt`)).hands
      if (!parsed?.ok) throw new Error(`${c.file} 解析失敗`)
      const { hand } = parsed
      expect(hand.exportSeq, c.file).toBe(source.exportSeq)
      expect(
        { gameType: hand.gameType, amountUnit: hand.amountUnit, playedAt: hand.playedAt, heroNet: hand.heroNet, board: hand.board },
        c.file,
      ).toEqual({ gameType: source.gameType, amountUnit: source.amountUnit, playedAt: source.playedAt, heroNet: source.heroNet, board: source.board })
      const strip = (d: NonNullable<typeof source.detail>) => ({ ...d, seats: d.seats.map((s) => ({ ...s, name: null })) })
      expect(strip(hand.detail!), c.file).toEqual(strip(source.detail!))
    })
  })

  it('合併檔的 7.9 範例與規格 fixture export-example-1.txt 逐字相同（同為 exportSeq 1）', () => {
    const fixture = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'hands', 'export-example-1.txt'), 'utf8')
    const hands = read(`${GTO_CHECK_ALL_FILE}.txt`).split('\n\n\n')
    expect(hands.map((h) => (h.endsWith('\n') ? h : `${h}\n`))).toContain(fixture)
  })
})
