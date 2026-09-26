/** sample.js — 範例資料：涵蓋合法連接、寬度/FFL 警告、變徑、Tee，以及一組可自動插彎頭的 L 型 */
(function (root) {
  const CT = (root.CT = root.CT || {});

  CT.sampleBlocks = function () {
    const mk = (id, trayId, type, o) => CT.createBlock(type, { id, trayId, ...o });
    return [
      mk("B1", "T-01", "straight", { x: 80, y: 180, length: 1000, from: "MCC-01", to: "JB-01" }),
      mk("B2", "T-02", "straight", { system: "POWER", width: 100, x: 1200, y: 220, length: 800, from: "JB-01", to: "JB-02", remark: "寬度/System 不同測試" }),
      mk("B3", "E-01", "elbow90", { x: 2100, y: 220, from: "JB-02", to: "JB-03", remark: "90 度彎頭" }),
      mk("B4", "T-03", "straight", { x: 2550, y: 670, rotation: 90, length: 400, elevation: 3200, from: "JB-03", to: "MCC-02", remark: "FFL 不同測試" }),
      mk("B5", "R-01", "reducer", { widthStart: 300, widthEnd: 200, x: 80, y: 500, length: 600, from: "MCC-01", to: "JB-04" }),
      mk("B6", "T-04", "straight", { width: 200, x: 800, y: 500, length: 700, from: "JB-04", to: "JB-05" }),
      mk("B7", "TEE-01", "tee", { x: 1900, y: 650, from: "JB-06", to: "JB-07", remark: "三通" }),
      // 自動彎頭候選：B8 朝右、B9 朝下，交於 (1080, 1050)
      mk("B8", "T-AUTO-01", "straight", { innerRadius: 150, x: 80, y: 1050, length: 800, from: "MCC-AUTO", remark: "v4 Auto Elbow 候選" }),
      mk("B9", "T-AUTO-02", "straight", { innerRadius: 150, x: 1080, y: 600, rotation: 90, length: 300, to: "JB-AUTO", remark: "v4 Auto Elbow 候選" }),
      // 自動變徑候選：W200 與 W150 同軸相對、間距 250mm
      mk("B10", "T-AUTO-03", "straight", { width: 200, x: 1200, y: 1090, length: 250, from: "AUTO-R1", remark: "v5 Auto Reducer 候選" }),
      mk("B11", "T-AUTO-04", "straight", { width: 150, x: 1950, y: 1090, rotation: 180, length: 250, to: "AUTO-R2", remark: "v5 Auto Reducer 候選" }),
      // 自動三通候選：CONTROL 系統（與其他元件隔離，避免被其他偵測誤配）。
      // 主線 B12 水平；分支 B13 從下方垂直朝向主線中段（J=(2100,1350)）
      mk("B12", "T-AUTO-05", "straight", { system: "CONTROL", x: 1500, y: 1350, length: 1200, from: "MCC-CTL", to: "JB-CTL", remark: "v5.2 Auto Tee 主線" }),
      mk("B13", "T-AUTO-06", "straight", { system: "CONTROL", x: 2100, y: 1800, rotation: 270, length: 300, from: "FIELD-CTL", remark: "v5.2 Auto Tee 分支" }),
    ];
  };

  CT.sampleConnections = () => [
    { id: "C1", from: "B1:B", to: "B2:A" },
    { id: "C2", from: "B2:B", to: "B3:A" },
    { id: "C3", from: "B3:B", to: "B4:A" },
    { id: "C4", from: "B5:B", to: "B6:A" },
  ];

  if (typeof module !== "undefined") module.exports = CT;
})(globalThis);
