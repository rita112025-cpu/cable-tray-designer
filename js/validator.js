/**
 * validator.js — 外部 Connection 驗證
 *
 * 只比較「實際被接在一起的兩個 Connector」：
 *   占用 / 自迴路 / System / FFL / Tray Height（兩側都有設定才比較）/ 端點有效寬 / 方向。
 * Reducer 本身是否合理（起終同寬）屬於元件內部檢查，見 CT.validateComponent。
 */
(function (root) {
  const CT = (root.CT = root.CT || {});

  CT.validateConnections = function (blocks, connections) {
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const use = new Map();
    connections.forEach((c) => {
      use.set(c.from, (use.get(c.from) || 0) + 1);
      use.set(c.to, (use.get(c.to) || 0) + 1);
    });

    const results = [];
    connections.forEach((c) => {
      const [bi, ki] = c.from.split(":");
      const [bj, kj] = c.to.split(":");
      const A = byId.get(bi);
      const B = byId.get(bj);
      if (!A || !B) return;
      const ca = A.connectors.find((k) => k.id === ki);
      const cb = B.connectors.find((k) => k.id === kj);
      if (!ca || !cb) return;

      const checks = [];
      const add = (name, status, detail) => checks.push({ name, status, detail });

      if (bi === bj) add("自迴路", "Invalid", "Self-loop 不允許自連");
      [c.from, c.to].forEach((k) => {
        if ((use.get(k) || 0) > 1) add("占用檢查", "Invalid", `Connector 已占用：${k} 被多次連接`);
      });

      if (A.system !== B.system) add("系統一致", "Warning", `System 不一致：${A.system} vs ${B.system}`);
      else add("系統一致", "Valid", `System 一致 ${A.system}`);

      if (A.elevation !== B.elevation) add("高程一致", "Warning", `FFL 不一致：+${A.elevation} vs +${B.elevation}`);
      else add("高程一致", "Valid", `FFL 一致 +${A.elevation}`);

      // Tray Height（v5.9）：兩側都有設定才比較；任一未設定 → 不判定、不 Warning。
      // 用 Warning 而非 Invalid：不同高度不一定不能接（可能有變高接頭 / 轉接件），
      // 但目前模型沒有這類 fitting，所以只提示，不嘗試自動處理。
      if (CT.hasHeight(A) && CT.hasHeight(B)) {
        if (A.trayHeight !== B.trayHeight) add("高度一致", "Warning", `Tray Height 不一致：H${A.trayHeight} vs H${B.trayHeight}（目前沒有變高接頭 / 轉接件模型，僅提示）`);
        else add("高度一致", "Valid", `Tray Height 一致 H${A.trayHeight}`);
      }

      const wa = CT.effectiveWidth(A, ki);
      const wb = CT.effectiveWidth(B, kj);
      const hasReducer = A.type === "reducer" || B.type === "reducer";
      if (wa !== wb) {
        if (hasReducer) add("寬度匹配", "Invalid", `Endpoint 寬度不匹配 W${wa}≠W${wb}（${A.trayId}:${ki} ↔ ${B.trayId}:${kj}）`);
        else add("寬度匹配", "Warning", `Width mismatch W${wa}→W${wb}，建議插入 Reducer（${A.trayId}:${ki} ↔ ${B.trayId}:${kj}）`);
      } else {
        add("寬度匹配", "Valid", `寬度一致 W${wa}（${A.trayId}:${ki} ↔ ${B.trayId}:${kj}）`);
      }

      // 兩個 Connector 的朝外方向應相反（差 180°）
      const off = CT.angleBetween(ca.worldDir + 180, cb.worldDir);
      if (off > 15) add("方向檢查", "Warning", `方向不合理：偏離相對 ${off.toFixed(1)}°`);
      else add("方向檢查", "Valid", `方向正確 偏差 ${off.toFixed(1)}°`);

      const overall = checks.some((x) => x.status === "Invalid") ? "Invalid" : checks.some((x) => x.status === "Warning") ? "Warning" : "Valid";
      results.push({ id: c.id, from: c.from, to: c.to, fromBlock: A, toBlock: B, checks, overall });
    });
    return results;
  };

  /** 元件內部檢查 */
  CT.validateComponent = function (b) {
    const out = [];
    if (b.type === "reducer" && b.widthStart === b.widthEnd) out.push(`變徑起終同寬 W${b.widthStart}→W${b.widthEnd}`);
    if ((b.type === "straight" || b.type === "reducer") && !(b.length > 0)) out.push("長度必須大於 0");
    return out;
  };

  if (typeof module !== "undefined") module.exports = CT;
})(globalThis);
