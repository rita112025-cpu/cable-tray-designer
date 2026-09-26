/**
 * collision.js — v5.5 實體輪廓重疊檢查
 *
 * 目的：Auto Elbow / Reducer / Tee / Cross 在數學與連接上都合法時，
 * 仍可能讓新元件的輪廓壓到別的 Tray。這裡提供純幾何判斷，並由共用的
 * CT.checkProposal 在 commit 前一起套用（四個 Auto 功能不各自實作）。
 *
 * 判定規則：
 *   - 只比較「同 FFL」的元件（同高程平面碰撞）。FFL 不同視為不同平面，不判定為碰撞。
 *     這不代表不同 FFL 一定沒有 3D 干涉：Tray 高度、支架與垂直淨空都沒有建模，所以無法驗證上下淨空；
 *     也不設「高程差多少算安全」的門檻（沒有資料依據，會是假精度）。
 *   - 只有「面積重疊」才算：兩個凸多邊形沿所有分離軸的穿透深度都 > OVERLAP_TOL（1 mm）。
 *     共邊 / 端點相接（穿透深度 ≈ 0）不算，所以已連接的相鄰元件不會誤報。
 *   - 同一元件內部不比較（Tee / Cross 的兩根臂本來就相交）。
 *   - 只擋「提案新增的重疊」：專案裡原本就重疊的舊問題不會讓所有提案失敗。
 *     Tee / Cross 拆出來的 Main-1 / Main-2 以 proposal.derives 對應回原 Main，
 *     所以原 Main 既有的重疊會被視為既有，不算新增。
 *
 * 形狀：Straight / Reducer / Tee / Cross 的輪廓本身就是凸多邊形（Tee / Cross 是兩塊）；
 * Elbow 是圓環扇形（凹），拆成相鄰的小四邊形逐塊比較，因此不是用外接框判斷。
 */
(function (root) {
  const CT = (root.CT = root.CT || {});

  const OVERLAP_TOL = 1; // mm，穿透深度超過才算重疊
  CT.OVERLAP_TOL = OVERLAP_TOL;

  /** 元件的碰撞形狀：凸多邊形陣列（世界座標） */
  CT.collisionShapes = function (b) {
    const polys = CT.worldOutlines(b);
    if (b.type === "elbow90" || b.type === "elbow45") {
      // outlines 為 outer[0..n] + inner[n..0]；拆成 n 個凸四邊形
      const ring = polys[0];
      const n = ring.length / 2 - 1;
      const outer = ring.slice(0, n + 1);
      const inner = ring.slice(n + 1).reverse();
      const quads = [];
      for (let i = 0; i < n; i++) quads.push([outer[i], outer[i + 1], inner[i + 1], inner[i]]);
      return quads;
    }
    return polys;
  };

  const bbox = (polys) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    polys.forEach((p) => p.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
    return { x0, y0, x1, y1 };
  };

  /** 兩個凸多邊形的穿透深度（SAT）：分離或剛好相接回傳 0 */
  CT.penetrationDepth = function (A, B) {
    let min = Infinity;
    for (const poly of [A, B]) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        let nx = q[1] - p[1];
        let ny = p[0] - q[0];
        const len = Math.hypot(nx, ny);
        if (len < 1e-9) continue;
        nx /= len; ny /= len;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        A.forEach(([x, y]) => { const d = x * nx + y * ny; a0 = Math.min(a0, d); a1 = Math.max(a1, d); });
        B.forEach(([x, y]) => { const d = x * nx + y * ny; b0 = Math.min(b0, d); b1 = Math.max(b1, d); });
        const overlap = Math.min(a1, b1) - Math.max(a0, b0);
        if (overlap <= 0) return 0;
        min = Math.min(min, overlap);
      }
    }
    return min === Infinity ? 0 : min;
  };

  /** 兩個元件的最大穿透深度（各凸塊兩兩比較）；不重疊回傳 0 */
  CT.blockPenetration = function (a, b) {
    const sa = CT.collisionShapes(a);
    const sb = CT.collisionShapes(b);
    let best = 0;
    for (const pa of sa) for (const pb of sb) best = Math.max(best, CT.penetrationDepth(pa, pb));
    return best;
  };

  /** 找出所有「同 FFL 且面積重疊」的元件對：[{a, b, depth}]（同一元件內部不比較） */
  CT.findOverlaps = function (blocks, tol = OVERLAP_TOL) {
    const boxes = blocks.map((b) => bbox(CT.collisionShapes(b)));
    const out = [];
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const p = boxes[i], q = boxes[j];
        if (blocks[i].elevation !== blocks[j].elevation) continue; // 不同 FFL：不同平面，不判定為 2D 碰撞
        if (p.x1 <= q.x0 || q.x1 <= p.x0 || p.y1 <= q.y0 || q.y1 <= p.y0) continue; // 外接框沒交集，快速略過
        const depth = CT.blockPenetration(blocks[i], blocks[j]);
        if (depth > tol) out.push({ a: blocks[i].id, b: blocks[j].id, depth });
      }
    }
    return out;
  };

  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  /**
   * 提案造成的「新增」重疊。
   * before：目前的 blocks；after：模擬後的 blocks；derives：{新元件 id → 原元件 id}（拆分主線用）。
   * 已存在於 before 的重疊（以 derives 還原成原 id 比對）不算新增。
   */
  CT.newOverlaps = function (before, after, derives = {}) {
    const old = new Set(CT.findOverlaps(before).map((o) => pairKey(o.a, o.b)));
    const origin = (id) => derives[id] || id;
    return CT.findOverlaps(after).filter((o) => !old.has(pairKey(origin(o.a), origin(o.b))));
  };

  if (typeof module !== "undefined") module.exports = CT;
})(globalThis);
