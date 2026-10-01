// 4.2–4.5 行動引擎：強制下注、輪位、合法行動、回合結束、自動發完、未跟注退回。
// 以不可變（immutable）的狀態逐筆重播行動；任何不合法的行動回傳錯誤代碼，不丟例外。
// 金額一律為整數（單位依該手的 amountUnit，3.8），只做加減比較，不使用浮點數。
import { clockwiseFrom, forcedSeats, nextSeatClockwise } from './positions'
import { STREETS, type Action, type ActionType, type HandDetail, type Street } from './types'

/** 開始一手牌需要的設定（HandDetail 的子集） */
export interface EngineConfig {
  seats: readonly { seatNo: number; stack: number }[]
  buttonSeat: number
  sb: number
  bb: number
  ante: number
  straddle: number
}

export interface PlayerState {
  seatNo: number
  /** 起始籌碼 */
  startStack: number
  /** 剩餘籌碼 S */
  stack: number
  /** 該街投入 A（不含前注） */
  street: number
  /** 總投入 = 前注 + 各街投入 − 退回（4.6） */
  total: number
  folded: boolean
}

/** betting：下注進行中；foldEnded：其他人都棄牌而結束；showdown：河牌回合結束或自動發完，進入攤牌 */
export type HandStatus = 'betting' | 'foldEnded' | 'showdown'

/** 4.5 未跟注退回 */
export interface Refund {
  street: Street
  seatNo: number
  amount: number
}

export interface EngineState {
  readonly bb: number
  readonly buttonSeat: number
  /** 依座位號由小到大 */
  readonly players: readonly PlayerState[]
  /** 目前（或最後）的下注回合 */
  readonly street: Street
  readonly status: HandStatus
  /** 目前下注額 B */
  readonly currentBet: number
  /** 最小加注增量 L */
  readonly minRaise: number
  /** 本回合已行動過的座位（強制下注不算行動） */
  readonly actedThisRound: readonly number[]
  /** 4.3「可加注」：自上一次完整加注（或本回合開始）後已行動過的座位 */
  readonly actedSinceFullRaise: readonly number[]
  /** 輪到行動的座位；手牌結束時為 null */
  readonly toAct: number | null
  /** 是否自動發完（4.4） */
  readonly runout: boolean
  /** 回合已結束的街（依序） */
  readonly completedStreets: readonly Street[]
  /** 各街開始時的底池（已扣退回）；翻前為發牌前放入的前注與盲注合計 */
  readonly potAtStart: Readonly<Partial<Record<Street, number>>>
  readonly refunds: readonly Refund[]
}

/** 行動不合法的原因（3.4、4.3） */
export type ActionErrorCode =
  | 'handEnded'
  | 'wrongStreet'
  | 'notYourTurn'
  | 'cannotCheck'
  | 'cannotCall'
  | 'cannotBet'
  | 'cannotRaise'
  | 'raiseNotReopened'
  | 'betTooSmall'
  | 'raiseTooSmall'
  | 'exceedsStack'
  | 'invalidTo'

export type ApplyResult = { ok: true; state: EngineState } | { ok: false; code: ActionErrorCode }

const isAllIn = (p: PlayerState) => !p.folded && p.stack === 0
/** 仍在牌局中（未棄牌）且未全下：還能行動的玩家 */
const canAct = (p: PlayerState) => !p.folded && p.stack > 0

export function nextStreet(street: Street): Street | null {
  const i = STREETS.indexOf(street)
  return i < STREETS.length - 1 ? (STREETS[i + 1] as Street) : null
}

/** 該街應有的公牌張數：翻前 0、翻牌 3、轉牌 4、河牌 5 */
export function boardCountFor(street: Street): number {
  return street === 'preflop' ? 0 : street === 'flop' ? 3 : street === 'turn' ? 4 : 5
}

const sumTotal = (players: readonly PlayerState[]) => players.reduce((s, p) => s + p.total, 0)

/** 從 start（含）起順時針找第一位符合條件的座位 */
function firstFrom(players: readonly PlayerState[], start: number, pred: (p: PlayerState) => boolean): number | null {
  const bySeat = new Map(players.map((p) => [p.seatNo, p]))
  const order = clockwiseFrom(
    players.map((p) => p.seatNo),
    start,
  )
  for (const s of order) if (pred(bySeat.get(s)!)) return s
  return null
}

/**
 * 4.2 發牌前放入：前注（只計入底池）→ 小盲、大盲、straddle（計入翻前的該街投入）。
 * 翻前 B = max(bb, straddle)、L = B；第一位行動者為大盲（有 straddle 時為 straddle 玩家）順時針下一位。
 * 籌碼是否足夠（4.3 籌碼限制）由結構驗證檢查，引擎不另外檢查。
 */
export function startHand(config: EngineConfig): EngineState {
  const seatNos = config.seats.map((s) => s.seatNo)
  const forced = forcedSeats(seatNos, config.buttonSeat, config.straddle > 0)
  const post = new Map<number, number>([
    [forced.sbSeat, config.sb],
    [forced.bbSeat, config.bb],
  ])
  if (forced.straddleSeat !== null) post.set(forced.straddleSeat, config.straddle)

  const players: PlayerState[] = [...config.seats]
    .sort((a, b) => a.seatNo - b.seatNo)
    .map((s) => {
      const blind = post.get(s.seatNo) ?? 0
      return {
        seatNo: s.seatNo,
        startStack: s.stack,
        stack: s.stack - config.ante - blind,
        street: blind,
        total: config.ante + blind,
        folded: false,
      }
    })
  const currentBet = Math.max(config.bb, config.straddle)
  const after = nextSeatClockwise(seatNos, forced.straddleSeat ?? forced.bbSeat)
  return {
    bb: config.bb,
    buttonSeat: config.buttonSeat,
    players,
    street: 'preflop',
    status: 'betting',
    currentBet,
    minRaise: currentBet,
    actedThisRound: [],
    actedSinceFullRaise: [],
    toAct: firstFrom(players, after, canAct),
    runout: false,
    completedStreets: [],
    potAtStart: { preflop: sumTotal(players) },
    refunds: [],
  }
}

export interface LegalActions {
  seatNo: number
  /** 該街已投入 A */
  committed: number
  /** 剩餘籌碼 S */
  stack: number
  currentBet: number
  minRaise: number
  /** toCall = B − A */
  toCall: number
  /** 跟注實際投入 min(toCall, S)；不能跟注時為 0 */
  callAmount: number
  canFold: boolean
  canCheck: boolean
  canCall: boolean
  canBet: boolean
  canRaise: boolean
  /** bet / raise 的最小「到」金額（不足時為全下金額）；不能下注 / 加注時為 null */
  minTo: number | null
  /** bet / raise 的最大「到」金額 = A + S（全下）；不能下注 / 加注時為 null */
  maxTo: number | null
}

/** 4.3 目前輪到的玩家可做的行動；手牌已結束時回傳 null */
export function legalActions(state: EngineState): LegalActions | null {
  if (state.status !== 'betting' || state.toAct === null) return null
  const p = state.players.find((x) => x.seatNo === state.toAct)!
  const A = p.street
  const S = p.stack
  const B = state.currentBet
  const L = state.minRaise
  const toCall = B - A
  const canBet = B === 0 && S > 0
  const canRaise = B > 0 && S > toCall && !state.actedSinceFullRaise.includes(p.seatNo)
  const allInTo = A + S
  let minTo: number | null = null
  if (canBet) minTo = Math.min(state.bb, S)
  else if (canRaise) minTo = Math.min(B + L, allInTo)
  return {
    seatNo: p.seatNo,
    committed: A,
    stack: S,
    currentBet: B,
    minRaise: L,
    toCall,
    callAmount: toCall > 0 ? Math.min(toCall, S) : 0,
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    canBet,
    canRaise,
    minTo,
    maxTo: canBet || canRaise ? allInTo : null,
  }
}

/** 4.4 回合是否結束（在剛完成一筆行動之後判斷） */
function isRoundOver(players: readonly PlayerState[], currentBet: number, acted: readonly number[]): boolean {
  const active = players.filter((p) => !p.folded)
  if (active.length <= 1) return true
  const movers = active.filter(canAct)
  if (movers.length === 0) return true
  if (movers.length === 1 && movers[0]!.street >= currentBet) return true
  return movers.every((p) => acted.includes(p.seatNo) && p.street === currentBet)
}

/** 4.5：該街投入最高者只有 1 位且高於第二高者時，差額退回給他（含已棄牌者一起比較） */
function refundUncalled(players: PlayerState[], street: Street): Refund | null {
  const sorted = [...players].sort((a, b) => b.street - a.street)
  const top = sorted[0]
  const second = sorted[1]
  if (!top || !second || top.street <= second.street) return null
  const amount = top.street - second.street
  top.street -= amount
  top.total -= amount
  top.stack += amount
  return { street, seatNo: top.seatNo, amount }
}

/** 4.4 回合結束後：退回 → 手牌結束 / 攤牌 / 自動發完 / 下一條街 */
function endRound(
  base: EngineState,
  players: PlayerState[],
  acted: readonly number[],
  actedSinceFullRaise: readonly number[],
  currentBet: number,
  minRaise: number,
): EngineState {
  const street = base.street
  const refund = refundUncalled(players, street)
  const refunds = refund ? [...base.refunds, refund] : base.refunds
  const completedStreets = [...base.completedStreets, street]
  const common = { ...base, players, refunds, completedStreets, actedThisRound: acted, actedSinceFullRaise, currentBet, minRaise, toAct: null }
  const active = players.filter((p) => !p.folded)
  if (active.length === 1) return { ...common, status: 'foldEnded' }
  const next = nextStreet(street)
  if (next === null) return { ...common, status: 'showdown' }
  const pot = sumTotal(players)
  if (active.filter(canAct).length <= 1) {
    // 自動發完：之後的街沒有任何行動，公牌直接發到 5 張
    const potAtStart = { ...base.potAtStart }
    for (let s: Street | null = next; s !== null; s = nextStreet(s)) potAtStart[s] = pot
    return { ...common, status: 'showdown', runout: true, potAtStart }
  }
  for (const p of players) p.street = 0
  return {
    ...common,
    street: next,
    status: 'betting',
    currentBet: 0,
    minRaise: base.bb,
    actedThisRound: [],
    actedSinceFullRaise: [],
    // 翻牌後第一位行動者：按鈕順時針下一位仍在牌局中且未全下的玩家
    toAct: firstFrom(players, nextSeatClockwise(players.map((p) => p.seatNo), base.buttonSeat), canAct),
    potAtStart: { ...base.potAtStart, [next]: pot },
  }
}

/** 套用一筆行動（3.4、4.3）；不合法時回傳錯誤代碼，狀態不變 */
export function applyAction(state: EngineState, action: Pick<Action, 'street' | 'seatNo' | 'type' | 'to'>): ApplyResult {
  const fail = (code: ActionErrorCode): ApplyResult => ({ ok: false, code })
  if (state.status !== 'betting' || state.toAct === null) return fail('handEnded')
  if (action.street !== state.street) return fail('wrongStreet')
  if (action.seatNo !== state.toAct) return fail('notYourTurn')
  const legal = legalActions(state)!
  const type: ActionType = action.type
  if ((type === 'bet' || type === 'raise') !== (action.to !== null)) return fail('invalidTo')
  if (action.to !== null && !Number.isSafeInteger(action.to)) return fail('invalidTo')

  const players = state.players.map((p) => ({ ...p }))
  const p = players.find((x) => x.seatNo === action.seatNo)!
  let currentBet = state.currentBet
  let minRaise = state.minRaise
  let actedSinceFullRaise = [...state.actedSinceFullRaise]
  const markActed = () => {
    if (!actedSinceFullRaise.includes(p.seatNo)) actedSinceFullRaise.push(p.seatNo)
  }
  const putTo = (to: number) => {
    const delta = to - p.street
    p.street = to
    p.total += delta
    p.stack -= delta
  }

  switch (type) {
    case 'fold':
      p.folded = true
      markActed()
      break
    case 'check':
      if (!legal.canCheck) return fail('cannotCheck')
      markActed()
      break
    case 'call':
      if (!legal.canCall) return fail('cannotCall')
      putTo(p.street + legal.callAmount)
      markActed()
      break
    case 'bet': {
      const to = action.to!
      if (!legal.canBet) return fail('cannotBet')
      if (to > legal.maxTo!) return fail('exceedsStack')
      if (to < state.bb && to !== legal.maxTo) return fail('betTooSmall')
      if (to <= 0) return fail('betTooSmall')
      putTo(to)
      currentBet = to
      minRaise = Math.max(to, state.bb)
      actedSinceFullRaise = [p.seatNo]
      break
    }
    case 'raise': {
      const to = action.to!
      if (state.currentBet === 0 || legal.stack <= legal.toCall) return fail('cannotRaise')
      if (!legal.canRaise) return fail('raiseNotReopened')
      if (to > legal.maxTo!) return fail('exceedsStack')
      if (to <= state.currentBet) return fail('raiseTooSmall')
      if (to < state.currentBet + state.minRaise && to !== legal.maxTo) return fail('raiseTooSmall')
      const increment = to - state.currentBet
      putTo(to)
      currentBet = to
      if (increment >= state.minRaise) {
        // 完整加注：L = r，重新開放行動
        minRaise = increment
        actedSinceFullRaise = [p.seatNo]
      } else {
        // 不完整加注（只可能是全下）：L 不變，不重新開放
        markActed()
      }
      break
    }
  }

  const acted = state.actedThisRound.includes(p.seatNo) ? [...state.actedThisRound] : [...state.actedThisRound, p.seatNo]
  if (isRoundOver(players, currentBet, acted)) {
    return { ok: true, state: endRound(state, players, acted, actedSinceFullRaise, currentBet, minRaise) }
  }
  // 輪位：順時針下一位「未棄牌、未全下、且這回合還需要行動」的玩家
  const needsAction = (x: PlayerState) => canAct(x) && (!acted.includes(x.seatNo) || x.street < currentBet)
  const toAct = firstFrom(players, nextSeatClockwise(players.map((x) => x.seatNo), p.seatNo), needsAction)
  return {
    ok: true,
    state: { ...state, players, currentBet, minRaise, actedThisRound: acted, actedSinceFullRaise, toAct },
  }
}

export type ReplayResult =
  | { ok: true; state: EngineState }
  | { ok: false; /** 0 起算 */ actionIndex: number; code: ActionErrorCode; state: EngineState }

/** 3.4：從第一筆行動重播到最後一筆，全部合法才成功 */
export function replay(detail: Pick<HandDetail, 'seats' | 'buttonSeat' | 'sb' | 'bb' | 'ante' | 'straddle' | 'actions'>): ReplayResult {
  let state = startHand(detail)
  for (let i = 0; i < detail.actions.length; i++) {
    const r = applyAction(state, detail.actions[i]!)
    if (!r.ok) return { ok: false, actionIndex: i, code: r.code, state }
    state = r.state
  }
  return { ok: true, state }
}

/** 目前底池 P（所有玩家已放入的前注與各街投入，含本街；4.11） */
export function currentPot(state: EngineState): number {
  return sumTotal(state.players)
}

/** 是否全下（未棄牌且剩餘籌碼為 0） */
export function playerIsAllIn(p: PlayerState): boolean {
  return isAllIn(p)
}
