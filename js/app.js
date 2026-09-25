/**
 * app.js — UI（純 DOM + SVG，無框架、無編譯）
 *
 * state 只有一份；任何修改都經過 setState()，再呼叫 render()。
 * Auto Elbow 的套用是「一次 setState({ blocks, connections })」，因此不會出現半完成狀態。
 */
(function () {
  const CT = globalThis.CT;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SNAP = 40;

  const state = {
    blocks: CT.sampleBlocks(),
    connections: CT.sampleConnections(),
    tab: "config",
    selectedId: "B1",
    pending: null, // 等待連接的第一個 connector key
    proposals: [],
    previewId: null,
    toast: null, // { text, error }
    filter: "All",
  };
  let toastTimer = null;
  let drag = null;

  function setState(patch) {
    Object.assign(state, patch);
    render();
  }
  function toast(text, error = false) {
    clearTimeout(toastTimer);
    setState({ toast: { text, error } });
    toastTimer = setTimeout(() => setState({ toast: null }), 5000);
  }

  /** 每次 render 只算一次的衍生資料 */
  function derive() {
    const graph = CT.buildGraph(state.blocks, state.connections);
    return {
      graph,
      routes: null, // 需要時才算
      validation: CT.validateConnections(state.blocks, state.connections),
    };
  }

  // ---------- 畫布 ----------
  const TYPE_LABEL = { straight: "直線", reducer: "異徑", elbow90: "彎頭90", elbow45: "彎頭45", tee: "三通", cross: "四通" };

  function polyPoints(poly) { return poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "); }

  function renderCanvas(d) {
    const parts = [];
    parts.push(`<defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="20" cy="20" r="0.9" class="grid-dot"/></pattern></defs><rect width="3000" height="1200" fill="url(#grid)"/>`);

    // Connection 線
    state.connections.forEach((c) => {
      const A = CT.endpointOf(state.blocks, c.from);
      const B = CT.endpointOf(state.blocks, c.to);
      if (!A || !B) return;
      const status = (d.validation.find((v) => v.id === c.id) || {}).overall;
      const color = status === "Invalid" ? "#ef4444" : status === "Warning" ? "#eab308" : "var(--ink)";
      const gap = Math.hypot(A.k.worldX - B.k.worldX, A.k.worldY - B.k.worldY);
      parts.push(`<line x1="${A.k.worldX}" y1="${A.k.worldY}" x2="${B.k.worldX}" y2="${B.k.worldY}" style="stroke:${color}" stroke-width="${status === "Invalid" ? 4 : 2.5}" ${status === "Warning" ? 'stroke-dasharray="8 6"' : ""}/>`);
      if (gap > 1) parts.push(`<circle cx="${(A.k.worldX + B.k.worldX) / 2}" cy="${(A.k.worldY + B.k.worldY) / 2}" r="7" style="fill:${color}"/>`);
    });

    // 元件
    state.blocks.forEach((b) => {
      const sel = state.selectedId === b.id;
      let g = `<g class="blk" data-block="${esc(b.id)}">`;
      CT.worldOutlines(b).forEach((poly) => {
        g += `<polygon points="${polyPoints(poly)}" class="shape${sel ? " sel" : ""}" stroke-width="${sel ? 3 : 2}" stroke-linejoin="round"/>`;
      });
      const label = b.type === "reducer" ? `${b.trayId} W${b.widthStart}→W${b.widthEnd}` : `${b.trayId} W${b.width} ${b.system}`;
      const top = CT.toWorld(b, b.type === "tee" || b.type === "cross" ? 0 : (b.type.startsWith("elbow") ? CT.centerlineRadius(b) / 2 : b.length / 2), -Math.max(b.width, b.widthStart, b.widthEnd) / 2 - 14);
      g += `<text x="${top.x}" y="${top.y}" text-anchor="middle" font-size="24" font-weight="700" class="svg-text" pointer-events="none">${esc(label)}</text>`;
      if (b.type === "tee" || b.type === "cross") {
        const j = d.graph.nodes.get(`${b.id}:J`);
        if (j) {
          b.connectors.forEach((k) => { g += `<line x1="${k.worldX}" y1="${k.worldY}" x2="${j.worldX}" y2="${j.worldY}" style="stroke:var(--mute)" stroke-dasharray="3 3"/>`; });
          g += `<circle cx="${j.worldX}" cy="${j.worldY}" r="7" class="junction" stroke-width="1.5"/>`;
        }
      }
      b.connectors.forEach((k) => {
        const key = `${b.id}:${k.id}`;
        const occ = (d.graph.nodes.get(key) || {}).occupiedCount || 0;
        const fillC = state.pending === key ? "#eab308" : occ > 0 ? "#a1a1aa" : "#22c55e";
        g += `<g class="conn" data-conn="${esc(key)}"><circle cx="${k.worldX}" cy="${k.worldY}" r="17" fill="${fillC}" style="stroke:var(--ink)" stroke-width="1.5"/><text x="${k.worldX}" y="${k.worldY + 6}" text-anchor="middle" font-size="16" font-weight="800" fill="#fff" pointer-events="none">${k.id}</text></g>`;
      });
      parts.push(g + "</g>");
    });

    // Auto Elbow 預覽
    const pr = state.proposals.find((p) => p.id === state.previewId);
    if (pr && pr.type === "AUTO_REDUCER") {
      const G = pr.geometry;
      const ghost = CT.worldOutlines(CT.refresh(pr.addBlocks[0])).map((poly) => `<polygon points="${polyPoints(poly)}" fill="#2563eb" fill-opacity="0.25" stroke="#2563eb" stroke-width="3"/>`).join("");
      parts.push(`<g pointer-events="none">${ghost}
        <text x="${(G.A[0] + G.B[0]) / 2}" y="${G.A[1] - pr.info.widthStart / 2 - 16}" text-anchor="middle" font-size="26" font-weight="700" fill="#2563eb">變徑 W${pr.info.widthStart}→W${pr.info.widthEnd}・長 ${CT.REDUCER_LEN}mm</text></g>`);
    } else if (pr) {
      const G = pr.geometry;
      const arc = `M ${G.p1New[0]} ${G.p1New[1]} A ${G.Rc} ${G.Rc} 0 0 1 ${G.p2New[0]} ${G.p2New[1]}`;
      parts.push(`<g pointer-events="none">
        <line x1="${G.p1[0]}" y1="${G.p1[1]}" x2="${G.C[0]}" y2="${G.C[1]}" stroke="#ef4444" stroke-width="2" stroke-dasharray="10 8"/>
        <line x1="${G.p2[0]}" y1="${G.p2[1]}" x2="${G.C[0]}" y2="${G.C[1]}" stroke="#ef4444" stroke-width="2" stroke-dasharray="10 8"/>
        <line x1="${G.p1New[0]}" y1="${G.p1New[1]}" x2="${G.C[0]}" y2="${G.C[1]}" stroke="#2563eb" stroke-width="3"/>
        <line x1="${G.p2New[0]}" y1="${G.p2New[1]}" x2="${G.C[0]}" y2="${G.C[1]}" stroke="#2563eb" stroke-width="3"/>
        <path d="${arc}" fill="none" stroke="#2563eb" stroke-width="${pr.info.width}" opacity="0.22"/>
        <path d="${arc}" fill="none" stroke="#2563eb" stroke-width="3"/>
        <circle cx="${G.C[0]}" cy="${G.C[1]}" r="12" fill="#ef4444"/>
        <text x="${G.C[0] + 18}" y="${G.C[1] - 14}" font-size="26" font-weight="700" fill="#ef4444">C・需退縮 ${G.Rc}mm</text></g>`);
    }
    $("canvas").innerHTML = parts.join("");
  }

  // ---------- 面板 ----------
  function renderProps(d) {
    const b = state.blocks.find((x) => x.id === state.selectedId);
    let html = `<div class="row" style="justify-content:space-between"><h3>選中元件屬性</h3>${b ? `<button class="btn small" data-act="delete">刪除</button>` : ""}</div>`;
    if (!b) return void ($("props").innerHTML = html + `<p class="hint">請點選一個元件</p>`);
    const num = (label, key, extra = "") => `<label>${label}<input type="number" data-prop="${key}" value="${b[key]}" ${extra}></label>`;
    const txt = (label, key) => `<label>${label}<input data-prop="${key}" data-text="1" value="${esc(b[key])}"></label>`;
    html += `<div class="form">
      ${txt("Tray ID", "trayId")}
      <label>System<select data-prop="system" data-text="1">${CT.SYSTEMS.map((s) => `<option ${s === b.system ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label>Type<input value="${b.type}" disabled></label>
      ${b.type === "reducer" ? num("寬度 起始", "widthStart") + num("寬度 終端", "widthEnd") : num("寬度 Width", "width")}
      ${b.type === "straight" || b.type === "reducer" || b.type === "tee" || b.type === "cross" ? num("長度 Length", "length") : ""}
      ${b.type.startsWith("elbow") ? num("內半徑 InnerRadius", "innerRadius") + num("彎角 BendAngle", "bendAngle") : ""}
      ${num("旋轉 Rotation°", "rotation")}
      ${num("FFL (mm)", "elevation")}
      ${txt("Route From", "from")}${txt("Route To", "to")}
      <label class="full">Remark<input data-prop="remark" data-text="1" value="${esc(b.remark)}"></label>
    </div>`;
    const inner = CT.validateComponent(b);
    if (inner.length) html += `<div class="note warn" style="margin-top:8px">⚠️ 內部檢查：${esc(inner.join("；"))}</div>`;
    html += `<div class="note" style="margin-top:8px"><b>中心線長度</b> ${CT.centerlineLength(b).toFixed(2)} mm${b.type.startsWith("elbow") ? `（Rc=${CT.centerlineRadius(b)}，弧長）` : ""}
      <div class="mono" style="margin-top:4px">${b.connectors.map((k) => {
        const key = `${b.id}:${k.id}`;
        const link = state.connections.find((c) => c.from === key || c.to === key);
        return `${k.id}: (${k.worldX.toFixed(0)}, ${k.worldY.toFixed(0)}) dir ${k.worldDir.toFixed(0)}° 有效寬 ${CT.effectiveWidth(b, k.id)} — ${link ? "已連接 " + (link.from === key ? link.to : link.from) : "未連接"}`;
      }).join("<br>")}</div></div>`;
    $("props").innerHTML = html;
  }

  function renderConnList(d) {
    let html = `<h3>連接清單（TRAY-LINK）</h3><div class="clist">`;
    state.connections.forEach((c) => {
      const v = d.validation.find((x) => x.id === c.id);
      const o = v ? v.overall : "Valid";
      html += `<div class="citem ${o}"><div><b>${esc(c.from)} ↔ ${esc(c.to)}</b><div class="hint">${v ? esc(v.checks.filter((x) => x.status !== "Valid").map((x) => x.detail).slice(0, 2).join(" | ") || "全部檢查通過") : ""}</div></div>
        <div><span class="badge ${o}">${o}</span> <button class="btn small" data-act="unlink" data-id="${esc(c.id)}">斷開</button></div></div>`;
    });
    if (!state.connections.length) html += `<p class="hint">尚無連接。點兩個 Connector 建立連接。</p>`;
    $("conn-list").innerHTML = html + "</div>";
  }

  function renderProposals() {
    $("proposals").innerHTML = state.proposals.map((p) => `
      <div class="proposal ${state.previewId === p.id ? "sel" : ""}">
        <div><b>${p.type === "AUTO_REDUCER" ? "變徑" : "彎頭"}：${esc(p.sourceConnectors[0])} ↔ ${esc(p.sourceConnectors[1])}</b>
          <div>${p.type === "AUTO_REDUCER"
            ? `W${p.info.widthStart}→W${p.info.widthEnd} ${esc(p.info.system)} FFL+${p.info.elevation} ｜ 間距 ${p.geometry.gap.toFixed(0)}mm ｜ 變徑長 ${CT.REDUCER_LEN}mm`
            : `W${p.info.width} ${esc(p.info.system)} FFL+${p.info.elevation} ｜ 夾角 90° ｜ 需退縮 ${p.geometry.Rc}mm ｜ t1=${p.geometry.t1.toFixed(0)} t2=${p.geometry.t2.toFixed(0)}`}</div>
          <div class="sub">${esc(p.info.trayX)} ${p.info.oldLenX}→${p.info.newLenX} ・ ${esc(p.info.trayY)} ${p.info.oldLenY}→${p.info.newLenY} ・ +1 ${p.type === "AUTO_REDUCER" ? "reducer" : "elbow90"} ・ +2 connections</div></div>
        <div class="row"><button class="btn small" data-act="preview" data-id="${esc(p.id)}">預覽</button>
          <button class="btn small dark" data-act="apply" data-id="${esc(p.id)}">套用</button>
          <button class="btn small" data-act="ignore" data-id="${esc(p.id)}">忽略</button></div>
      </div>`).join("");
    const t = $("toast");
    t.hidden = !state.toast;
    if (state.toast) { t.textContent = state.toast.text; t.className = "toast" + (state.toast.error ? " err" : ""); }
  }

  function renderRoutes(d) {
    const routes = CT.getAllRoutes(d.graph, state.blocks);
    const g = d.graph;
    const comp = state.blocks.reduce((s, b) => s + (b.type === "straight" || b.type === "reducer" ? b.length : 0), 0);
    const card = (k, v, s = "", hl = false) => `<div class="stat ${hl ? "hl" : ""}"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
    let html = `<h2>路徑分析（Graph Engine）</h2><div class="cards">
      ${card("元件數", state.blocks.length)}${card("連接數", state.connections.length)}${card("子網路數", g.subgraphCount)}
      ${card("孤立元件", g.isolatedCount, esc(g.isolatedBlocks.join(", ") || "無"), g.isolatedCount > 0)}
      ${card("迴圈數", g.loopCount, "Tee/Cross 以 Junction 節點建模，不會誤報", g.loopCount > 0)}
      ${card("全專案中心線合計", (g.totalCenterline / 1000).toFixed(3) + " m", "所有元件中心線加總（非單一 Route）")}
      ${card("直線+變徑 length 加總", (comp / 1000).toFixed(3) + " m", "元件 length 欄位，不含彎頭弧長")}
      ${card("Graph 節點", g.nodes.size, "含 Tee/Cross 的 Junction")}</div><h3>Routes（端點到端點）</h3>`;
    if (!routes.length) html += `<p class="hint">尚無 Route（需要至少一條連接）</p>`;
    routes.forEach((r) => {
      html += `<div class="route"><b>${r.id}</b> 中心線長 <b>${(r.length / 1000).toFixed(3)} m</b>
        <div class="mono">${r.path.map(esc).join(" → ")}</div>
        <div class="hint">${r.steps.map((s) => `${esc(s.trayId)}(${TYPE_LABEL[s.type] || s.type}) ${s.length.toFixed(0)}mm`).join(" + ") || "—"}</div></div>`;
    });
    $("view-routes").innerHTML = html;
  }

  function renderValidator(d) {
    const list = d.validation.filter((v) => state.filter === "All" || v.overall === state.filter);
    const cnt = (o) => d.validation.filter((v) => v.overall === o).length;
    let html = `<h2>Connection 驗證器</h2><div class="filter">${["All", "Valid", "Warning", "Invalid"].map((f) => `<button class="btn small ${state.filter === f ? "on" : ""}" data-filter="${f}">${f}${f === "All" ? ` (${d.validation.length})` : ` (${cnt(f)})`}</button>`).join("")}</div>`;
    list.forEach((v) => {
      html += `<div class="route"><b>${esc(v.from)} ↔ ${esc(v.to)}</b> <span class="badge ${v.overall}">${v.overall}</span>
        <table style="margin-top:6px"><tbody>${v.checks.map((c) => `<tr><td style="width:90px">${esc(c.name)}</td><td style="width:80px"><span class="badge ${c.status}">${c.status}</span></td><td>${esc(c.detail)}</td></tr>`).join("")}</tbody></table></div>`;
    });
    if (!list.length) html += `<p class="hint">沒有符合的連接</p>`;
    $("view-validator").innerHTML = html;
  }

  function renderBOM() {
    const total = state.blocks.reduce((s, b) => s + b.length, 0);
    const cl = state.blocks.reduce((s, b) => s + CT.centerlineLength(b), 0);
    let html = `<h2>BOM（數量與長度）</h2><p class="hint">僅列客觀可算的數量與長度；不提供重量（無製造商 / 型錄 / 材質資料）。</p>
      <table><thead><tr><th>#</th><th>Tray ID</th><th>類型</th><th>系統</th><th>寬度</th><th>length (mm)</th><th>中心線 (mm)</th><th>FFL</th><th>From→To</th></tr></thead><tbody>`;
    state.blocks.forEach((b, i) => {
      html += `<tr><td>${i + 1}</td><td>${esc(b.trayId)}</td><td>${TYPE_LABEL[b.type]}</td><td>${esc(b.system)}</td><td>${b.type === "reducer" ? `${b.widthStart}→${b.widthEnd}` : b.width}</td><td>${b.length}</td><td>${CT.centerlineLength(b).toFixed(1)}</td><td>+${b.elevation}</td><td>${esc(b.from)}→${esc(b.to)}</td></tr>`;
    });
    html += `</tbody><tfoot><tr><th colspan="5">合計</th><th>${total}</th><th>${cl.toFixed(1)}</th><th colspan="2"></th></tr></tfoot></table>
      <p class="hint">length 欄位加總（非中心線）＝ ${(total / 1000).toFixed(3)} m；元件中心線合計 ＝ ${(cl / 1000).toFixed(3)} m。</p>`;
    $("view-bom").innerHTML = html;
  }

  function renderChrome(d) {
    $("tabs").innerHTML = [["config", "配置"], ["routes", "路徑分析"], ["validator", "驗證器"], ["bom", "BOM"]]
      .map(([k, l]) => `<button class="tab ${state.tab === k ? "active" : ""}" data-tab="${k}">${l}</button>`).join("");
    ["config", "routes", "validator", "bom"].forEach((k) => {
      const v = $("view-" + k);
      v.hidden = state.tab !== k;
      v.classList.toggle("pad", k !== "config");
    });
    $("stats").innerHTML = `元件 ${state.blocks.length} ・ 連接 ${state.connections.length} ・ 孤立 ${d.graph.isolatedCount} ・ loop ${d.graph.loopCount}<br>中心線合計 ${(d.graph.totalCenterline / 1000).toFixed(3)} m`;
    const p = $("pending");
    p.hidden = !state.pending;
    p.textContent = state.pending ? `已選 ${state.pending} → 請點下一個 Connector` : "";
  }

  function render() {
    const d = derive();
    renderChrome(d);
    if (state.tab === "config") { renderCanvas(d); renderProps(d); renderConnList(d); renderProposals(); }
    if (state.tab === "routes") renderRoutes(d);
    if (state.tab === "validator") renderValidator(d);
    if (state.tab === "bom") renderBOM();
  }

  // ---------- 操作 ----------
  function nextId() {
    let n = state.blocks.length + 1;
    while (state.blocks.some((b) => b.id === `B${n}`)) n++;
    return n;
  }
  function addBlock(type) {
    const n = nextId();
    const b = CT.createBlock(type, { id: `B${n}`, trayId: `T-${String(n).padStart(2, "0")}`, x: 400 + (n % 4) * 300, y: 400 + Math.floor(n / 4) * 200 });
    setState({ blocks: [...state.blocks, b], selectedId: b.id });
  }
  function updateSelected(key, value) {
    setState({ blocks: state.blocks.map((b) => (b.id === state.selectedId ? CT.refresh({ ...b, [key]: value }) : b)) });
  }
  function deleteSelected() {
    const id = state.selectedId;
    setState({
      blocks: state.blocks.filter((b) => b.id !== id),
      connections: state.connections.filter((c) => !c.from.startsWith(id + ":") && !c.to.startsWith(id + ":")),
      selectedId: null, proposals: [], previewId: null,
    });
  }
  function clickConnector(key) {
    if (!state.pending) return setState({ pending: key });
    if (state.pending === key) return setState({ pending: null });
    const exists = state.connections.some((c) => (c.from === state.pending && c.to === key) || (c.from === key && c.to === state.pending));
    const conns = exists ? state.connections : [...state.connections, { id: `C${Date.now()}`, from: state.pending, to: key }];
    setState({ connections: conns, pending: null, proposals: [], previewId: null });
  }
  function detect(kind) {
    const isRed = kind === "reducer";
    const { proposals, notes } = isRed ? CT.detectAutoReducers(state.blocks, state.connections) : CT.detectAutoElbows(state.blocks, state.connections);
    setState({ proposals, previewId: proposals[0] ? proposals[0].id : null });
    const what = isRed ? "變徑" : "90° 彎頭";
    if (proposals.length) toast(`偵測到 ${proposals.length} 個可插入${what}的位置`);
    else toast(`未偵測到可插入${what}的位置` + (notes.length ? "：" + notes[0] : ""), true);
  }
  function applyProposal(id) {
    const pr = state.proposals.find((p) => p.id === id);
    if (!pr) return;
    // 以目前狀態重新 build + validate；成功才一次 setState（blocks + connections 同時更新）
    const commit = pr.type === "AUTO_REDUCER" ? CT.commitAutoReducer : CT.commitAutoElbow;
    const r = commit(state.blocks, state.connections, pr.sourceConnectors[0], pr.sourceConnectors[1]);
    if (!r.ok) {
      setState({ proposals: state.proposals.filter((p) => p.id !== id), previewId: null });
      return toast("套用失敗，狀態未變更：" + r.reason, true);
    }
    const i = r.proposal.info;
    const el = r.proposal.addBlocks[0];
    setState({ blocks: r.blocks, connections: r.connections, proposals: [], previewId: null, selectedId: el.id });
    toast(`已插入 ${el.trayId}；${i.trayX} ${i.oldLenX}→${i.newLenX}，${i.trayY} ${i.oldLenY}→${i.newLenY}`);
  }
  function download(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- 事件 ----------
  function svgPoint(ev) {
    const svg = $("canvas");
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  $("canvas").addEventListener("pointerdown", (ev) => {
    const conn = ev.target.closest("[data-conn]");
    if (conn) return clickConnector(conn.dataset.conn);
    const blk = ev.target.closest("[data-block]");
    if (!blk) return setState({ selectedId: null, pending: null });
    const b = state.blocks.find((x) => x.id === blk.dataset.block);
    const p = svgPoint(ev);
    drag = { id: b.id, dx: p.x - b.x, dy: p.y - b.y };
    $("canvas").setPointerCapture(ev.pointerId);
    setState({ selectedId: b.id });
  });
  $("canvas").addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const p = svgPoint(ev);
    const x = Math.round((p.x - drag.dx) / SNAP) * SNAP;
    const y = Math.round((p.y - drag.dy) / SNAP) * SNAP;
    const cur = state.blocks.find((b) => b.id === drag.id);
    if (!cur || (cur.x === x && cur.y === y)) return;
    setState({ blocks: state.blocks.map((b) => (b.id === drag.id ? CT.refresh({ ...b, x, y }) : b)), proposals: [], previewId: null });
  });
  const endDrag = () => { drag = null; };
  $("canvas").addEventListener("pointerup", endDrag);
  $("canvas").addEventListener("pointercancel", endDrag);

  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-tab],[data-act],[data-filter]");
    if (!t) return;
    if (t.dataset.tab) return setState({ tab: t.dataset.tab });
    if (t.dataset.filter) return setState({ filter: t.dataset.filter });
    const id = t.dataset.id;
    switch (t.dataset.act) {
      case "delete": return deleteSelected();
      case "unlink": return setState({ connections: state.connections.filter((c) => c.id !== id), proposals: [], previewId: null });
      case "preview": return setState({ previewId: id });
      case "apply": return applyProposal(id);
      case "ignore": return setState({ proposals: state.proposals.filter((p) => p.id !== id), previewId: state.previewId === id ? null : state.previewId });
    }
  });

  // 屬性輸入（change 事件：輸入完成才更新，避免打字時整個重繪失去焦點）
  $("props").addEventListener("change", (ev) => {
    const el = ev.target.closest("[data-prop]");
    if (!el) return;
    const key = el.dataset.prop;
    if (el.dataset.text) return updateSelected(key, el.value);
    const v = parseFloat(el.value);
    updateSelected(key, Number.isFinite(v) ? v : 0);
    setState({ proposals: [], previewId: null });
  });

  $("add-buttons").innerHTML = Object.entries(TYPE_LABEL).map(([t, l]) => `<button class="btn" data-add="${t}">${l}</button>`).join("");
  $("add-buttons").addEventListener("click", (ev) => { const t = ev.target.closest("[data-add]"); if (t) addBlock(t.dataset.add); });
  $("btn-detect").addEventListener("click", () => detect("elbow"));
  $("btn-detect-reducer").addEventListener("click", () => detect("reducer"));
  $("btn-dxf").addEventListener("click", () => download(CT.toDXF(state.blocks, state.connections), "cable-tray-sketch-AC1014.dxf", "application/dxf"));
  $("btn-csv").addEventListener("click", () => download(CT.toCSV(state.blocks), "bom.csv", "text/csv;charset=utf-8"));
  $("btn-json").addEventListener("click", () => download(CT.toJSON(state.blocks, state.connections, CT.buildGraph(state.blocks, state.connections)), "graph.json", "application/json"));
  $("btn-sample").addEventListener("click", () => setState({ blocks: CT.sampleBlocks(), connections: CT.sampleConnections(), selectedId: "B1", pending: null, proposals: [], previewId: null }));
  $("btn-clear").addEventListener("click", () => setState({ blocks: [], connections: [], selectedId: null, pending: null, proposals: [], previewId: null }));

  // ---------- 外觀：亮/暗版與文字大小（記在 localStorage） ----------
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 無痕模式等情況忽略 */ } },
  };
  const SCALES = [1, 1.15, 1.3, 1.5];
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $("btn-theme").textContent = theme === "dark" ? "☀️ 亮版" : "🌙 暗版";
    store.set("ct-theme", theme);
  }
  function applyScale(i) {
    i = Math.max(0, Math.min(SCALES.length - 1, i));
    document.documentElement.style.setProperty("--scale", SCALES[i]);
    $("btn-font-minus").disabled = i === 0;
    $("btn-font-plus").disabled = i === SCALES.length - 1;
    store.set("ct-scale", i);
    scaleIdx = i;
  }
  let scaleIdx = parseInt(store.get("ct-scale"), 10);
  if (!(scaleIdx >= 0 && scaleIdx < SCALES.length)) scaleIdx = 1; // 預設較大字（parseInt(null) 為 NaN）
  applyTheme(store.get("ct-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  applyScale(scaleIdx);
  $("btn-theme").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("btn-font-minus").addEventListener("click", () => applyScale(scaleIdx - 1));
  $("btn-font-plus").addEventListener("click", () => applyScale(scaleIdx + 1));

  // 給除錯 / 自動化測試用
  globalThis.CTApp = { state, setState };
  render();
})();
