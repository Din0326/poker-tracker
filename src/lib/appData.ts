// App 使用的 DB 與 repository。預設為單例 db；元件測試以 <AppDataContext value={...}> 注入獨立的資料庫
import { createContext, useContext } from 'react'
import { createRepositories, db, type PokerDb, type Repositories } from '../db'

export interface AppData {
  db: PokerDb
  repos: Repositories
}

export const defaultAppData: AppData = { db, repos: createRepositories(db) }

export const AppDataContext = createContext<AppData>(defaultAppData)

export function useAppData(): AppData {
  return useContext(AppDataContext)
}
