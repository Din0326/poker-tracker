import { strings } from '../strings'

// P0 佔位內容，之後各階段替換為實際功能
export function Placeholder({ phase }: { phase: string }) {
  return (
    <p className="py-10 text-center text-(--color-text-muted)">{strings.placeholder.comingIn(phase)}</p>
  )
}
