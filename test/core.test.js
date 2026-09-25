// 執行：node test/core.test.js （或 npm test）
const assert = require("node:assert/strict");
const path = require("node:path");
["geometry", "graph", "validator", "transaction", "autoelbow", "autoreducer", "export", "sample"].forEach((f) => require(path.join(__dirname, "..", "js", f + ".js")));
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
