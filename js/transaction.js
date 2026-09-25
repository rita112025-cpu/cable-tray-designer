/**
 * transaction.js — Auto Elbow / Auto Reducer 共用的「提案 → 模擬 → 驗證」基礎
 *
 * proposal 格式（所有 Auto* 功能相同）：
 *   { id, type, sourceConnectors:[keyX,keyY],
 *     addBlocks:[block...], updateBlocks:[{id,newLength,newX?,newY?}...],
 *     addConnections:[{from,to}...] }
 *
 * 全部是純函式：不修改傳入的 blocks / connections。
 * 正確性一律交給既有的 CT.validateConnections / CT.buildGraph，
 * Auto* 功能只負責「提出修改方案」，不自己發明另一套判斷。
 */
(function (root) {
  const CT = (root.CT = root.CT || {});

  CT.round2 = (v) => Math.round(v * 100) / 100;

  CT.usedConnectors = function (connections) {
    const s = new Set();
    connections.forEach((c) => { s.add(c.from); s.add(c.to); });
    return s;
  };

  /** "B12:B" → { b: block, k: connector } */
  CT.endpointOf = function (blocks, key) {
    const [bid, cid] = key.split(":");
    const b = blocks.find((x) => x.id === bid);
    const k = b && b.connectors.find((x) => x.id === cid);
    return k ? { b, k } : null;
  };

  /**
   * 直線被改動的那一端：B 端只改長度；A 端要連同起點一起移動（另一端保持不動）。
   * E = endpointOf() 結果，tip = 新的端點座標。
   */
  CT.tipUpdate = function (E, newLen, tip) {
    const r2 = CT.round2;
    return E.k.id === "B"
      ? { id: E.b.id, newLength: r2(newLen) }
      : { id: E.b.id, newLength: r2(newLen), newX: r2(tip[0]), newY: r2(tip[1]) };
  };

  /** 產生新的 blocks / connections（不修改輸入） */
  CT.simulateProposal = function (blocks, connections, pr) {
    const nextBlocks = blocks
      .map((b) => {
        const u = pr.updateBlocks.find((x) => x.id === b.id);
        if (!u) return b;
        const o = { ...b, length: u.newLength };
        if (u.newX != null) { o.x = u.newX; o.y = u.newY; }
        return CT.refresh(o);
      })
      .concat(pr.addBlocks.map(CT.refresh));
    const eid = pr.addBlocks[0].id;
    const newConns = pr.addConnections.map((c, i) => ({ id: `${eid}-C${i + 1}`, from: c.from, to: c.to }));
    return { blocks: nextBlocks, connections: [...connections, ...newConns], newConns };
  };

  /**
   * 通用驗證：occupied、長度、端點重合、既有連接端點未被移動、
   * Connector 驗證器（新連接必須全為 Valid、既有連接不可變成 Invalid）、
   * Graph（Loop / 子網路數不可增加）。
   * 回傳 { errs, blocks, connections }。
   */
  CT.checkProposal = function (blocks, connections, pr, minLength = 100) {
    const errs = [];
    const sim = CT.simulateProposal(blocks, connections, pr);

    const used = CT.usedConnectors(connections);
    pr.sourceConnectors.forEach((k) => { if (used.has(k)) errs.push(`occupied：${k} 已被占用`); });

    pr.updateBlocks.forEach((u) => { if (!(u.newLength >= minLength)) errs.push(`geometry：${u.id} 新長度 ${u.newLength} < ${minLength}`); });

    pr.addConnections.forEach((c) => {
      const a = CT.endpointOf(sim.blocks, c.from);
      const b = CT.endpointOf(sim.blocks, c.to);
      if (!a || !b) { errs.push(`endpoint：${c.from}↔${c.to} 端點不存在`); return; }
      const gap = Math.hypot(a.k.worldX - b.k.worldX, a.k.worldY - b.k.worldY);
      if (gap > 0.5) errs.push(`endpoint：${c.from}↔${c.to} 端點未重合（${gap.toFixed(2)}mm）`);
    });

    connections.forEach((c) => [c.from, c.to].forEach((k) => {
      const o = CT.endpointOf(blocks, k);
      const n = CT.endpointOf(sim.blocks, k);
      if (o && n && Math.hypot(o.k.worldX - n.k.worldX, o.k.worldY - n.k.worldY) > 0.01) errs.push(`既有連接端點 ${k} 被移動`);
    }));

    const after = CT.validateConnections(sim.blocks, sim.connections);
    sim.newConns.forEach((c) => {
      const r = after.find((x) => x.id === c.id);
      if (!r) errs.push("validator：找不到新連接");
      else if (r.overall !== "Valid") errs.push(`validator：${c.from}↔${c.to} ${r.overall} — ${r.checks.filter((x) => x.status !== "Valid").map((x) => x.detail).join(" / ")}`);
    });
    const before = CT.validateConnections(blocks, connections);
    after.forEach((r) => {
      const old = before.find((x) => x.id === r.id);
      if (old && old.overall !== "Invalid" && r.overall === "Invalid") errs.push(`validator：既有連接 ${r.id} 變成 Invalid`);
    });

    const g1 = CT.buildGraph(blocks, connections);
    const g2 = CT.buildGraph(sim.blocks, sim.connections);
    if (g2.loopCount > g1.loopCount) errs.push(`graph：Loop ${g1.loopCount}→${g2.loopCount}`);
    if (g2.subgraphCount > g1.subgraphCount) errs.push(`graph：子網路 ${g1.subgraphCount}→${g2.subgraphCount}`);

    return { errs, blocks: sim.blocks, connections: sim.connections };
  };

  /** 下一個未使用的 id：`${prefix}${n}` */
  CT.nextFreeId = function (blocks, prefix) {
    let n = 1;
    while (blocks.some((b) => b.id === `${prefix}${n}`)) n++;
    return n;
  };

  /**
   * 通用提交：以「目前」狀態重新 build + validate，避免使用過期 proposal。
   * build(blocks, connections, keyA, keyB) → {ok, proposal|reason}
   * validate(blocks, connections, proposal) → {ok, errs, blocks, connections}
   */
  CT.commitWith = function (build, validate, blocks, connections, keyA, keyB) {
    try {
      const r = build(blocks, connections, keyA, keyB);
      if (!r.ok) return { ok: false, reason: r.reason };
      const v = validate(blocks, connections, r.proposal);
      if (!v.ok) return { ok: false, reason: v.errs.join("；") };
      return { ok: true, blocks: v.blocks, connections: v.connections, proposal: r.proposal };
    } catch (err) {
      return { ok: false, reason: `例外：${err && err.message}` };
    }
  };

  if (typeof module !== "undefined") module.exports = CT;
})(globalThis);
