import { useState } from 'react'
import { SegmentedControl } from '../../components/SegmentedControl'
import { PROFIT_COLOR_SCHEMES, formatSignedMoney, type ProfitColorScheme } from '../../domain'
import { useAppData } from '../../lib/appData'
import { showGlobalToast } from '../../lib/globalToast'
import { setProfitScheme } from '../../lib/profitScheme'
import { strings } from '../../strings'
import { ERROR_TOAST_MS } from './manageShared'
import { SettingsSection, cardClass } from './SettingsSection'

const t = strings.settings
const options = PROFIT_COLOR_SCHEMES.map((value) => ({ value, label: t.profitSchemes[value] }))

// 8.3 顯示設定：盈虧顏色（存入 Settings.profitColorScheme，立即套用到 <html data-profit-scheme>）。
// 深淺色主題跟隨系統，不提供切換。
export function DisplaySection({ initial }: { initial: ProfitColorScheme }) {
  const { repos } = useAppData()
  const [scheme, setScheme] = useState(initial)

  const change = async (next: ProfitColorScheme) => {
    if (next === scheme) return
    const prev = scheme
    setScheme(next)
    setProfitScheme(next)
    try {
      await repos.settings.set('profitColorScheme', next)
    } catch {
      // 寫入失敗：還原畫面與顏色
      setScheme(prev)
      setProfitScheme(prev)
      showGlobalToast({ text: t.actionFailed, durationMs: ERROR_TOAST_MS })
    }
  }

  return (
    <SettingsSection id="settings-display" title={t.displaySection}>
      <div className={`${cardClass} px-4 py-3`}>
        <p className="mb-2 font-semibold">{t.profitColor}</p>
        <SegmentedControl
          label={t.profitColor}
          options={options}
          value={scheme}
          onChange={(v) => void change(v)}
          testId="profit-scheme"
        />
        <p className="num mt-3 text-sm text-(--color-text-muted)" data-testid="profit-sample">
          {t.profitSample}
          <span className="ml-3 font-semibold text-(--color-gain)" data-testid="profit-sample-gain">
            {formatSignedMoney(1000)}
          </span>
          <span className="ml-3 font-semibold text-(--color-loss)" data-testid="profit-sample-loss">
            {formatSignedMoney(-1000)}
          </span>
        </p>
        <p className="mt-2 text-xs text-(--color-text-muted)">{t.themeHint}</p>
      </div>
    </SettingsSection>
  )
}
