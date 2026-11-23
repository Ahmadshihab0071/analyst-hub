/* Engine: PIN lock, Claude API streaming with web search, charts, and the Word builder. */
(function () {
  const H = window.HUB;

  /* ---------- small storage helper ---------- */
  H.store = {
    get(k, d = null) { try { const v = localStorage.getItem("hub:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("hub:" + k, JSON.stringify(v)); } catch (e) { console.warn("storage full", e); } },
    del(k) { try { localStorage.removeItem("hub:" + k); } catch (e) {} }
  };

  const dec = new TextDecoder();

  /* ---------- Supabase (sign-in, profile, settings, saved items, brand files) ---------- */
  const C = window.HUB_CONFIG || {};
  H.sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  H.token = async () => (await H.sb.auth.getSession()).data.session?.access_token;
  H.org = { model: "claude-opus-5-5", max_words: 700, topic_searches: 40 };
  H.me = null;
  H.ctx = () => ({ regions: H.me?.regions || ["ME", "AF"], name: H.me?.full_name || H.me?.email || "", title: H.me?.job_title || "" });

  H.items = {
    async list(kind, task, limit = 15) {
      let q = H.sb.from("items").select("*").eq("kind", kind).order("created_at", { ascending: false }).limit(limit);
      if (task) q = q.eq("task", task);
      const { data, error } = await q; if (error) throw error; return data;
    },
    async add(kind, row) {
      const { data, error } = await H.sb.from("items").insert({ kind, regions: H.ctx().regions, ...row }).select().single();
      if (error) throw error; return data;
    }
  };

  /* Brand files, loaded once after sign-in and whenever the admin changes them. */
  H.brand = { fontName: null, font: null, fontBold: null, logo: null, template: null };
  async function fileBytes(path) {
    if (!path) return null;
    const { data, error } = await H.sb.storage.from("brand").download(path);
    if (error) { console.warn("brand file", path, error); return null; }
    return new Uint8Array(await data.arrayBuffer());
  }
  H.loadBrand = async function () {
    const o = H.org, b = H.brand;
    [b.font, b.fontBold, b.template] = await Promise.all([fileBytes(o.font_file), fileBytes(o.font_bold_file), fileBytes(o.template_file)]);
    b.fontName = b.font ? (o.font_name || "Brand") : null;
    b.logo = null;
    const logo = await fileBytes(o.logo_file);
    if (logo) {
      const type = /\.png$/i.test(o.logo_file) ? "png" : "jpg";
      const bmp = await createImageBitmap(new Blob([logo], { type: type === "png" ? "image/png" : "image/jpeg" }));
      b.logo = { data: logo, type, w: bmp.width, h: bmp.height };
    }
    if (b.font && "FontFace" in window) {   // charts use the brand font too
      try { const ff = new FontFace("HubBrand", b.font); await ff.load(); document.fonts.add(ff);
        if (b.fontBold) { const fb = new FontFace("HubBrand", b.fontBold, { weight: "700" }); await fb.load(); document.fonts.add(fb); } }
      catch (e) { console.warn("font", e); }
    }
  };
  const CF = () => (H.brand.font ? "HubBrand, " : "") + "Inter, Arial, sans-serif";

  /* ---------- Claude API (direct from the browser, streamed) ---------- */
  H.settings = () => ({ model: H.org.model, maxWords: H.org.max_words, maxCharts: 2, searchTool: "web_search_20250305",
    topicSearches: H.org.topic_searches, draftSearches: 25 });

  async function streamOnce(body, onEvent, signal) {
    const res = await fetch(C.WORKER_URL.replace(/\/$/, "") + "/claude", {
      method: "POST", signal,
      headers: { "content-type": "application/json", Authorization: "Bearer " + await H.token() },
      body: JSON.stringify({ ...body, stream: true })
    });
    if (!res.ok) {
      let msg = res.status + " " + res.statusText;
      try { const j = await res.json(); msg = j.error?.message || j.error || msg; } catch (e) {}
      const err = new Error(msg); err.status = res.status; throw err;
    }
    const reader = res.body.getReader();
    let buf = "", stop = null; const blocks = []; const partial = {};
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split("\n").find(l => l.startsWith("data:"));
        if (!line) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
        if (ev.type === "content_block_start") {
          blocks[ev.index] = JSON.parse(JSON.stringify(ev.content_block));
          if (ev.content_block.type === "text") blocks[ev.index].text = blocks[ev.index].text || "";
          if (ev.content_block.type === "web_search_tool_result") onEvent?.({ type: "results", n: (ev.content_block.content || []).length });
        } else if (ev.type === "content_block_delta") {
          const b = blocks[ev.index], d = ev.delta;
          if (d.type === "text_delta") { b.text += d.text; onEvent?.({ type: "text", text: d.text }); }
          else if (d.type === "input_json_delta") partial[ev.index] = (partial[ev.index] || "") + d.partial_json;
          else if (d.type === "citations_delta") (b.citations = b.citations || []).push(d.citation);
        } else if (ev.type === "content_block_stop") {
          const b = blocks[ev.index];
          if (b && partial[ev.index] !== undefined) {
            try { b.input = JSON.parse(partial[ev.index] || "{}"); } catch (e) { b.input = {}; }
            if (b.type === "server_tool_use") onEvent?.({ type: "search", query: b.input.query || "" });
          }
        } else if (ev.type === "message_delta") stop = ev.delta?.stop_reason || stop;
        else if (ev.type === "error") throw new Error(ev.error?.message || "Stream error");
      }
    }
    return { blocks: blocks.filter(Boolean), stop };
  }

  /* Runs one task. Continues automatically when a long search pauses, retries once on overload. */
  H.ask = async function ({ content, searches = 0, maxTokens = 16000, onEvent, signal }) {
    const s = H.settings();
    const body = { model: s.model, max_tokens: maxTokens, messages: [{ role: "user", content }] };
    if (searches > 0) body.tools = [{ type: s.searchTool, name: "web_search", max_uses: searches }];
    let text = "";
    for (let turn = 0; turn < 6; turn++) {
      let out;
      for (let attempt = 0; ; attempt++) {
        try { out = await streamOnce(body, onEvent, signal); break; }
        catch (e) {
          if (signal?.aborted || attempt >= 2 || ![429, 500, 529].includes(e.status)) throw e;
          onEvent?.({ type: "status", text: "Claude is busy, retrying in 20 seconds" });
          await new Promise(r => setTimeout(r, 20000));
        }
      }
      text += out.blocks.filter(b => b.type === "text").map(b => b.text).join("");
      if (out.stop !== "pause_turn") return text;
      body.messages.push({ role: "assistant", content: out.blocks });
      onEvent?.({ type: "status", text: "Still researching" });
    }
    return text;
  };

  H.admin = async function (method, body, query = "") {
    const res = await fetch(C.WORKER_URL.replace(/\/$/, "") + "/admin/users" + query, { method,
      headers: { "content-type": "application/json", Authorization: "Bearer " + await H.token() }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || res.statusText);
    return j;
  };

  H.extractJSON = function (text) {
    const m = text.match(/<json>\s*([\s\S]*?)\s*<\/json>/);
    let raw = m ? m[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    raw = raw.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "");
    return JSON.parse(raw);
  };

  /* Files you attach: images and PDFs go to Claude as-is, text files as text. */
  H.fileBlocks = async function (files) {
    const out = [];
    for (const f of files) {
      const type = f.type || "";
      if (/^image\/(png|jpeg|gif|webp)$/.test(type) || type === "application/pdf") {
        const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = no; r.readAsDataURL(f); });
        out.push(type === "application/pdf"
          ? { type: "document", source: { type: "base64", media_type: type, data }, title: f.name }
          : { type: "image", source: { type: "base64", media_type: type, data } });
      } else if (/\.(txt|csv|md|json|tsv)$/i.test(f.name) || type.startsWith("text/")) {
        out.push({ type: "text", text: `File ${f.name}:\n` + (await f.text()).slice(0, 150000) });
      } else {
        throw new Error(`${f.name}: save Word or Excel files as PDF or CSV first.`);
      }
    }
    return out;
  };

  /* ---------- draft helpers ---------- */
  H.TOKEN = /\[\[VERIFY:([\s\S]*?)\|\|([\s\S]*?)\]\]|\*\*(.+?)\*\*/g;
  const plain = t => String(t || "").replace(H.TOKEN, (m, a, b, c) => a || c || "");
  H.contentWords = function (d) {
    const conc = Array.isArray(d.conclusion) ? d.conclusion : [d.conclusion || ""];
    const parts = [...(d.takeaways || []), d.introduction || "", ...conc];
    (d.sections || []).forEach(s => { parts.push(s.heading || ""); parts.push(...(s.paragraphs || [])); });
    return plain(parts.join(" ")).split(/\s+/).filter(Boolean).length;
  };
  /* calibrated on real renders: ~380 words a page, ~0.42 page per chart, 0.25 for the title block */
  H.estPages = d => 0.25 + H.contentWords(d) / 380 + 0.42 * (d.charts || []).length;
  H.verifyCount = d => (JSON.stringify(d).match(/\[\[VERIFY:/g) || []).length + (d.charts || []).filter(c => c.verify).length;

  /* ---------- charts on canvas (validated colour-blind-safe palette, fixed order) ---------- */
  const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
  const INK = "#0b0b0b", INK2 = "#52514e", GRID = "#e4e3df", BG = "#ffffff";
  const fmt = (v, u) => v == null ? "" : (Math.round(v * 10) / 10).toLocaleString("en-US") + (u === "%" ? "%" : "");
  function wrapText(ctx, text, maxW) {
    const words = String(text).split(" "), lines = []; let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines;
  }
  H.drawChart = function (chart) {
    const W = 1400, Hh = chart.type === "stat" ? 460 : 760, c = document.createElement("canvas");
    c.width = W; c.height = Hh; const x = c.getContext("2d");
    x.fillStyle = BG; x.fillRect(0, 0, W, Hh);
    x.fillStyle = INK; x.font = "600 34px " + CF();
    const tl = wrapText(x, chart.title || "", W - 80); tl.forEach((l, i) => x.fillText(l, 40, 56 + i * 42));
    const top = 56 + tl.length * 42 + 20;
    x.fillStyle = INK2; x.font = "22px " + CF();
    if (chart.source) x.fillText(("Source: " + chart.source).slice(0, 140), 40, Hh - 24);
    const series = chart.series || [], labels = chart.labels || [];
    const has = series.some(s => (s.values || []).some(v => v != null));
    if (chart.verify || !has) {
      x.fillStyle = "#fff6c2"; x.strokeStyle = "#eda100"; x.lineWidth = 3;
      x.beginPath(); x.roundRect(40, top + 10, W - 80, Hh - top - 90, 16); x.fill(); x.stroke();
      x.fillStyle = INK; x.font = "600 32px " + CF(); x.textAlign = "center";
      x.fillText("Chart placeholder: verify with your data", W / 2, top + (Hh - top - 90) / 2 - 6);
      x.fillStyle = INK2; x.font = "24px " + CF();
      wrapText(x, chart.verify_note || "Add the figures from Counterpoint records.", W - 200).slice(0, 3)
        .forEach((l, i) => x.fillText(l, W / 2, top + (Hh - top - 90) / 2 + 40 + i * 32));
      x.textAlign = "left"; return c;
    }
    if (chart.type === "stat") {
      x.fillStyle = SERIES[0]; x.font = "700 120px " + CF();
      x.fillText(fmt(series[0].values[0], chart.unit) + (chart.unit && chart.unit !== "%" ? " " + chart.unit : ""), 40, top + 120);
      x.fillStyle = INK2; x.font = "28px " + CF(); x.fillText(labels[0] || series[0].name || "", 40, top + 175);
      return c;
    }
    // legend (2+ series), always present so colour is never the only cue
    let lx = 40, ly = top + 6;
    if (series.length > 1) {
      x.font = "24px " + CF();
      series.forEach((s, i) => { x.fillStyle = SERIES[i % 8]; x.beginPath(); x.roundRect(lx, ly - 16, 22, 22, 4); x.fill(); x.fillStyle = INK; x.fillText(s.name, lx + 32, ly + 2); lx += 32 + x.measureText(s.name).width + 36; });
    }
    const L = chart.type === "hbar" ? 260 : 90, R = 60, T = top + (series.length > 1 ? 50 : 20), B = Hh - 90;
    const all = series.flatMap(s => s.values.filter(v => v != null)); const max = Math.max(...all, 0) * 1.12 || 1;
    const min = Math.min(0, ...all);
    x.font = "22px " + CF();
    if (chart.type === "hbar") {
      const band = (B - T) / labels.length, bh = band * 0.7 / series.length;
      labels.forEach((lab, j) => {
        x.fillStyle = INK2; x.textAlign = "right"; x.fillText(String(lab).slice(0, 20), L - 14, T + band * j + band / 2 + 8); x.textAlign = "left";
        series.forEach((s, i) => {
          const v = s.values[j]; if (v == null) return; const w = (W - L - R - 90) * (v / max), y = T + band * j + band * 0.15 + bh * i;
          x.fillStyle = SERIES[i % 8]; x.beginPath(); x.roundRect(L, y, Math.max(w, 2), bh - 3, [0, 6, 6, 0]); x.fill();
          if (series.length <= 2) { x.fillStyle = INK; x.fillText(fmt(v, chart.unit), L + w + 10, y + bh / 2 + 6); }
        });
      });
      return c;
    }
    const y = v => B - (B - T) * ((v - min) / (max - min));
    x.strokeStyle = GRID; x.lineWidth = 1.5; x.fillStyle = INK2; x.textAlign = "right";
    for (let k = 0; k <= 4; k++) { const v = min + (max - min) * k / 4, yy = y(v); x.beginPath(); x.moveTo(L, yy); x.lineTo(W - R, yy); x.stroke(); x.fillText(fmt(v, chart.unit), L - 12, yy + 7); }
    x.textAlign = "center";
    const band = (W - L - R) / labels.length;
    labels.forEach((lab, j) => { x.fillStyle = INK2; x.fillText(String(lab).slice(0, 14), L + band * j + band / 2, B + 34); });
    if (chart.type === "line") {
      series.forEach((s, i) => {
        x.strokeStyle = SERIES[i % 8]; x.fillStyle = SERIES[i % 8]; x.lineWidth = 4; x.beginPath(); let started = false;
        s.values.forEach((v, j) => { if (v == null) return; const px = L + band * j + band / 2; started ? x.lineTo(px, y(v)) : x.moveTo(px, y(v)); started = true; });
        x.stroke();
        s.values.forEach((v, j) => { if (v == null) return; x.beginPath(); x.arc(L + band * j + band / 2, y(v), 7, 0, 7); x.fill(); });
        const lastJ = s.values.map((v, j) => v == null ? -1 : j).filter(j => j >= 0).pop();
        if (series.length <= 4 && lastJ != null) { x.fillStyle = INK; x.textAlign = "left"; x.fillText(fmt(s.values[lastJ], chart.unit), L + band * lastJ + band / 2 + 12, y(s.values[lastJ]) - 10); x.textAlign = "center"; }
      });
    } else {
      const bw = band * 0.72 / series.length;
      series.forEach((s, i) => s.values.forEach((v, j) => {
        if (v == null) return; const px = L + band * j + band * 0.14 + bw * i, h = y(min) - y(v);
        x.fillStyle = SERIES[i % 8]; x.beginPath(); x.roundRect(px, y(v), bw - 4, Math.max(h, 2), [6, 6, 0, 0]); x.fill();
        if (series.length <= 2) { x.fillStyle = INK; x.fillText(fmt(v, chart.unit), px + (bw - 4) / 2, y(v) - 10); }
      }));
    }
    x.textAlign = "left"; return c;
  };
  const canvasBytes = c => new Promise(ok => c.toBlob(b => b.arrayBuffer().then(ok), "image/png"));

  /* ---------- Word builder: yellow highlight + a Word comment on every [[VERIFY]] ---------- */
  H.buildDocx = async function (d) {
    const D = window.docx; const comments = []; let cid = 0;
    const comment = text => { const id = cid++; const t = text.trim();
      comments.push({ id, author: "MEA Pulse", initials: "MP", date: new Date(),
        children: [new D.Paragraph({ children: [new D.TextRun(/^verify with your data/i.test(t) ? t : "Verify with your data: " + t)] })] });
      return id; };
    const runs = (text, base = {}) => {
      const out = []; let pos = 0; const re = new RegExp(H.TOKEN.source, "g"); let m;
      text = String(text || "");
      while ((m = re.exec(text))) {
        if (m.index > pos) out.push(new D.TextRun({ text: text.slice(pos, m.index), ...base }));
        if (m[1] !== undefined) {
          const id = comment(m[2]);
          out.push(new D.CommentRangeStart(id), new D.TextRun({ text: m[1].trim().replace(/\*\*/g, ""), highlight: "yellow", ...base }),
            new D.CommentRangeEnd(id), new D.TextRun({ children: [new D.CommentReference(id)] }));
        } else out.push(new D.TextRun({ text: m[3], bold: true, ...base }));
        pos = re.lastIndex;
      }
      if (pos < text.length) out.push(new D.TextRun({ text: text.slice(pos), ...base }));
      return out;
    };
    const P = (text, opts = {}) => new D.Paragraph({ children: runs(text), spacing: { after: 140 }, ...opts });
    const Hd = t => new D.Paragraph({ text: t, heading: D.HeadingLevel.HEADING_1, spacing: { before: 220, after: 100 } });
    const kids = [];
    kids.push(new D.Paragraph({ text: d.title || "Draft", heading: D.HeadingLevel.TITLE }));
    const cx = H.ctx();
    kids.push(new D.Paragraph({ children: [new D.TextRun({ text: `DRAFT for review | ${(d.format || "blog").replace(/^./, c => c.toUpperCase())} | ${cx.name}${cx.title ? ", " + cx.title : ""} | ${HUB.regionInfo(cx.regions).short} | ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, size: 18, color: "52514E" })], spacing: { after: 200 } }));
    if (d.takeaways?.length) { kids.push(Hd("Key takeaways")); d.takeaways.forEach(t => kids.push(P(t, { bullet: { level: 0 } }))); }
    if (d.introduction) { kids.push(Hd("Introduction")); kids.push(P(d.introduction)); }
    const charts = Object.fromEntries((d.charts || []).map(c => [c.id, c])); const used = new Set();
    const addChart = async id => {
      const c = charts[id]; if (!c || used.has(id)) return; used.add(id);
      const canvas = H.drawChart(c);
      kids.push(new D.Paragraph({ children: [new D.ImageRun({ type: "png", data: await canvasBytes(canvas), transformation: { width: 560, height: Math.round(560 * canvas.height / canvas.width) } })], spacing: { after: 120 } }));
      if (c.verify) { const id2 = comment(c.verify_note || "Add the chart figures.");
        kids.push(new D.Paragraph({ children: [new D.CommentRangeStart(id2), new D.TextRun({ text: "Figure needs Counterpoint data: " + (c.title || ""), highlight: "yellow", size: 18 }), new D.CommentRangeEnd(id2), new D.TextRun({ children: [new D.CommentReference(id2)] })] })); }
    };
    for (const s of d.sections || []) {
      if (s.heading) kids.push(Hd(s.heading));
      (s.paragraphs || []).forEach(t => kids.push(P(t)));
      if (s.chart_after) await addChart(s.chart_after);
    }
    for (const id of Object.keys(charts)) await addChart(id);
    const conc = Array.isArray(d.conclusion) ? d.conclusion : (d.conclusion ? [d.conclusion] : []);
    if (conc.length) { kids.push(Hd("Conclusion")); conc.forEach(t => kids.push(P(t))); }
    if (d.sources?.length) {
      kids.push(new D.Paragraph({ text: "Sources", heading: D.HeadingLevel.HEADING_1, pageBreakBefore: true }));
      d.sources.forEach(s => kids.push(new D.Paragraph({ spacing: { after: 60 }, children: [
        new D.TextRun({ text: `[${s.n}] ${s.publisher || ""}, "${s.title || ""}", ${s.date || ""}. `, size: 20 }),
        new D.ExternalHyperlink({ link: s.url || "", children: [new D.TextRun({ text: s.url || "", style: "Hyperlink", size: 20 })] })] })));
    }
    if (d.editor_notes?.length) { kids.push(Hd("Notes for the analyst (delete before publishing)")); d.editor_notes.forEach(n => kids.push(new D.Paragraph({ text: n, bullet: { level: 0 } }))); }
    return H.finishDoc(kids, comments, d.title || "Draft");
  };

  /* Markdown answer -> simple Word file (headings, bullets, bold, ==verify== highlights) */
  H.mdToDocx = async function (md, title) {
    const D = window.docx; const kids = [new D.Paragraph({ text: title, heading: D.HeadingLevel.TITLE })];
    const inline = t => t.split(/(\*\*.+?\*\*|==.+?==)/g).filter(Boolean).map(p =>
      p.startsWith("**") ? new D.TextRun({ text: p.slice(2, -2), bold: true }) :
      p.startsWith("==") ? new D.TextRun({ text: p.slice(2, -2), highlight: "yellow" }) : new D.TextRun(p.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")));
    for (const raw of md.split("\n")) {
      const l = raw.trimEnd(); if (!l.trim()) continue;
      let m;
      if ((m = l.match(/^(#{1,3})\s+(.*)/))) kids.push(new D.Paragraph({ children: inline(m[2]), heading: [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3][m[1].length - 1] }));
      else if ((m = l.match(/^\s*[-*]\s+(.*)/))) kids.push(new D.Paragraph({ children: inline(m[1]), bullet: { level: 0 } }));
      else if (/^\|/.test(l)) { if (!/^\|[\s:-|]+\|$/.test(l)) kids.push(new D.Paragraph({ children: inline(l.replace(/^\||\|$/g, "").split("|").map(s => s.trim()).join("  |  ")) })); }
      else kids.push(new D.Paragraph({ children: inline(l), spacing: { after: 120 } }));
    }
    return H.finishDoc(kids, [], title);
  };

  /* Shared last step for every Word file: brand font (embedded), logo header, then the Word template. */
  H.finishDoc = async function (kids, comments, title) {
    const D = window.docx, b = H.brand, font = b.fontName || "Calibri";
    const opts = { creator: H.ctx().name || "Analyst Hub", title, comments: { children: comments },
      styles: { default: { document: { run: { font, size: 22 } }, heading1: { run: { font } }, title: { run: { font } } } },
      sections: [{ children: kids }] };
    if (b.font) opts.fonts = [{ name: font, data: b.font, ...(b.fontBold ? { bold: b.fontBold } : {}), characterSet: D.CharacterSet.ANSI }];
    if (b.logo) {
      const h = 40, w = Math.round(h * b.logo.w / b.logo.h);   // 40px tall, keeps the logo's shape
      opts.sections[0].headers = { default: new D.Header({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT,
        children: [new D.ImageRun({ type: b.logo.type, data: b.logo.data, transformation: { width: Math.min(w, 220), height: Math.round(Math.min(w, 220) * b.logo.h / b.logo.w) } })] })] }) };
    }
    let blob = await D.Packer.toBlob(new D.Document(opts));
    if (b.template) blob = await H.mergeTemplate(blob, b.template, { keepTemplateHeader: !b.logo, font: b.fontName });
    return blob;
  };

  /* Applies a Word template (.docx or .dotx): its styles, theme, page size and margins, footer, and its header
     unless a logo was uploaded (then the logo header is used). Content always comes from the draft. */
  H.mergeTemplate = async function (genBlob, tplBytes, { keepTemplateHeader, font }) {
    const gen = await JSZip.loadAsync(genBlob), tpl = await JSZip.loadAsync(tplBytes);
    const read = (z, p) => z.file(p) ? z.file(p).async("string") : Promise.resolve(null);
    const rels = xml => [...(xml || "").matchAll(/<Relationship\b[^>]*>/g)].map(m => ({
      raw: m[0], Id: (m[0].match(/Id="([^"]+)"/) || [])[1], Type: (m[0].match(/Type="([^"]+)"/) || [])[1],
      Target: (m[0].match(/Target="([^"]+)"/) || [])[1], External: /TargetMode="External"/.test(m[0]) }));
    let ct = await read(gen, "[Content_Types].xml"), genRelsXml = await read(gen, "word/_rels/document.xml.rels");
    const tplRels = rels(await read(tpl, "word/_rels/document.xml.rels"));
    const addRel = (type, target) => { const id = "rIdTpl" + Math.random().toString(36).slice(2, 8);
      genRelsXml = genRelsXml.replace("</Relationships>", `<Relationship Id="${id}" Type="${type}" Target="${target}"/></Relationships>`); return id; };
    const addOverride = (part, type) => { if (!ct.includes(`PartName="${part}"`)) ct = ct.replace("</Types>", `<Override PartName="${part}" ContentType="${type}"/></Types>`); };
    const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", emf: "image/x-emf", wmf: "image/x-wmf", svg: "image/svg+xml", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff" };
    const addDefault = ext => { ext = ext.toLowerCase(); if (MIME[ext] && !new RegExp(`Extension="${ext}"`, "i").test(ct)) ct = ct.replace("<Override", `<Default Extension="${ext}" ContentType="${MIME[ext]}"/><Override`); };

    // styles (fonts switched to the uploaded brand font, if any) and theme
    let styles = await read(tpl, "word/styles.xml");
    if (styles) {
      if (font) styles = styles.replace(/<w:rFonts\b[^>]*\/>/g, `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/>`);
      gen.file("word/styles.xml", styles);
    }
    const themeRel = tplRels.find(r => /\/theme$/.test(r.Type));
    if (themeRel && !/\/theme"/.test(genRelsXml)) {
      const t = await read(tpl, "word/" + themeRel.Target);
      if (t) { gen.file("word/theme/tpltheme1.xml", t); addRel(themeRel.Type, "theme/tpltheme1.xml"); addOverride("/word/theme/tpltheme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"); }
    }

    // page setup, header and footer from the template's last section
    const tDoc = await read(tpl, "word/document.xml"); let gDoc = await read(gen, "word/document.xml");
    const tSects = tDoc.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g), gSects = gDoc.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g);
    if (tSects && gSects) {
      let sect = tSects[tSects.length - 1];
      const gSect = gSects[gSects.length - 1];
      const refs = [...sect.matchAll(/<w:(header|footer)Reference\b[^>]*\/>/g)];
      for (const m of refs) {
        const kind = m[1], rid = (m[0].match(/r:id="([^"]+)"/) || [])[1], rel = tplRels.find(r => r.Id === rid);
        if (!rel || (kind === "header" && !keepTemplateHeader)) { sect = sect.replace(m[0], ""); continue; }
        const part = rel.Target.replace(/^\/?word\//, ""), newName = "tpl_" + part.replace(/\//g, "_");
        gen.file("word/" + newName, await read(tpl, "word/" + part));
        const partRels = await read(tpl, `word/_rels/${part}.rels`);
        if (partRels) {
          let out = partRels;
          for (const r of rels(partRels)) {
            if (r.External || !r.Target) continue;
            const src = "word/" + r.Target.replace(/^\.\//, ""), dest = "media/tpl_" + r.Target.split("/").pop();
            const f = tpl.file(src); if (!f) continue;
            gen.file("word/" + dest, await f.async("uint8array")); addDefault(dest.split(".").pop());
            out = out.replace(r.raw, r.raw.replace(`Target="${r.Target}"`, `Target="${dest}"`));
          }
          gen.file(`word/_rels/${newName}.rels`, out);
        }
        const newId = addRel(rel.Type, newName);
        addOverride("/word/" + newName, `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`);
        sect = sect.replace(m[0], m[0].replace(`r:id="${rid}"`, `r:id="${newId}"`));
      }
      if (!keepTemplateHeader) {   // use the logo header from the generated file
        const own = (gSect.match(/<w:headerReference\b[^>]*\/>/g) || []).join("");
        sect = sect.replace(/<w:titlePg\s*\/>/g, "").replace(/(<w:sectPr\b[^>]*>)/, "$1" + own);
      }
      gDoc = gDoc.slice(0, gDoc.lastIndexOf(gSect)) + sect + gDoc.slice(gDoc.lastIndexOf(gSect) + gSect.length);
      gen.file("word/document.xml", gDoc);
    }
    gen.file("[Content_Types].xml", ct);
    gen.file("word/_rels/document.xml.rels", genRelsXml);
    return gen.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  };
})();
