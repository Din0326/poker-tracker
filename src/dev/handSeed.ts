// 開發用：產生 10,000 手隨機測試手牌（SPEC-v2-hands 11.1：30% 簡易、70% 完整）。
// 只產生資料，不寫入 DB、不含 UI；正式程式碼不得 import 本檔（ESLint no-restricted-imports 強制）。
// 以固定種子的虛擬亂數產生，同一組參數每次結果相同。
// 每一手都以 domain/hands 的引擎逐筆產生合法行動，再以 finalizeHandContent 推導 collected、kind 與摘要欄位，
// 所以全部通過 handSchema 與 verifyHand（見 tests/unit/hand-seed.test.ts）。
import dayjs from 'dayjs'
import {
  FULL_DECK,
  POSITIONS,
  applyAction,
  boardCountFor,
  buildPots,
  finalizeHandContent,
  legalActions,
  quickBetSizesFor,
  startHand,
  type Action,
  type Card,
  type EngineState,
  type Hand,
  type HandContent,
  type HandDetail,
  type HandGameType,
  type HandSource,
  type Seat,
} from '../domain/hands'
import type { Session } from '../domain/types'
import { mulberry32 } from './seed'

/** 寫在 note 與 tags 裡的標記，也用於確認建置產物不含本檔 */
export const HAND_SEED_MARKER = 'poker-hand-seed-generator-v1'

export interface HandSeedOptions {
  /** 手數，預設 10,000 */
  count?: number
  /** 亂數種子，預設 20261001 */
  seed?: number
  /** 資料的最晚日期 `YYYY-MM-DD`（不含當天），預設為執行當天 */
  today?: string
  /** 往前分布的天數，預設 730 */
  spanDays?: number
  /** 可關聯的場次（依類型相容規則挑選，3.11）；省略時全部為獨立手牌 */
  sessions?: readonly Pick<Session, 'id' | 'type'>[]
  /** 第一手的 exportSeq，預設 1（呼叫端依 7.4 配發） */
  startSeq?: number
}

type Rand = () => number

interface Picker {
  rand: Rand
  int: (min: number, max: number) => number
  pick: <T>(items: readonly T[]) => T
  chance: (p: number) => boolean
  shuffle: <T>(items: readonly T[]) => T[]
}

function picker(seed: number): Picker {
  const rand = mulberry32(seed)
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))
  return {
    rand,
    int,
    pick: <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)] as T,
    chance: (p: number) => rand() < p,
    shuffle: <T>(items: readonly T[]) => {
      const a = [...items]
      for (let i = a.length - 1; i > 0; i--) {
        const j = int(0, i)
        ;[a[i], a[j]] = [a[j] as T, a[i] as T]
      }
      return a
    },
  }
}

/** 各單位的盲注組合（sb、bb、ante） */
const BLINDS: Record<'yuan' | 'cent' | 'chip', [number, number, number][]> = {
  yuan: [
    [25, 50, 0],
    [50, 100, 0],
    [100, 200, 0],
    [200, 400, 0],
    [1, 2, 0],
  ],
  cent: [
    [5, 10, 0],
    [10, 25, 0],
    [25, 50, 0],
    [50, 100, 0],
  ],
  chip: [
    [100, 200, 25],
    [200, 400, 50],
    [500, 1000, 100],
    [100, 200, 0],
  ],
}

type Kind = 'memo' | 'unfinished' | 'random' | 'chop' | 'sidePot'

interface Setup {
  source: HandSource
  gameType: HandGameType
  sb: number
  bb: number
  ante: number
  straddle: number
  tableSize: number
  seats: { seatNo: number; stack: number }[]
  buttonSeat: number
  heroSeat: number
}

function makeSetup(p: Picker, source: HandSource, gameType: HandGameType, kind: Kind): Setup {
  const unit = gameType === 'tournament' ? 'chip' : source === 'gg' ? 'cent' : 'yuan'
  const [sb, bb, ante] = p.pick(BLINDS[unit])
  const tableSize = p.pick([2, 6, 6, 6, 8, 9, 9, 10])
  const playerCount = kind === 'sidePot' ? Math.min(tableSize, p.int(3, 4)) : tableSize === 2 ? 2 : p.int(Math.max(2, tableSize - 3), tableSize)
  const seatNos = p.shuffle(Array.from({ length: tableSize }, (_, i) => i + 1))
    .slice(0, playerCount)
    .sort((a, b) => a - b)
  // straddle 只在手動現金桌（GG 不支援，8.3）、3 人以上
  const straddle = source === 'manual' && gameType === 'cash' && playerCount >= 3 && p.chance(0.08) ? 2 * bb : 0
  const seats = seatNos.map((seatNo, i) => {
    // 邊池模板：每位玩家籌碼不同（依序遞增），確保切出多個池
    const bbs = kind === 'sidePot' ? 10 + i * p.int(8, 20) : p.int(20, 250)
    // 籌碼必須大於要放的前注 + 盲注（含 straddle），以 5 bb 以上保證
    return { seatNo, stack: Math.max(bb * bbs + p.int(0, bb - 1), (5 * bb + ante) | 0) }
  })
  return {
    source,
    gameType,
    sb,
    bb,
    ante,
    straddle,
    tableSize,
    seats,
    buttonSeat: p.pick(seatNos),
    heroSeat: p.pick(seatNos),
  }
}

/** 依權重隨機選一個合法行動 */
function chooseAction(p: Picker, state: EngineState, kind: Kind): Action {
  const legal = legalActions(state)!
  const base = { street: state.street, seatNo: legal.seatNo }
  const sizes = quickBetSizesFor(state)
  const sized = (): Action => {
    const s = sizes!
    const choice = kind === 'sidePot' ? s.allIn : p.pick([s.min, s.half, s.twoThirds, s.twoThirds, s.pot, s.allIn])
    return { ...base, type: legal.canBet ? 'bet' : 'raise', to: choice.to }
  }
  if (kind === 'chop') return { ...base, type: legal.canCheck ? 'check' : 'call', to: null }
  if (kind === 'sidePot') {
    // 第一位全下，其餘跟注（籌碼不足者跟注即全下）
    if (legal.canRaise && state.currentBet <= state.bb * 2) return sized()
    return { ...base, type: legal.canCall ? 'call' : 'check', to: null }
  }
  const r = p.rand()
  if (legal.canCheck) {
    if ((legal.canBet || legal.canRaise) && r < 0.3) return sized()
    return { ...base, type: 'check', to: null }
  }
  if (r < 0.32) return { ...base, type: 'fold', to: null }
  if (r < 0.88 || !legal.canRaise) return { ...base, type: 'call', to: null }
  return sized()
}

interface Played {
  detail: HandDetail
  board: Card[]
  /** 手牌是否已結束（未完成模板需為 false） */
  finished: boolean
}

const ROYAL: Card[] = ['Ts', 'Js', 'Qs', 'Ks', 'As']

function playHand(p: Picker, setup: Setup, kind: Kind): Played {
  const deck = p.shuffle(kind === 'chop' ? FULL_DECK.filter((c) => !ROYAL.includes(c)) : FULL_DECK)
  const deal = () => deck.pop() as Card
  const heroCards = [deal(), deal()]
  let state = startHand(setup)
  const actions: Action[] = []
  const board: Card[] = []
  const stopAt = kind === 'unfinished' ? p.int(1, 12) : Number.POSITIVE_INFINITY
  while (state.status === 'betting' && actions.length < 200) {
    if (actions.length >= stopAt) break
    // 該街開始行動前先發公牌（3.9：該街有行動時必須已有公牌）
    while (board.length < boardCountFor(state.street)) board.push(kind === 'chop' ? ROYAL[board.length]! : deal())
    const action = chooseAction(p, state, kind)
    const r = applyAction(state, action)
    if (!r.ok) throw new Error(`seed produced an illegal action: ${r.code}`)
    state = r.state
    actions.push(action)
  }
  const showdown = state.status === 'showdown'
  if (showdown) while (board.length < 5) board.push(kind === 'chop' ? ROYAL[board.length]! : deal())
  const finished = state.status !== 'betting'

  const pots = finished ? buildPots(state.players) : []
  const heroEligibleAll = pots.every((pot) => pot.eligible.includes(setup.heroSeat))
  const seats: Seat[] = setup.seats.map((s) => {
    const player = state.players.find((x) => x.seatNo === s.seatNo)!
    const isHero = s.seatNo === setup.heroSeat
    let cards: Card[] = isHero ? heroCards : []
    let mucked = false
    if (!isHero && showdown && !player.folded) {
      // 攤牌對手：Hero 在每個池都有資格時，偶爾蓋牌；否則亮牌（確保每個池都能判定輸贏）
      if (heroEligibleAll && p.chance(0.2)) mucked = true
      else cards = [deal(), deal()]
    }
    return { seatNo: s.seatNo, stack: s.stack, cards, mucked, name: null }
  })
  const pot = state.players.reduce((sum, x) => sum + x.total, 0)
  // 抽水：現金桌、手牌結束時約 0–5%（整數運算）；錦標賽固定 0
  const rake = setup.gameType === 'cash' && finished && p.chance(0.7) ? Math.floor((pot * p.int(0, 5)) / 100) : 0
  return {
    detail: {
      tableSize: setup.tableSize,
      buttonSeat: setup.buttonSeat,
      heroSeat: setup.heroSeat,
      sb: setup.sb,
      bb: setup.bb,
      ante: setup.ante,
      straddle: setup.straddle,
      seats,
      actions,
      rake,
      collected: [],
    },
    board,
    finished,
  }
}

export function generateHandSeedData(options: HandSeedOptions = {}): Hand[] {
  const { count = 10_000, seed = 20261001, spanDays = 730, sessions = [], startSeq = 1 } = options
  const today = options.today ?? dayjs().format('YYYY-MM-DD')
  const p = picker(seed)
  const uuid = (): string => {
    const hex = Array.from({ length: 32 }, () => p.int(0, 15).toString(16))
    hex[12] = '4'
    hex[16] = (8 + p.int(0, 3)).toString(16)
    const h = hex.join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
  const cashSessions = sessions.filter((s) => s.type === 'cash')
  const tournamentSessions = sessions.filter((s) => s.type !== 'cash')
  const tagPool = ['3bet', 'bluff', 'hero call', 'cooler', 'review', 'seed']

  const hands: Hand[] = []
  for (let i = 0; i < count; i++) {
    // 30% 簡易（20% 純備忘、10% 未完成的完整紀錄）、70% 完整；完整中固定比例為平分與邊池模板
    let kind: Kind
    if (i % 10 < 2) kind = 'memo'
    else if (i % 10 === 2) kind = 'unfinished'
    else if (i % 25 === 3 || i % 25 === 18) kind = 'chop'
    else if (i % 25 === 7 || i % 25 === 14) kind = 'sidePot'
    else kind = 'random'
    // 來源 / 牌局類型：手動現金桌（元）、GG 現金桌（分，只有隨機的完整手牌，匯入不會產生簡易手牌，8.3）、錦標賽（籌碼）
    const r = p.rand()
    const source: HandSource = kind === 'random' && r < 0.28 ? 'gg' : 'manual'
    const gameType: HandGameType = source === 'manual' && r > 0.72 ? 'tournament' : 'cash'

    const day = dayjs(today).subtract(p.int(1, spanDays), 'day').hour(p.int(0, 23)).minute(p.int(0, 11) * 5)
    const playedAt = (source === 'gg' ? day.second(p.int(0, 59)) : day.second(0)).format('YYYY-MM-DDTHH:mm:ss')
    const createdAt = day.add(p.int(1, 600), 'minute').format('YYYY-MM-DDTHH:mm:ssZ')
    const linkable = gameType === 'cash' ? cashSessions : tournamentSessions
    const sessionId = linkable.length > 0 && p.chance(source === 'gg' ? 0.1 : 0.4) ? p.pick(linkable).id : null
    const tags = p.chance(0.3) ? [...new Set(p.shuffle(tagPool).slice(0, p.int(1, 3)))] : []
    const note = p.chance(0.15) ? `${HAND_SEED_MARKER} #${i + 1}` : null

    let content: HandContent
    if (kind === 'memo') {
      const deck = p.shuffle(FULL_DECK)
      const unit = gameType === 'tournament' ? 'chip' : 'yuan'
      const bb = p.chance(0.7) ? p.pick(BLINDS[unit])[1] : null
      content = {
        source,
        gameType,
        sessionId,
        playedAt,
        bb,
        heroCards: p.chance(0.85) ? deck.slice(0, 2) : [],
        heroPosition: p.chance(0.7) ? p.pick(POSITIONS) : null,
        board: deck.slice(2, 2 + p.pick([0, 3, 4, 5])),
        // + 0 避免產生 -0
        heroNet: p.chance(0.8) ? (p.chance(0.5) ? 1 : -1) * p.int(0, 300) * (bb ?? 100) + 0 : null,
        detail: null,
        tags,
        note: note ?? (p.chance(0.3) ? 'memo' : null),
        sourceHandId: null,
        rawText: null,
        parserVersion: null,
      }
    } else {
      let played: Played
      let setup: Setup
      // GG 第一版不支援邊池（8.3、HQ21）：切出 2 個以上的池時重新產生
      do {
        setup = makeSetup(p, source, gameType, kind)
        played = playHand(p, setup, kind)
        // 未完成模板必須停在手牌結束前
      } while ((source === 'gg' && hasSidePot(played)) || (kind === 'unfinished' && played.finished))
      const ggId = `RC${String(1_000_000_000 + i)}`
      content = {
        source,
        gameType,
        sessionId,
        playedAt,
        bb: null,
        heroCards: [],
        heroPosition: null,
        board: played.board,
        heroNet: null,
        detail: played.detail,
        tags,
        note,
        sourceHandId: source === 'gg' ? ggId : null,
        rawText: source === 'gg' ? `Poker Hand #${ggId}: ${HAND_SEED_MARKER}` : null,
        parserVersion: source === 'gg' ? 1 : null,
      }
      if (source === 'gg') {
        // GG 的 collected 取自原文；以 4.8 的計算值代替原文（同為贏家集合）
        const fin = finalizeHandContent({ ...content, source: 'manual' })
        content = { ...content, detail: fin.detail }
      }
    }
    hands.push({ id: uuid(), exportSeq: startSeq + i, createdAt, updatedAt: createdAt, ...finalizeHandContent(content) })
  }
  return hands
}

function hasSidePot(played: Played): boolean {
  // 只用引擎重播的結果判斷池數
  let state = startHand(played.detail)
  for (const a of played.detail.actions) {
    const r = applyAction(state, a)
    if (!r.ok) return true
    state = r.state
  }
  return state.status !== 'betting' && buildPots(state.players).length > 1
}
