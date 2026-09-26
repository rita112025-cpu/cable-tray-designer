// 執行：node test/core.test.js （或 npm test）
const assert = require("node:assert/strict");
const path = require("node:path");
["geometry", "collision", "graph", "validator", "transaction", "autoelbow", "autoreducer", "autotee", "autocross", "export", "sample"].forEach((f) => require(path.join(__dirname, "..", "js", f + ".js")));
const CT = globalThis.CT;

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log("  ✓", name); }
  catch (e) { console.error("  ✗", name, "\n   ", e.message); process.exitCode = 1; }
};
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const B = (type, o) => CT.createBlock(type, o);

console.log("Geometry");
test("W300 R150 彎頭中心線半徑 300、弧長 471mm", () => {
  const e = B("elbow90", { innerRadius: 150, width: 300 });
  near(CT.centerlineRadius(e), 300);
  near(CT.centerlineLength(e), 471.24, 0.01);
});
test("彎頭 B 端 = (Rc, Rc)，朝 90°", () => {
  const e = B("elbow90", { innerRadius: 150, width: 300 });
  near(e.connectors[1].worldX, 300); near(e.connectors[1].worldY, 300); near(e.connectors[1].worldDir, 90);
});
test("變徑兩端有效寬獨立", () => {
  const r = B("reducer", { widthStart: 300, widthEnd: 200 });
  assert.equal(CT.effectiveWidth(r, "A"), 300);
  assert.equal(CT.effectiveWidth(r, "B"), 200);
});

console.log("Graph");
test("單一 Tee / Cross 不產生假 Loop", () => {
  ["tee", "cross"].forEach((t) => {
    const g = CT.buildGraph([B(t, { id: "X" })], []);
    assert.equal(g.loopCount, 0, t);
  });
});
test("外部連接形成環才算 Loop", () => {
  const a = B("straight", { id: "A1", x: 0, y: 0, length: 500 });
  const b = B("straight", { id: "A2", x: 500, y: 0, length: 500 });
  const open = CT.buildGraph([a, b], [{ id: "c1", from: "A1:B", to: "A2:A" }]);
  assert.equal(open.loopCount, 0);
  const closed = CT.buildGraph([a, b], [{ id: "c1", from: "A1:B", to: "A2:A" }, { id: "c2", from: "A2:B", to: "A1:A" }]);
  assert.equal(closed.loopCount, 1);
});
test("Route 長度 = 直線 + 彎頭弧長", () => {
  const s1 = B("straight", { id: "S1", x: 0, y: 0, length: 1000, innerRadius: 150 });
  const el = B("elbow90", { id: "E1", x: 1000, y: 0, innerRadius: 150 });
  const g = CT.buildGraph([s1, el], [{ id: "c", from: "S1:B", to: "E1:A" }]);
  const routes = CT.getAllRoutes(g, [s1, el]);
  assert.equal(routes.length, 1);
  near(routes[0].length, 1000 + 471.24, 0.01);
});

console.log("Validator");
const conn = (a, b) => [{ id: "c", from: a, to: b }];
test("W300 ↔ W100 Straight → Warning，建議 Reducer", () => {
  const a = B("straight", { id: "A", x: 0, y: 0 });
  const b = B("straight", { id: "B", x: 1000, y: 0, width: 100 });
  assert.equal(CT.validateConnections([a, b], conn("A:B", "B:A"))[0].overall, "Warning");
});
test("Reducer 接對端 Valid、接錯端 Invalid", () => {
  const red = B("reducer", { id: "R", x: 1000, y: 0, widthStart: 300, widthEnd: 200 });
  const s300 = B("straight", { id: "S3", x: 0, y: 0, width: 300 });
  const s200 = B("straight", { id: "S2", x: 1600, y: 0, width: 200 });
  assert.equal(CT.validateConnections([s300, red], conn("S3:B", "R:A"))[0].overall, "Valid");
  assert.equal(CT.validateConnections([red, s200], conn("R:B", "S2:A"))[0].overall, "Valid");
  const wrong = B("straight", { id: "W2", x: 0, y: 0, width: 200 });
  assert.equal(CT.validateConnections([wrong, red], conn("W2:B", "R:A"))[0].overall, "Invalid");
});
test("System / FFL 不一致 → Warning；自迴路 → Invalid", () => {
  const a = B("straight", { id: "A", x: 0, y: 0 });
  const b = B("straight", { id: "B", x: 1000, y: 0, system: "POWER", elevation: 3200 });
  const r = CT.validateConnections([a, b], conn("A:B", "B:A"))[0];
  assert.equal(r.overall, "Warning");
  assert.ok(r.checks.filter((c) => c.status === "Warning").length >= 2);
  assert.equal(CT.validateConnections([a], conn("A:A", "A:B"))[0].overall, "Invalid");
});

console.log("Auto Elbow (v4)");

test("範例資料：偵測到 1 組，退縮 300mm", () => {
  const blocks = CT.sampleBlocks(); const conns = CT.sampleConnections();
  const { proposals } = CT.detectAutoElbows(blocks, conns);
  assert.equal(proposals.length, 1);
  const p = proposals[0];
  near(p.geometry.Rc, 300);
  near(p.geometry.C[0], 1080); near(p.geometry.C[1], 1050);
  const len = (id) => p.updateBlocks.find((u) => u.id === id).newLength;
  assert.equal(len("B8"), 700); // B8 800→700（退縮修短）
  assert.equal(len("B9"), 150); // B9 300→150
});
test("套用後：兩端點與彎頭重合、新連接全 Valid、Loop 不變", () => {
  const blocks = CT.sampleBlocks(); const conns = CT.sampleConnections();
  const r = CT.commitAutoElbow(blocks, conns, "B8:B", "B9:B");
  assert.ok(r.ok, r.reason);
  assert.equal(r.blocks.length, blocks.length + 1);
  assert.equal(r.connections.length, conns.length + 2);
  const v = CT.validateConnections(r.blocks, r.connections);
  assert.ok(v.slice(-2).every((x) => x.overall === "Valid"));
  assert.equal(CT.buildGraph(r.blocks, r.connections).loopCount, 0);
  const el = r.blocks.find((b) => b.type === "elbow90" && b.id.startsWith("EL-A"));
  const b8 = r.blocks.find((b) => b.id === "B8"); const b9 = r.blocks.find((b) => b.id === "B9");
  near(b8.connectors[1].worldX, el.connectors[1].worldX); near(b8.connectors[1].worldY, el.connectors[1].worldY);
  near(b9.connectors[1].worldX, el.connectors[0].worldX); near(b9.connectors[1].worldY, el.connectors[0].worldY);
});
test("交易式：不修改輸入；失敗時回傳 ok:false", () => {
  const blocks = CT.sampleBlocks(); const conns = CT.sampleConnections();
  const snap = JSON.stringify([blocks, conns]);
  CT.commitAutoElbow(blocks, conns, "B8:B", "B9:B");
  assert.equal(JSON.stringify([blocks, conns]), snap);
  const bad = CT.commitAutoElbow(blocks, conns, "B1:B", "B9:B"); // B1:B 已占用
  assert.equal(bad.ok, false);
  assert.equal(JSON.stringify([blocks, conns]), snap);
});
test("4 個方向、左轉右轉皆能插入且端點重合", () => {
  // X 朝右、Y 位於其上方或下方；再整體旋轉 0/90/180/270
  for (const rot of [0, 90, 180, 270]) {
    for (const side of [1, -1]) {
      const p = CT.createBlock("straight", { id: "P", innerRadius: 150, length: 800, x: 0, y: 0 });
      // Y 的 B 端朝向 C=(1000, side*1000)... 用 Y 朝 (0,side) 反方向
      const q = CT.createBlock("straight", { id: "Q", innerRadius: 150, length: 400, x: 1000, y: side * 1600, rotation: side === 1 ? 270 : 90 });
      // 整體旋轉：繞原點
      const rotate = (b) => {
        const w = CT.toWorld({ x: 0, y: 0, rotation: rot }, b.x, b.y);
        return CT.refresh({ ...b, x: w.x, y: w.y, rotation: (b.rotation + rot) % 360 });
      };
      const bl = [rotate(p), rotate(q)];
      const r2 = CT.commitAutoElbow(bl, [], "P:B", "Q:B");
      assert.ok(r2.ok, `rot=${rot} side=${side}: ${r2.reason}`);
      const el = r2.blocks.find((b) => b.id === "EL-A1");
      r2.connections.forEach((c) => {
        const a = CT.endpointOf(r2.blocks, c.from), b = CT.endpointOf(r2.blocks, c.to);
        near(a.k.worldX, b.k.worldX, 0.02); near(a.k.worldY, b.k.worldY, 0.02);
      });
      assert.ok(el);
    }
  }
});
test("範例中：B8:B + B9:B 才是朝向交點的一組", () => {
  const blocks = CT.sampleBlocks();
  const r = CT.buildProposal(blocks, CT.sampleConnections(), "B8:B", "B9:B");
  assert.ok(r.ok, r.reason);
});
test("屬性不一致會被擋下", () => {
  const mk = (o) => { const bl = CT.sampleBlocks(); const q = bl.find((b) => b.id === "B9"); Object.assign(q, o); return bl.map((b) => (b.id === "B9" ? CT.refresh(b) : b)); };
  assert.equal(CT.buildProposal(mk({ width: 200 }), [], "B8:B", "B9:B").ok, false);
  assert.equal(CT.buildProposal(mk({ system: "POWER" }), [], "B8:B", "B9:B").ok, false);
  assert.equal(CT.buildProposal(mk({ elevation: 3200 }), [], "B8:B", "B9:B").ok, false);
  assert.equal(CT.buildProposal(mk({ rotation: 80 }), [], "B8:B", "B9:B").ok, false);
});
test("退縮後長度不足 100mm → 擋下", () => {
  const bl = CT.sampleBlocks().map((b) => (b.id === "B9" ? CT.refresh({ ...b, y: 830, length: 120 }) : b));
  const r = CT.buildProposal(bl, [], "B8:B", "B9:B");
  assert.equal(r.ok, false);
});

console.log("Auto Reducer (v5.0)");
// P: W300 直線（B 端 x=1000）；Q: W200 直線（A 端 x=1400，朝左）→ 間距 400
const RP = (o) => B("straight", { id: "P", width: 300, x: 0, y: 0, length: 1000, ...o });
const RQ = (o) => B("straight", { id: "Q", width: 200, x: 1400, y: 0, length: 800, ...o });

test("W300 ↔ W200 直線 → 產生 Reducer proposal，A 端對 W300、B 端對 W200", () => {
  const r = CT.buildReducerProposal([RP(), RQ()], [], "P:B", "Q:A");
  assert.ok(r.ok, r.reason);
  const rd = r.proposal.addBlocks[0];
  assert.equal(rd.type, "reducer"); assert.equal(rd.widthStart, 300); assert.equal(rd.widthEnd, 200);
  assert.deepEqual(r.proposal.addConnections.map((c) => [c.from, c.to]), [["P:B", `${rd.id}:A`], [`${rd.id}:B`, "Q:A"]]);
  assert.equal(r.proposal.type, "AUTO_REDUCER");
});
test("傳入順序相反，A 端仍對較寬的一側", () => {
  const r = CT.buildReducerProposal([RP(), RQ()], [], "Q:A", "P:B");
  assert.ok(r.ok, r.reason);
  const rd = r.proposal.addBlocks[0];
  assert.equal(rd.widthStart, 300); assert.equal(rd.widthEnd, 200);
  assert.equal(r.proposal.sourceConnectors[0], "P:B");
});
test("System 不同 / FFL 不同 / 相同寬度 → 不產生 proposal", () => {
  assert.equal(CT.buildReducerProposal([RP(), RQ({ system: "POWER" })], [], "P:B", "Q:A").ok, false);
  assert.equal(CT.buildReducerProposal([RP(), RQ({ elevation: 3200 })], [], "P:B", "Q:A").ok, false);
  assert.equal(CT.buildReducerProposal([RP(), RQ({ width: 300 })], [], "P:B", "Q:A").ok, false);
});
test("不同軸（偏移）或未相對 → 不產生 proposal", () => {
  assert.equal(CT.buildReducerProposal([RP(), RQ({ y: 60 })], [], "P:B", "Q:A").ok, false);
  assert.equal(CT.buildReducerProposal([RP(), RQ({ rotation: 90 })], [], "P:B", "Q:A").ok, false);
  assert.equal(CT.buildReducerProposal([RP(), RQ({ x: 500 })], [], "P:B", "Q:A").ok, false); // 已重疊（間距為負）
});
test("套用後兩條新連接皆 Valid，原本的 Width mismatch Warning 消失", () => {
  const bl = [RP(), RQ()];
  const manual = CT.validateConnections(bl, [{ id: "m", from: "P:B", to: "Q:A" }])[0];
  assert.equal(manual.overall, "Warning");
  const r = CT.commitAutoReducer(bl, [], "P:B", "Q:A");
  assert.ok(r.ok, r.reason);
  const v = CT.validateConnections(r.blocks, r.connections);
  assert.equal(v.length, 2);
  assert.ok(v.every((x) => x.overall === "Valid"));
  assert.equal(r.connections.length, 2);
});
test("幾何：間距 400 → 變徑 300，兩側各調整 50；端點皆重合", () => {
  const r = CT.commitAutoReducer([RP(), RQ()], [], "P:B", "Q:A");
  const len = (id) => r.proposal.updateBlocks.find((u) => u.id === id).newLength;
  assert.equal(len("P"), 1050); assert.equal(len("Q"), 850);
  r.connections.forEach((c) => {
    const a = CT.endpointOf(r.blocks, c.from), b = CT.endpointOf(r.blocks, c.to);
    near(a.k.worldX, b.k.worldX, 0.02); near(a.k.worldY, b.k.worldY, 0.02);
  });
  // Q 的 A 端往左移 50 → x=1350，B 端保持在 2200
  const q = r.blocks.find((b) => b.id === "Q");
  near(q.connectors[0].worldX, 1350); near(q.connectors[1].worldX, 2200);
});
test("旋轉 180° 的相對配置也可處理", () => {
  const P = RP({ x: 2000, rotation: 180 }); // B 端在 x=1000，朝左
  const Q = RQ({ x: 0, length: 600 });      // B 端在 x=600，朝右
  const r = CT.commitAutoReducer([P, Q], [], "P:B", "Q:B");
  assert.ok(r.ok, r.reason);
  assert.equal(r.proposal.addBlocks[0].widthStart, 300);
});
test("occupied connector → 不允許", () => {
  const bl = [RP(), RQ(), B("straight", { id: "Z", width: 300, x: 1000, y: 0, length: 900, rotation: 0 })];
  const conns = [{ id: "c", from: "P:B", to: "Z:A" }];
  assert.equal(CT.buildReducerProposal(bl, conns, "P:B", "Q:A").ok, false);
  assert.equal(CT.commitAutoReducer(bl, conns, "P:B", "Q:A").ok, false);
});
test("空間 / 長度不足 → 不提交", () => {
  // 間距 100（<變徑 300）需各縮 100；Q 長度只有 150 → 縮後 50 < 100
  const r = CT.commitAutoReducer([RP(), RQ({ x: 1100, length: 150 })], [], "P:B", "Q:A");
  assert.equal(r.ok, false);
});
test("交易式：commit 失敗時輸入 blocks / connections 完全不變", () => {
  const bad = [RP(), RQ({ x: 1100, length: 150 })]; const cn = [];
  const snap = JSON.stringify([bad, cn]);
  assert.equal(CT.commitAutoReducer(bad, cn, "P:B", "Q:A").ok, false);
  assert.equal(JSON.stringify([bad, cn]), snap);
  const ok = [RP(), RQ()]; const snap2 = JSON.stringify([ok, cn]);
  assert.equal(CT.commitAutoReducer(ok, cn, "P:B", "Q:A").ok, true);
  assert.equal(JSON.stringify([ok, cn]), snap2);
});
test("Graph：Loop 不增加、子網路數不惡化", () => {
  const bl = [RP(), RQ()];
  const g1 = CT.buildGraph(bl, []);
  const r = CT.commitAutoReducer(bl, [], "P:B", "Q:A");
  const g2 = CT.buildGraph(r.blocks, r.connections);
  assert.ok(g2.loopCount <= g1.loopCount);
  assert.ok(g2.subgraphCount <= g1.subgraphCount);
});
test("連續執行第二次：不會再插入第二個 Reducer", () => {
  const r = CT.commitAutoReducer([RP(), RQ()], [], "P:B", "Q:A");
  assert.equal(CT.detectAutoReducers(r.blocks, r.connections).proposals.length, 0);
  assert.equal(CT.commitAutoReducer(r.blocks, r.connections, "P:B", "Q:A").ok, false);
});
test("範例資料：偵測到 1 組 Reducer（W200→W150）；Auto Elbow 仍為 1 組", () => {
  const bl = CT.sampleBlocks(), cn = CT.sampleConnections();
  const { proposals } = CT.detectAutoReducers(bl, cn);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].addBlocks[0].widthStart, 200); assert.equal(proposals[0].addBlocks[0].widthEnd, 150);
  assert.equal(CT.detectAutoElbows(bl, cn).proposals.length, 1);
});
test("Elbow 與 Reducer 可接續套用（範例資料 Loop 仍為 0）", () => {
  let bl = CT.sampleBlocks(), cn = CT.sampleConnections();
  const e = CT.commitAutoElbow(bl, cn, "B8:B", "B9:B"); assert.ok(e.ok, e.reason); bl = e.blocks; cn = e.connections;
  const r = CT.detectAutoReducers(bl, cn).proposals[0];
  const c = CT.commitAutoReducer(bl, cn, r.sourceConnectors[0], r.sourceConnectors[1]); assert.ok(c.ok, c.reason);
  assert.equal(CT.buildGraph(c.blocks, c.connections).loopCount, 0);
});

console.log("Auto Elbow 45° (v5.1)");
const TAN = Math.tan(Math.PI / 8); // tan(22.5°)
// X 朝東，B 端在 (1000,0)；Y 的端點朝 225°（右轉 45°）或 135°（左轉 45°）
// 交點 C=(1300,0)，t1=300、t2=500（可用參數覆寫）。整體可再繞原點旋轉 rot。
function elbow45Layout({ turn = "right", rot = 0, t2 = 500, lenY = 600, y = {} } = {}) {
  const C = [1300, 0];
  const dirY = turn === "right" ? 225 : 135;
  const u2 = [Math.cos((dirY * Math.PI) / 180), Math.sin((dirY * Math.PI) / 180)];
  const tip = [C[0] - t2 * u2[0], C[1] - t2 * u2[1]];
  const org = [tip[0] - lenY * u2[0], tip[1] - lenY * u2[1]]; // Y 的 A 端（B 端才是朝向 C 的端點）
  const rotate = (b) => {
    const w = CT.toWorld({ x: 0, y: 0, rotation: rot }, b.x, b.y);
    return CT.refresh({ ...b, x: w.x, y: w.y, rotation: (b.rotation + rot) % 360 });
  };
  const P = B("straight", { id: "P", innerRadius: 150, width: 300, x: 0, y: 0, length: 1000 });
  const Q = B("straight", { id: "Q", innerRadius: 150, width: 300, x: org[0], y: org[1], rotation: dirY, length: lenY, ...y });
  return [rotate(P), rotate(Q)];
}
const c45 = (bl, cn = []) => CT.commitAutoElbow(bl, cn, "P:B", "Q:B", 45);

test("退縮量 T = Rc·tan(22.5°) ≈ 124.26mm（Rc=300）；彎頭中心線長 = Rc·π/4", () => {
  const r = CT.buildProposal(elbow45Layout(), [], "P:B", "Q:B", 45);
  assert.ok(r.ok, r.reason);
  near(r.proposal.geometry.setback, 300 * TAN, 1e-9);
  near(r.proposal.geometry.setback, 124.264, 0.001);
  const el = CT.refresh(r.proposal.addBlocks[0]);
  assert.equal(el.type, "elbow45"); assert.equal(el.bendAngle, 45);
  near(CT.centerlineLength(el), (300 * Math.PI) / 4, 1e-9);
  assert.equal(r.proposal.type, "AUTO_ELBOW_45");
});
test("新長度 = 原長度 + t − T（P 1000→1175.74，Q 600→975.74）", () => {
  const r = c45(elbow45Layout());
  assert.ok(r.ok, r.reason);
  const len = (id) => r.proposal.updateBlocks.find((u) => u.id === id).newLength;
  near(len("P"), 1000 + 300 - 300 * TAN, 0.01); near(len("Q"), 600 + 500 - 300 * TAN, 0.01);
});
test("右轉 / 左轉、旋轉 0/90/180/270：皆成功，兩個 tangent point 與彎頭 A/B 精確重合", () => {
  for (const turn of ["right", "left"]) {
    for (const rot of [0, 90, 180, 270]) {
      const r = c45(elbow45Layout({ turn, rot }));
      assert.ok(r.ok, `${turn} rot=${rot}: ${r.reason}`);
      r.connections.forEach((c) => {
        const a = CT.endpointOf(r.blocks, c.from), b = CT.endpointOf(r.blocks, c.to);
        near(a.k.worldX, b.k.worldX, 0.02); near(a.k.worldY, b.k.worldY, 0.02);
      });
      const G = r.proposal.geometry, el = r.blocks.find((b) => b.id.startsWith("EL-A"));
      const [pa, pb] = [G.p1New, G.p2New];
      const hit = (pt) => el.connectors.some((k) => Math.hypot(k.worldX - pt[0], k.worldY - pt[1]) < 0.02);
      assert.ok(hit(pa) && hit(pb), `tangent points ${turn} ${rot}`);
    }
  }
});
test("套用後兩條連接皆 Valid，Loop 不增加、子網路不惡化", () => {
  const bl = elbow45Layout();
  const g1 = CT.buildGraph(bl, []);
  const r = c45(bl);
  assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"));
  const g2 = CT.buildGraph(r.blocks, r.connections);
  assert.ok(g2.loopCount <= g1.loopCount); assert.ok(g2.subgraphCount <= g1.subgraphCount);
});
test("角度容差：44° / 46° / 30° / 60° 不會被當成 45°；45° 版面不會被當成 90°", () => {
  const off = (d) => elbow45Layout({ y: { rotation: 225 + d } });
  // 直接改 Q 的 rotation 會使 B 端位置也變，這裡只需要驗證「夾角判斷」
  [-1, 1, -15, 15].forEach((d) => {
    const bl = off(d);
    assert.equal(CT.buildProposal(bl, [], "P:B", "Q:B", 45).ok, false, `Δ${d}`);
  });
  assert.equal(CT.buildProposal(elbow45Layout(), [], "P:B", "Q:B", 90).ok, false);
  assert.equal(CT.buildProposal(elbow45Layout(), [], "P:B", "Q:B", 30).ok, false); // 不支援的角度
});
test("90° 版面（L 型）不會被 45° 偵測抓到，45° 版面不會被 90° 偵測抓到", () => {
  assert.equal(CT.detectAutoElbows(CT.sampleBlocks(), CT.sampleConnections(), 45).proposals.length, 0);
  assert.equal(CT.detectAutoElbows(elbow45Layout(), [], 90).proposals.length, 0);
  assert.equal(CT.detectAutoElbows(elbow45Layout(), [], 45).proposals.length, 1);
});
test("長度不足 100mm → 失敗且輸入完全不變", () => {
  const bl = elbow45Layout({ t2: 0, lenY: 100 }); // Q 新長度 = 100 + 0 − 124 < 100
  const snap = JSON.stringify([bl, []]);
  assert.equal(c45(bl).ok, false);
  assert.equal(JSON.stringify([bl, []]), snap);
});
test("System / FFL / Width 不一致 → 失敗", () => {
  assert.equal(c45(elbow45Layout({ y: { system: "POWER" } })).ok, false);
  assert.equal(c45(elbow45Layout({ y: { elevation: 3200 } })).ok, false);
  assert.equal(c45(elbow45Layout({ y: { width: 200 } })).ok, false);
});
test("第二次執行不會再插入第二個 45° 彎頭", () => {
  const r = c45(elbow45Layout());
  assert.equal(CT.detectAutoElbows(r.blocks, r.connections, 45).proposals.length, 0);
  assert.equal(c45(r.blocks, r.connections).ok, false);
});
test("45° 與 90° 彎頭可在同一專案接續套用", () => {
  const e90 = CT.commitAutoElbow(CT.sampleBlocks(), CT.sampleConnections(), "B8:B", "B9:B");
  assert.ok(e90.ok, e90.reason);
  assert.ok(e90.blocks.some((b) => b.type === "elbow90" && b.id.startsWith("EL-A")));
});

console.log("Transaction contract (v5.2a：removeBlocks / removeConnections / replaces)");
// Z ──c1── M(0..2000)。手動把 M 拆成 M1 + M2，Z 的連接改接到 M1:A
const txM = () => B("straight", { id: "M", x: 0, y: 0, length: 2000 });
const txZ = () => B("straight", { id: "Z", x: -1000, y: 0, length: 1000 });
const txBase = () => ({ blocks: [txM(), txZ()], conns: [{ id: "c1", from: "Z:B", to: "M:A" }] });
const txSplit = (over = {}) => ({
  id: "split", type: "TEST_SPLIT", sourceConnectors: [],
  removeBlocks: ["M"], removeConnections: ["c1"], updateBlocks: [],
  addBlocks: [
    B("straight", { id: "M1", x: 0, y: 0, length: 1000 }),
    B("straight", { id: "M2", x: 1000, y: 0, length: 1000 }),
  ],
  addConnections: [
    { from: "M1:B", to: "M2:A" },
    { from: "Z:B", to: "M1:A", replaces: { id: "c1", oldKey: "M:A", newKey: "M1:A" } },
  ],
  ...over,
});
test("split proposal 通過驗證：M 被移除、M1/M2 加入、既有連接被替換", () => {
  const { blocks, conns } = txBase();
  const v = CT.checkProposal(blocks, conns, txSplit());
  assert.equal(v.errs.length, 0, v.errs.join(";"));
  assert.ok(!v.blocks.some((b) => b.id === "M")); assert.ok(v.blocks.some((b) => b.id === "M1") && v.blocks.some((b) => b.id === "M2"));
  assert.equal(v.connections.length, 2);
  assert.ok(!v.connections.some((c) => c.id === "c1"));
});
test("simulateProposal 固定順序：不修改輸入", () => {
  const { blocks, conns } = txBase();
  const snap = JSON.stringify([blocks, conns]);
  CT.simulateProposal(blocks, conns, txSplit());
  assert.equal(JSON.stringify([blocks, conns]), snap);
});
test("移除元件卻沒處理連接 → dangling connection 被擋", () => {
  const { blocks, conns } = txBase();
  const v = CT.checkProposal(blocks, conns, txSplit({ removeConnections: [], addConnections: [{ from: "M1:B", to: "M2:A" }] }));
  assert.ok(v.errs.some((e) => e.includes("不存在")));
});
test("移除連接但沒有替換 → 被擋", () => {
  const { blocks, conns } = txBase();
  const v = CT.checkProposal(blocks, conns, txSplit({ addConnections: [{ from: "M1:B", to: "M2:A" }] }));
  assert.ok(v.errs.some((e) => e.includes("沒有替換")));
});
test("替換後端點座標改變 → 被擋", () => {
  const { blocks, conns } = txBase();
  const bad = txSplit({ addBlocks: [B("straight", { id: "M1", x: 40, y: 0, length: 960 }), B("straight", { id: "M2", x: 1000, y: 0, length: 1000 })] });
  assert.ok(CT.checkProposal(blocks, conns, bad).errs.some((e) => e.includes("座標改變")));
});
test("要移除不存在的元件 / 連接 → 被擋", () => {
  const { blocks, conns } = txBase();
  assert.ok(CT.checkProposal(blocks, conns, txSplit({ removeBlocks: ["M", "NOPE"] })).errs.some((e) => e.includes("NOPE")));
  assert.ok(CT.checkProposal(blocks, conns, txSplit({ removeConnections: ["c1", "cX"] })).errs.some((e) => e.includes("cX")));
});
test("替換的連接不可比原本差；未動的連接維持原狀", () => {
  const { blocks, conns } = txBase();
  const worse = txSplit({ addBlocks: [B("straight", { id: "M1", x: 0, y: 0, length: 1000, system: "POWER" }), B("straight", { id: "M2", x: 1000, y: 0, length: 1000 })] });
  assert.ok(CT.checkProposal(blocks, conns, worse).errs.some((e) => e.includes("validator")));
});
test("純新增的連接必須 Valid（拆分後 M1:B↔M2:A 寬度不同 → 被擋）", () => {
  const { blocks, conns } = txBase();
  const bad = txSplit({ addBlocks: [B("straight", { id: "M1", x: 0, y: 0, length: 1000 }), B("straight", { id: "M2", x: 1000, y: 0, length: 1000, width: 200 })] });
  assert.ok(CT.checkProposal(blocks, conns, bad).errs.some((e) => e.includes("validator")));
});

console.log("Auto Tee (v5.2)");
// Main：W300、x 0→2000（y=0）；Branch：垂直，端點朝向主線（交點 J=(1000,0)，t=400）
const TM = (o) => B("straight", { id: "M", trayId: "MAIN", width: 300, x: 0, y: 0, length: 2000, ...o });
const TS = (o) => B("straight", { id: "S", trayId: "BR", width: 300, x: 1000, y: -1200, rotation: 90, length: 800, ...o });
const TSbelow = (o) => TS({ y: 1200, rotation: 270, ...o });
const rot4 = (bl, rot) => bl.map((b) => {
  const w = CT.toWorld({ x: 0, y: 0, rotation: rot }, b.x, b.y);
  return CT.refresh({ ...b, x: w.x, y: w.y, rotation: (b.rotation + rot) % 360 });
});
const tee = (bl, cn = []) => CT.commitAutoTee(bl, cn, "S:B", "M");
const allCoincide = (r) => r.connections.forEach((c) => {
  const a = CT.endpointOf(r.blocks, c.from), b = CT.endpointOf(r.blocks, c.to);
  if (!/^(TE|CX)-A/.test(c.id)) return;
  near(a.k.worldX, b.k.worldX, 0.02); near(a.k.worldY, b.k.worldY, 0.02);
});

test("T 字：Main 被拆成 Main-1 / Main-2 + Tee，Branch 修到 Tee:C", () => {
  const r = tee([TM(), TS()]);
  assert.ok(r.ok, r.reason);
  assert.ok(!r.blocks.some((b) => b.id === "M"));
  assert.deepEqual(r.blocks.map((b) => b.type).sort(), ["straight", "straight", "straight", "tee"]);
  assert.equal(r.proposal.type, "AUTO_TEE");
  assert.equal(r.connections.length, 3);
});
test("長度：Tee 600；Main-L = 1000−300 = 700，Main-R = 700（總長 700+600+700=2000）；Branch 800→900", () => {
  const r = tee([TM(), TS()]);
  const L = r.blocks.find((b) => b.id.startsWith("TL-A")), R = r.blocks.find((b) => b.id.startsWith("TR-A")), T = r.blocks.find((b) => b.type === "tee");
  near(L.length, 700); near(R.length, 700); near(T.length, 600);
  near(L.length + T.length + R.length, 2000);
  near(r.blocks.find((b) => b.id === "S").length, 900);
});
test("Tee A/B/C 與三條 Straight 端點精確重合；Tee C 朝向 Branch", () => {
  const r = tee([TM(), TS()]);
  allCoincide(r);
  const T = r.blocks.find((b) => b.type === "tee");
  const C = T.connectors.find((k) => k.id === "C");
  near(C.worldX, 1000); near(C.worldY, -300); near(C.worldDir, 270);
});
test("分支在上 / 下、整體旋轉 0/90/180/270：皆成功、端點重合、三條連接皆 Valid", () => {
  for (const mk of [TS, TSbelow]) {
    for (const rot of [0, 90, 180, 270]) {
      const r = tee(rot4([TM(), mk()], rot));
      assert.ok(r.ok, `rot=${rot}: ${r.reason}`);
      allCoincide(r);
      assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"), `valid rot=${rot}`);
    }
  }
});
test("Main 兩端本來就有連接（設備────Main────設備）：座標與連接保持，替換後仍 Valid", () => {
  const E1 = B("straight", { id: "E1", x: -1000, y: 0, length: 1000 });
  const E2 = B("straight", { id: "E2", x: 2000, y: 0, length: 1000 });
  const bl = [TM(), TS(), E1, E2];
  const cn = [{ id: "c1", from: "E1:B", to: "M:A" }, { id: "c2", from: "M:B", to: "E2:A" }];
  const r = tee(bl, cn);
  assert.ok(r.ok, r.reason);
  assert.equal(r.connections.length, 5);
  const L = r.blocks.find((b) => b.id.startsWith("TL-A")), R = r.blocks.find((b) => b.id.startsWith("TR-A"));
  near(L.connectors[0].worldX, 0); near(R.connectors[1].worldX, 2000);
  assert.ok(r.connections.some((c) => (c.from === "E1:B" && c.to === `${L.id}:A`) || (c.to === "E1:B" && c.from === `${L.id}:A`)));
  assert.ok(r.connections.some((c) => (c.from === "E2:A" && c.to === `${R.id}:B`) || (c.to === "E2:A" && c.from === `${R.id}:B`)));
  assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"));
  // 整條路徑仍連通：E1 → … → E2 是同一個子網路
  assert.equal(CT.buildGraph(r.blocks, r.connections).subgraphCount, 1);
});
test("Main 端點連接原本就有 Warning（System 不同的設備）：替換後不變差即可通過", () => {
  const E1 = B("straight", { id: "E1", x: -1000, y: 0, length: 1000, system: "POWER" });
  const cn = [{ id: "c1", from: "E1:B", to: "M:A" }];
  const r = tee([TM(), TS(), E1], cn);
  assert.ok(r.ok, r.reason);
});
test("Branch occupied → 失敗", () => {
  const Z = B("straight", { id: "Z", x: 1000, y: -400, length: 300, rotation: 270 });
  const bl = [TM(), TS(), Z];
  assert.equal(tee(bl, [{ id: "c", from: "S:B", to: "Z:A" }]).ok, false);
});
test("交點落在 Main 之外 / 太靠近端點 → 失敗且不修改輸入", () => {
  const outside = [TM(), TS({ x: 2500 })];
  const near1 = [TM(), TS({ x: 250 })]; // Main-L = 250−300 < 0
  const near2 = [TM(), TS({ x: 380 })]; // Main-L = 80 < 100
  [outside, near1, near2].forEach((bl) => {
    const snap = JSON.stringify([bl, []]);
    assert.equal(tee(bl).ok, false);
    assert.equal(JSON.stringify([bl, []]), snap);
  });
  assert.equal(tee([TM(), TS({ x: 400 })]).ok, true); // 邊界：Main-L = 100 剛好可以
});
test("Branch 朝向遠離主線 / 距離過遠 / 調整後長度不足 → 失敗", () => {
  assert.equal(tee([TM(), TS({ y: -1200, rotation: 270, x: 1000 })]).ok, false); // 端點朝上遠離
  assert.equal(tee([TM(), TS({ y: -4000 })]).ok, false); // t 太大
  assert.equal(tee([TM(), TS({ y: -300, length: 200 })]).ok, false); // tip 在 y=-100，t=100 → 新長度 200+100−300 < 100
});
test("System / FFL 不一致、非 90° → 失敗（寬度不同自 v5.3 起改為自動加 Reducer，見下）", () => {
  assert.equal(tee([TM(), TS({ system: "POWER" })]).ok, false);
  assert.equal(tee([TM(), TS({ elevation: 3200 })]).ok, false);
  assert.equal(tee([TM(), TS({ rotation: 80 })]).ok, false);
  assert.equal(tee([TM(), TS({ rotation: 45 })]).ok, false);
});
test("Loop 不憑空增加、subgraph 不惡化", () => {
  const bl = [TM(), TS()];
  const g1 = CT.buildGraph(bl, []);
  const r = tee(bl);
  const g2 = CT.buildGraph(r.blocks, r.connections);
  assert.equal(g2.loopCount, 0);
  assert.ok(g2.subgraphCount <= g1.subgraphCount);
  assert.equal(g2.subgraphCount, 1);
});
test("第二次執行不會再插 Tee", () => {
  const r = tee([TM(), TS()]);
  assert.equal(CT.detectAutoTees(r.blocks, r.connections).proposals.length, 0);
  assert.equal(tee(r.blocks, r.connections).ok, false);
});
test("交易式：失敗時輸入完全不變；成功時輸入也不被改動", () => {
  const ok = [TM(), TS()]; const snap = JSON.stringify([ok, []]);
  assert.equal(tee(ok).ok, true);
  assert.equal(JSON.stringify([ok, []]), snap);
});
test("偵測：只找 free 分支端點；Elbow / Reducer 偵測不受影響", () => {
  const bl = [TM(), TS()];
  const found = CT.detectAutoTees(bl, []).proposals;
  assert.equal(found.length, 1); assert.equal(found[0].sourceConnectors[0], "S:B");
  assert.equal(CT.detectAutoElbows(bl, [], 90).proposals.length, 0);
  assert.equal(CT.detectAutoReducers(bl, []).proposals.length, 0);
});
test("範例資料：偵測到 1 組 Tee；Elbow 與 Reducer 各 1 組不變", () => {
  const bl = CT.sampleBlocks(), cn = CT.sampleConnections();
  assert.equal(CT.detectAutoTees(bl, cn).proposals.length, 1);
  assert.equal(CT.detectAutoElbows(bl, cn).proposals.length, 1);
  assert.equal(CT.detectAutoReducers(bl, cn).proposals.length, 1);
});

console.log("Auto Tee + Branch Reducer (v5.3)");
const types = (r) => r.blocks.map((b) => b.type).sort().join(",");
const RED = (r) => r.blocks.find((b) => b.type === "reducer");
const TEE = (r) => r.blocks.find((b) => b.type === "tee");

test("W300 Main + W150 Branch → Tee + Reducer（W300→W150）一次成功，全部連接 Valid", () => {
  const r = tee([TM(), TS({ width: 150 })]);
  assert.ok(r.ok, r.reason);
  assert.equal(types(r), "reducer,straight,straight,straight,tee");
  assert.equal(TEE(r).width, 300);
  assert.equal(RED(r).widthStart, 300); assert.equal(RED(r).widthEnd, 150);
  assert.equal(r.connections.length, 4);
  assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"));
});
test("W150 Main + W300 Branch → Reducer A 端接寬端（分支側），Tee 以 Main 寬度為準", () => {
  const r = tee([TM({ width: 150 }), TS({ width: 300 })]);
  assert.ok(r.ok, r.reason);
  assert.equal(TEE(r).width, 150);
  assert.equal(RED(r).widthStart, 300); assert.equal(RED(r).widthEnd, 150);
  assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"));
  // A 端（寬）接 Branch，B 端（窄）接 Tee:C
  const rid = RED(r).id;
  assert.ok(r.connections.some((c) => [c.from, c.to].includes(`${rid}:A`) && [c.from, c.to].includes("S:B")));
  assert.ok(r.connections.some((c) => [c.from, c.to].includes(`${rid}:B`) && [c.from, c.to].includes(`${TEE(r).id}:C`)));
});
test("同寬 → 走原本的 Auto Tee，不會加 Reducer", () => {
  const r = tee([TM(), TS()]);
  assert.equal(types(r), "straight,straight,straight,tee");
  assert.equal(r.connections.length, 3);
  assert.equal(r.proposal.info.reducer, null);
});
test("Reducer A 永遠是寬端（多種寬度組合）", () => {
  [[300, 100], [300, 200], [200, 100], [100, 300], [150, 300], [200, 400]].forEach(([wm, wb]) => {
    const r = tee([TM({ width: wm }), TS({ width: wb })]);
    assert.ok(r.ok, `${wm}/${wb}: ${r.reason}`);
    assert.equal(RED(r).widthStart, Math.max(wm, wb)); assert.equal(RED(r).widthEnd, Math.min(wm, wb));
  });
});
test("Tee:C ↔ Reducer ↔ Branch 端點精確重合；Branch 長度 = 原長 + t − L/2 − 300", () => {
  const r = tee([TM(), TS({ width: 150 })]);
  allCoincide(r);
  near(r.blocks.find((b) => b.id === "S").length, 800 + 400 - 300 - 300); // 600
  // Reducer 位於 Tee:C(1000,-300) 與 Branch 新端點(1000,-600) 之間
  const xs = RED(r).connectors.map((k) => [k.worldX, k.worldY]).sort((a, b) => b[1] - a[1]);
  near(xs[0][1], -300); near(xs[1][1], -600); near(xs[0][0], 1000);
});
test("分支在上 / 下、整體旋轉 0/90/180/270（兩種寬度方向）：全部成功且 Valid", () => {
  for (const mk of [TS, TSbelow]) {
    for (const rot of [0, 90, 180, 270]) {
      [[300, 150], [150, 300]].forEach(([wm, wb]) => {
        const r = tee(rot4([TM({ width: wm }), mk({ width: wb })], rot));
        assert.ok(r.ok, `rot=${rot} ${wm}/${wb}: ${r.reason}`);
        allCoincide(r);
        assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"));
      });
    }
  }
});
test("Main 原 A/B 外部連接：座標與驗證等級維持（不同寬分支）", () => {
  const E1 = B("straight", { id: "E1", x: -1000, y: 0, length: 1000 });
  const E2 = B("straight", { id: "E2", x: 2000, y: 0, length: 1000 });
  const bl = [TM(), TS({ width: 150 }), E1, E2];
  const cn = [{ id: "c1", from: "E1:B", to: "M:A" }, { id: "c2", from: "M:B", to: "E2:A" }];
  const before = CT.validateConnections(bl, cn).map((v) => v.overall);
  const r = tee(bl, cn);
  assert.ok(r.ok, r.reason);
  assert.equal(r.connections.length, 6);
  const L = r.blocks.find((b) => b.id.startsWith("TL-A")), R = r.blocks.find((b) => b.id.startsWith("TR-A"));
  near(L.connectors[0].worldX, 0); near(R.connectors[1].worldX, 2000);
  assert.deepEqual(before, ["Valid", "Valid"]);
  assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"));
  assert.equal(CT.buildGraph(r.blocks, r.connections).subgraphCount, 1);
});
test("Branch 長度不足（含 Reducer 之後）→ 整筆 fail，輸入完全不變；同寬時同樣配置可成功", () => {
  const mk = (w) => [TM(), TS({ width: w, y: -500, length: 200 })]; // tip y=-300、t=300
  assert.equal(tee(mk(300)).ok, true); // 200+300−300 = 200
  const bad = mk(150); const snap = JSON.stringify([bad, []]);
  assert.equal(tee(bad).ok, false); // 200+300−300−300 = −100
  assert.equal(JSON.stringify([bad, []]), snap);
});
test("System / FFL 不同、Branch occupied → fail（不同寬時同樣適用）", () => {
  assert.equal(tee([TM(), TS({ width: 150, system: "POWER" })]).ok, false);
  assert.equal(tee([TM(), TS({ width: 150, elevation: 3200 })]).ok, false);
  const Z = B("straight", { id: "Z", width: 150, x: 1000, y: -400, length: 300, rotation: 270 });
  assert.equal(tee([TM(), TS({ width: 150 }), Z], [{ id: "c", from: "S:B", to: "Z:A" }]).ok, false);
});
test("Loop 不增加、subgraph 不惡化；成功時也不修改輸入", () => {
  const bl = [TM(), TS({ width: 150 })]; const snap = JSON.stringify([bl, []]);
  const g1 = CT.buildGraph(bl, []);
  const r = tee(bl);
  const g2 = CT.buildGraph(r.blocks, r.connections);
  assert.equal(g2.loopCount, 0); assert.ok(g2.subgraphCount <= g1.subgraphCount); assert.equal(g2.subgraphCount, 1);
  assert.equal(JSON.stringify([bl, []]), snap);
});
test("第二次執行不能再重複插 Tee / Reducer", () => {
  const r = tee([TM(), TS({ width: 150 })]);
  assert.equal(CT.detectAutoTees(r.blocks, r.connections).proposals.length, 0);
  assert.equal(CT.detectAutoReducers(r.blocks, r.connections).proposals.length, 0);
  assert.equal(tee(r.blocks, r.connections).ok, false);
});
test("Reducer 的寬度由既有 validator 判定：不會出現 Width mismatch", () => {
  const r = tee([TM({ width: 200 }), TS({ width: 100 })]);
  const v = CT.validateConnections(r.blocks, r.connections);
  assert.ok(v.every((x) => x.checks.filter((c) => c.name === "寬度匹配").every((c) => c.status === "Valid")));
});

console.log("Auto Cross (v5.4)");
// Main：W300、x 0→2000（y=0）；上方 Branch S（朝下）與下方 Branch S2（朝上）交在 J=(1000,0)，t 皆 400
const XS2 = (o) => TSbelow({ id: "S2", trayId: "BR2", ...o });
const XM = () => TM();
const cross = (bl, cn = [], a = "S:B", b = "S2:B") => CT.commitAutoCross(bl, cn, a, b, "M");
const XX = (r) => r.blocks.find((b) => b.type === "cross");
const xLayout = (o1, o2) => [XM(), TS(o1), XS2(o2)];

test("標準十字：Main 拆成兩段 + Cross，兩條 Branch 修到 Cross:C / D，共 4 條新連接皆 Valid", () => {
  const r = cross(xLayout());
  assert.ok(r.ok, r.reason);
  assert.equal(r.proposal.type, "AUTO_CROSS");
  assert.deepEqual(r.blocks.map((b) => b.type).sort(), ["cross", "straight", "straight", "straight", "straight"]);
  assert.ok(!r.blocks.some((b) => b.id === "M"));
  assert.equal(r.connections.length, 4);
  assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"));
});
test("長度：Cross 600×600；Main-L = Main-R = 700（700+600+700=2000）；兩條 Branch 800→900", () => {
  const r = cross(xLayout());
  const L = r.blocks.find((b) => b.id.startsWith("CL-A")), R = r.blocks.find((b) => b.id.startsWith("CR-A"));
  near(XX(r).length, 600); near(L.length, 700); near(R.length, 700);
  near(L.length + XX(r).length + R.length, 2000);
  near(r.blocks.find((b) => b.id === "S").length, 900); near(r.blocks.find((b) => b.id === "S2").length, 900);
});
test("Cross A/B/C/D 四個端點與四條 Straight 端點精確重合", () => {
  const r = cross(xLayout());
  allCoincide(r);
  const X = XX(r);
  const at = (id) => X.connectors.find((k) => k.id === id);
  near(at("A").worldX, 700); near(at("B").worldX, 1300);
  near(at("C").worldY, -300); near(at("D").worldY, 300); // 上方 Branch 接 C（−y），下方接 D（+y）
  assert.ok(r.connections.some((c) => [c.from, c.to].includes(`${X.id}:C`) && [c.from, c.to].includes("S:B")));
  assert.ok(r.connections.some((c) => [c.from, c.to].includes(`${X.id}:D`) && [c.from, c.to].includes("S2:B")));
});
test("整體旋轉 0/90/180/270、傳入順序互換：皆成功、端點重合、全部 Valid", () => {
  for (const rot of [0, 90, 180, 270]) {
    for (const swap of [false, true]) {
      const bl = rot4(xLayout(), rot);
      const r = swap ? cross(bl, [], "S2:B", "S:B") : cross(bl);
      assert.ok(r.ok, `rot=${rot} swap=${swap}: ${r.reason}`);
      allCoincide(r);
      assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"));
    }
  }
});
test("Main 兩端既有連接（設備────Main────設備）：座標與連接保持", () => {
  const E1 = B("straight", { id: "E1", x: -1000, y: 0, length: 1000 });
  const E2 = B("straight", { id: "E2", x: 2000, y: 0, length: 1000 });
  const bl = [...xLayout(), E1, E2];
  const cn = [{ id: "c1", from: "E1:B", to: "M:A" }, { id: "c2", from: "M:B", to: "E2:A" }];
  const r = cross(bl, cn);
  assert.ok(r.ok, r.reason);
  assert.equal(r.connections.length, 6);
  const L = r.blocks.find((b) => b.id.startsWith("CL-A")), R = r.blocks.find((b) => b.id.startsWith("CR-A"));
  near(L.connectors[0].worldX, 0); near(R.connectors[1].worldX, 2000);
  assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"));
  assert.equal(CT.buildGraph(r.blocks, r.connections).subgraphCount, 1);
});
test("任一 Branch occupied → fail", () => {
  const Z = B("straight", { id: "Z", x: 1000, y: -400, length: 300, rotation: 270 });
  const bl = [...xLayout(), Z];
  assert.equal(cross(bl, [{ id: "c", from: "S:B", to: "Z:A" }]).ok, false);
  const Z2 = B("straight", { id: "Z2", x: 1000, y: 400, length: 300, rotation: 90 });
  assert.equal(cross([...xLayout(), Z2], [{ id: "c", from: "S2:B", to: "Z2:A" }]).ok, false);
});
test("兩條 Branch 不在同一交點 / 不互為反向 / 不是 90° → fail", () => {
  assert.equal(cross(xLayout({}, { x: 1100 })).ok, false); // 交點錯開 100mm
  assert.equal(cross([XM(), TS(), TS({ id: "S2", y: -2400, x: 1000 })]).ok, false); // 兩條都在上方、同向
  assert.equal(cross(xLayout({}, { rotation: 275 })).ok, false); // 不是 90° 且不反向
  assert.equal(cross(xLayout({ rotation: 80 })).ok, false);
});
test("System / FFL 不一致 → fail（寬度不同自 v5.7 起改為自動加 Reducer，見下）", () => {
  assert.equal(cross(xLayout({ system: "POWER" })).ok, false);
  assert.equal(cross(xLayout({}, { elevation: 3200 })).ok, false);
});
test("交點太靠主線端點 / Branch 太短 / 朝向遠離 → fail，輸入完全不變", () => {
  const cases = [
    [XM(), TS({ x: 300 }), XS2({ x: 300 })],           // Main-L = 0
    [XM(), TS({ y: -500, length: 150 }), XS2()],       // tip y=-350 → t=350，新長度 150+350−300 = 200 OK；改用更短
    [XM(), TS({ y: -300, length: 120 }), XS2()],       // tip y=-180，t=180 → 120+180−300 < 100
    [XM(), TS({ y: -1200, rotation: 270 }), XS2()],    // 朝上遠離
  ];
  const bad = [cases[0], cases[2], cases[3]];
  bad.forEach((bl) => {
    const snap = JSON.stringify([bl, []]);
    assert.equal(cross(bl).ok, false);
    assert.equal(JSON.stringify([bl, []]), snap);
  });
});
test("Loop 不增加、subgraph 不惡化；成功時輸入不被修改", () => {
  const bl = xLayout(); const snap = JSON.stringify([bl, []]);
  const g1 = CT.buildGraph(bl, []);
  const r = cross(bl);
  const g2 = CT.buildGraph(r.blocks, r.connections);
  assert.equal(g2.loopCount, 0); assert.ok(g2.subgraphCount <= g1.subgraphCount); assert.equal(g2.subgraphCount, 1);
  assert.equal(JSON.stringify([bl, []]), snap);
});
test("第二次執行不會重複插 Cross（偵測為空、再次 commit 失敗）", () => {
  const r = cross(xLayout());
  assert.equal(CT.detectAutoCrosses(r.blocks, r.connections).proposals.length, 0);
  assert.equal(CT.detectAutoTees(r.blocks, r.connections).proposals.length, 0);
  assert.equal(cross(r.blocks, r.connections).ok, false);
});
test("偵測：十字配置找到 1 個 Cross；範例資料沒有 Cross；Tee 偵測對兩條分支各找到 1 個", () => {
  const bl = xLayout();
  const found = CT.detectAutoCrosses(bl, []).proposals;
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].sourceConnectors.slice().sort(), ["S2:B", "S:B"]);
  assert.equal(CT.detectAutoTees(bl, []).proposals.length, 2);
  assert.equal(CT.detectAutoCrosses(CT.sampleBlocks(), CT.sampleConnections()).proposals.length, 0);
});
test("Tee 與 Cross 可在同一專案接續套用（先 Cross，再對另一條 Main 插 Tee）", () => {
  const M2 = TM({ id: "M2", trayId: "MAIN2", x: 0, y: 3000 });
  const S3 = TS({ id: "S3", trayId: "BR3", y: 1800 }); // 朝下，端點 (1000,2600)，t=400
  const r1 = cross([...xLayout(), M2, S3]);
  assert.ok(r1.ok, r1.reason);
  const r2 = CT.commitAutoTee(r1.blocks, r1.connections, "S3:B", "M2");
  assert.ok(r2.ok, r2.reason);
  assert.equal(CT.buildGraph(r2.blocks, r2.connections).loopCount, 0);
});

console.log("Collision (v5.5)");
const OB = (o) => B("straight", { id: "Z", trayId: "OBST", width: 100, ...o });
const hasCollision = (r) => !r.ok && r.reason.includes("collision");

test("共邊 / 端點相接不算重疊；穿透 ≤ 1mm 不算；穿透 100mm 算", () => {
  const a = B("straight", { id: "A", x: 0, y: 0, length: 1000 });
  const at = (x) => B("straight", { id: "B", x, y: 0, length: 1000 });
  assert.equal(CT.findOverlaps([a, at(1000)]).length, 0);
  assert.equal(CT.findOverlaps([a, at(999.5)]).length, 0);
  const o = CT.findOverlaps([a, at(900)]);
  assert.equal(o.length, 1); near(o[0].depth, 100, 0.01);
});
test("旋轉後的矩形：交叉重疊、分離不重疊", () => {
  const a = B("straight", { id: "A", x: 0, y: 0, length: 1000 });
  const cross1 = B("straight", { id: "B", x: 500, y: -500, length: 1000, rotation: 90 });
  const apart = B("straight", { id: "C", x: 500, y: 300, length: 1000, rotation: 90 });
  assert.equal(CT.findOverlaps([a, cross1]).length, 1);
  assert.equal(CT.findOverlaps([a, apart]).length, 0);
});
test("彎頭：兩端相接不算；穿過圓環算；放在內側空腔（凹處）不算，證明不是外接框判斷", () => {
  const e = B("elbow90", { id: "E", x: 0, y: 0, innerRadius: 150, width: 300 });
  const atA = B("straight", { id: "S1", x: -500, y: 0, length: 500 });
  const atB = B("straight", { id: "S2", x: 300, y: 300, rotation: 90, length: 500 });
  assert.equal(CT.findOverlaps([e, atA, atB]).length, 0);
  const through = B("straight", { id: "S3", width: 40, x: 162, y: 88, length: 100 });      // 圓環中線中點附近
  assert.equal(CT.findOverlaps([e, through]).length, 1);
  const hollow = B("straight", { id: "S4", width: 40, x: 20, y: 270, length: 100 });       // 內半徑之內
  assert.equal(CT.findOverlaps([e, hollow]).length, 0);
});
test("Tee / Cross 內部兩根臂不互相比較；Auto Tee / Auto Cross 結果沒有任何重疊", () => {
  assert.equal(CT.findOverlaps([B("tee", { id: "T" })]).length, 0);
  assert.equal(CT.findOverlaps([B("cross", { id: "X" })]).length, 0);
  assert.equal(CT.findOverlaps(tee([TM(), TS()]).blocks).length, 0);
  assert.equal(CT.findOverlaps(tee([TM(), TS({ width: 150 })]).blocks).length, 0);
  assert.equal(CT.findOverlaps(cross(xLayout()).blocks).length, 0);
});
test("Auto Tee：新增的 Tee / 延伸的 Branch 壓到別的 Tray → 擋下，輸入完全不變", () => {
  // 障礙物在 Branch 原端點（y=-400）的外側，Branch 延伸到 y=-300 後才會與它重疊
  const bl = [TM(), TS(), OB({ x: 1100, y: -350, length: 300 })];
  assert.equal(CT.findOverlaps(bl).length, 0);
  const snap = JSON.stringify([bl, []]);
  const r = tee(bl);
  assert.ok(hasCollision(r), r.reason);
  assert.equal(JSON.stringify([bl, []]), snap);
  assert.equal(CT.detectAutoTees(bl, []).proposals.length, 0); // 不會出現在偵測清單
});
test("Auto Elbow：彎頭壓到別的 Tray → 擋下", () => {
  const P = B("straight", { id: "P", innerRadius: 150, length: 800 });
  const Q = B("straight", { id: "Q", innerRadius: 150, x: 1000, y: 1600, rotation: 270, length: 400 });
  assert.ok(CT.commitAutoElbow([P, Q], [], "P:B", "Q:B").ok); // 沒有障礙物時可行
  const bl = [P, Q, OB({ x: 850, y: 150, length: 100 })];
  assert.equal(CT.findOverlaps(bl).length, 0);
  const r = CT.commitAutoElbow(bl, [], "P:B", "Q:B");
  assert.ok(hasCollision(r), r.reason);
  assert.equal(CT.detectAutoElbows(bl, [], 90).proposals.length, 0);
});
test("Auto Reducer：變徑壓到別的 Tray → 擋下", () => {
  assert.ok(CT.commitAutoReducer([RP(), RQ()], [], "P:B", "Q:A").ok);
  const bl = [RP(), RQ(), OB({ x: 1200, y: 100, rotation: 90, length: 300 })];
  assert.equal(CT.findOverlaps(bl).length, 0);
  const r = CT.commitAutoReducer(bl, [], "P:B", "Q:A");
  assert.ok(hasCollision(r), r.reason);
});
test("Auto Cross：Cross 壓到別的 Tray → 擋下", () => {
  const bl = [...xLayout(), OB({ x: 1100, y: 250, length: 300 })];
  assert.equal(CT.findOverlaps(bl).length, 0);
  const r = cross(bl);
  assert.ok(hasCollision(r), r.reason);
  assert.equal(CT.detectAutoCrosses(bl, []).proposals.length, 0);
});
test("與提案無關、原本就存在的重疊不會讓提案失敗", () => {
  const far = [OB({ id: "Z1", x: 0, y: 3000, length: 1000 }), OB({ id: "Z2", x: 500, y: 3000, length: 1000 })];
  assert.equal(CT.findOverlaps(far).length, 1);
  assert.ok(CT.commitAutoReducer([RP(), RQ(), ...far], [], "P:B", "Q:A").ok);
  assert.ok(tee([TM(), TS(), ...far]).ok);
});
test("原 Main 既有的重疊會被拆出的 Main-1/2 繼承（derives），不算新增；但 Tee 自己壓到才算", () => {
  const farOverlap = OB({ id: "Z", x: 1500, y: 0, length: 300, rotation: 90 }); // 壓在 Main 右段（離 Tee 很遠）
  const bl = [TM(), TS(), farOverlap];
  assert.equal(CT.findOverlaps(bl).length, 1); // 只有 Z 與 M
  const r = tee(bl);
  assert.ok(r.ok, r.reason);
});
test("範例資料本身沒有任何重疊（畫布上不會出現紅框）", () => {
  assert.equal(CT.findOverlaps(CT.sampleBlocks()).length, 0);
});
test("範例資料：Elbow / Reducer / Tee 依序套用都不會產生新的重疊", () => {
  let bl = CT.sampleBlocks(), cn = CT.sampleConnections();
  const before = CT.findOverlaps(bl).length;
  const e = CT.commitAutoElbow(bl, cn, "B8:B", "B9:B"); assert.ok(e.ok, e.reason); bl = e.blocks; cn = e.connections;
  const r = CT.detectAutoReducers(bl, cn).proposals[0];
  const c = CT.commitAutoReducer(bl, cn, r.sourceConnectors[0], r.sourceConnectors[1]); assert.ok(c.ok, c.reason); bl = c.blocks; cn = c.connections;
  const t = CT.detectAutoTees(bl, cn).proposals[0];
  const d = CT.commitAutoTee(bl, cn, t.sourceConnectors[0], t.mainId); assert.ok(d.ok, d.reason);
  assert.equal(CT.findOverlaps(d.blocks).length, before);
});

console.log("Elevation-aware collision (v5.6)");
test("XY 完全重疊但 FFL 不同 → 不算碰撞；同 FFL 才算", () => {
  const a = B("straight", { id: "A", x: 0, y: 0, length: 1000, elevation: 3000 });
  const same = B("straight", { id: "B", x: 200, y: 0, length: 1000, elevation: 3000 });
  const diff = B("straight", { id: "B", x: 200, y: 0, length: 1000, elevation: 3600 });
  assert.equal(CT.findOverlaps([a, same]).length, 1);
  assert.equal(CT.findOverlaps([a, diff]).length, 0);
});
test("FFL 差多少都不設門檻：只要不同就不比較（1mm 也一樣）", () => {
  const a = B("straight", { id: "A", x: 0, y: 0, length: 1000, elevation: 3000 });
  const b = B("straight", { id: "B", x: 0, y: 0, length: 1000, elevation: 3001 });
  assert.equal(CT.findOverlaps([a, b]).length, 0);
});
test("不同 FFL 的障礙物不會擋 Auto Tee / Reducer / Cross / Elbow；同 FFL 的障礙物仍會擋", () => {
  const up = (o) => OB({ elevation: 3600, ...o });
  // Tee
  const tbl = (ob) => [TM(), TS(), ob({ x: 1100, y: -350, length: 300 })];
  assert.ok(tee(tbl(up)).ok);
  assert.ok(hasCollision(tee(tbl(OB))));
  // Reducer
  const rbl = (ob) => [RP(), RQ(), ob({ x: 1200, y: 100, rotation: 90, length: 300 })];
  assert.ok(CT.commitAutoReducer(rbl(up), [], "P:B", "Q:A").ok);
  assert.ok(hasCollision(CT.commitAutoReducer(rbl(OB), [], "P:B", "Q:A")));
  // Cross
  const xbl = (ob) => [...xLayout(), ob({ x: 1100, y: 250, length: 300 })];
  assert.ok(cross(xbl(up)).ok);
  assert.ok(hasCollision(cross(xbl(OB))));
  // Elbow
  const P = B("straight", { id: "P", innerRadius: 150, length: 800 });
  const Q = B("straight", { id: "Q", innerRadius: 150, x: 1000, y: 1600, rotation: 270, length: 400 });
  const ebl = (ob) => [P, Q, ob({ x: 850, y: 150, length: 100 })];
  assert.ok(CT.commitAutoElbow(ebl(up), [], "P:B", "Q:B").ok);
  assert.ok(hasCollision(CT.commitAutoElbow(ebl(OB), [], "P:B", "Q:B")));
});
test("新增的重疊只看同 FFL：Tee 的 Main 與 Branch 同 FFL，遇到不同 FFL 的舊 Tray 不受影響", () => {
  const under = OB({ id: "Zu", elevation: 2000, x: 0, y: -20, length: 2000, width: 300 }); // 正好在 Main 下方一層
  const r = tee([TM(), TS(), under]);
  assert.ok(r.ok, r.reason);
  assert.equal(CT.findOverlaps(r.blocks).length, 0);
});

console.log("Auto Cross + Branch Reducer (v5.7)");
const reds = (r) => r.blocks.filter((b) => b.type === "reducer");
const linked = (r, a, b) => r.connections.some((c) => [c.from, c.to].includes(a) && [c.from, c.to].includes(b));

test("Main W300 + Branch W150 / W200 → 2 個 Reducer（各自 W300→W150、W300→W200），全部連接 Valid", () => {
  const r = cross(xLayout({ width: 150 }, { width: 200 }));
  assert.ok(r.ok, r.reason);
  assert.equal(reds(r).length, 2);
  assert.deepEqual(reds(r).map((d) => `${d.widthStart}>${d.widthEnd}`).sort(), ["300>150", "300>200"]);
  assert.equal(XX(r).width, 300);
  assert.equal(r.connections.length, 6);
  assert.equal(r.proposal.info.reducerCount, 2);
  assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"));
});
test("Main W300 + Branch W300 / W150 → 只有 1 個 Reducer（在窄的那一側）；5 條新連接", () => {
  const r = cross(xLayout({}, { width: 150 }));
  assert.ok(r.ok, r.reason);
  assert.equal(reds(r).length, 1);
  assert.equal(r.connections.length, 5);
  assert.ok(linked(r, `${XX(r).id}:D`, `${reds(r)[0].id}:A`)); // 窄分支在下方 → 接 Cross:D，Reducer A（寬端）朝 Cross
  assert.ok(linked(r, `${XX(r).id}:C`, "S:B")); // 同寬的上方分支直接接 Cross:C
});
test("三者皆 W300 → 0 個 Reducer，維持 v5.4 行為（4 條連接）", () => {
  const r = cross(xLayout());
  assert.equal(reds(r).length, 0);
  assert.equal(r.connections.length, 4);
  assert.equal(r.proposal.info.reducer1, null); assert.equal(r.proposal.info.reducer2, null);
});
test("Main W150 + Branch W300 → Reducer A 在 Branch 側（寬端接 Branch），Cross 本體用 Main 寬度", () => {
  const r = cross([TM({ width: 150 }), TS({ width: 300 }), XS2({ width: 300 })]);
  assert.ok(r.ok, r.reason);
  assert.equal(XX(r).width, 150); near(XX(r).length, 300);
  assert.equal(reds(r).length, 2);
  reds(r).forEach((d) => { assert.equal(d.widthStart, 300); assert.equal(d.widthEnd, 150); });
  const [x1, x2] = [reds(r)[0].id, reds(r)[1].id];
  assert.ok(linked(r, `${x1}:A`, "S:B") || linked(r, `${x1}:A`, "S2:B"));
  assert.ok(linked(r, `${x2}:A`, "S:B") || linked(r, `${x2}:A`, "S2:B"));
  assert.ok(linked(r, `${x1}:B`, `${XX(r).id}:C`) || linked(r, `${x1}:B`, `${XX(r).id}:D`));
  assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"));
});
test("兩條 Branch 一寬一窄（Main W200；Branch-1 W300、Branch-2 W100）→ 兩顆 Reducer 方向各自正確", () => {
  const r = cross([TM({ width: 200 }), TS({ width: 300 }), XS2({ width: 100 })]);
  assert.ok(r.ok, r.reason);
  const X = XX(r);
  const rWide = reds(r).find((d) => d.widthEnd === 200); // 300→200：分支較寬
  const rNarrow = reds(r).find((d) => d.widthEnd === 100); // 200→100：主線較寬
  assert.equal(rWide.widthStart, 300); assert.equal(rNarrow.widthStart, 200);
  assert.ok(linked(r, `${rWide.id}:A`, "S:B") && linked(r, `${rWide.id}:B`, `${X.id}:C`)); // A（寬）在 Branch 側
  assert.ok(linked(r, `${rNarrow.id}:A`, `${X.id}:D`) && linked(r, `${rNarrow.id}:B`, "S2:B")); // A（寬）在 Cross 側
  assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"));
});
test("上/下 Branch、傳入順序互換、整體旋轉 0/90/180/270：全部成功、端點精確重合、全部 Valid", () => {
  for (const rot of [0, 90, 180, 270]) {
    for (const swap of [false, true]) {
      const bl = rot4(xLayout({ width: 150 }, { width: 200 }), rot);
      const r = swap ? cross(bl, [], "S2:B", "S:B") : cross(bl);
      assert.ok(r.ok, `rot=${rot} swap=${swap}: ${r.reason}`);
      allCoincide(r);
      assert.equal(reds(r).length, 2);
      assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"));
      assert.equal(CT.findOverlaps(r.blocks).length, 0);
    }
  }
});
test("Cross / Reducer / Branch 端點精確重合；Branch 新長度 = 原長 + t − L/2 − Reducer 長（同寬為 0）", () => {
  const r = cross(xLayout({ width: 150 }, {}));
  allCoincide(r);
  near(r.blocks.find((b) => b.id === "S").length, 800 + 400 - 300 - 300);  // 有 Reducer：600
  near(r.blocks.find((b) => b.id === "S2").length, 800 + 400 - 300);       // 同寬：900
  // 有 Reducer 那側：Cross:C (1000,-300) → Reducer → Branch 新端點 (1000,-600)
  const red = reds(r)[0];
  const ys = red.connectors.map((k) => k.worldY).sort((a, b) => b - a);
  near(ys[0], -300); near(ys[1], -600);
});
test("Main 原兩端既有連接：座標與驗證等級維持（含 Reducer）", () => {
  const E1 = B("straight", { id: "E1", x: -1000, y: 0, length: 1000 });
  const E2 = B("straight", { id: "E2", x: 2000, y: 0, length: 1000 });
  const bl = [...xLayout({ width: 150 }, { width: 200 }), E1, E2];
  const cn = [{ id: "c1", from: "E1:B", to: "M:A" }, { id: "c2", from: "M:B", to: "E2:A" }];
  const r = cross(bl, cn);
  assert.ok(r.ok, r.reason);
  assert.equal(r.connections.length, 8);
  const L = r.blocks.find((b) => b.id.startsWith("CL-A")), R = r.blocks.find((b) => b.id.startsWith("CR-A"));
  near(L.connectors[0].worldX, 0); near(R.connectors[1].worldX, 2000);
  assert.ok(CT.validateConnections(r.blocks, r.connections).every((v) => v.overall === "Valid"));
  assert.equal(CT.buildGraph(r.blocks, r.connections).subgraphCount, 1);
});
test("一側扣掉 Reducer 後 < 100mm → 整筆失敗；另一側足夠也不能部分提交；輸入完全不變", () => {
  const mk = (w1, w2) => [XM(), TS({ width: w1, y: -500, length: 200 }), XS2({ width: w2 })]; // Branch-1 tip y=-300、t=300
  assert.ok(cross(mk(300, 300)).ok);              // 同寬：200+300−300 = 200
  assert.ok(cross(mk(300, 150)).ok);              // 另一側有 Reducer 也足夠
  const bad = mk(150, 300); const snap = JSON.stringify([bad, []]);
  const r = cross(bad);                            // Branch-1：200+300−300−300 = −100
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify([bad, []]), snap);
  assert.equal(CT.detectAutoCrosses(bad, []).proposals.length, 0);
});
test("System / FFL 不同、任一 Branch occupied → 仍然失敗（不同寬時同樣適用）", () => {
  assert.equal(cross(xLayout({ width: 150, system: "POWER" }, { width: 150 })).ok, false);
  assert.equal(cross(xLayout({ width: 150 }, { width: 150, elevation: 3200 })).ok, false);
  const Z = B("straight", { id: "Z", width: 150, x: 1000, y: -400, length: 300, rotation: 270 });
  assert.equal(cross([...xLayout({ width: 150 }, { width: 150 }), Z], [{ id: "c", from: "S:B", to: "Z:A" }]).ok, false);
});
test("collision 擋住任一 Reducer → 整筆失敗（同 FFL 才擋；不同 FFL 不擋）", () => {
  const obst = (o) => OB({ x: 1100, y: -450, length: 300, ...o }); // 壓到上方 Reducer 寬端附近，原本不與任何 Tray 重疊
  const bl = (o) => [...xLayout({ width: 150 }, {}), obst(o)];
  assert.equal(CT.findOverlaps(bl()).length, 0);
  const snap = JSON.stringify([bl(), []]);
  const r = cross(bl());
  assert.ok(hasCollision(r), r.reason);
  assert.equal(JSON.stringify([bl(), []]), snap);
  assert.ok(cross(bl({ elevation: 3600 })).ok);
});
test("第二次偵測不再插入；偵測到不同寬的十字，且 sourceConnectors / mainId 正確", () => {
  const bl = xLayout({ width: 150 }, { width: 200 });
  const found = CT.detectAutoCrosses(bl, []).proposals;
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].sourceConnectors.slice().sort(), ["S2:B", "S:B"]);
  assert.equal(found[0].mainId, "M");
  const r = cross(bl);
  assert.equal(CT.detectAutoCrosses(r.blocks, r.connections).proposals.length, 0);
  assert.equal(CT.detectAutoTees(r.blocks, r.connections).proposals.length, 0);
  assert.equal(CT.detectAutoReducers(r.blocks, r.connections).proposals.length, 0);
  assert.equal(cross(r.blocks, r.connections).ok, false);
});
test("Loop 不增加、subgraph 不惡化；成功時輸入不被修改", () => {
  const bl = xLayout({ width: 150 }, { width: 200 }); const snap = JSON.stringify([bl, []]);
  const r = cross(bl);
  const g = CT.buildGraph(r.blocks, r.connections);
  assert.equal(g.loopCount, 0); assert.equal(g.subgraphCount, 1);
  assert.equal(JSON.stringify([bl, []]), snap);
});

console.log("Export");
test("DXF：AC1014、TRAY-LINK、無 AC1009 / TRAY-DIM / DIMENSION", () => {
  const bl = CT.sampleBlocks(); const dxf = CT.toDXF(bl, CT.sampleConnections());
  assert.ok(dxf.includes("AC1014")); assert.ok(dxf.includes("TRAY-LINK")); assert.ok(dxf.includes("LWPOLYLINE"));
  ["AC1009", "TRAY-DIM", "DIMENSION"].forEach((s) => assert.ok(!dxf.includes(s), s));
});
test("CSV 含引號跳脫", () => {
  const b = CT.sampleBlocks(); b[0].remark = 'a,"b"';
  assert.ok(CT.toCSV(b).includes('"a,""b"""'));
});

console.log(`\n${passed} passed`);
