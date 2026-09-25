/**
 * graph.js — Connector 圖模型與 Route 搜尋
 *
 * 節點：每個 Connector（"blockId:connId"），Tee/Cross 另加虛擬 Junction 節點（"blockId:J"）。
 * 邊：
 *   - internal：元件內部（Straight/Reducer/Elbow 的 A↔B，權重 = 中心線長度）
 *   - internal：Tee/Cross 的「各 Connector ↔ J」星型（權重 0，避免兩兩相連造成假 Loop）
 *   - external：使用者建立的 Connection（權重 0）
 */
(function (root) {
  const CT = (root.CT = root.CT || {});

  CT.buildGraph = function (blocks, connections) {
    const nodes = new Map();
    const adj = new Map();
    const edges = [];
    const link = (a, b) => { adj.get(a).add(b); adj.get(b).add(a); };

    blocks.forEach((b) => {
      b.connectors.forEach((k) => {
        const id = `${b.id}:${k.id}`;
        nodes.set(id, {
          id, blockId: b.id, connId: k.id,
          worldX: k.worldX, worldY: k.worldY, dir: k.worldDir,
          system: b.system, width: CT.effectiveWidth(b, k.id), elevation: b.elevation,
          occupiedCount: 0,
        });
        adj.set(id, new Set());
      });
      if (b.type === "tee" || b.type === "cross") {
        const n = b.connectors.length || 1;
        const jx = b.connectors.reduce((s, k) => s + k.worldX, 0) / n;
        const jy = b.connectors.reduce((s, k) => s + k.worldY, 0) / n;
        const id = `${b.id}:J`;
        nodes.set(id, {
          id, blockId: b.id, connId: "J", worldX: jx, worldY: jy, dir: 0,
          system: b.system, width: b.width, elevation: b.elevation, occupiedCount: 0, isJunction: true,
        });
        adj.set(id, new Set());
      }
    });

    connections.forEach((c) => {
      [c.from, c.to].forEach((k) => {
        const n = nodes.get(k);
        if (n) n.occupiedCount++;
      });
    });

    blocks.forEach((b) => {
      const ids = b.connectors.map((k) => `${b.id}:${k.id}`);
      if (b.type === "tee" || b.type === "cross") {
        const j = `${b.id}:J`;
        ids.forEach((k) => {
          edges.push({ id: `int-${k}-${j}`, from: k, to: j, type: "internal", blockId: b.id, weight: 0 });
          link(k, j);
        });
      } else if (ids.length === 2) {
        edges.push({ id: `int-${ids[0]}-${ids[1]}`, from: ids[0], to: ids[1], type: "internal", blockId: b.id, weight: CT.centerlineLength(b) });
        link(ids[0], ids[1]);
      }
    });

    connections.forEach((c) => {
      if (!nodes.has(c.from) || !nodes.has(c.to)) return;
      edges.push({ id: c.id, from: c.from, to: c.to, type: "external", weight: 0 });
      link(c.from, c.to);
    });

    // 孤立元件：沒有出現在任何 connection
    const linked = new Set();
    connections.forEach((c) => { linked.add(c.from.split(":")[0]); linked.add(c.to.split(":")[0]); });
    const isolatedBlocks = blocks.filter((b) => !linked.has(b.id)).map((b) => b.id);

    // 子網路（BFS）
    const seen = new Set();
    const subgraphs = [];
    nodes.forEach((_, start) => {
      if (seen.has(start)) return;
      const q = [start];
      const comp = [];
      seen.add(start);
      while (q.length) {
        const cur = q.shift();
        comp.push(cur);
        adj.get(cur).forEach((nb) => { if (!seen.has(nb)) { seen.add(nb); q.push(nb); } });
      }
      subgraphs.push(comp);
    });

    // Loop 數 = 邊數 - 節點數 + 連通分量數（cyclomatic number）
    const uniqueEdges = new Set();
    adj.forEach((set, a) => set.forEach((b) => uniqueEdges.add(a < b ? `${a}|${b}` : `${b}|${a}`)));
    const loopCount = Math.max(0, uniqueEdges.size - nodes.size + subgraphs.length);

    const totalCenterline = blocks.reduce((s, b) => s + CT.centerlineLength(b), 0);
    return { nodes, edges, adj, isolatedBlocks, isolatedCount: isolatedBlocks.length, subgraphs, subgraphCount: subgraphs.length, loopCount, totalCenterline };
  };

  /**
   * 找出所有端點到端點的 Route（DFS）。
   * 起點為度數 1 的節點；沒有端點（純環）時取第一個節點。
   */
  CT.getAllRoutes = function (graph, blocks, { maxDepth = 30, maxRoutes = 50 } = {}) {
    const { adj, nodes, edges } = graph;
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const edgeOf = new Map();
    edges.forEach((e) => { edgeOf.set(`${e.from}|${e.to}`, e); edgeOf.set(`${e.to}|${e.from}`, e); });

    const ends = [];
    adj.forEach((set, id) => { if (set.size === 1) ends.push(id); });
    if (!ends.length && nodes.size) ends.push(nodes.keys().next().value);

    const routes = [];
    const seen = new Set();
    for (const start of ends) {
      const stack = [{ node: start, path: [start], visited: new Set([start]), blocks: new Set(), length: 0, steps: [] }];
      while (stack.length && routes.length < maxRoutes) {
        const cur = stack.pop();
        if (cur.path.length > 1 && ends.includes(cur.node) && cur.node !== start) {
          const key = [...cur.path].sort().join("|");
          if (!seen.has(key)) {
            seen.add(key);
            routes.push({ id: `R${routes.length + 1}`, path: cur.path, blocks: [...cur.blocks], length: cur.length, steps: cur.steps });
          }
          continue;
        }
        if (cur.path.length >= maxDepth) continue;
        for (const next of adj.get(cur.node) || []) {
          if (cur.visited.has(next)) continue;
          const e = edgeOf.get(`${cur.node}|${next}`);
          let add = 0;
          const steps = [...cur.steps];
          const usedBlocks = new Set(cur.blocks);
          if (e && e.type === "internal" && !usedBlocks.has(e.blockId)) {
            const b = byId.get(e.blockId);
            add = e.weight;
            if (b) steps.push({ blockId: b.id, trayId: b.trayId, type: b.type, length: add });
          }
          if (e && e.blockId) usedBlocks.add(e.blockId);
          stack.push({ node: next, path: [...cur.path, next], visited: new Set([...cur.visited, next]), blocks: usedBlocks, length: cur.length + add, steps });
        }
      }
    }
    return routes.sort((a, b) => b.length - a.length);
  };

  if (typeof module !== "undefined") module.exports = CT;
})(globalThis);
