/**
 * cadmanifest.js — CAD Bridge v1：輸出 AutoCAD 動態圖塊用的 Manifest CSV
 *
 * Designer 是資料來源，AutoCAD 圖塊是繪圖輸出端；這裡只做「資料 → 圖塊資料」的轉換，
 * 不新增 Designer 資料模型（RUNG_SPACING 只存在於 CAD 端）。規格見 cad/mapping/designer-to-autocad.md。
 *
 * 欄位（固定）：BLOCK,TRAY_ID,X,Y,ROTATION,LENGTH,WIDTH,FFL,TRAY_HEIGHT,SYSTEM,STATUS
 *
 * 座標 / 旋轉（Designer 為 SVG：y 向下、旋轉順時針為正；AutoCAD：y 向上、旋轉逆時針為正）：
 *   CAD_X        = Designer.x
 *   CAD_Y        = −Designer.y
 *   CAD_ROTATION = normalize(360 − Designer.rotation)      例：90° → 270°、270° → 90°
 *
 * 插入基準點：Straight / Reducer / Elbow = A connector 中心點；Tee / Cross = 中心 J（Designer 的 x, y 就是這些點）。
 * LENGTH：Straight / Reducer = 中心線長度；Elbow / Tee / Cross 留空（由圖塊自身的 fitting 幾何決定）。
 * WIDTH：不自動修正。不在標準清單（100…1500，每 100）的寬度照實輸出，STATUS = NON_STANDARD_WIDTH。
 * TRAY_HEIGHT：未設定留空，不填 0。
 */
(function (root) {
  const CT = (root.CT = root.CT || {});

  CT.CAD_BLOCKS = {
    straight: "SCADA_TRAY_ST",
    elbow90: "SCADA_TRAY_EL90",
    elbow45: "SCADA_TRAY_EL45",
    reducer: "SCADA_TRAY_RED",
    tee: "SCADA_TRAY_TEE",
    cross: "SCADA_TRAY_CROSS",
  };
  CT.CAD_HEADER = ["BLOCK", "TRAY_ID", "X", "Y", "ROTATION", "LENGTH", "WIDTH", "FFL", "TRAY_HEIGHT", "SYSTEM", "STATUS"];
  CT.CAD_STANDARD_WIDTHS = Array.from({ length: 15 }, (_, i) => (i + 1) * 100); // 100 … 1500

  /** 數字輸出：最多 2 位小數、去掉尾端 0、避免 "-0" */
  const num = (v) => {
    const r = Math.round(v * 100) / 100;
    return String(r === 0 ? 0 : r);
  };

  CT.cadY = (y) => -y;
  CT.cadRotation = (designerRotation) => CT.normDeg(360 - designerRotation);

  /** 單一元件 → Manifest 一列（陣列，順序同 CT.CAD_HEADER） */
  CT.cadRow = function (b) {
    const isLinear = b.type === "straight" || b.type === "reducer";
    const width = b.type === "reducer" ? b.widthStart : b.width; // Reducer：WIDTH = A 端寬度（B 端寬度 v1 不輸出）
    const widths = b.type === "reducer" ? [b.widthStart, b.widthEnd] : [b.width];
    const status = widths.every((w) => CT.CAD_STANDARD_WIDTHS.includes(w)) ? "OK" : "NON_STANDARD_WIDTH";
    return [
      CT.CAD_BLOCKS[b.type] || `UNKNOWN_${b.type}`,
      b.trayId,
      num(b.x),
      num(CT.cadY(b.y)),
      num(CT.cadRotation(b.rotation)),
      isLinear ? num(b.length) : "",
      num(width),
      num(b.elevation),
      CT.hasHeight(b) ? num(b.trayHeight) : "",
      b.system,
      CT.CAD_BLOCKS[b.type] ? status : "UNKNOWN_TYPE",
    ];
  };

  /**
   * 產生 Manifest。回傳 { csv, rows, warnings }：
   *   csv：UTF-8 文字（不含 BOM，方便 AutoLISP 直接讀第一列）；
   *   warnings：STATUS 非 OK 的元件說明，給介面提示用。
   */
  CT.toCadManifest = function (blocks) {
    const rows = blocks.map(CT.cadRow);
    const warnings = [];
    rows.forEach((r, i) => {
      if (r[10] === "NON_STANDARD_WIDTH") warnings.push(`${r[1]}：寬度 W${r[6]}${blocks[i].type === "reducer" ? `→W${blocks[i].widthEnd}` : ""} 不在標準清單（100…1500，每 100），未修正`);
      if (r[10] === "UNKNOWN_TYPE") warnings.push(`${r[1]}：不支援的元件類型 ${blocks[i].type}`);
    });
    const csv = [CT.CAD_HEADER, ...rows].map((r) => r.map(CT.csvCell).join(",")).join("\n") + "\n";
    return { csv, rows, warnings };
  };

  if (typeof module !== "undefined") module.exports = CT;
})(globalThis);
