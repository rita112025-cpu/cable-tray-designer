# cable-tray-designer

**電纜架（Cable Tray）配置設計器** — 在瀏覽器裡拖拉電纜架元件、用 Connector 接起來，自動檢查接得對不對、算出 Route 中心線長度，並匯出 2D 草圖 DXF 與 CSV BOM。

> 適用於教學與概念排線（例如 SCADA / 動力 / 控制 / 通訊各系統的電纜架路徑規劃）。**不是** AutoCAD 動態圖塊，也不是施工或算料依據。

## 為什麼做這個

一般畫電纜架只是「線條看起來接在一起」。這個工具把每個元件當成有端點（Connector）的節點，真正建立連接關係，因此可以：

- 擋下錯誤連接：寬度不同直接相接、System 或高程（FFL）不一致、變徑接錯端、Connector 重複占用。
- 分析網路：Route 中心線長度、孤立元件、子網路、Loop。
- 兩條垂直的直線一鍵插入 90° 彎頭，並自動算好退縮量（Auto Elbow，提案 → 驗證 → 提交，失敗不會留下半完成狀態）。

## 快速開始

純 HTML + JavaScript，**不需要安裝或編譯**：直接雙擊開啟 `index.html`，或用 GitHub Pages 發佈。點「偵測 90° 彎頭」即可試範例。

## 功能

| 版本 | 內容 |
| --- | --- |
| v2 | Connector 資料模型（每個元件有 A/B/C/D 端點，含世界座標與方向）、Tray ID / System / FFL / From / To 欄位 |
| v3 | Graph 引擎：Route DFS、孤立元件、子網路、Loop；Connection 驗證器（占用 / System / FFL / 端點有效寬 / 方向 / 自迴路） |
| v3.1 | Tee / Cross 以虛擬 Junction 節點建模（避免假 Loop）；Reducer 只比較「實際接上的兩個端點」寬度 |
| **v4** | **Auto Elbow 90°**：偵測 → 提案 → 驗證 → 一次提交（失敗則狀態完全不變） |

### Auto Elbow 90°（v4）

1. **偵測**：掃描 free 的 Straight connector 兩兩組合，條件為同 System、同 FFL、同寬、夾角 90°、朝外射線在前方相交（≤ 2000 mm）。
2. **切線退縮**：彎頭中心線半徑 `Rc = innerRadius + width / 2`，兩條直線端點各退到 `C − Rc·u`（`C` 為射線交點）。新長度 = 原長度 + t − Rc，且需 ≥ 100 mm。左轉與右轉都支援。
3. **提案（proposal）**：`{ addBlocks, updateBlocks, addConnections }`，不直接改 state。
4. **驗證**：在「模擬後的新狀態」上檢查 occupied、幾何、端點重合、既有連接端點未被移動、Connector 驗證器（新連接必須全為 Valid）、Graph（Loop / 子網路數不增加）。
5. **提交**：以目前狀態重新 build + validate；全部通過才一次更新 `blocks` 與 `connections`。任何失敗回傳原因，原資料不變。

v4 第一版僅支援 Straight↔Straight、90°、同寬。45°、Auto Reducer、Auto Tee 留待 v5。

## 長度的定義

- **元件 `length` 加總**：只是欄位相加，不是 Route 長度。
- **中心線長度**：直線 / 變徑 = `length`；彎頭 = `(innerRadius + width/2) × 角度(rad)`（W300、內半徑 150、90° → 471 mm）；Tee / Cross 視為節點，權重 0。
- **全專案中心線合計** ≠ 任何單一 Route。各 Route 的長度在「路徑分析」分頁分別列出。

## DXF 匯出的範圍

有：`LWPOLYLINE`（元件輪廓）、`TEXT`、`LINE`（Connection，圖層 `TRAY-LINK`）、`LAYER` 表；`$ACADVER = AC1014`。
沒有：`BLOCK` / `INSERT` / `DIMENSION` / 3D / Z 值。FFL 只寫在文字標註內。

BOM 只有數量與長度，**不含重量**（沒有製造商 / 型錄 / 材質依據）。

## 專案結構

```
index.html          頁面
css/style.css
js/geometry.js      元件模型、Connector、中心線、輪廓
js/graph.js         Graph 建模、Route DFS
js/validator.js     Connection 驗證
js/autoelbow.js     v4 Auto Elbow（proposal / validate / commit）
js/export.js        DXF / CSV / JSON
js/sample.js        範例資料
js/app.js           UI
test/core.test.js   單元測試（Node 或瀏覽器）
test/index.html     在瀏覽器執行測試
```

核心模組（`geometry / graph / validator / autoelbow / export`）沒有 DOM 相依，可單獨在 Node 執行。

## 測試

有 Node：

```bash
node test/core.test.js
```

沒有 Node：用瀏覽器開啟 `test/index.html`（標題顯示 PASS / FAIL）。若瀏覽器擋 `file://`，可先啟動簡易伺服器：

```bash
python -m http.server 8000
```

## 發佈到 GitHub Pages

Repository → Settings → Pages → Source 選 `main` / root，網址即為 `https://<user>.github.io/<repo>/`。

## 座標系

SVG 座標（x 向右、y 向下），角度 0° = 向右、90° = 向下。DXF 匯出時 y 會取負值轉為 CAD 座標。
