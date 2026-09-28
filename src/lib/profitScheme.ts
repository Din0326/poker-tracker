// 啟動時依 Settings.profitColorScheme（預設 redGain）設定 <html data-profit-scheme>，
// 讓 --color-gain / --color-loss 對應正確的紅綠（9.3、8.3）
import type { Repositories } from '../db'
import type { ProfitColorScheme } from '../domain'

export const DEFAULT_PROFIT_SCHEME: ProfitColorScheme = 'redGain'

export function setProfitScheme(scheme: ProfitColorScheme): void {
  document.documentElement.dataset.profitScheme = scheme
}

export async function applyStoredProfitScheme(repos: Repositories): Promise<void> {
  try {
    setProfitScheme((await repos.settings.get('profitColorScheme')) ?? DEFAULT_PROFIT_SCHEME)
  } catch {
    // 讀取失敗時維持 index.html 的預設值（redGain）
    setProfitScheme(DEFAULT_PROFIT_SCHEME)
  }
}
