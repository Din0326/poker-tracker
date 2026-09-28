// 三種場次類型的固定圖示（9.3：全 App 一致）
import { Coins, Timer, Trophy, type LucideIcon } from 'lucide-react'
import type { SessionType } from '../domain'

export const sessionTypeIcons: Record<SessionType, LucideIcon> = {
  cash: Coins,
  mtt: Trophy,
  timed_mtt: Timer,
}
