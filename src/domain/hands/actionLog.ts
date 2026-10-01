// 行動紀錄的顯示資料（5.3 本手行動紀錄、6.2 逐街呈現共用）：跟注金額與是否全下不儲存（3.4），由重播推導。
import { applyAction, startHand, type EngineConfig, type EngineState } from './engine'
import type { Action } from './types'

export interface ActionLogEntry {
  action: Action
  /** 跟注：實際投入 min(toCall, S)；下注 / 加注：「到」金額；棄牌 / 過牌：null */
  amount: number | null
  /** 這個行動後該玩家剩餘籌碼為 0（全下） */
  allIn: boolean
}

/** 逐筆重播並記下每個行動的顯示金額；遇到不合法的行動時停止（只回傳之前的部分） */
export function describeActions(config: EngineConfig, actions: readonly Action[]): ActionLogEntry[] {
  let state: EngineState = startHand(config)
  const out: ActionLogEntry[] = []
  for (const action of actions) {
    const before = state.players.find((p) => p.seatNo === action.seatNo)
    const r = applyAction(state, action)
    if (!r.ok || !before) break
    const after = r.state.players.find((p) => p.seatNo === action.seatNo)!
    // 未跟注退回（4.5）會在回合結束時加回籌碼：以退回前的投入判斷全下
    const refunded = r.state.refunds
      .slice(state.refunds.length)
      .filter((x) => x.seatNo === action.seatNo)
      .reduce((s, x) => s + x.amount, 0)
    const putIn = action.type === 'call' ? before.stack - (after.stack - refunded) : null
    out.push({
      action,
      amount: action.type === 'call' ? putIn : action.to,
      allIn: action.type !== 'fold' && action.type !== 'check' && after.stack - refunded === 0,
    })
    state = r.state
  }
  return out
}
