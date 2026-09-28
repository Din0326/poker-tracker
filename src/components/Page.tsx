import type { ReactNode } from 'react'
import { useNavigationType } from 'react-router'
import { PageHeader } from './PageHeader'

type Props = {
  title: string
  backTo?: string
  children?: ReactNode
}

// 分頁根頁面與推入式子頁共用的頁面框架；子頁以 PUSH 進入時播放推入動效
export function Page({ title, backTo, children }: Props) {
  const navigationType = useNavigationType()
  const isPushedSubPage = backTo !== undefined && navigationType === 'PUSH'

  return (
    <div className={isPushedSubPage ? 'anim-push' : undefined}>
      <PageHeader title={title} {...(backTo !== undefined ? { backTo } : {})} />
      <main className="px-4">{children}</main>
    </div>
  )
}
