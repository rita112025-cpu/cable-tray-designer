/**
 * autocross.js — v5.4 自動插入四通（Cross）
 *
 * 適用：兩條「分支」直線的 free 端點，從主線兩側、同一個交點、互為反向地垂直朝向主線中段。
 *
 *              Branch-1                        Branch-1
 *                 │                               │C
 *   Main ─────────┼─────────  →   Main-1 ──[A CROSS B]── Main-2
 *                 │                               │D
 *              Branch-2                        Branch-2
 *
 * 完全沿用 Tee 的做法與共用 transaction 契約（不改 transaction.js）：
 *   removeBlocks 原 Main；addBlocks Cross / Main-1 / Main-2；updateBlocks 兩條 Branch 修到 Cross:C / Cross:D；
 *   addConnections 4 條新連接 + 原 Main 兩端既有連接的 replaces。
 *
 * 幾何：Cross 長 = 高 = 2 × 寬度（W300 → 600 × 600），中心在交點 J，A/B/C/D 各距 J L/2。
 *   Cross 的旋轉取主線旋轉：A 朝主線 A 側、B 朝 B 側、C 朝主線的 −y 側、D 朝 +y 側。
 *
 * 第一版限制：Main / Branch-1 / Branch-2 皆為 Straight，同寬、同 System / FFL，
 * 兩 Branch 與 Main 皆 90°、彼此反向、交在主線同一點（±0.5mm）、端點 free。
 * Cross + Branch Reducer 留待後續版本。
 */
(function (root) {
  const CT = (root.CT = root.CT || {});

  const MIN_LEN = 100; // mm
  const MAX_REACH = 2000; // mm
  const ANGLE_TOL = 0.1; // °
  const JUNCTION_TOL = 0.5; // 兩條 Branch 交點的容差 mm

  CT.buildCrossProposal = function (blocks, connections, keyA, keyB, mainId) {
    const S1 = CT.endpointOf(blocks, keyA);
    const S2 = CT.endpointOf(blocks, keyB);
    const M = blocks.find((b) => b.id === mainId);
    if (!S1 || !S2 || !M) return { ok: false, stage: "pre", reason: "分支連接器或主線不存在" };
    if (S1.b.id === S2.b.id || S1.b.id === M.id || S2.b.id === M.id) return { ok: false, stage: "pre", reason: "主線與兩條分支必須是三個不同的元件" };
    if (S1.b.type !== "straight" || S2.b.type !== "straight" || M.type !== "straight") return { ok: false, stage: "pre", reason: "Auto Cross 僅支援 Straight" };
    const used = CT.usedConnectors(connections);
    if (used.has(keyA) || used.has(keyB)) return { ok: false, stage: "pre", reason: "分支 Connector 已占用，非 free connector" };

    for (const S of [S1, S2]) {
      if (S.b.system !== M.system) return { ok: false, stage: "attr", reason: `System 不一致 ${S.b.system} vs ${M.system}` };
      if (S.b.elevation !== M.elevation) return { ok: false, stage: "attr", reason: `FFL 不一致 +${S.b.elevation} vs +${M.elevation}` };
      const wb = CT.effectiveWidth(S.b, S.k.id);
      if (wb !== M.width) return { ok: false, stage: "attr", reason: `寬度不一致 W${wb} vs W${M.width}（Cross + Reducer 留待後續版本）` };
      if (Math.abs(CT.angleBetween(S.k.worldDir, M.rotation) - 90) >= ANGLE_TOL) return { ok: false, stage: "angle", reason: "分支與主線不是 90°" };
    }
    if (CT.angleBetween(S1.k.worldDir + 180, S2.k.worldDir) >= ANGLE_TOL) return { ok: false, stage: "angle", reason: "兩條分支不是互為反向" };

    const h1 = CT.rayOnMain(S1, M);
    const h2 = CT.rayOnMain(S2, M);
    if (h1.t < 0 || h2.t < 0) return { ok: false, stage: "geom", reason: `分支朝向遠離主線（t1=${h1.t.toFixed(0)}, t2=${h2.t.toFixed(0)}）` };
    if (h1.t > MAX_REACH || h2.t > MAX_REACH) return { ok: false, stage: "geom", reason: `分支距離主線過遠（上限 ${MAX_REACH}）` };
    if (Math.abs(h1.s - h2.s) > JUNCTION_TOL) return { ok: false, stage: "geom", reason: `兩條分支不在主線同一交點（相差 ${Math.abs(h1.s - h2.s).toFixed(1)}mm）` };

    const s = (h1.s + h2.s) / 2;
    const w = M.width;
    const L = 2 * w;
    const h = L / 2;
    const lenL = s - h;
    const lenR = M.length - s - h;
    const newLen1 = S1.b.length + h1.t - h;
    const newLen2 = S2.b.length + h2.t - h;
    if (s < 0 || s > M.length) return { ok: false, stage: "geom", reason: `交點在主線之外（s=${s.toFixed(0)}, 主線長 ${M.length}）` };
    if (lenL < MIN_LEN || lenR < MIN_LEN) return { ok: false, stage: "geom", reason: `交點太靠近主線端點：Main-L ${lenL.toFixed(0)} / Main-R ${lenR.toFixed(0)}（需 ≥ ${MIN_LEN}mm，Cross 長 ${L}mm）` };
    if (newLen1 < MIN_LEN || newLen2 < MIN_LEN) return { ok: false, stage: "geom", reason: `分支調整後長度不足 ${MIN_LEN}mm：${newLen1.toFixed(0)} / ${newLen2.toFixed(0)}` };

    let n = 1;
    while (["CX-A", "CL-A", "CR-A"].some((p) => blocks.some((b) => b.id === `${p}${n}`))) n++;
    const [xId, lId, rId] = [`CX-A${n}`, `CL-A${n}`, `CR-A${n}`];
    const r2 = CT.round2;
    const split = CT.splitMainPlan(M, connections, s, L, lId, rId, "Auto Cross");
    const { J, m } = split;
    const cross = {
      ...M, id: xId, trayId: `CROSS-AUTO-${String(n).padStart(3, "0")}`, type: "cross", length: L,
      x: r2(J[0]), y: r2(J[1]), rotation: r2(M.rotation), from: "", to: "", remark: "自動插入四通",
    };
    delete cross.connectors;

    // 分支在主線的哪一側：朝外方向 = 主線旋轉 + 270° → 分支在 +y 側 → 接 Cross:D；否則接 Cross:C
    const sideOf = (S) => (CT.angleBetween(S.k.worldDir, M.rotation + 270) < 1 ? "D" : "C");
    const side1 = sideOf(S1);
    const side2 = sideOf(S2);
    const tip = (hit) => [J[0] - h * hit.uS[0], J[1] - h * hit.uS[1]];

    const addConnections = [
      { from: `${lId}:B`, to: `${xId}:A` },
      { from: `${xId}:B`, to: `${rId}:A` },
      { from: `${xId}:${side1}`, to: keyA },
      { from: `${xId}:${side2}`, to: keyB },
      ...split.replaced,
    ];

    return {
      ok: true,
      proposal: {
        id: `${keyA}+${keyB}>${M.id}`,
        type: "AUTO_CROSS",
        sourceConnectors: [keyA, keyB],
        mainId: M.id,
        geometry: { J, s, h, L, t1: h1.t, t2: h2.t, m, rot: M.rotation, pS1: [S1.k.worldX, S1.k.worldY], pS2: [S2.k.worldX, S2.k.worldY] },
        info: {
          system: M.system, width: w, elevation: M.elevation,
          trayMain: M.trayId, trayBranch1: S1.b.trayId, trayBranch2: S2.b.trayId,
          oldLenMain: M.length, lenL: r2(lenL), lenR: r2(lenR),
          oldLenBranch1: S1.b.length, newLenBranch1: r2(newLen1),
          oldLenBranch2: S2.b.length, newLenBranch2: r2(newLen2),
          newConnections: addConnections.length - split.removeConnections.length,
        },
        removeBlocks: [M.id],
        removeConnections: split.removeConnections,
        updateBlocks: [CT.tipUpdate(S1, newLen1, tip(h1)), CT.tipUpdate(S2, newLen2, tip(h2))],
        addBlocks: [cross, split.left, split.right],
        addConnections,
      },
    };
  };

  CT.validateCrossProposal = function (blocks, connections, pr) {
    const c = CT.checkProposal(blocks, connections, pr, MIN_LEN);
    return { ok: c.errs.length === 0, errs: c.errs, blocks: c.blocks, connections: c.connections };
  };

  /** 偵測所有可插入位置（只回傳通過驗證的 proposal） */
  CT.detectAutoCrosses = function (blocks, connections) {
    const used = CT.usedConnectors(connections);
    const free = [];
    blocks.forEach((b) => {
      if (b.type !== "straight") return;
      b.connectors.forEach((k) => { const key = `${b.id}:${k.id}`; if (!used.has(key)) free.push(key); });
    });
    const proposals = [];
    const notes = [];
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        // 只考慮互為反向的兩個 free 端點
        const a = CT.endpointOf(blocks, free[i]);
        const b = CT.endpointOf(blocks, free[j]);
        if (a.b.id === b.b.id || CT.angleBetween(a.k.worldDir + 180, b.k.worldDir) >= ANGLE_TOL) continue;
        blocks.forEach((m) => {
          if (m.type !== "straight" || m.id === a.b.id || m.id === b.b.id) return;
          const r = CT.buildCrossProposal(blocks, connections, free[i], free[j], m.id);
          if (!r.ok) {
            if (r.stage === "geom") notes.push(`${free[i]}+${free[j]}→${m.id}：${r.reason}`);
            return;
          }
          const v = CT.validateCrossProposal(blocks, connections, r.proposal);
          if (v.ok) proposals.push(r.proposal);
          else notes.push(`${free[i]}+${free[j]}→${m.id}：${v.errs[0]}`);
        });
      }
    }
    return { proposals, notes };
  };

  /** 提交：成功回傳新的 blocks / connections；失敗只回傳原因，不產生任何新狀態。 */
  CT.commitAutoCross = (blocks, connections, keyA, keyB, mainId) => CT.commitWith(
    (b, c, x, y) => CT.buildCrossProposal(b, c, x, y, mainId), CT.validateCrossProposal, blocks, connections, keyA, keyB);

  if (typeof module !== "undefined") module.exports = CT;
})(globalThis);
