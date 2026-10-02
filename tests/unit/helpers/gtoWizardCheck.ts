// SPEC-v2-hands 12.3 H5 第 1 項：給使用者上傳 GTO Wizard 的驗證檔內容（docs/gto-wizard-check/）。
// 手牌資料重用 H3 往返測試的案例（handCases.ts、exportCases.ts），輸出一律由專案的 exportPokerStars 產生，不手寫文字。
// scripts/make-gto-wizard-check.ts（npm run gto-check）寫出檔案；tests/unit/gto-wizard-check.test.ts 確認檔案與匯出程式同步。
import { exportPokerStars, type Hand, type HandDetail } from '../../../src/domain/hands'
import { ggCentHand, hc7Hand, hc9Hand } from './exportCases'
import { hc5Detail, runoutBoard } from './handCases'
import { act, buildHand, detail, example79Hand, seat } from './hands'

type Fixed = Pick<Hand, 'exportSeq'>

/** 9 人現金桌（元單位，盲注 100 / 200）：Hero 座位 7 開池加注，大盲跟注到河牌攤牌，Hero 三條 J 獲勝；抽水 500 */
export function nineMaxCashHand(fixed: Fixed): Hand {
  const d: HandDetail = detail({
    tableSize: 9,
    buttonSeat: 1,
    heroSeat: 7,
    rake: 500,
    seats: Array.from({ length: 9 }, (_, i) => {
      const no = i + 1
      if (no === 7) return seat(no, 20000, ['Jh', 'Jd'])
      if (no === 3) return seat(no, 25000, ['Ac', 'Qc'])
      return seat(no, 20000)
    }),
    actions: [
      act('preflop', 4, 'fold'),
      act('preflop', 5, 'fold'),
      act('preflop', 6, 'fold'),
      act('preflop', 7, 'raise', 600),
      act('preflop', 8, 'fold'),
      act('preflop', 9, 'fold'),
      act('preflop', 1, 'fold'),
      act('preflop', 2, 'fold'),
      act('preflop', 3, 'call'),
      act('flop', 3, 'check'),
      act('flop', 7, 'bet', 800),
      act('flop', 3, 'call'),
      act('turn', 3, 'check'),
      act('turn', 7, 'check'),
      act('river', 3, 'bet', 2000),
      act('river', 7, 'call'),
    ],
  })
  return buildHand({ detail: d, board: ['Js', '8c', '2d', '5h', 'Kc'], playedAt: '2026-09-30T23:00:00' }, fixed)
}

export interface GtoCheckCase {
  /** 單手檔案名稱（不含副檔名） */
  file: string
  /** 檔案說明（README 與測試訊息用） */
  title: string
  build: (fixed: Fixed) => Hand
}

/**
 * 12.3 H5 第 1 項列出的 6 手。單手檔案的 exportSeq 為 101–106、合併檔 all-6-hands.txt 為 1–6：
 * 外部工具多以手牌編號去重（7.4），兩者編號不同，使用者先後上傳合併檔與單手檔時，單手檔不會被當成重複而略過。
 */
export const GTO_CHECK_CASES: readonly GtoCheckCase[] = [
  {
    file: '01-example-7-9',
    title: '7.9 範例：6 人現金桌、元單位無小數金額、無時區後綴時間',
    build: (fixed) => example79Hand({ ...fixed }),
  },
  {
    file: '02-heads-up',
    title: 'HC7 2 人桌（Cash Heads-up）、元單位',
    build: (fixed) => ({ ...hc7Hand(fixed), playedAt: '2026-09-30T21:30:00' }),
  },
  {
    file: '03-mtt-8max-ante',
    title: 'HC9 8 人錦標賽含前注（MTT 8max）、籌碼單位',
    build: (fixed) => ({ ...hc9Hand(fixed), playedAt: '2026-09-30T22:00:00' }),
  },
  {
    file: '04-side-pot',
    title: 'HC5 三人邊池（主池 + 1 個邊池）、元單位',
    build: (fixed) => buildHand({ detail: hc5Detail(0), board: runoutBoard, playedAt: '2026-09-30T22:30:00' }, fixed),
  },
  {
    file: '05-cash-9max',
    title: '9 人現金桌、元單位（GTO Wizard 可能不支援分析，觀察是否接受）',
    build: nineMaxCashHand,
  },
  {
    file: '06-cent-unit',
    title: '分單位手牌（8.8 GG 範例的解析結果，2 位小數金額）',
    build: (fixed) => ggCentHand({}, fixed),
  },
]

export const GTO_CHECK_ALL_FILE = 'all-6-hands'

/** 單手檔案的 exportSeq 起點（101–106），合併檔為 1–6 */
const SINGLE_SEQ_BASE = 100

/** 產生全部驗證檔：檔名（含 .txt）→ 檔案內容（皆由 exportPokerStars 產生，Hero 名稱用預設 `Hero`） */
export function gtoWizardCheckFiles(): { name: string; text: string }[] {
  const all = GTO_CHECK_CASES.map((c, i) => c.build({ exportSeq: i + 1 }))
  return [
    { name: `${GTO_CHECK_ALL_FILE}.txt`, text: exportPokerStars(all) },
    ...GTO_CHECK_CASES.map((c, i) => ({ name: `${c.file}.txt`, text: exportPokerStars([c.build({ exportSeq: SINGLE_SEQ_BASE + i + 1 })]) })),
  ]
}
