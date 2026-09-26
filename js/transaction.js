/**
 * transaction.js — Auto Elbow / Auto Reducer / Auto Tee 共用的「提案 → 模擬 → 驗證」基礎
 *
 * proposal 格式（所有 Auto* 功能相同）：
 *   {
 *     id, type, sourceConnectors: [key...],
 *     removeConnections: [connectionId...],
 *     removeBlocks:      [blockId...],
 *     updateBlocks:      [{ id, newLength, newX?, newY?, set? }...],
 *     addBlocks:         [block...],
 *     addConnections:    [{ from, to, replaces?: { id, oldKey, newKey } }...],
 *     derives?:          { 新元件 id: 原元件 id }   // 拆分主線用：讓碰撞檢查把原 Main 既有的重疊視為既有
 *   }
 *
 * simulateProposal 的固定順序：
 *   1. removeConnections  2. removeBlocks  3. updateBlocks  4. addBlocks  5. addConnections
 * 之後 checkProposal 在「模擬後的新狀態」上做全部驗證；通過才可提交。
 * 全部是純函式：不修改傳入的 blocks / connections，失敗時原資料完全不變。
 *
 * `replaces` 用於「既有連接改接」（例如把一條直線拆成兩段）：
 *   舊連接 id 必須列在 removeConnections；新連接的 replaces 說明 oldKey（舊端點）
 *   在新狀態變成 newKey，兩者的世界座標必須相同，且新連接的驗證結果不可比舊的差。
 *
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

  /** 依固定順序模擬 proposal，產生新的 blocks / connections（不修改輸入） */
  CT.simulateProposal = function (blocks, connections, pr) {
    const rmConn = new Set(pr.removeConnections || []);
    const rmBlock = new Set(pr.removeBlocks || []);
    const kept = connections.filter((c) => !rmConn.has(c.id)); // 1
    const survivors = blocks.filter((b) => !rmBlock.has(b.id)); // 2
    const updated = survivors.map((b) => { // 3
      const u = (pr.updateBlocks || []).find((x) => x.id === b.id);
      if (!u) return b;
      const o = { ...b, ...(u.set || {}), length: u.newLength };
      if (u.newX != null) { o.x = u.newX; o.y = u.newY; }
      return CT.refresh(o);
    });
    const nextBlocks = updated.concat((pr.addBlocks || []).map(CT.refresh)); // 4
    const eid = pr.addBlocks && pr.addBlocks[0] ? pr.addBlocks[0].id : pr.id;
    const newConns = (pr.addConnections || []).map((c, i) => ({ id: `${eid}-C${i + 1}`, from: c.from, to: c.to })); // 5
    return { blocks: nextBlocks, connections: [...kept, ...newConns], newConns };
  };

  const RANK = { Valid: 0, Warning: 1, Invalid: 2 };

  /**
   * 通用驗證。回傳 { errs, blocks, connections }。
   *  - 結構：removeBlocks / removeConnections 必須存在；不可留下指向不存在 connector 的連接
   *  - occupied、長度、新連接端點重合
   *  - 既有（未移除）連接的端點不可被移動；被 replaces 的端點座標必須相同
   *  - Connector 驗證器：純新增的連接必須 Valid；替換的連接不可比原本差；未動的連接不可變 Invalid
   *  - Graph：Loop / 子網路數不可增加
   *  - Collision（v5.5）：不可新增實體輪廓的面積重疊
   */
  CT.checkProposal = function (blocks, connections, pr, minLength = 100) {
    const errs = [];
    const rmConn = pr.removeConnections || [];
    const rmBlock = pr.removeBlocks || [];

    rmConn.forEach((id) => { if (!connections.some((c) => c.id === id)) errs.push(`structure：要移除的連接 ${id} 不存在`); });
    rmBlock.forEach((id) => { if (!blocks.some((b) => b.id === id)) errs.push(`structure：要移除的元件 ${id} 不存在`); });

    const sim = CT.simulateProposal(blocks, connections, pr);

    // 不可留下 dangling connection
    sim.connections.forEach((c) => {
      [c.from, c.to].forEach((k) => { if (!CT.endpointOf(sim.blocks, k)) errs.push(`structure：連接 ${c.id} 的端點 ${k} 不存在`); });
    });

    const used = CT.usedConnectors(connections);
    (pr.sourceConnectors || []).forEach((k) => { if (used.has(k)) errs.push(`occupied：${k} 已被占用`); });

    (pr.updateBlocks || []).forEach((u) => { if (!(u.newLength >= minLength)) errs.push(`geometry：${u.id} 新長度 ${u.newLength} < ${minLength}`); });
    (pr.addBlocks || []).forEach((b) => { if ((b.type === "straight" || b.type === "reducer") && !(b.length >= minLength)) errs.push(`geometry：新元件 ${b.id} 長度 ${b.length} < ${minLength}`); });

    (pr.addConnections || []).forEach((c) => {
      const a = CT.endpointOf(sim.blocks, c.from);
      const b = CT.endpointOf(sim.blocks, c.to);
      if (!a || !b) { errs.push(`endpoint：${c.from}↔${c.to} 端點不存在`); return; }
      if (c.replaces) return; // 被替換的既有連接，本來就可能有間隙；改由下方「座標相同」檢查
      const gap = Math.hypot(a.k.worldX - b.k.worldX, a.k.worldY - b.k.worldY);
      if (gap > 0.5) errs.push(`endpoint：${c.from}↔${c.to} 端點未重合（${gap.toFixed(2)}mm）`);
    });

    // 既有（未移除）連接的端點不可被移動
    const rmSet = new Set(rmConn);
    connections.filter((c) => !rmSet.has(c.id)).forEach((c) => [c.from, c.to].forEach((k) => {
      const o = CT.endpointOf(blocks, k);
      const n = CT.endpointOf(sim.blocks, k);
      if (o && n && Math.hypot(o.k.worldX - n.k.worldX, o.k.worldY - n.k.worldY) > 0.01) errs.push(`既有連接端點 ${k} 被移動`);
    }));
    // 被替換的連接：舊端點 → 新端點座標必須相同；且每個被移除的連接都必須有對應的替換
    (pr.addConnections || []).forEach((c) => {
      if (!c.replaces) return;
      const { id, oldKey, newKey } = c.replaces;
      const o = CT.endpointOf(blocks, oldKey);
      const n = CT.endpointOf(sim.blocks, newKey);
      if (!rmSet.has(id)) errs.push(`structure：replaces 指向未移除的連接 ${id}`);
      else if (!o || !n) errs.push(`structure：replaces ${oldKey}→${newKey} 端點不存在`);
      else if (Math.hypot(o.k.worldX - n.k.worldX, o.k.worldY - n.k.worldY) > 0.01) errs.push(`既有連接端點 ${oldKey} 改接到 ${newKey} 後座標改變`);
    });
    rmConn.forEach((id) => {
      if (!(pr.addConnections || []).some((c) => c.replaces && c.replaces.id === id)) errs.push(`structure：連接 ${id} 被移除但沒有替換`);
    });

    // Connector 驗證器
    const before = CT.validateConnections(blocks, connections);
    const after = CT.validateConnections(sim.blocks, sim.connections);
    sim.newConns.forEach((nc, i) => {
      const r = after.find((x) => x.id === nc.id);
      if (!r) { errs.push("validator：找不到新連接"); return; }
      const rep = pr.addConnections[i].replaces;
      const old = rep && before.find((x) => x.id === rep.id);
      const limit = old ? RANK[old.overall] : 0; // 替換：不可比原本差；純新增：必須 Valid
      if (RANK[r.overall] > limit) errs.push(`validator：${nc.from}↔${nc.to} ${r.overall} — ${r.checks.filter((x) => x.status !== "Valid").map((x) => x.detail).join(" / ")}`);
    });
    after.forEach((r) => {
      const old = before.find((x) => x.id === r.id);
      if (old && old.overall !== "Invalid" && r.overall === "Invalid") errs.push(`validator：既有連接 ${r.id} 變成 Invalid`);
    });

    // Graph
    const g1 = CT.buildGraph(blocks, connections);
    const g2 = CT.buildGraph(sim.blocks, sim.connections);
    if (g2.loopCount > g1.loopCount) errs.push(`graph：Loop ${g1.loopCount}→${g2.loopCount}`);
    if (g2.subgraphCount > g1.subgraphCount) errs.push(`graph：子網路 ${g1.subgraphCount}→${g2.subgraphCount}`);

    // 實體輪廓：只擋提案「新增」的面積重疊（見 collision.js）
    if (CT.newOverlaps) {
      CT.newOverlaps(blocks, sim.blocks, pr.derives || {}).forEach((o) => errs.push(`collision：${o.a} 與 ${o.b} 輪廓重疊（穿透 ${o.depth.toFixed(1)}mm）`));
    }

    return { errs, blocks: sim.blocks, connections: sim.connections };
  };

  /** 下一個未使用的 id：`${prefix}${n}`，回傳 n */
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
