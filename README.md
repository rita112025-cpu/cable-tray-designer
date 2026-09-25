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
| v4 | **Auto Elbow 90°**：偵測 → 提案 → 驗證 → 一次提交（失敗則狀態完全不變） |
| **v5.0** | **Auto Reducer**：兩條同軸相對、寬度不同的直線 → 自動插入變徑（W300→W200） |
| **v5.1** | **Auto Elbow 45°**：切線退縮量 `T = Rc·tan(θ/2)`，與 90° 共用同一套 proposal / transaction |
| v5.2a | **Transaction 升級**：proposal 支援 `removeBlocks` / `removeConnections` / `replaces`（既有連接改接） |
| **v5.2** | **Auto Tee**：分支端點垂直朝向另一條直線的中段 → 主線拆成兩段並插入三通 |

### Auto Elbow 90°（v4）

1. **偵測**：掃描 free 的 Straight connector 兩兩組合，條件為同 System、同 FFL、同寬、夾角 90°、朝外射線在前方相交（≤ 2000 mm）。
2. **切線退縮**：彎頭中心線半徑 `Rc = innerRadius + width / 2`，兩條直線端點各退到 `C − Rc·u`（`C` 為射線交點）。新長度 = 原長度 + t − Rc，且需 ≥ 100 mm。左轉與右轉都支援。
3. **提案（proposal）**：`{ addBlocks, updateBlocks, addConnections }`，不直接改 state。
4. **驗證**：在「模擬後的新狀態」上檢查 occupied、幾何、端點重合、既有連接端點未被移動、Connector 驗證器（新連接必須全為 Valid）、Graph（Loop / 子網路數不增加）。
5. **提交**：以目前狀態重新 build + validate；全部通過才一次更新 `blocks` 與 `connections`。任何失敗回傳原因，原資料不變。

v4 第一版僅支援 Straight↔Straight、90°、同寬。

### Auto Reducer（v5.0）

兩條 free 的 Straight，端點同軸、朝向彼此、System / FFL 相同、寬度不同，就能插入變徑：

- 變徑長度預設 300 mm，兩條直線各調整 `(間距 − 300) / 2`（間距大則延伸補足，間距小則退縮修短），調整後長度需 ≥ 100 mm。
- 變徑的 A 端固定接較寬的一側（`widthStart ≥ widthEnd`），與傳入順序無關。
- 寬度、System、FFL、方向的判斷**不自己寫**，一律沿用 `CT.validateConnections` 與 `CT.buildGraph`；新增的兩條連接必須全為 Valid，Loop / 子網路數不可增加。
- 與 Auto Elbow 共用同一套交易契約（`js/transaction.js`）：驗證失敗時輸入的 blocks / connections 完全不變。

### Auto Elbow 45°（v5.1）

與 90° 共用同一套流程，只有幾何參數不同：

| 彎角 θ | 切線退縮量 T = Rc·tan(θ/2) | Rc=300 時 |
| --- | --- | --- |
| 90° | Rc | 300 mm |
| 45° | Rc × 0.41421 | 124.26 mm |

- 夾角判斷採嚴格容差 ±0.1°（彎頭端點需精確重合），因此 44° / 46° / 30° / 60° 不會被當成 45°。
- 彎頭形狀固定為順時針轉 θ；左轉時自動對調 X / Y，所以左右轉皆可。
- 範例資料沒有 45° 的組合；把兩條直線放成 45° 夾角（例如一條 rotation 0、另一條 rotation 225 且端點朝向交點）再按「偵測 45° 彎頭」即可。

### Transaction 契約（v5.2a）

所有 Auto* 功能共用 `js/transaction.js`，proposal 的欄位與模擬順序固定：

```text
removeConnections → removeBlocks → updateBlocks → addBlocks → addConnections
        ↓
checkProposal（全部在「模擬後的新狀態」上驗證）
        ↓ 通過才 commit；任何失敗 → 原 blocks / connections 完全不變
```

- 不可留下指向不存在 connector 的連接（dangling）。
- 既有（未移除）連接的端點座標不可被移動。
- 被移除的連接必須有對應的 `replaces`，且舊端點 → 新端點座標必須相同；替換後的驗證結果不可比原本差。
- 純新增的連接必須全為 Valid；Loop / 子網路數不可增加。

### Auto Tee（v5.2）

```text
              Branch                     Main-1 ──[A TEE B]── Main-2
                │                                     │C
   Main ────────┼────────      →                   Branch
```

一次交易完成：移除原 Main、新增 Tee / Main-1 / Main-2、Branch 修到 Tee:C、建立 3 條新連接，
並把原 Main 兩端既有的連接「替換」到 Main-1:A / Main-2:B（座標不變）。

- 條件：Main 與 Branch 皆為 Straight，同 System / FFL / Width，夾角 90°（±0.1°），Branch 端點 free。
- Tee 長度 = 2 × 寬度（W300 → 600 mm），中心在交點 J。
- Main-1 = s − L/2、Main-2 = 原長 − s − L/2，兩段都必須 ≥ 100 mm（交點不可太靠近主線端點）。
- Branch 新長度 = 原長度 + t − L/2，同樣需 ≥ 100 mm。
- 主線兩端若已接設備，插入後連接與座標保持不變。

後續可做：Tee 分支寬度不同（自動配 Reducer）、Cross（四通）、支路自動路由。

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
js/transaction.js   Auto* 共用：模擬 / 通用驗證 / 提交（含 remove / replaces）
js/autoelbow.js     Auto Elbow 90° / 45°（proposal / validate / commit）
js/autoreducer.js   v5.0 Auto Reducer
js/autotee.js       v5.2 Auto Tee（拆分主線）
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
