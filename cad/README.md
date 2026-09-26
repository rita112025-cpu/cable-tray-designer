# cad/ — AutoCAD 動態圖塊橋接（CAD Bridge v1）

Cable Tray Designer 負責**配置、檢查、算資料**；AutoCAD 動態圖塊負責**正式圖面**（圖層、線型、標註、出圖、人工微調）。
兩邊不各做一套邏輯：網站是資料來源，圖塊是繪圖輸出端。

```text
Cable Tray Designer ──匯出──▶ CAD Manifest CSV ──人工──▶ AutoCAD 動態圖塊
```

## 內容

| 檔案 | 說明 |
|---|---|
| [`mapping/designer-to-autocad.md`](mapping/designer-to-autocad.md) | **規格**：欄位、圖塊名稱、座標 / 旋轉轉換、插入基準點、LENGTH / WIDTH / STATUS 定義 |
| [`examples/block-manifest.csv`](examples/block-manifest.csv) | 用 Designer 的範例資料實際匯出的 Manifest |

## 使用

1. 在網站左側按 **CAD Manifest CSV**，下載 `cad-manifest.csv`。
2. 在 AutoCAD 依每一列插入對應圖塊（`BLOCK`），插入點 `(X, Y)`，旋轉 `ROTATION`。
3. 填動態參數 `LENGTH` / `WIDTH`，以及屬性 `TRAY_ID` / `SYSTEM` / `FFL` / `TRAY_HEIGHT`。
4. `STATUS` 不是 `OK` 的列要先確認（例如寬度不在標準清單）。

## 這一版做的與不做的

做：規格文件、Manifest CSV 匯出、座標與旋轉轉換、非標準寬度警告。

不做：AutoLISP、自動插入 DWG、改 Designer 資料模型、新增 `RUNG_SPACING`（**CAD-side only**）。

## 關鍵約定（詳見規格）

- `CAD_Y = −y`；`CAD_ROTATION = normalize(360 − rotation)`（Designer 順時針為正、AutoCAD 逆時針為正）。
- 插入基準點：Straight / Reducer / Elbow = **A 端中心點**；Tee / Cross = **中心 J**。
- `FFL` = **Tray 底面高程**，不是建築完成面標高。
- 寬度不自動修正；不在標準清單（100…1500，每 100）→ `STATUS = NON_STANDARD_WIDTH`。
- `TRAY_HEIGHT` 未設定留空，不填 0。
