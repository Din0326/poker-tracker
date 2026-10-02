// GG 匯入測試用的原文。全部是非真實檔案，依規格 8.8 範例與公開格式撰寫，待以真實 PokerCraft 匯出驗證（14 節 HQ15）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const GG_FIXTURE = join(import.meta.dirname, '..', '..', 'fixtures', 'hands', 'gg-example-1.txt')

/** 8.8 範例原文（fixture 以 \n 結尾；拆手時會去除尾端空行） */
export function ggExample(): string {
  return readFileSync(GG_FIXTURE, 'utf8')
}

/** 改變原站手牌編號（8.8 範例為 RC1000000001） */
export function withHandId(text: string, id: string): string {
  return text.replace(/^Poker Hand #[A-Za-z0-9]+:/, `Poker Hand #${id}:`)
}

/** 在第 lineNo 行（1 起算）之前插入一行 */
export function insertLine(text: string, lineNo: number, line: string): string {
  const lines = text.split('\n')
  lines.splice(lineNo - 1, 0, line)
  return lines.join('\n')
}

/**
 * 有攤牌的手牌（非真實檔案）：3 人，按鈕座位 1 棄牌，Hero（SB）與 BB 一路過牌到河牌攤牌，Hero A♠A♦ 勝 K♣K♦。
 * 底池 $0.5（50 分）、抽水 $0.02、Hero 收回 $0.48。
 */
export const SHOWDOWN_HAND = [
  "Poker Hand #RC3000000001: Hold'em No Limit ($0.1/$0.25) - 2026/09/21 10:00:00",
  "Table 'RushAndCash100' 6-max Seat #1 is the button",
  'Seat 1: aaaa1111 ($25 in chips)',
  'Seat 2: Hero ($25 in chips)',
  'Seat 3: bbbb2222 ($25 in chips)',
  'Hero: posts small blind $0.1',
  'bbbb2222: posts big blind $0.25',
  '*** HOLE CARDS ***',
  'Dealt to aaaa1111 ',
  'Dealt to Hero [As Ad]',
  'Dealt to bbbb2222 ',
  'aaaa1111: folds',
  'Hero: calls $0.15',
  'bbbb2222: checks',
  '*** FLOP *** [2c 7d 9h]',
  'Hero: checks',
  'bbbb2222: checks',
  '*** TURN *** [2c 7d 9h] [Js]',
  'Hero: checks',
  'bbbb2222: checks',
  '*** RIVER *** [2c 7d 9h Js] [4c]',
  'Hero: checks',
  'bbbb2222: checks',
  '*** SHOWDOWN ***',
  'Hero: shows [As Ad] (a pair of Aces)',
  'bbbb2222: shows [Kc Kd] (a pair of Kings)',
  'Hero collected $0.48 from pot',
  '*** SUMMARY ***',
  'Total pot $0.5 | Rake $0.02',
  'Board [2c 7d 9h Js 4c]',
  "Seat 1: aaaa1111 (button) folded before Flop (didn't bet)",
  'Seat 2: Hero (small blind) showed [As Ad] and won ($0.48) with a pair of Aces',
  'Seat 3: bbbb2222 (big blind) showed [Kc Kd] and lost with a pair of Kings',
].join('\n')

/**
 * 會切出邊池的手牌（非真實檔案）：座位 1 全下 $10、Hero 全下 $30、BB 跟注 → 主池 $30（3 人）、邊池 $40（Hero、BB）。
 */
export const SIDE_POT_HAND = [
  "Poker Hand #RC4000000001: Hold'em No Limit ($0.1/$0.25) - 2026/09/21 11:00:00",
  "Table 'RushAndCash100' 6-max Seat #1 is the button",
  'Seat 1: aaaa1111 ($10 in chips)',
  'Seat 2: Hero ($30 in chips)',
  'Seat 3: bbbb2222 ($50 in chips)',
  'Hero: posts small blind $0.1',
  'bbbb2222: posts big blind $0.25',
  '*** HOLE CARDS ***',
  'Dealt to aaaa1111 ',
  'Dealt to Hero [As Ad]',
  'Dealt to bbbb2222 ',
  'aaaa1111: raises $9.75 to $10 and is all-in',
  'Hero: raises $20 to $30 and is all-in',
  'bbbb2222: calls $29.75',
  '*** FLOP *** [2c 7d 9h]',
  '*** TURN *** [2c 7d 9h] [Js]',
  '*** RIVER *** [2c 7d 9h Js] [4c]',
  '*** SHOWDOWN ***',
  'aaaa1111: shows [Kc Kd]',
  'Hero: shows [As Ad]',
  'bbbb2222: shows [Qc Qd]',
  'Hero collected $70 from pot',
  '*** SUMMARY ***',
  'Total pot $70 | Rake $0',
  'Board [2c 7d 9h Js 4c]',
  'Seat 1: aaaa1111 (button) showed [Kc Kd] and lost with a pair of Kings',
  'Seat 2: Hero (small blind) showed [As Ad] and won ($70) with a pair of Aces',
  'Seat 3: bbbb2222 (big blind) showed [Qc Qd] and lost with a pair of Queens',
].join('\n')

/** n 手 8.8 範例（編號 RC<start>…），手牌之間空一行，供多手 / 大量資料測試 */
export function ggExampleFile(n: number, start = 1_000_000_001): string {
  const base = ggExample().trimEnd()
  return Array.from({ length: n }, (_, i) => withHandId(base, `RC${start + i}`)).join('\n\n\n') + '\n'
}
