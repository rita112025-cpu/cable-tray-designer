/**
 * autoelbow.js — v4 自動插入 90° 彎頭（交易式）
 *
 * 流程（全部為純函式，不修改傳入的 blocks / connections）：
 *   detect()          掃描 free Straight connector 的兩兩組合
 *   buildProposal()   幾何計算，產出 proposal
 *   validateProposal()在「模擬後的新狀態」上跑全部檢查
 *   commit()          重新 build + validate，全部通過才回傳新狀態；任何失敗回傳 ok:false，
 *                     呼叫端不需更動任何 state（不會有半完成狀態）
 *
 * 幾何：
 *   兩條 free connector 的「朝外射線」相交於 C（t1, t2 ≥ 0）。
 *   90° 彎頭的切線退縮量 = 中心線半徑 Rc = innerRadius + width/2。
 *   彎頭 A 端 = C − Rc·u1，B 端 = C − Rc·u2，兩條直線的端點各移到這兩點，
 *   新長度 = 原長度 + t − Rc（t < Rc 為退縮修短，t > Rc 為延伸補足）。
 *
 *   彎頭的形狀固定為「順時針」轉 90°（A 朝 180°、B 朝 90°）。
 *   因此要求 dirX = dirY + 90°；若相反就把 X、Y 對調，左轉/右轉皆可處理。
 */
(function (root) {
  const CT = (root.CT = root.CT || {});

  const MIN_LEN = 100; // 退縮後直線最短長度 mm
  const MAX_REACH = 2000; // 射線交點最遠距離 mm
  const ANGLE_TOL = 1; // 夾角容差 °
  const r2 = CT.round2;
  const usedSet = CT.usedConnectors;
  const endpoint = CT.endpointOf;

  CT.buildProposal = function (blocks, connections, keyA, keyB) {
    let X = endpoint(blocks, keyA);
    let Y = endpoint(blocks, keyB);
    let xKey = keyA;
    let yKey = keyB;
    if (!X || !Y) return { ok: false, stage: "pre", reason: "連接器不存在" };
    if (X.b.id === Y.b.id) return { ok: false, stage: "pre", reason: "同一元件的兩端不可自接" };
    if (X.b.type !== "straight" || Y.b.type !== "straight") return { ok: false, stage: "pre", reason: "v4 僅支援 Straight↔Straight（其他 v5 再支援）" };
    const used = usedSet(connections);
    if (used.has(xKey) || used.has(yKey)) return { ok: false, stage: "pre", reason: "Connector 已占用，非 free connector" };

    // 需要 dirX − dirY = 90°；若為 270° 就對調
    let d = CT.normDeg(X.k.worldDir - Y.k.worldDir);
    if (Math.abs(d - 270) < ANGLE_TOL) {
      [X, Y] = [Y, X];
      [xKey, yKey] = [yKey, xKey];
      d = 90;
    }
    if (Math.abs(d - 90) >= ANGLE_TOL) return { ok: false, stage: "angle", reason: "夾角不是 90°" };

    if (X.b.system !== Y.b.system) return { ok: false, stage: "attr", reason: `System 不一致 ${X.b.system} vs ${Y.b.system}` };
    if (X.b.elevation !== Y.b.elevation) return { ok: false, stage: "attr", reason: `FFL 不一致 +${X.b.elevation} vs +${Y.b.elevation}` };
    const w = CT.effectiveWidth(X.b, X.k.id);
    const w2 = CT.effectiveWidth(Y.b, Y.k.id);
    if (w !== w2) return { ok: false, stage: "attr", reason: `寬度不一致 W${w} vs W${w2}` };

    const u1 = [Math.cos(CT.rad(X.k.worldDir)), Math.sin(CT.rad(X.k.worldDir))];
    const u2 = [Math.cos(CT.rad(Y.k.worldDir)), Math.sin(CT.rad(Y.k.worldDir))];
    const cross = u1[0] * u2[1] - u1[1] * u2[0];
    const dx = Y.k.worldX - X.k.worldX;
    const dy = Y.k.worldY - X.k.worldY;
    const t1 = (dx * u2[1] - dy * u2[0]) / cross;
    const t2 = (dx * u1[1] - dy * u1[0]) / cross;
    if (!(t1 >= 0 && t2 >= 0)) return { ok: false, stage: "geom", reason: `兩射線不相交於前方（t1=${t1.toFixed(0)}, t2=${t2.toFixed(0)}）` };
    if (t1 > MAX_REACH || t2 > MAX_REACH) return { ok: false, stage: "geom", reason: `距離過遠（t1=${t1.toFixed(0)}, t2=${t2.toFixed(0)}, 上限 ${MAX_REACH}）` };

    const Rc = X.b.innerRadius + w / 2;
    const newLenX = X.b.length + t1 - Rc;
    const newLenY = Y.b.length + t2 - Rc;
    if (newLenX < MIN_LEN || newLenY < MIN_LEN) {
      return { ok: false, stage: "geom", reason: `調整後長度不足 ${MIN_LEN}mm：${X.b.trayId}→${newLenX.toFixed(0)} / ${Y.b.trayId}→${newLenY.toFixed(0)}（需退縮 ${Rc}mm）` };
    }

    const C = [X.k.worldX + t1 * u1[0], X.k.worldY + t1 * u1[1]];
    const A = [C[0] - Rc * u1[0], C[1] - Rc * u1[1]];
    const B = [C[0] - Rc * u2[0], C[1] - Rc * u2[1]];

    let n = 1;
    while (blocks.some((b) => b.id === `EL-A${n}`)) n++;
    const eid = `EL-A${n}`;
    const elbow = {
      id: eid, trayId: `ELBOW-AUTO-${String(n).padStart(3, "0")}`, type: "elbow90",
      system: X.b.system, width: w, widthStart: w, widthEnd: w, length: 600,
      innerRadius: X.b.innerRadius, bendAngle: 90, rotation: r2(X.k.worldDir),
      x: r2(A[0]), y: r2(A[1]), elevation: X.b.elevation, from: "", to: "", remark: "v4 自動插入彎頭",
    };
    const update = CT.tipUpdate;

    return {
      ok: true,
      proposal: {
        id: `${xKey}|${yKey}`,
        type: "AUTO_ELBOW_90",
        sourceConnectors: [xKey, yKey],
        geometry: { C, p1: [X.k.worldX, X.k.worldY], p2: [Y.k.worldX, Y.k.worldY], p1New: A, p2New: B, Rc, t1, t2, setback: Rc },
        info: {
          system: X.b.system, width: w, elevation: X.b.elevation,
          trayX: X.b.trayId, trayY: Y.b.trayId,
          oldLenX: X.b.length, oldLenY: Y.b.length, newLenX: r2(newLenX), newLenY: r2(newLenY),
        },
        addBlocks: [elbow],
        updateBlocks: [update(X, newLenX, A), update(Y, newLenY, B)],
        removeConnections: [],
        addConnections: [{ from: xKey, to: `${eid}:A` }, { from: `${eid}:B`, to: yKey }],
      },
    };
  };

  /** 彎頭專屬的幾何檢查 + 共用的 CT.checkProposal */
  CT.validateProposal = function (blocks, connections, pr) {
    const errs = [];
    if (!(pr.geometry.t1 >= 0 && pr.geometry.t2 >= 0)) errs.push("geometry：射線交點在後方");
    const c = CT.checkProposal(blocks, connections, pr, MIN_LEN);
    errs.push(...c.errs);
    return { ok: errs.length === 0, errs, blocks: c.blocks, connections: c.connections };
  };

  /** 偵測所有可插入位置（只回傳通過驗證的 proposal） */
  CT.detectAutoElbows = function (blocks, connections) {
    const used = usedSet(connections);
    const free = [];
    blocks.forEach((b) => {
      if (b.type !== "straight") return;
      b.connectors.forEach((k) => { const key = `${b.id}:${k.id}`; if (!used.has(key)) free.push(key); });
    });
    const proposals = [];
    const notes = [];
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const r = CT.buildProposal(blocks, connections, free[i], free[j]);
        if (!r.ok) {
          if (r.stage === "attr" || r.stage === "geom") notes.push(`${free[i]}↔${free[j]}：${r.reason}`);
          continue;
        }
        const v = CT.validateProposal(blocks, connections, r.proposal);
        if (v.ok) proposals.push(r.proposal);
        else notes.push(`${free[i]}↔${free[j]}：${v.errs[0]}`);
      }
    }
    return { proposals, notes };
  };

  /** 提交：成功回傳新的 blocks / connections；失敗只回傳原因，不產生任何新狀態。 */
  CT.commitAutoElbow = (blocks, connections, keyA, keyB) => CT.commitWith(CT.buildProposal, CT.validateProposal, blocks, connections, keyA, keyB);

  if (typeof module !== "undefined") module.exports = CT;
})(globalThis);
