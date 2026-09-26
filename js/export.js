/**
 * export.js — 2D 草圖 DXF / CSV BOM / JSON Graph
 *
 * DXF 內容：LWPOLYLINE（元件輪廓）、TEXT、LINE（Connection，圖層 TRAY-LINK）、LAYER 表。
 * 不含：BLOCK / INSERT / DIMENSION / 3D / Z。
 */
(function (root) {
  const CT = (root.CT = root.CT || {});

  CT.DXF_LAYERS = ["TRAY", "TRAY-CTR", "TRAY-TEXT", "TRAY-LINK", "SCADA", "POWER", "CONTROL", "TELECOM", "GENERAL"];

  CT.toDXF = function (blocks, connections) {
    const out = [];
    const put = (...pairs) => pairs.forEach((p) => out.push(String(p)));
    put(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1014", 0, "ENDSEC");

    put(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 70, CT.DXF_LAYERS.length);
    CT.DXF_LAYERS.forEach((name) => {
      const color = CT.SYSTEM_COLORS[name] || 7;
      put(0, "LAYER", 2, name, 70, 0, 62, color, 6, "CONTINUOUS");
    });
    put(0, "ENDTAB", 0, "ENDSEC");

    put(0, "SECTION", 2, "ENTITIES");
    blocks.forEach((b) => {
      const layer = CT.DXF_LAYERS.includes(b.system) ? b.system : "TRAY";
      CT.worldOutlines(b).forEach((poly) => {
        put(0, "LWPOLYLINE", 8, layer, 90, poly.length, 70, 1);
        poly.forEach(([x, y]) => put(10, x.toFixed(2), 20, (-y).toFixed(2))); // SVG y 向下 → CAD y 向上
      });
      const label = `${b.trayId} W${b.type === "reducer" ? `${b.widthStart}>${b.widthEnd}` : b.width} FFL+${b.elevation}${CT.hasHeight(b) ? ` H${b.trayHeight}` : ""} [${b.system}]${b.from || b.to ? ` ${b.from}>${b.to}` : ""}`;
      put(0, "TEXT", 8, "TRAY-TEXT", 10, b.x.toFixed(2), 20, (-(b.y - b.width / 2 - 30)).toFixed(2), 40, 40, 1, label);
    });
    connections.forEach((c) => {
      const A = CT.endpointOf(blocks, c.from);
      const B = CT.endpointOf(blocks, c.to);
      if (!A || !B) return;
      put(0, "LINE", 8, "TRAY-LINK", 10, A.k.worldX.toFixed(2), 20, (-A.k.worldY).toFixed(2), 11, B.k.worldX.toFixed(2), 21, (-B.k.worldY).toFixed(2));
    });
    put(0, "ENDSEC", 0, "EOF");
    return out.join("\n") + "\n";
  };

  const csvCell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  CT.csvCell = csvCell;

  CT.toCSV = function (blocks) {
    const head = ["Tray ID", "Type", "System", "WidthStart", "WidthEnd", "Length(mm)", "CenterlineLength(mm)", "FFL(Tray底面高程)", "TrayHeight", "From", "To", "Remark"];
    const rows = blocks.map((b) => [
      b.trayId, b.type, b.system,
      b.type === "reducer" ? b.widthStart : b.width,
      b.type === "reducer" ? b.widthEnd : b.width,
      b.length, CT.centerlineLength(b).toFixed(3), b.elevation, CT.hasHeight(b) ? b.trayHeight : "", b.from, b.to, b.remark,
    ]);
    // 加 BOM 讓 Excel 正確辨識 UTF-8
    return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  };

  CT.toJSON = function (blocks, connections, graph) {
    return JSON.stringify({
      blocks: blocks.map((b) => ({ ...b, centerlineLength: CT.centerlineLength(b) })),
      connections,
      graphStats: {
        totalBlocks: blocks.length, totalConnections: connections.length,
        isolatedBlocks: graph.isolatedBlocks, subgraphCount: graph.subgraphCount,
        loopCount: graph.loopCount, totalCenterline: graph.totalCenterline,
      },
    }, null, 2);
  };

  if (typeof module !== "undefined") module.exports = CT;
})(globalThis);
