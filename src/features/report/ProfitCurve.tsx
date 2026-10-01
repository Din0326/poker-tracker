import { memo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from 'recharts'
import { formatSignedMoney } from '../../domain'
import { strings } from '../../strings'
import { profitColorClass } from '../sessions/sessionView'
import { MAX_DOTS, MIN_CURVE_POINTS, signed, type CurvePoint } from './reportModel'

const t = strings.report.curve

// 顏色一律取自 tokens.css（SVG 屬性可直接使用 CSS 變數）
const tickStyle = { fill: 'var(--color-text-muted)', fontSize: 12 }

function CurveTooltip({ active, payload }: TooltipContentProps<TooltipValueType, string | number>) {
  const point = active ? (payload?.[0]?.payload as CurvePoint | undefined) : undefined
  if (!point) return null
  const p = signed.money(point.profit)
  const c = signed.money(point.cumulative)
  return (
    <div
      data-testid="curve-tooltip"
      className="num rounded-(--radius-control) border border-(--color-border) bg-(--color-surface-raised) px-3 py-2 text-sm text-(--color-text) shadow-sm"
    >
      <p data-testid="tooltip-heading" className="font-semibold">
        {strings.format.titleJoin(point.date, strings.sessionTypes[point.type])}
      </p>
      <p data-testid="tooltip-profit" className="mt-1 flex justify-between gap-4">
        <span className="text-(--color-text-muted)">{t.sessionProfit}</span>
        <span className={`font-semibold ${profitColorClass(p.tone)}`}>{p.text}</span>
      </p>
      <p data-testid="tooltip-cumulative" className="flex justify-between gap-4">
        <span className="text-(--color-text-muted)">{t.cumulative}</span>
        <span className={`font-semibold ${profitColorClass(c.tone)}`}>{c.text}</span>
      </p>
    </div>
  )
}

type Props = { points: CurvePoint[] }

// 6.3 累積盈利曲線：X 軸為場次序號，Y 軸為累積盈利；Y=0 虛線基準線；
// 點按或滑過顯示 tooltip；超過 500 點不畫資料點圓圈。關閉 Recharts 動畫（9.3 動效只用於狀態變化）。
export const ProfitCurve = memo(function ProfitCurve({ points }: Props) {
  if (points.length < MIN_CURVE_POINTS) {
    return (
      <p data-testid="curve-empty" className="py-10 text-center text-sm text-(--color-text-muted)">
        {t.needTwo}
      </p>
    )
  }
  const showDots = points.length <= MAX_DOTS
  const last = points[points.length - 1]!
  return (
    <div
      data-testid="profit-curve"
      data-points={points.length}
      role="img"
      aria-label={t.chartLabel(points.length, formatSignedMoney(last.cumulative))}
      className="num h-60 w-full touch-pan-y select-none"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="index"
            type="number"
            domain={[1, points.length]}
            allowDecimals={false}
            tick={tickStyle}
            tickLine={false}
            stroke="var(--color-border)"
            minTickGap={24}
          />
          <YAxis
            width="auto"
            tickFormatter={(v: number) => formatSignedMoney(v)}
            tick={tickStyle}
            tickLine={false}
            axisLine={false}
          />
          <ReferenceLine
            y={0}
            ifOverflow="extendDomain"
            stroke="var(--color-text-muted)"
            strokeDasharray="4 4"
            className="curve-baseline"
          />
          <Tooltip
            content={CurveTooltip}
            cursor={{ stroke: 'var(--color-text-muted)', strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="cumulative"
            stroke="var(--color-accent)"
            strokeWidth={2}
            dot={showDots ? { r: 3, fill: 'var(--color-accent)', stroke: 'var(--color-accent)', strokeWidth: 0 } : false}
            activeDot={{ r: 5, fill: 'var(--color-accent)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
})
