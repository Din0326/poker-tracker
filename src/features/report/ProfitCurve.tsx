import { memo, useId, useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type ActiveDotProps,
  type DotItemDotProps,
  type TooltipContentProps,
  type TooltipValueType,
} from 'recharts'
import { formatPermille, formatSignedMoney } from '../../domain'
import { strings } from '../../strings'
import { profitColorClass } from '../sessions/sessionView'
import {
  MAX_DOTS,
  MIN_CURVE_POINTS,
  curvePointTone,
  curveStroke,
  signed,
  type CurvePoint,
  type CurveTone,
} from './reportModel'

const t = strings.report.curve

// 顏色一律取自 tokens.css（SVG 屬性可直接使用 CSS 變數）
const tickStyle = { fill: 'var(--color-text-muted)', fontSize: 12 }

// 6.3 水上 / 水下：盈虧語意色，隨 <html data-profit-scheme> 切換
const TONE_COLOR: Record<CurveTone, string> = { gain: 'var(--color-gain)', loss: 'var(--color-loss)' }

/** 資料點圓圈：依該點累積值著色（≥ 0 gain、< 0 loss） */
function CurveDot({ cx, cy, payload }: DotItemDotProps) {
  if (cx == null || cy == null) return null
  const tone = curvePointTone((payload as CurvePoint).cumulative)
  return <circle className="recharts-dot" cx={cx} cy={cy} r={3} fill={TONE_COLOR[tone]} strokeWidth={0} data-tone={tone} />
}

/** tooltip 啟用時的作用中圓點：同樣依累積值著色 */
function CurveActiveDot({ cx, cy, payload }: ActiveDotProps) {
  if (cx == null || cy == null) return null
  const tone = curvePointTone((payload as CurvePoint).cumulative)
  return (
    <circle
      className="recharts-dot"
      cx={cx}
      cy={cy}
      r={5}
      fill={TONE_COLOR[tone]}
      stroke="var(--color-surface)"
      strokeWidth={2}
      data-tone={tone}
    />
  )
}

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
        <span>
          <span className={`font-semibold ${profitColorClass(p.tone)}`}>{p.text}</span>
          {point.soldPermille !== null && (
            <span data-testid="tooltip-sold" className="text-(--color-text-muted)">
              {t.soldSuffix(formatPermille(point.soldPermille))}
            </span>
          )}
        </span>
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
  // 漸層 id 須唯一；useId 產生的冒號、« » 等字元放進 url(#...) 會失效，只保留安全字元
  const gradientId = `curve-stroke-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  const stroke = useMemo(() => curveStroke(points.map((p) => p.cumulative)), [points])
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
          {stroke.kind === 'split' && (
            // 6.3 跨 0 時：兩組 stop 在同一 offset 形成硬切換（上 gain、下 loss，不漸層）。
            // 採 objectBoundingBox：bbox 即線條 path 的資料 min～max，offset 由 curveStroke 純函式計算；
            // 所有點同值（高度 0）時 curveStroke 必回傳 solid，不會用到漸層。
            <defs>
              <linearGradient id={gradientId} data-testid="curve-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset={0} style={{ stopColor: TONE_COLOR.gain }} />
                <stop offset={stroke.offset} style={{ stopColor: TONE_COLOR.gain }} />
                <stop offset={stroke.offset} style={{ stopColor: TONE_COLOR.loss }} />
                <stop offset={1} style={{ stopColor: TONE_COLOR.loss }} />
              </linearGradient>
            </defs>
          )}
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
            stroke={stroke.kind === 'split' ? `url(#${gradientId})` : TONE_COLOR[stroke.tone]}
            strokeWidth={2}
            dot={showDots ? CurveDot : false}
            activeDot={CurveActiveDot}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
})
