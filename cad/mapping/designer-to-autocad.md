# Designer ↔ AutoCAD 對照規格（CAD Bridge v1）

**狀態：** v1（Manifest CSV 匯出已實作；AutoLISP 自動插圖塊尚未做）
**實作：** `js/cadmanifest.js`　**測試：** `test/core.test.js` 的「CAD Bridge v1」一節

網站（Designer）是資料來源，AutoCAD 動態圖塊是繪圖輸出端；兩邊不各做一套邏輯。
Designer 匯出 Manifest CSV → 在 AutoCAD 人工插入動態圖塊 → 依 CSV 填 LENGTH / WIDTH / 屬性。

---

## 1. Manifest 欄位（固定，不要改名）

```
BLOCK,TRAY_ID,X,Y,ROTATION,LENGTH,WIDTH,FFL,TRAY_HEIGHT,SYSTEM,STATUS
```

| 欄位 | 來源（Designer） | 說明 |
|---|---|---|
| `BLOCK` | `type` | 圖塊名稱，見第 2 節 |
| `TRAY_ID` | `trayId` | 對應圖塊屬性 `TRAY_ID` |
| `X` | `x` | 見第 3 節，不轉換 |
| `Y` | `−y` | 見第 3 節，Y 軸方向相反 |
| `ROTATION` | `normalize(360 − rotation)` | 見第 3 節，單位度，0 ≤ 值 < 360 |
| `LENGTH` | `length` | 只有 Straight / Reducer 有值，見第 5 節 |
| `WIDTH` | `width`（Reducer 為 `widthStart`） | **不自動修正**，見第 6 節 |
| `FFL` | `elevation` | **= Tray 底面高程（mm）**，不是建築完成面標高 |
| `TRAY_HEIGHT` | `trayHeight` | 未設定留空，**不填 0** |
| `SYSTEM` | `system` | |
| `STATUS` | 計算 | `OK` / `NON_STANDARD_WIDTH` / `UNKNOWN_TYPE` |

檔案格式：UTF-8、**無 BOM**、換行 `\n`、欄位含逗號或引號時以雙引號包起來。範例：`cad/examples/block-manifest.csv`。

---

## 2. 元件 → 圖塊名稱

| Designer `type` | AutoCAD 圖塊 |
|---|---|
| `straight` | `SCADA_TRAY_ST` |
| `elbow90` | `SCADA_TRAY_EL90` |
| `elbow45` | `SCADA_TRAY_EL45` |
| `reducer` | `SCADA_TRAY_RED` |
| `tee` | `SCADA_TRAY_TEE` |
| `cross` | `SCADA_TRAY_CROSS` |

---

## 3. 座標與旋轉

Designer 使用 SVG 座標：**Y 向下、旋轉順時針為正**。AutoCAD：**Y 向上、旋轉逆時針為正**。因此：

```text
CAD_X        = Designer.x
CAD_Y        = −Designer.y
CAD_ROTATION = normalize(360 − Designer.rotation)      // 正規化到 0 ≤ θ < 360
```

| Designer rotation | CAD ROTATION |
|---|---|
| 0° | 0° |
| 90° | 270° |
| 180° | 180° |
| 270° | 90° |
| 45° | 315° |

這個轉換已用測試對照真實幾何驗證：以 CAD 原點 + `LENGTH·(cos ROTATION, sin ROTATION)` 算出的 Straight B 端，
等於 Designer 的 B connector 世界座標 `(worldX, −worldY)`（0/30/45/90/135/180/270/315°）。
畫面上「順時針」的彎頭，在 CAD 圖面上仍是順時針（彎向 −Y 側）。

---

## 4. 插入基準點（圖塊必須照這個做）

| 元件 | 基準點 | Designer 的 `x, y` 就是 |
|---|---|---|
| Straight | A connector 中心點 | A 端中心 |
| Reducer | A connector 中心點 | A 端中心 |
| Elbow（90 / 45） | A connector 中心點 | A 端中心 |
| Tee | 中心 J | 中心 J |
| Cross | 中心 J | 中心 J |

圖塊在 `ROTATION = 0` 時的本地座標（CAD，Y 向上）：

- **Straight**：A 在原點，開口朝 −X；B 在 `(LENGTH, 0)`，開口朝 +X。管路中心線沿 X 軸，寬度以中心線對稱（±WIDTH/2）。
- **Reducer**：同 Straight；A 端寬 `WIDTH`，B 端寬另一個值。
- **Elbow**：A 在原點，開口朝 −X；沿順時針彎 θ（90 或 45），B 在 `(Rc·sinθ, −Rc·(1−cosθ))`，
  其中 `Rc = INNER_RADIUS + WIDTH/2`（中心線半徑）；B 的開口朝向為 `−θ`（90° 時朝 −Y）。
- **Tee**：中心在原點；主線沿 X 軸，A 在 `−X` 側、B 在 `+X` 側；分支 C 朝 **−Y**（順時針側）。
- **Cross**：中心在原點；A / B 在 ∓X 側；C 朝 **+Y**、D 朝 **−Y**。

（Designer 內部本地座標的 Y 向下，所以 Designer 的 `+y` 側在 CAD 圖塊裡是 `−Y`。）

---

## 5. LENGTH 的定義

| 元件 | `LENGTH` |
|---|---|
| Straight / Reducer | **中心線長度**（= Designer 的 `length`） |
| Elbow | **留空**。不作為動態拉伸參數；弧長由 `Rc × θ` 決定 |
| Tee / Cross | **留空**。由 fitting 自身的幾何規則決定，不把 Designer 的 route length 當圖塊 LENGTH |

---

## 6. WIDTH 與 STATUS

CAD 標準寬度清單：**100, 200, 300, … 1500**（每 100 一階，共 15 種）。

- Manifest **照實輸出** Designer 的寬度，**不四捨五入、不自動改成最接近的標準值**。
- 不在清單內 → `STATUS = NON_STANDARD_WIDTH`（例如 `W350`、`W150`）。
- Reducer 的 A 端或 B 端寬度任一不在清單內，都會標 `NON_STANDARD_WIDTH`。
- 不支援的元件類型 → `STATUS = UNKNOWN_TYPE`，`BLOCK` 為 `UNKNOWN_<type>`。
- 網站匯出時，介面會提示警告筆數與第一筆說明。

> 注意：`W150` 不在這份清單裡。Designer 範例與許多支線寬度會用到 150，匯出時會被標成 `NON_STANDARD_WIDTH`。
> 這是資料不失真的設計選擇——要不要把 150 加進 CAD 標準清單，是 CAD 端的決定。

---

## 7. `RUNG_SPACING`

`RUNG_SPACING is CAD-side only in bridge v1.`

Designer 沒有這個欄位，Manifest 也不輸出。`SCADA_TRAY_ST` 動態圖塊可以自己預設（例如 300），
但那是 CAD 圖塊的預設值，不是 Designer 資料。

---

## 8. v1 已知限制

- **Reducer 的 B 端寬度不在 Manifest 裡**：欄位只有一個 `WIDTH`（= A 端寬度）。B 端寬度目前只影響 `STATUS` 判斷，
  圖塊需要時得由使用者在 CAD 手動填。若要完整表達，之後需新增欄位（例如 `WIDTH_END`），那會是 Manifest v2。
- Elbow 的 `INNER_RADIUS`、`BEND_ANGLE`（EL90 / EL45 已由圖塊名稱區分角度）不在 Manifest；內半徑目前由 CAD 圖塊自己決定。
- 連接關係（connections）、Route、碰撞結果不在 Manifest；Manifest 只描述「每個圖塊放在哪裡、多大」。
- 不做 AutoLISP、不自動插入 DWG、不改 Designer 資料模型。

---

## 9. 建議驗收（第一顆 `SCADA_TRAY_ST`，1000 × 300）

```text
LENGTH 1000 → 2000         ✓
WIDTH 300 → 600            ✓
左端（A 端）基準點不移動    ✓
TRAY_ID / FFL / TRAY_HEIGHT / SYSTEM 屬性正常   ✓
```

先用 Manifest 的 Straight 驗證尺寸、方向、插入基準點與 Designer 一致，再做 Elbow / Reducer / Tee / Cross，最後才考慮 AutoLISP 自動化。
