/**
 * autoreducer.js — v5.0 自動插入變徑（Reducer）
 *
 * 適用：兩條 free 的 Straight，端點同軸、朝向彼此，System / FFL 相同、寬度不同。
 *
 *   W300 ───┤ ├─── W200      →      W300 ───[Reducer W300→W200]─── W200
 *
 * 只負責「提出修改方案」（proposal）；寬度是否匹配、連接是否合法、Graph 是否惡化，
 * 全部交給共用的 CT.checkProposal（內部使用既有的 CT.validateConnections / CT.buildGraph）。
 *
 * 幾何：
 *   兩端點間距 g（沿軸向），變徑長度 Lr（預設 300 mm）。
 *   兩條直線各調整 delta = (g − Lr)/2：g > Lr 為延伸補足，g < Lr 為退縮修短。
 *   變徑放在兩條直線的新端點之間，A 端固定接「較寬」的一側，
 *   所以 widthStart ≥ widthEnd，傳入 keyA/keyB 順序不影響結果。
 */
(function (root) {
  const CT = (root.CT = root.CT || {});

  const REDUCER_LEN = 300; // mm
  const MIN_LEN = 100; // 調整後直線最短長度 mm
  const ANGLE_TOL = 1; // °
  const OFFSET_TOL = 0.5; // 兩軸偏移容差 mm

  CT.REDUCER_LEN = REDUCER_LEN;

  CT.buildReducerProposal = function (blocks, connections, keyA, keyB) {
    let X = CT.endpointOf(blocks, keyA);
    let Y = CT.endpointOf(blocks, keyB);
    let xKey = keyA;
    let yKey = keyB;
    if (!X || !Y) return { ok: false, stage: "pre", reason: "連接器不存在" };
    if (X.b.id === Y.b.id) return { ok: false, stage: "pre", reason: "同一元件的兩端不可自接" };
    if (X.b.type !== "straight" || Y.b.type !== "straight") return { ok: false, stage: "pre", reason: "Auto Reducer 僅支援 Straight↔Straight" };
    const used = CT.usedConnectors(connections);
    if (used.has(xKey) || used.has(yKey)) return { ok: false, stage: "pre", reason: "Connector 已占用，非 free connector" };

    if (X.b.system !== Y.b.system) return { ok: false, stage: "attr", reason: `System 不一致 ${X.b.system} vs ${Y.b.system}` };
    if (X.b.elevation !== Y.b.elevation) return { ok: false, stage: "attr", reason: `FFL 不一致 +${X.b.elevation} vs +${Y.b.elevation}` };
    let wX = CT.effectiveWidth(X.b, X.k.id);
    let wY = CT.effectiveWidth(Y.b, Y.k.id);
    if (wX === wY) return { ok: false, stage: "attr", reason: `寬度相同 W${wX}，不需要變徑` };

    // A 端接較寬的一側
    if (wX < wY) {
      [X, Y] = [Y, X];
      [xKey, yKey] = [yKey, xKey];
      [wX, wY] = [wY, wX];
    }

    if (CT.angleBetween(X.k.worldDir + 180, Y.k.worldDir) > ANGLE_TOL) return { ok: false, stage: "angle", reason: "兩端點未相對（需相差 180°）" };

    const u = [Math.cos(CT.rad(X.k.worldDir)), Math.sin(CT.rad(X.k.worldDir))];
    const dx = Y.k.worldX - X.k.worldX;
    const dy = Y.k.worldY - X.k.worldY;
    const gap = dx * u[0] + dy * u[1];
    const offset = Math.abs(dx * u[1] - dy * u[0]);
    if (offset > OFFSET_TOL) return { ok: false, stage: "geom", reason: `兩端點不同軸（偏移 ${offset.toFixed(1)}mm）` };
    if (gap < 0) return { ok: false, stage: "geom", reason: `兩端點已重疊（間距 ${gap.toFixed(0)}mm）` };

    const delta = (gap - REDUCER_LEN) / 2;
    const newLenX = X.b.length + delta;
    const newLenY = Y.b.length + delta;
    if (newLenX < MIN_LEN || newLenY < MIN_LEN) {
      return { ok: false, stage: "geom", reason: `調整後長度不足 ${MIN_LEN}mm：${X.b.trayId}→${newLenX.toFixed(0)} / ${Y.b.trayId}→${newLenY.toFixed(0)}（間距 ${gap.toFixed(0)}mm，變徑 ${REDUCER_LEN}mm）` };
    }

    const A = [X.k.worldX + delta * u[0], X.k.worldY + delta * u[1]];
    const B = [A[0] + REDUCER_LEN * u[0], A[1] + REDUCER_LEN * u[1]];
    const n = CT.nextFreeId(blocks, "RD-A");
    const rid = `RD-A${n}`;
    const r2 = CT.round2;
    const reducer = {
      id: rid, trayId: `RED-AUTO-${String(n).padStart(3, "0")}`, type: "reducer",
      system: X.b.system, width: wX, widthStart: wX, widthEnd: wY, length: REDUCER_LEN,
      innerRadius: X.b.innerRadius, bendAngle: 90, rotation: r2(X.k.worldDir),
      x: r2(A[0]), y: r2(A[1]), elevation: X.b.elevation, from: "", to: "", remark: "v5 自動插入變徑",
    };

    return {
      ok: true,
      proposal: {
        id: `${xKey}|${yKey}`,
        type: "AUTO_REDUCER",
        sourceConnectors: [xKey, yKey],
        geometry: { A, B, gap, delta },
        info: {
          system: X.b.system, elevation: X.b.elevation, widthStart: wX, widthEnd: wY,
          trayX: X.b.trayId, trayY: Y.b.trayId,
          oldLenX: X.b.length, oldLenY: Y.b.length, newLenX: r2(newLenX), newLenY: r2(newLenY),
        },
        addBlocks: [reducer],
        updateBlocks: [CT.tipUpdate(X, newLenX, A), CT.tipUpdate(Y, newLenY, B)],
        removeConnections: [],
        addConnections: [{ from: xKey, to: `${rid}:A` }, { from: `${rid}:B`, to: yKey }],
      },
    };
  };

  CT.validateReducerProposal = function (blocks, connections, pr) {
    const c = CT.checkProposal(blocks, connections, pr, MIN_LEN);
    return { ok: c.errs.length === 0, errs: c.errs, blocks: c.blocks, connections: c.connections };
  };

  /** 偵測所有可插入位置（只回傳通過驗證的 proposal） */
  CT.detectAutoReducers = function (blocks, connections) {
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
        const r = CT.buildReducerProposal(blocks, connections, free[i], free[j]);
        if (!r.ok) {
          if (r.stage === "geom") notes.push(`${free[i]}↔${free[j]}：${r.reason}`);
          continue;
        }
        const v = CT.validateReducerProposal(blocks, connections, r.proposal);
        if (v.ok) proposals.push(r.proposal);
        else notes.push(`${free[i]}↔${free[j]}：${v.errs[0]}`);
      }
    }
    return { proposals, notes };
  };

  /** 提交：成功回傳新的 blocks / connections；失敗只回傳原因，不產生任何新狀態。 */
  CT.commitAutoReducer = (blocks, connections, keyA, keyB) => CT.commitWith(CT.buildReducerProposal, CT.validateReducerProposal, blocks, connections, keyA, keyB);

  if (typeof module !== "undefined") module.exports = CT;
})(globalThis);
