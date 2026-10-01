// 行動者的顯示文字（5.3 行動紀錄、行動列、結果；寫法同 6.2）：「UTG（1）」；Hero 為「你 BTN（4）」
import { positionText, positionsBySeat } from '../../domain/hands'
import { strings } from '../../strings'
import type { ParsedSetup } from './handFormModel'

const t = strings.hands

export function actorLabeler(setup: ParsedSetup): (seatNo: number) => string {
  const positions = positionsBySeat(
    setup.config.seats.map((s) => s.seatNo),
    setup.config.buttonSeat,
  )
  return (seatNo) => {
    const pos = positions.get(seatNo)
    const name = pos ? positionText(pos) : strings.format.empty
    return seatNo === setup.heroSeat ? t.log.heroActor(t.log.you, name, seatNo) : t.log.actor(name, seatNo)
  }
}
