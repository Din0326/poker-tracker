import { Page } from '../../components/Page'
import { Placeholder } from '../../components/Placeholder'
import { strings } from '../../strings'

// 盲注管理（8.2，P5 實作）
export function StakesPage() {
  return (
    <Page title={strings.pages.stakes} backTo="/settings">
      <Placeholder phase="P5" />
    </Page>
  )
}
