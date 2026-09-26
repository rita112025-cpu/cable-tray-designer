/**
 * geometry.js — 元件資料模型、Connector 世界座標、中心線長度、輪廓
 *
 * 座標系：SVG（x 向右、y 向下），角度單位為度，dir 90° = 朝下（+y）。
 * 每個元件有區域座標，經 rotation 旋轉後平移到 (x, y)。
 */
(function (root) {
  const CT = (root.CT = root.CT || {});

  CT.SYSTEMS = ["SCADA", "POWER", "CONTROL", "TELECOM", "GENERAL"];
  CT.SYSTEM_COLORS = { SCADA: 3, POWER: 1, CONTROL: 5, TELECOM: 4, GENERAL: 7 }; // DXF ACI 色號

  const rad = (d) => (d * Math.PI) / 180;
  const normDeg = (d) => ((d % 360) + 360) % 360;
  /** 兩方向的最小夾角 0..180 */
  const angleBetween = (a, b) => {
    const d = Math.abs(normDeg(a) - normDeg(b));
    return d > 180 ? 360 - d : d;
  };
  CT.rad = rad;
  CT.normDeg = normDeg;
  CT.angleBetween = angleBetween;

  /** Tray 高度是否已設定（> 0 才視為有效） */
  CT.hasHeight = (b) => Number.isFinite(b.trayHeight) && b.trayHeight > 0;
  /** 兩個元件之間的過渡件（Elbow / Reducer）高度：兩邊都有值取較大者，任一未知則未知 */
  CT.combineHeight = (a, b) => (a > 0 && b > 0 ? Math.max(a, b) : null);
  /** Z 區間：底面 = elevation，頂面 = elevation + trayHeight；高度未知回傳 null */
  CT.zRange = (b) => (CT.hasHeight(b) ? [b.elevation, b.elevation + b.trayHeight] : null);

  /** 彎頭中心線半徑 Rc = 內半徑 + 寬度/2 */
  CT.centerlineRadius = (b) => b.innerRadius + b.width / 2;

  /** Connector 的有效寬度：變徑 A 端 = widthStart、B 端 = widthEnd */
  CT.effectiveWidth = function (block, connId) {
    if (block.type === "reducer") {
      if (connId === "A") return block.widthStart;
      if (connId === "B") return block.widthEnd;
    }
    return block.width;
  };

  /** 元件自身的中心線長度（Tee/Cross 視為節點，權重 0） */
  CT.centerlineLength = function (b) {
    if (b.type === "straight" || b.type === "reducer") return b.length;
    if (b.type === "elbow90" || b.type === "elbow45") {
      return CT.centerlineRadius(b) * rad(b.bendAngle);
    }
    return 0;
  };

  /** 區域座標的 Connector 定義 */
  function localConnectors(b) {
    switch (b.type) {
      case "straight":
      case "reducer":
        return [
          { id: "A", x: 0, y: 0, dir: 180 },
          { id: "B", x: b.length, y: 0, dir: 0 },
        ];
      case "elbow90":
      case "elbow45": {
        // 圓心在 (0, Rc)，A 在 (0,0) 朝 180°，B 為順時針轉 bendAngle 之後的端點
        const rc = CT.centerlineRadius(b);
        const t = rad(b.bendAngle);
        return [
          { id: "A", x: 0, y: 0, dir: 180 },
          { id: "B", x: rc * Math.sin(t), y: rc * (1 - Math.cos(t)), dir: b.bendAngle },
        ];
      }
      case "tee":
        return [
          { id: "A", x: -b.length / 2, y: 0, dir: 180 },
          { id: "B", x: b.length / 2, y: 0, dir: 0 },
          { id: "C", x: 0, y: b.length / 2, dir: 90 },
        ];
      case "cross":
        return [
          { id: "A", x: -b.length / 2, y: 0, dir: 180 },
          { id: "B", x: b.length / 2, y: 0, dir: 0 },
          { id: "C", x: 0, y: -b.length / 2, dir: 270 },
          { id: "D", x: 0, y: b.length / 2, dir: 90 },
        ];
      default:
        return [];
    }
  }

  /** 區域點 → 世界點 */
  CT.toWorld = function (b, lx, ly) {
    const r = rad(b.rotation);
    const c = Math.cos(r);
    const s = Math.sin(r);
    return { x: b.x + c * lx - s * ly, y: b.y + s * lx + c * ly };
  };

  /** 計算並回傳含世界座標的 connectors 陣列 */
  CT.computeConnectors = function (b) {
    return localConnectors(b).map((k) => {
      const w = CT.toWorld(b, k.x, k.y);
      return { ...k, worldX: w.x, worldY: w.y, worldDir: normDeg(k.dir + b.rotation) };
    });
  };

  /** 回傳「重新計算 connectors 後」的新元件（不修改原物件） */
  CT.refresh = (b) => ({ ...b, connectors: CT.computeConnectors(b) });

  CT.createBlock = function (type, o = {}) {
    const b = {
      id: "B1",
      trayId: "T-01",
      type,
      system: "SCADA",
      width: 300,
      widthStart: 300,
      widthEnd: type === "reducer" ? 200 : 300,
      length: type === "tee" || type === "cross" ? 600 : type.startsWith("elbow") ? 600 : 1000,
      innerRadius: 300,
      bendAngle: type === "elbow45" ? 45 : 90,
      rotation: 0,
      x: 0,
      y: 0,
      elevation: 2700, // 本工具中的 FFL 欄位 = Tray 底面高程（mm）
      trayHeight: null, // Tray 本體高度（mm）；null / 0 = 未知，碰撞檢查沿用「同 FFL」規則
      from: "",
      to: "",
      remark: "",
      ...o,
    };
    return CT.refresh(b);
  };

  /**
   * 區域座標的輪廓多邊形（可能多個，皆為封閉）。
   * SVG 繪圖與 DXF LWPOLYLINE 共用同一份，避免兩邊不一致。
   */
  CT.outlines = function (b) {
    const hw = b.width / 2;
    switch (b.type) {
      case "straight":
        return [[[0, -hw], [b.length, -hw], [b.length, hw], [0, hw]]];
      case "reducer":
        return [[[0, -b.widthStart / 2], [b.length, -b.widthEnd / 2], [b.length, b.widthEnd / 2], [0, b.widthStart / 2]]];
      case "elbow90":
      case "elbow45": {
        const rc = CT.centerlineRadius(b);
        const t = rad(b.bendAngle);
        const n = 16;
        const outer = [];
        const inner = [];
        for (let i = 0; i <= n; i++) {
          const p = (t * i) / n;
          outer.push([(rc + hw) * Math.sin(p), rc - (rc + hw) * Math.cos(p)]);
          inner.push([(rc - hw) * Math.sin(p), rc - (rc - hw) * Math.cos(p)]);
        }
        return [outer.concat(inner.reverse())];
      }
      case "tee":
        return [
          [[-b.length / 2, -hw], [b.length / 2, -hw], [b.length / 2, hw], [-b.length / 2, hw]],
          [[-hw, 0], [hw, 0], [hw, b.length / 2], [-hw, b.length / 2]],
        ];
      case "cross":
        return [
          [[-b.length / 2, -hw], [b.length / 2, -hw], [b.length / 2, hw], [-b.length / 2, hw]],
          [[-hw, -b.length / 2], [hw, -b.length / 2], [hw, b.length / 2], [-hw, b.length / 2]],
        ];
      default:
        return [];
    }
  };

  /** 世界座標的輪廓 */
  CT.worldOutlines = (b) => CT.outlines(b).map((poly) => poly.map(([x, y]) => {
    const w = CT.toWorld(b, x, y);
    return [w.x, w.y];
  }));

  if (typeof module !== "undefined") module.exports = CT;
})(globalThis);
