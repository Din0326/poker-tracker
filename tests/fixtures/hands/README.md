# 手牌測試 fixture

| 檔案 | 說明 |
| --- | --- |
| `export-example-1.txt` | SPEC-v2-hands 7.9 預期輸出全文（HC17 逐行比對基準） |
| `gg-example-1.txt` | SPEC-v2-hands 8.8 GG 範例原文（HC19）。**非真實檔案，依公開格式撰寫，待以真實 PokerCraft 匯出驗證（14 節 HQ15）**。內容必須與規格 8.8 原文完全相同（`Dealt to <名稱> ` 行尾有一個空格），不能加註解行，否則會被白名單拒絕 |

其他 GG 測試資料（HC20 各種不支援情況、zip、10,000 手效能）在測試中由 `gg-example-1.txt` 改寫或複製產生，同樣是非真實檔案。
