import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'

/**
 * 子頁的「返回上一層」（9.1）：有歷史時退回上一頁；
 * 直接開啟子頁網址（location.key 為 'default'，沒有歷史可退）時改以 replace 前往 backTo。
 */
export function useGoBack(backTo: string | undefined): () => void {
  const navigate = useNavigate()
  const location = useLocation()
  const isFirstEntry = location.key === 'default'
  return useCallback(() => {
    if (!isFirstEntry) void navigate(-1)
    else if (backTo) void navigate(backTo, { replace: true })
  }, [navigate, isFirstEntry, backTo])
}
