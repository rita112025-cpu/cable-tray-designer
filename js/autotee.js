/**
 * autotee.js — v5.2 自動插入三通（Tee）
 *
 * 適用：一條「分支」直線的 free 端點，垂直朝向另一條「主線」直線的中段。
 *
 *              Branch                    Main-L ──[A TEE B]── Main-R
 *                │                                    │C
 *   Main ────────┼────────   →                       Branch
 *
 * 一次交易完成（走共用的 transaction.js，不自己改 connections）：
 *   removeBlocks       原 Main
 *   addBlocks          Tee、Main-L、Main-R
 *   updateBlocks       Branch 修到 Tee:C（延伸或退縮）
 *   removeConnections  原 Main 兩端既有的連接
 *   addConnections     Tee↔Main-L、Tee↔Main-R、Tee:C↔Branch，
 *                      以及把原 Main 兩端的連接「替換」到 Main-L:A / Main-R:B（replaces）
 *
 * 幾何：
 *   Tee 長度 L = 2 × 寬度，中心在交點 J；A/B 距 J 各 L/2，C 朝分支方向也距 J L/2。
 *   Main-L 長 = s − L/2、Main-R 長 = 原長 − s − L/2（s 為 J 到 Main A 端的距離），兩者皆需 ≥ 100 mm。
 *   Branch 新長度 = 原長度 + t − L/2（t 為 Branch 端點到 J 的距離，需 ≥ 0）。
 *
 * 第一版限制：Main / Branch 皆為 Straight，同 System / FFL / Width，夾角 90°（±0.1°），
 * 分支端點 free，交點落在 Main 中段。
 */
(function (root) {
  const CT = (root.CT = root.CT || {});

  const MIN_LEN = 100; // mm
  const MAX_REACH = 2000; // Branch 端點到主線的最遠距離 mm
  const ANGLE_TOL = 0.1; // °
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

  CT.buildTeeProposal = function (blocks, connections, branchKey, mainId) {
    const S = CT.endpointOf(blocks, branchKey);
    const M = blocks.find((b) => b.id === mainId);
    if (!S || !M) return { ok: false, stage: "pre", reason: "分支連接器或主線不存在" };
    if (S.b.id === M.id) return { ok: false, stage: "pre", reason: "分支與主線不可是同一元件" };
    if (S.b.type !== "straight" || M.type !== "straight") return { ok: false, stage: "pre", reason: "Auto Tee 僅支援 Straight 主線與 Straight 分支" };
    if (CT.usedConnectors(connections).has(branchKey)) return { ok: false, stage: "pre", reason: "分支 Connector 已占用，非 free connector" };

    if (S.b.system !== M.system) return { ok: false, stage: "attr", reason: `System 不一致 ${S.b.system} vs ${M.system}` };
    if (S.b.elevation !== M.elevation) return { ok: false, stage: "attr", reason: `FFL 不一致 +${S.b.elevation} vs +${M.elevation}` };
    const w = M.width;
    if (CT.effectiveWidth(S.b, S.k.id) !== w) return { ok: false, stage: "attr", reason: `寬度不一致 W${CT.effectiveWidth(S.b, S.k.id)} vs W${w}` };

    if (Math.abs(CT.angleBetween(S.k.worldDir, M.rotation) - 90) >= ANGLE_TOL) return { ok: false, stage: "angle", reason: "分支與主線不是 90°" };

    const m = [Math.cos(CT.rad(M.rotation)), Math.sin(CT.rad(M.rotation))];
    const uS = [Math.cos(CT.rad(S.k.worldDir)), Math.sin(CT.rad(S.k.worldDir))];
    const pA = [M.connectors[0].worldX, M.connectors[0].worldY];
    const pB = [M.connectors[1].worldX, M.connectors[1].worldY];
    const pS = [S.k.worldX, S.k.worldY];
    const den = cross(uS, m);
    const d = [pA[0] - pS[0], pA[1] - pS[1]];
    const t = cross(d, m) / den; // 分支端點到 J 的距離
    const s = cross(d, uS) / den; // J 到 Main A 端的距離（沿主線）
    if (t < 0) return { ok: false, stage: "geom", reason: `分支朝向遠離主線（t=${t.toFixed(0)}）` };
    if (t > MAX_REACH) return { ok: false, stage: "geom", reason: `分支距離主線過遠（t=${t.toFixed(0)}, 上限 ${MAX_REACH}）` };

    const L = 2 * w;
    const h = L / 2;
    const lenL = s - h;
    const lenR = M.length - s - h;
    const newLenS = S.b.length + t - h;
    if (s < 0 || s > M.length) return { ok: false, stage: "geom", reason: `交點在主線之外（s=${s.toFixed(0)}, 主線長 ${M.length}）` };
    if (lenL < MIN_LEN || lenR < MIN_LEN) return { ok: false, stage: "geom", reason: `交點太靠近主線端點：Main-L ${lenL.toFixed(0)} / Main-R ${lenR.toFixed(0)}（需 ≥ ${MIN_LEN}mm，Tee 長 ${L}mm）` };
    if (newLenS < MIN_LEN) return { ok: false, stage: "geom", reason: `分支調整後長度不足 ${MIN_LEN}mm：${newLenS.toFixed(0)}` };

    const J = [pA[0] + s * m[0], pA[1] + s * m[1]];
    const dirC = CT.normDeg(S.k.worldDir + 180); // Tee C 朝向分支
    const rot = CT.normDeg(dirC - 90);
    const uT = [Math.cos(CT.rad(rot)), Math.sin(CT.rad(rot))];
    const Cpos = [J[0] - h * uS[0], J[1] - h * uS[1]];

    let n = 1;
    while (["TE-A", "TL-A", "TR-A"].some((p) => blocks.some((b) => b.id === `${p}${n}`))) n++;
    const [teeId, lId, rId] = [`TE-A${n}`, `TL-A${n}`, `TR-A${n}`];
    const r2 = CT.round2;
    const num = String(n).padStart(3, "0");
    const tee = {
      ...M, id: teeId, trayId: `TEE-AUTO-${num}`, type: "tee", length: L,
      x: r2(J[0]), y: r2(J[1]), rotation: r2(rot), from: "", to: "", remark: "自動插入三通",
    };
    const left = { ...M, id: lId, trayId: `${M.trayId}-1`, length: r2(lenL), to: "", remark: "Auto Tee 分割（左）" };
    const right = {
      ...M, id: rId, trayId: `${M.trayId}-2`, length: r2(lenR), from: "",
      x: r2(J[0] + h * m[0]), y: r2(J[1] + h * m[1]), remark: "Auto Tee 分割（右）",
    };
    [tee, left, right].forEach((b) => delete b.connectors);

    // Tee 的 A 端在 −uT 側；uT 與 m 同向 → A 接 Main-L，否則 A 接 Main-R
    const same = uT[0] * m[0] + uT[1] * m[1] > 0;
    const addConnections = [
      { from: `${lId}:B`, to: `${teeId}:${same ? "A" : "B"}` },
      { from: `${teeId}:${same ? "B" : "A"}`, to: `${rId}:A` },
      { from: `${teeId}:C`, to: branchKey },
    ];
    // 原 Main 兩端既有的連接：改接到 Main-L:A / Main-R:B，座標不變
    const removeConnections = [];
    [["A", lId], ["B", rId]].forEach(([end, newBlock]) => {
      const oldKey = `${M.id}:${end}`;
      const newKey = `${newBlock}:${end}`;
      connections.filter((c) => c.from === oldKey || c.to === oldKey).forEach((c) => {
        removeConnections.push(c.id);
        addConnections.push({
          from: c.from === oldKey ? newKey : c.from,
          to: c.to === oldKey ? newKey : c.to,
          replaces: { id: c.id, oldKey, newKey },
        });
      });
    });

    return {
      ok: true,
      proposal: {
        id: `${branchKey}>${M.id}`,
        type: "AUTO_TEE",
        sourceConnectors: [branchKey],
        mainId: M.id,
        geometry: { J, s, t, h, L, Cpos, pA, pB, pS, rot },
        info: {
          system: M.system, width: w, elevation: M.elevation,
          trayMain: M.trayId, trayBranch: S.b.trayId,
          oldLenMain: M.length, lenL: r2(lenL), lenR: r2(lenR),
          oldLenBranch: S.b.length, newLenBranch: r2(newLenS),
        },
        removeBlocks: [M.id],
        removeConnections,
        updateBlocks: [CT.tipUpdate(S, newLenS, Cpos)],
        addBlocks: [tee, left, right],
        addConnections,
      },
    };
  };

  CT.validateTeeProposal = function (blocks, connections, pr) {
    const c = CT.checkProposal(blocks, connections, pr, MIN_LEN);
    return { ok: c.errs.length === 0, errs: c.errs, blocks: c.blocks, connections: c.connections };
  };

  /** 偵測所有可插入位置（只回傳通過驗證的 proposal） */
  CT.detectAutoTees = function (blocks, connections) {
    const used = CT.usedConnectors(connections);
    const proposals = [];
    const notes = [];
    blocks.forEach((b) => {
      if (b.type !== "straight") return;
      b.connectors.forEach((k) => {
        const key = `${b.id}:${k.id}`;
        if (used.has(key)) return;
        blocks.forEach((m) => {
          if (m.type !== "straight" || m.id === b.id) return;
          const r = CT.buildTeeProposal(blocks, connections, key, m.id);
          if (!r.ok) {
            if (r.stage === "geom") notes.push(`${key}→${m.id}：${r.reason}`);
            return;
          }
          const v = CT.validateTeeProposal(blocks, connections, r.proposal);
          if (v.ok) proposals.push(r.proposal);
          else notes.push(`${key}→${m.id}：${v.errs[0]}`);
        });
      });
    });
    return { proposals, notes };
  };

  /** 提交：成功回傳新的 blocks / connections；失敗只回傳原因，不產生任何新狀態。 */
  CT.commitAutoTee = (blocks, connections, branchKey, mainId) => CT.commitWith(CT.buildTeeProposal, CT.validateTeeProposal, blocks, connections, branchKey, mainId);

  if (typeof module !== "undefined") module.exports = CT;
})(globalThis);
