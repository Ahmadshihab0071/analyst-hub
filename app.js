/* The page: sign-in, task list, and the work area for each task. */
(function () {
  const H = window.HUB, S = H.store, $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const tname = t => cap(HUB.fill(t.name, H.ctx()));
  const today = () => new Date().toISOString().slice(0, 10);
  const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  let WK = null, current = S.get("current", "weekly"), filter = "All", query = "", controller = null;

  /* ---------- sign in ---------- */
  function lockScreen(msg = "") {
    $("#app").style.display = "none"; $("#lock").style.display = "grid";
    $("#lockcard").innerHTML = `
      <h1>Analyst Hub</h1>
      <form id="lf" style="display:grid;gap:12px">
        <div><label for="em">Email</label><input type="text" id="em" autocomplete="username" inputmode="email" required></div>
        <div><label for="pw">Password</label><input type="password" id="pw" autocomplete="current-password" required></div>
        <button class="btn main" type="submit">Sign in</button>
        <p class="hint">Accounts are created by your admin. Forgot your password? Ask the admin to reset it.</p>
        <p class="err" id="lerr">${esc(msg)}</p>
      </form>`;
    $("#lf").addEventListener("submit", async e => {
      e.preventDefault(); const err = $("#lerr"); err.textContent = "";
      const { error } = await H.sb.auth.signInWithPassword({ email: $("#em").value.trim(), password: $("#pw").value });
      if (error) return err.textContent = /invalid/i.test(error.message) ? "Wrong email or password." : /banned/i.test(error.message) ? "Your access has been turned off. Ask the admin." : error.message;
      boot();
    });
    setTimeout(() => $("#em")?.focus(), 50);
  }
  async function boot() {
    const { data: { session } } = await H.sb.auth.getSession();
    if (!session) return lockScreen();
    const [{ data: me, error: e1 }, { data: org }] = await Promise.all([
      H.sb.from("profiles").select("*").eq("id", session.user.id).single(),
      H.sb.from("org_settings").select("*").eq("id", 1).single()]);
    if (e1 || !me) { await H.sb.auth.signOut(); return lockScreen("Your profile is missing. Ask the admin to check your account."); }
    if (!me.active) { await H.sb.auth.signOut(); return lockScreen("Your access has been turned off. Ask the admin."); }
    H.me = me; if (org) H.org = org;
    $("#lock").style.display = "none"; $("#app").style.display = "block";
    renderTop(); renderNav(); renderWork();
    H.loadBrand().catch(e => console.warn(e));
  }
  function renderTop() {
    const R = HUB.regionInfo(H.me.regions);
    $("#who").innerHTML = `${esc(H.me.full_name || H.me.email)} · Covering <b>${esc(R.short)}</b>${H.me.role === "admin" ? " · Admin" : ""}`;
  }

  /* ---------- left column ---------- */
  function renderNav() {
    $("#chips").innerHTML = H.GROUPS.map(g => `<button class="chip" type="button" data-g="${g}" aria-pressed="${g === filter}">${g}</button>`).join("");
    const shown = H.TASKS.filter(t => (filter === "All" || t.g === filter) && HUB.fill(t.name + " " + t.desc, H.ctx()).toLowerCase().includes(query.toLowerCase()));
    $("#tlist").innerHTML = H.GROUPS.slice(1).filter(g => shown.some(t => t.g === g)).map(g =>
      `<div class="tgroup">${g}</div>` + shown.filter(t => t.g === g).map(t =>
        `<button class="titem" type="button" data-t="${t.id}" aria-current="${t.id === current}"><span>${esc(tname(t))}</span><small>${esc(t.freq)}</small></button>`).join("")).join("")
      || `<p class="hint">No task matches.</p>`;
    $("#tlist").insertAdjacentHTML("beforeend", `<div class="tgroup">Setup</div><button class="titem" type="button" data-t="settings" aria-current="${current === "settings"}"><span>Settings</span><small>${H.me?.role === "admin" ? "Admin" : ""}</small></button>`);
    H.items.list("draft", null, 8).then(drafts => {
      $("#recent").innerHTML = drafts.length ? `<div class="tgroup">Recent drafts</div>` + drafts.map(d =>
        `<button class="titem" type="button" data-draft="${d.id}"><span>${esc(d.title)}</span><small>${esc(d.created_at.slice(5, 10))}</small></button>`).join("") : "";
    }).catch(() => {});
  }

  /* ---------- progress log ---------- */
  function progress(el) {
    const lines = [];
    const paint = () => el.innerHTML = lines.map((l, i) => `<div>${i === lines.length - 1 && controller ? '<span class="spin"></span>' : ""}${l}</div>`).join("");
    return { add(html) { lines.push(html); paint(); el.scrollTop = el.scrollHeight; }, done() { paint(); },
      onEvent(ev) {
        if (ev.type === "search") this.add(`Searching: <b>${esc(ev.query)}</b>`);
        else if (ev.type === "status") this.add(esc(ev.text));
        else if (ev.type === "text" && !this.writing) { this.writing = true; this.add("Writing"); }
      } };
  }
  async function guard(btn, fn) {
    controller = new AbortController(); btn && (btn.disabled = true);
    try { await fn(controller.signal); }
    catch (e) {
      if (e.name === "AbortError") return;
      const msg = e.status === 401 && /session/i.test(e.message) ? "Your session expired. Sign in again." :
        /credit/i.test(e.message) ? "The Claude API credit has run out. Ask the admin to add credit in the Anthropic console." :
        e.status === 401 ? "The Claude API key was rejected. Ask the admin to check it in the Worker settings." : e.message;
      const box = document.querySelector("#out") || $("#work");
      box.insertAdjacentHTML("afterbegin", `<p class="err">Something went wrong: ${esc(msg)}</p>`);
    } finally { controller = null; btn && (btn.disabled = false); renderNav(); }
  }

  /* ---------- work area ---------- */
  function renderWork() {
    if (current === "settings") return renderSettings();
    const t = H.TASKS.find(x => x.id === current) || H.TASKS[0];
    S.set("current", t.id);
    const cx = H.ctx();
    const head = `<div class="head"><h2>${esc(tname(t))}</h2><p>${esc(HUB.fill(t.desc, cx))} <span class="stat">${esc(HUB.regionInfo(cx.regions).short)}</span></p></div>`;
    if (t.kind === "topics") return renderWeekly(head);
    $("#work").innerHTML = head + `
      <div class="form">
        <div><label for="notes">Your input and notes</label><textarea id="notes" placeholder="Paste your text, points or numbers, and anything Claude should keep in mind">${esc(S.get("notes:" + t.id, ""))}</textarea></div>
        ${t.files ? `<div><label for="files">Attach files (chart image, PDF, CSV, TXT)</label><input type="file" id="files" multiple accept="image/png,image/jpeg,image/webp,application/pdf,.csv,.txt,.md,.tsv"><p class="hint">Save Word or Excel files as PDF or CSV first.</p></div>` : ""}
        <div class="row"><button class="btn main" id="run" type="button">Run</button><button class="btn" id="stop" type="button">Stop</button>
          ${t.search ? `<span class="hint">Searches the web</span>` : ""}</div>
      </div>
      <div class="log" id="log" hidden></div>
      <div id="out"></div>`;
    H.items.list("result", t.id, 1).then(r => { if (r[0] && $("#out") && !$("#out").innerHTML) showText(t, r[0].data.md, r[0].created_at.slice(0, 10)); }).catch(() => {});
    $("#notes").addEventListener("input", e => S.set("notes:" + t.id, e.target.value));
    $("#stop").onclick = () => controller?.abort();
    $("#run").onclick = () => guard($("#run"), async signal => {
      const notes = $("#notes").value.trim(), files = [...($("#files")?.files || [])];
      if (!notes && !files.length && !t.search) throw new Error("Add your text or attach a file first.");
      const log = $("#log"); log.hidden = false; const p = progress(log); p.add(t.search ? "Researching" : "Working");
      const content = [...await H.fileBlocks(files), { type: "text", text: H.taskPrompt(H.ctx(), t, notes, today()) }];
      const md = await H.ask({ content, searches: t.search ? 15 : 0, maxTokens: 12000, signal, onEvent: e => p.onEvent(e) });
      p.add("Done"); p.done();
      H.items.add("result", { task: t.id, title: tname(t), data: { md } }).catch(e => console.warn(e));
      showText(t, md, today());
    });
  }

  function showText(t, md, date) {
    const html = DOMPurify.sanitize(marked.parse(md.replace(/==(.+?)==/g, "<mark>$1</mark>")));
    $("#out").innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:10px"><span class="stat">Result from ${esc(date)}</span>
      <span class="row"><button class="btn small" id="copy" type="button">Copy</button><button class="btn small" id="dl" type="button">Download Word</button></span></div>
      <div class="doc md">${html}</div>`;
    $("#copy").onclick = async () => { try { await navigator.clipboard.writeText(md.replace(/==(.+?)==/g, "$1")); $("#copy").textContent = "Copied"; } catch (e) { $("#copy").textContent = "Select the text to copy"; } };
    $("#dl").onclick = async () => { const n = tname(t); download(await H.mdToDocx(md, n), `${n} ${date}.docx`); };
  }

  function download(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name.replace(/[^\w .-]+/g, "_");
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------- weekly topics -> draft ---------- */
  async function renderWeekly(head) {
    $("#work").innerHTML = head + `<p class="hint">Loading</p>`;
    const key = H.ctx().regions.slice().sort().join(",");
    const last = (await H.items.list("topics", key, 1).catch(() => []))[0];
    const wk = last ? { ...last.data, date: last.created_at.slice(0, 10) } : null;
    WK = wk;
    $("#work").innerHTML = head + `
      <div class="band"><span><b>${wk ? "Topics from " + esc(wk.date) : "No topics yet this week"}</b><br>Research takes 3 to 6 minutes.</span>
        <span class="row"><button class="btn" style="background:#fff;color:#0b0b10;border-color:#fff" id="find" type="button">${wk ? "Find new topics" : "Find this week's topics"}</button>
        <button class="btn" style="color:#fff;border-color:#fff" id="stop" type="button">Stop</button></span></div>
      <div class="log" id="log" hidden></div>
      <div id="out"></div>`;
    $("#stop").onclick = () => controller?.abort();
    $("#find").onclick = () => guard($("#find"), async signal => {
      const log = $("#log"); log.hidden = false; const p = progress(log); p.add("Researching the last 7 days");
      const past = await H.items.list("topics", key, 6).catch(() => []);
      const history = past.flatMap(p => [...(p.data.smartphone || []), ...(p.data.ai || [])].map(x => `- ${p.created_at.slice(0, 10)}: ${x.topic}`)).join("\n");
      const text = await H.ask({ content: H.topicsPrompt(H.ctx(), today(), daysAgo(7), history), searches: H.settings().topicSearches, signal, onEvent: e => p.onEvent(e) });
      const data = H.extractJSON(text);
      data.smartphone = (data.smartphone || []).slice(0, 5); data.ai = (data.ai || []).slice(0, 5); data.date = today();
      await H.items.add("topics", { task: key, title: "Topics " + data.date, data });
      p.add("Done"); p.done(); renderWeekly(head);
    });
    if (wk) showTopics(wk);
  }

  function showTopics(wk) {
    const table = (title, items) => `<h3 style="margin-top:6px">${title}</h3><div class="scroll"><table class="stack"><thead><tr><th>Topic</th><th>Stories we could write</th><th>Why it's hot</th><th></th></tr></thead><tbody>${
      items.map(x => `<tr><td><span class="code">${esc(x.code)}</span><b>${esc(x.topic)}</b></td>
        <td><ul>${(x.stories || []).map(s => `<li>${esc(s)}</li>`).join("")}</ul></td>
        <td>${esc(x.why_hot)}<div style="margin-top:6px">${(x.evidence || []).map(e => `<div><a href="${esc(/^https?:/.test(e.url) ? e.url : "#")}" target="_blank" rel="noopener">${esc(e.outlet)}</a> <span class="hint">${esc(e.date)}</span></div>`).join("")}</div></td>
        <td><button class="btn small go" type="button" data-write="${esc(x.code)}">Write this</button></td></tr>`).join("")}</tbody></table></div>`;
    $("#out").innerHTML = `
      <div class="form"><div><label for="dnotes">Notes for the draft (optional)</label>
        <textarea id="dnotes" placeholder="e.g. focus on Saudi Arabia and Egypt, mention the HONOR angle, LinkedIn length">${esc(S.get("notes:weekly", ""))}</textarea></div>
        <div><label for="newt">Or write about your own topic</label><div class="row"><input type="text" id="newt" placeholder="e.g. eSIM adoption in Egypt" style="flex:1 1 240px"><button class="btn" type="button" data-write="NEW">Write this</button></div></div></div>
      ${table("Smartphones", wk.smartphone)}${table("AI", wk.ai)}
      <div id="draftlog" class="log" hidden></div><div id="draft"></div>`;
    $("#dnotes").addEventListener("input", e => S.set("notes:weekly", e.target.value));
  }

  async function writeDraft(code, btn, previous) {
    const wk = WK || { smartphone: [], ai: [] };
    let topic;
    if (previous) topic = previous.topic;
    else if (code === "NEW") { const t = $("#newt").value.trim(); if (!t) return $("#newt").focus(); topic = JSON.stringify({ topic: t, note: "New topic from Ahmad" }); }
    else { const x = [...wk.smartphone, ...wk.ai].find(y => y.code === code); topic = JSON.stringify({ topic: x.topic, why_hot: x.why_hot, stories: x.stories, evidence: x.evidence }, null, 1); }
    let notes = ($("#dnotes")?.value || "").trim();
    if (previous) notes = ($("#rnotes").value.trim() || "Tighten and improve it.") + "\n\nRevise this earlier draft rather than starting over:\n" + JSON.stringify(previous.draft);
    await guard(btn, async signal => {
      const log = $("#draftlog"); log.hidden = false; log.innerHTML = ""; const p = progress(log);
      p.add(previous ? "Revising the draft" : "Researching and drafting " + esc(code === "NEW" ? "your topic" : code));
      const s = H.settings();
      let d = H.extractJSON(await H.ask({ content: H.draftPrompt(H.ctx(), topic, notes, today(), s.maxWords, s.maxCharts), searches: s.draftSearches, maxTokens: 20000, signal, onEvent: e => p.onEvent(e) }));
      d.charts = (d.charts || []).slice(0, s.maxCharts);
      for (let i = 0; i < 2 && (H.contentWords(d) > s.maxWords || H.estPages(d) > 3); i++) {
        p.add(`Too long (${H.contentWords(d)} words), cutting to fit 3 pages`);
        d = H.extractJSON(await H.ask({ content: H.shortenPrompt(d, H.contentWords(d), s.maxWords, s.maxCharts), maxTokens: 16000, signal }));
        d.charts = (d.charts || []).slice(0, s.maxCharts);
      }
      p.add("Done"); p.done();
      const entry = { id: null, date: today(), code, topic, draft: d };
      try { entry.id = (await H.items.add("draft", { task: "weekly", title: d.title || "Draft", data: { code, topic, draft: d } })).id; } catch (e) { console.warn(e); }
      showDraft(entry); renderNav();
    });
  }

  function richHTML(t) {
    return esc(t).replace(/\[\[VERIFY:([\s\S]*?)\|\|([\s\S]*?)\]\]/g, (m, a, b) => `<mark title="${b.trim()}">${a.trim().replace(/\*\*/g, "")}</mark>`)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  }
  function showDraft(entry) {
    const d = entry.draft, charts = Object.fromEntries((d.charts || []).map(c => [c.id, c])), used = new Set();
    const chartImg = id => { const c = charts[id]; if (!c || used.has(id)) return ""; used.add(id); return `<img alt="${esc(c.title)}" src="${H.drawChart(c).toDataURL("image/png")}">`; };
    const conc = Array.isArray(d.conclusion) ? d.conclusion : (d.conclusion ? [d.conclusion] : []);
    let body = `<h1>${esc(d.title)}</h1><p class="meta">Draft for review · ${esc(entry.date)}</p>`;
    if (d.takeaways?.length) body += `<h2>Key takeaways</h2><ul>${d.takeaways.map(t => `<li>${richHTML(t)}</li>`).join("")}</ul>`;
    if (d.introduction) body += `<h2>Introduction</h2><p>${richHTML(d.introduction)}</p>`;
    (d.sections || []).forEach(s => { body += `<h2>${esc(s.heading)}</h2>` + (s.paragraphs || []).map(p => `<p>${richHTML(p)}</p>`).join("") + (s.chart_after ? chartImg(s.chart_after) : ""); });
    Object.keys(charts).forEach(id => body += chartImg(id));
    if (conc.length) body += `<h2>Conclusion</h2>` + conc.map(p => `<p>${richHTML(p)}</p>`).join("");
    if (d.sources?.length) body += `<h2>Sources</h2><ol>${d.sources.map(s => `<li>${esc(s.publisher)}, ${esc(s.title)}, ${esc(s.date)}. <a href="${esc(/^https?:/.test(s.url) ? s.url : "#")}" target="_blank" rel="noopener">link</a></li>`).join("")}</ol>`;
    if (d.editor_notes?.length) body += `<h2>Notes for you</h2><ul>${d.editor_notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>`;
    const target = $("#draft") || $("#out");
    target.innerHTML = `
      <div class="row" style="justify-content:space-between;margin:8px 0 10px">
        <span class="stats"><span class="stat">${H.contentWords(d)} words</span><span class="stat">About ${H.estPages(d).toFixed(1)} of 3 pages</span><span class="stat">${(d.charts || []).length} chart(s)</span><span class="stat">${H.verifyCount(d)} to verify (yellow)</span></span>
        <button class="btn go" id="dlw" type="button">Download Word</button></div>
      <div class="doc">${body}</div>
      <div class="form" style="margin-top:14px"><div><label for="rnotes">Want changes? Describe them and revise</label><textarea id="rnotes" placeholder="e.g. shorter intro, add the Egypt VAT angle, more Clarkson in the title"></textarea></div>
        <div class="row"><button class="btn main" id="revise" type="button">Revise draft</button></div></div>`;
    $("#dlw").onclick = async () => { $("#dlw").textContent = "Building"; download(await H.buildDocx(d), (d.title || "Draft") + ".docx"); $("#dlw").textContent = "Download Word"; };
    $("#revise").onclick = () => { if (!$("#draftlog")) target.insertAdjacentHTML("beforebegin", '<div id="draftlog" class="log" hidden></div>'); writeDraft(entry.code, $("#revise"), entry); };
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- events ---------- */
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-g]"); if (g) { filter = g.dataset.g; return renderNav(); }
    const t = e.target.closest("[data-t]"); if (t) { if (controller) return; current = t.dataset.t; renderNav(); return renderWork(); }
    const w = e.target.closest("[data-write]"); if (w) return writeDraft(w.dataset.write, w);
    const r = e.target.closest("[data-draft]");
    if (r) { if (controller) return; H.sb.from("items").select("*").eq("id", r.dataset.draft).single().then(async ({ data }) => {
      if (!data) return; current = "weekly"; renderNav(); await renderWork();
      showDraft({ id: data.id, date: data.created_at.slice(0, 10), code: data.data.code, topic: data.data.topic, draft: data.data.draft }); }); }
  });
  $("#q").addEventListener("input", e => { query = e.target.value; renderNav(); });
  $("#b-lock").onclick = async () => { await H.sb.auth.signOut(); lockScreen("Signed out."); };
  $("#b-settings").onclick = () => { if (controller) return; current = "settings"; renderNav(); renderWork(); };
  H.sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT") lockScreen(); });

  /* ---------- settings page ---------- */
  function regionPicker(id, sel) {
    const names = { ME: "Middle East", AF: "Africa", APAC: "APAC", IN: "India", CN: "China", EE: "East Europe", WE: "West Europe", LATAM: "LATAM", NA: "North America" };
    return `<div class="regions" id="${id}" data-sel="${sel.join(",")}">` + HUB.REGION_GROUPS.map(g => `<div class="rgroup">` + g.map(k =>
      `<button type="button" class="chip" data-region="${k}" aria-pressed="${sel.includes(k)}">${names[k]}</button>`).join("") + `</div>`).join("") + `</div>`;
  }
  function pickerValue(id) { return ($("#" + id).dataset.sel || "").split(",").filter(Boolean); }
  function setPicker(id, sel) { const el = $("#" + id); el.dataset.sel = sel.join(","); el.querySelectorAll("[data-region]").forEach(b => b.setAttribute("aria-pressed", sel.includes(b.dataset.region))); }

  async function renderSettings() {
    const me = H.me, admin = me.role === "admin", o = H.org;
    $("#work").innerHTML = `<div class="head"><h2>Settings</h2><p>Your region drives every task: topics, drafts, research and commentary.</p></div>
      <div class="form">
        <h3>My coverage</h3>
        <div><label>Region</label>${regionPicker("my-reg", me.regions)}
          <p class="hint">Allowed: Middle East and/or Africa · APAC, India and/or China · East and/or West Europe · LATAM with North America.</p>
          <p class="hint" id="my-reg-label"></p></div>
        <div class="grid2"><div><label for="my-name">Name (used on drafts)</label><input type="text" id="my-name" value="${esc(me.full_name)}"></div>
          <div><label for="my-title">Title</label><input type="text" id="my-title" value="${esc(me.job_title)}"></div></div>
        <div class="row"><button class="btn main" type="button" id="save-me">Save my settings</button><span class="hint" id="me-msg"></span></div>
      </div>
      ${admin ? `
      <div class="form">
        <h3>Document branding <span class="stat">Admin</span></h3>
        <p class="hint">Used in every Word file anyone downloads. Changes apply to everyone from their next sign-in.</p>
        ${brandRow("font", "Font (regular)", ".ttf,.otf", o.font_file, o.font_name ? "Font name: " + o.font_name : "")}
        ${brandRow("fontbold", "Font (bold, optional)", ".ttf,.otf", o.font_bold_file, "")}
        ${brandRow("template", "Word template", ".docx,.dotx", o.template_file, "Styles, page setup, header and footer. If a logo is uploaded, the logo replaces the template's header.")}
        ${brandRow("logo", "Logo", ".png,.jpg,.jpeg", o.logo_file, "PNG or JPG. Shown top right in the document header.")}
        <div><label for="font-name">Font name used in Word (read from the font file; change only if Word shows the wrong font)</label><input type="text" id="font-name" value="${esc(o.font_name || "")}" placeholder="Filled in when you upload a font"></div>
        <p class="hint">PowerPoint templates aren't used yet: the hub only produces Word files today.</p>
      </div>
      <div class="form">
        <h3>Claude <span class="stat">Admin</span></h3>
        <div class="grid2"><div><label for="o-model">Model</label><select id="o-model"><option value="claude-opus-5-5">Claude Opus 5.5 (best writing)</option><option value="claude-sonnet-5-5">Claude Sonnet 5.5 (cheaper, faster)</option></select></div>
          <div><label for="o-words">Max words per draft (700 fits 3 pages with 2 charts)</label><input type="number" id="o-words" min="300" max="900" value="${o.max_words}"></div>
          <div><label for="o-search">Web searches for weekly topics</label><input type="number" id="o-search" min="10" max="60" value="${o.topic_searches}"></div></div>
        <div class="row"><button class="btn main" type="button" id="save-org">Save</button><span class="hint" id="org-msg"></span></div>
      </div>
      <div class="form">
        <h3>Users <span class="stat">Admin</span></h3>
        <div id="users"><p class="hint">Loading</p></div>
        <h3 style="font-size:18px">Add a user</h3>
        <div class="grid2"><div><label for="nu-email">Email</label><input type="text" id="nu-email" inputmode="email"></div>
          <div><label for="nu-pass">Password (8+ characters)</label><input type="text" id="nu-pass" autocomplete="off"></div>
          <div><label for="nu-name">Name</label><input type="text" id="nu-name"></div>
          <div><label for="nu-role">Role</label><select id="nu-role"><option value="analyst">Analyst</option><option value="admin">Admin</option></select></div></div>
        <div><label>Region</label>${regionPicker("nu-reg", ["ME", "AF"])}</div>
        <div class="row"><button class="btn go" type="button" id="add-user">Add user</button><span class="hint" id="nu-msg"></span></div>
        <p class="hint">Share the email and password with them privately. They can change their region later in Settings.</p>
      </div>` : ""}`;
    const showLabel = () => $("#my-reg-label").textContent = pickerValue("my-reg").length ? "Covering: " + HUB.regionInfo(pickerValue("my-reg")).label : "Pick at least one region.";
    showLabel(); $("#my-reg").addEventListener("click", () => setTimeout(showLabel));
    $("#save-me").onclick = async () => {
      const regions = pickerValue("my-reg");
      if (!HUB.validRegions(regions)) return $("#me-msg").textContent = "Pick a valid region combination.";
      const { error } = await H.sb.from("profiles").update({ regions, full_name: $("#my-name").value.trim(), job_title: $("#my-title").value.trim() }).eq("id", me.id);
      if (error) return $("#me-msg").textContent = error.message;
      Object.assign(H.me, { regions, full_name: $("#my-name").value.trim(), job_title: $("#my-title").value.trim() });
      $("#me-msg").textContent = "Saved. Every task now covers " + HUB.regionInfo(regions).short + "."; renderTop(); renderNav();
    };
    if (!admin) return;
    $("#o-model").value = o.model;
    $("#save-org").onclick = async () => {
      const patch = { model: $("#o-model").value, max_words: Math.min(900, Math.max(300, +$("#o-words").value || 700)),
        topic_searches: Math.min(60, Math.max(10, +$("#o-search").value || 40)), font_name: $("#font-name").value.trim() || null, updated_at: new Date().toISOString() };
      const { error } = await H.sb.from("org_settings").update(patch).eq("id", 1);
      $("#org-msg").textContent = error ? error.message : "Saved."; if (!error) Object.assign(H.org, patch);
    };
    document.querySelectorAll("[data-upload]").forEach(inp => inp.addEventListener("change", () => uploadBrand(inp)));
    document.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => removeBrand(b.dataset.remove)));
    $("#add-user").onclick = async () => {
      const regions = pickerValue("nu-reg");
      if (!HUB.validRegions(regions)) return $("#nu-msg").textContent = "Pick a valid region combination.";
      try {
        await H.admin("POST", { email: $("#nu-email").value.trim(), password: $("#nu-pass").value, full_name: $("#nu-name").value.trim(), role: $("#nu-role").value, regions });
        $("#nu-msg").textContent = "User added."; ["#nu-email", "#nu-pass", "#nu-name"].forEach(s => $(s).value = ""); loadUsers();
      } catch (e) { $("#nu-msg").textContent = e.message; }
    };
    loadUsers();
  }
  const BRAND_COL = { font: "font_file", fontbold: "font_bold_file", template: "template_file", logo: "logo_file" };
  function brandRow(key, label, accept, file, note) {
    return `<div class="brand"><div><label for="up-${key}">${label}</label>
      <div class="hint">${file ? "Current: " + esc(file.split("/").pop()) : "None uploaded"}${note ? " · " + esc(note) : ""}</div></div>
      <div class="row"><input type="file" id="up-${key}" data-upload="${key}" accept="${accept}">${file ? `<button class="btn small" type="button" data-remove="${key}">Remove</button>` : ""}</div></div>`;
  }
  async function uploadBrand(inp) {
    const f = inp.files[0], key = inp.dataset.upload; if (!f) return;
    if (f.size > 10e6) return alertIn(inp, "Files must be under 10 MB.");
    const path = `${key}/${Date.now()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
    const { error } = await H.sb.storage.from("brand").upload(path, f, { upsert: true, contentType: f.type || "application/octet-stream" });
    if (error) return alertIn(inp, error.message);
    const patch = { [BRAND_COL[key]]: path, updated_at: new Date().toISOString() };
    if (key === "font") patch.font_name = fontFamily(new Uint8Array(await f.arrayBuffer())) || f.name.replace(/\.(ttf|otf)$/i, "").replace(/[-_](Regular|Book|Roman)$/i, "").replace(/[-_]/g, " ");
    const old = H.org[BRAND_COL[key]];
    const { error: e2 } = await H.sb.from("org_settings").update(patch).eq("id", 1);
    if (e2) return alertIn(inp, e2.message);
    if (old) H.sb.storage.from("brand").remove([old]);
    Object.assign(H.org, patch); await H.loadBrand(); renderSettings();
  }
  async function removeBrand(key) {
    const old = H.org[BRAND_COL[key]];
    await H.sb.from("org_settings").update({ [BRAND_COL[key]]: null }).eq("id", 1);
    if (old) await H.sb.storage.from("brand").remove([old]);
    H.org[BRAND_COL[key]] = null; await H.loadBrand(); renderSettings();
  }
  /* Reads the family name stored inside a TTF/OTF file, which is the name Word needs to match the embedded font. */
  function fontFamily(bytes) {
    try {
      const v = new DataView(bytes.buffer), n = v.getUint16(4); let off = -1;
      for (let i = 0; i < n; i++) { const r = 12 + i * 16; if (String.fromCharCode(...bytes.slice(r, r + 4)) === "name") off = v.getUint32(r + 8); }
      if (off < 0) return null;
      const count = v.getUint16(off + 2), strings = off + v.getUint16(off + 4), found = {};
      for (let i = 0; i < count; i++) {
        const r = off + 6 + i * 12, platform = v.getUint16(r), id = v.getUint16(r + 6), len = v.getUint16(r + 8), start = strings + v.getUint16(r + 10);
        if ((id === 1 || id === 16) && (platform === 3 || platform === 0)) {
          let t = ""; for (let k = 0; k < len; k += 2) t += String.fromCharCode(v.getUint16(start + k));
          found[id] = found[id] || t;
        } else if ((id === 1 || id === 16) && platform === 1 && !found[id]) found[id] = String.fromCharCode(...bytes.slice(start, start + len));
      }
      return found[16] || found[1] || null;
    } catch (e) { return null; }
  }
  function alertIn(el, msg) { el.closest(".brand").insertAdjacentHTML("beforeend", `<p class="err">${esc(msg)}</p>`); }

  async function loadUsers() {
    let users; try { users = await H.admin("GET"); } catch (e) { return $("#users").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    $("#users").innerHTML = `<div class="scroll"><table class="stack"><thead><tr><th>User</th><th>Region</th><th>Role</th><th>Access</th><th></th></tr></thead><tbody>${users.map(u => `
      <tr data-uid="${u.id}"><td><b>${esc(u.full_name || "(no name)")}</b><br><span class="hint">${esc(u.email)}</span></td>
        <td>${regionPicker("ur-" + u.id, u.regions)}</td>
        <td><select data-role="${u.id}" aria-label="Role"><option value="analyst"${u.role === "analyst" ? " selected" : ""}>Analyst</option><option value="admin"${u.role === "admin" ? " selected" : ""}>Admin</option></select></td>
        <td>${u.active ? "Active" : "Turned off"}</td>
        <td><div class="row"><button class="btn small" type="button" data-save-user="${u.id}">Save</button>
          <button class="btn small" type="button" data-pass="${u.id}">Reset password</button>
          <button class="btn small" type="button" data-active="${u.id}" data-on="${u.active}">${u.active ? "Turn off" : "Turn on"}</button>
          ${u.id === H.me.id ? "" : `<button class="btn small" type="button" data-del="${u.id}">Delete</button>`}</div><span class="hint" id="um-${u.id}"></span></td></tr>`).join("")}</tbody></table></div>`;
    const msg = (id, t) => $("#um-" + id).textContent = t;
    const act = async (id, body, ok) => { try { await H.admin("PATCH", { id, ...body }); msg(id, ok); } catch (e) { msg(id, e.message); } };
    document.querySelectorAll("[data-save-user]").forEach(b => b.onclick = () => { const id = b.dataset.saveUser, regions = pickerValue("ur-" + id);
      if (!HUB.validRegions(regions)) return msg(id, "Pick a valid region combination."); act(id, { regions, role: $(`[data-role="${id}"]`).value }, "Saved."); });
    document.querySelectorAll("[data-pass]").forEach(b => b.onclick = () => { const id = b.dataset.pass;
      const cell = b.closest("td"); if (cell.querySelector(".newpass")) return;
      cell.insertAdjacentHTML("beforeend", `<div class="row newpass" style="margin-top:6px"><input type="text" placeholder="New password (8+)" aria-label="New password" style="max-width:200px"><button class="btn small" type="button">Set</button></div>`);
      const box = cell.querySelector(".newpass"); box.querySelector("button").onclick = () => act(id, { password: box.querySelector("input").value }, "Password changed. Share it privately."); });
    document.querySelectorAll("[data-active]").forEach(b => b.onclick = async () => { await act(b.dataset.active, { active: b.dataset.on !== "true" }, "Updated."); loadUsers(); });
    document.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Click again to delete"; return; }
      try { await H.admin("DELETE", null, "?id=" + b.dataset.del); loadUsers(); } catch (e) { msg(b.dataset.del, e.message); } });
  }

  document.addEventListener("click", e => {
    const r = e.target.closest("[data-region]"); if (!r) return;
    const box = r.closest(".regions"); const next = HUB.toggleRegion((box.dataset.sel || "").split(",").filter(Boolean), r.dataset.region);
    setPicker(box.id, next);
  });

  boot();
})();
