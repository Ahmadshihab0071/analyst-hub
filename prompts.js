/* Style guide, data rules, task list and prompt builders. Edit freely: no code changes needed elsewhere. */
window.HUB = window.HUB || {};

/* ---------- Regions ----------
   Allowed mixes: Middle East + Africa (MEA), APAC + India + China (any mix), East + West Europe,
   and LATAM + North America (always together). The same rules are enforced by the database and the Worker. */
HUB.REGIONS = {
  ME:   {name: "Middle East", countries: "Saudi Arabia, UAE, Qatar, Kuwait, Oman, Bahrain, Iraq, Jordan, Lebanon, Iran, Yemen",
         outlets: "The National, Gulf News, Arab News, Khaleej Times, Asharq Al-Awsat, Zawya",
         seasons: "Ramadan and Eid, back to school, White Friday (November), summer travel season",
         policy: "VAT and customs changes, device taxes, IMEI registration, 5G and spectrum licensing, local manufacturing (e.g. Saudi Vision 2030), grey-market and re-export flows via the UAE"},
  AF:   {name: "Africa", countries: "Egypt, Nigeria, Kenya, South Africa, Morocco, Algeria, Ethiopia, Tanzania, Ghana, Cote d'Ivoire, Uganda, Rwanda",
         outlets: "TechCabal, Business Day, Techpoint Africa, Daily Nation, Ahram Online, Business Insider Africa",
         seasons: "Ramadan and Eid (North and West Africa), Christmas and year-end, back to school, Black Friday",
         policy: "import duties and VAT, device and excise taxes, IMEI rules, currency moves (naira, Egyptian pound), local assembly, device financing and digital inclusion"},
  APAC: {name: "Asia Pacific", countries: "Indonesia, Vietnam, Thailand, Philippines, Malaysia, Japan, South Korea, Australia, Bangladesh, Pakistan",
         outlets: "Nikkei Asia, The Straits Times, Korea Herald, The Jakarta Post, VnExpress, The Australian Financial Review",
         seasons: "Lunar New Year, 9.9/11.11/12.12 online sales, Ramadan in Indonesia and Malaysia, year-end",
         policy: "local content rules (e.g. Indonesia TKDN), IMEI registration, import duties, 5G rollout, carrier subsidies"},
  IN:   {name: "India", countries: "India",
         outlets: "The Economic Times, Mint, Business Standard, Moneycontrol, The Hindu BusinessLine",
         seasons: "Diwali and the festive season, Amazon and Flipkart sale events, wedding season",
         policy: "GST and customs duty changes, PLI manufacturing incentives, BIS certification, 5G rollout, quick-commerce and online channels"},
  CN:   {name: "China", countries: "mainland China",
         outlets: "Caixin, South China Morning Post, Yicai Global, China Daily, 36Kr",
         seasons: "Chinese New Year, 618, Double 11, year-end",
         policy: "national trade-in subsidies, MIIT rules, export controls, domestic chip and OS ecosystems (HarmonyOS), eSIM"},
  EE:   {name: "Eastern Europe", countries: "Poland, Romania, Czechia, Hungary, Ukraine, Bulgaria, Slovakia, the Baltic states, Russia",
         outlets: "Reuters, Euractiv, Notes from Poland, Romania Insider, bne IntelliNews",
         seasons: "Black Friday, Christmas, back to school",
         policy: "EU rules (Digital Markets Act, USB-C, ecodesign and energy label, battery regulation), sanctions and grey imports, operator promotions, currency"},
  WE:   {name: "Western Europe", countries: "UK, Germany, France, Italy, Spain, Netherlands, the Nordics",
         outlets: "Financial Times, Euronews, Handelsblatt, Les Echos, The Guardian, Expansion",
         seasons: "Black Friday, Christmas, back to school, summer",
         policy: "EU rules (Digital Markets Act, USB-C, ecodesign and energy label, repairability, battery regulation), operator subsidies, refurbished market, tariffs"},
  LATAM:{name: "Latin America", countries: "Brazil, Mexico, Argentina, Colombia, Chile, Peru",
         outlets: "Valor Economico, El Economista, Bloomberg Linea, La Nacion, El Tiempo",
         seasons: "Black Friday, El Buen Fin (Mexico), Christmas, back to school, Hot Sale",
         policy: "import tariffs and taxes, Anatel and IFT rules, the Manaus free zone, currency swings, installment financing"},
  NA:   {name: "North America", countries: "United States, Canada",
         outlets: "The Wall Street Journal, CNBC, Bloomberg, The Verge, Reuters, The Globe and Mail",
         seasons: "back to school, Black Friday and the holiday season, the September iPhone cycle",
         policy: "tariffs and trade policy, carrier promotions and subsidies, FCC rules, right to repair, prepaid vs postpaid"}
};
HUB.REGION_GROUPS = [["ME", "AF"], ["APAC", "IN", "CN"], ["EE", "WE"], ["LATAM", "NA"]];
HUB.validRegions = r => Array.isArray(r) && r.length > 0 && (
  HUB.REGION_GROUPS.slice(0, 3).some(g => r.every(x => g.includes(x))) ||
  (r.length === 2 && r.includes("LATAM") && r.includes("NA")));
/* What happens when a region is ticked: other groups are cleared, LATAM and North America move together. */
HUB.toggleRegion = (current, key) => {
  const group = HUB.REGION_GROUPS.find(g => g.includes(key));
  if (key === "LATAM" || key === "NA") return current.includes(key) ? [] : ["LATAM", "NA"];
  let next = current.filter(x => group.includes(x));
  next = next.includes(key) ? next.filter(x => x !== key) : [...next, key];
  return next;
};
HUB.regionInfo = r => {
  const has = k => r.includes(k), list = r.map(k => HUB.REGIONS[k]);
  let label;
  if (has("ME") && has("AF")) label = "the Middle East and Africa (MEA)";
  else if (has("LATAM")) label = "the Americas (North America and Latin America)";
  else if (has("EE") && has("WE")) label = "Europe (Eastern and Western Europe)";
  else if (r.length === 1) label = r[0] === "ME" ? "the Middle East" : HUB.REGIONS[r[0]].name;
  else label = list.map(x => x.name).join(", ").replace(/, ([^,]*)$/, " and $1");
  const short = has("ME") && has("AF") ? "MEA" : has("LATAM") ? "the Americas" : has("EE") && has("WE") ? "Europe" : list.map(x => x.name).join(", ").replace(/, ([^,]*)$/, " and $1");
  return { label, short, countries: list.map(x => x.countries).join(", "), outlets: list.map(x => x.outlets).join(", "),
    seasons: list.map(x => x.name + ": " + x.seasons).join("; "), policy: list.map(x => x.name + ": " + x.policy).join("; ") };
};
/* Fills {REGION}, {SHORT}, {COUNTRIES}, {OUTLETS}, {SEASONS}, {POLICY}, {NAME}, {TITLE} in any prompt text. */
HUB.fill = (text, ctx) => {
  const R = HUB.regionInfo(ctx.regions);
  return String(text).replaceAll("{REGION}", R.label).replaceAll("{SHORT}", R.short).replaceAll("{COUNTRIES}", R.countries)
    .replaceAll("{OUTLETS}", R.outlets).replaceAll("{SEASONS}", R.seasons).replaceAll("{POLICY}", R.policy)
    .replaceAll("{NAME}", ctx.name || "the analyst").replaceAll("{TITLE}", ctx.title || "Research Analyst, Counterpoint Research");
};

HUB.STYLE = `
WRITING STYLE (Counterpoint Research analyst house style; the analyst is {NAME}, {TITLE}, covering {REGION})
- Casual-professional analyst voice, semi-formal. Sounds like a person, not a press office.
- Balanced and credible, never promotional. Name the risks and the gap between announcement and delivery.
- C-level readers (OEMs, distributors, component suppliers, investors) get the point from the first line.
- Short and tight. Plain words over jargon, but keep precise industry terms
  (sell-in, sell-through, ASP, BoM, MoM, YoY, entry tier, price band, channel inventory).
- Every point covers cause and effect: what happened, why, and what it means for the reader.
- One or two professional idioms per piece where they fit ("the writing is on the wall", "a double-edged sword").
- No em dashes. Use a colon, comma or full stop.
- Correct names: HONOR, TECNO, Infinix, itel, Xiaomi, Strait of Hormuz, iPhone 17.
- Commentary-style paragraphs open with a bold lead carrying the brand and the number (**double asterisks**),
  then 2 to 3 short sentences on the drivers.
A touch of Jeremy Clarkson, as seasoning only: a confident, slightly cheeky title and opening line; short punchy
sentences after a longer one; the odd vivid comparison or dry understatement; a clear verdict at the end.
Use it in the title, the opening, one or two lines in the body and the conclusion. Humour never bends a fact,
never mocks a country, people or group, never insults a brand.`;

HUB.DATA_RULES = `
DATA RULES (strict)
1. Smartphone market numbers (shipments, sell-in, sell-through, market share, brand growth MoM/QoQ/YoY, ASPs,
   revenue, price band mix, 5G smartphone share, model rankings, smartphone forecasts): use ONLY figures that
   Counterpoint Research has published online (counterpointresearch.com, or tier-1 media explicitly quoting
   Counterpoint). Cite the page. Never use IDC, Canalys, Omdia, TechInsights or GfK numbers.
2. If no published Counterpoint figure exists, write a placeholder ("X%", "X million units") and wrap it:
   [[VERIFY: the phrase with the placeholder || Verify with your data: the exact metric, market, period and Counterpoint source to pull]]
3. Other numbers (VAT and duties, regulation, government, operators, GSMA, ITU, World Bank, IMF, company
   announcements, prices, macro, oil) may come from credible sources: government and regulator sites, Reuters,
   Bloomberg, FT, WSJ, CNBC, and credible regional outlets such as {OUTLETS}.
4. Never invent a number, quote or source. If unsure a claim holds, wrap it in [[VERIFY: ... || ...]].
5. Cite inline as [1], [2] matching a numbered source list.`;

HUB.topicsPrompt = (ctx, today, start, history) => HUB.fill(`
You are the weekly research scout for {NAME}, {TITLE}, who covers the smartphone market in {REGION}
(countries: {COUNTRIES}) plus AI.

Today is ${today}. Cover news from ${start} to ${today}. Search the web thoroughly, with separate searches per area,
and include credible regional outlets ({OUTLETS}) as well as global ones.

Find the 5 HOTTEST SMARTPHONE topics and the 5 HOTTEST AI topics this week for {REGION}. Consider:
- Strategically important smartphone announcements (launches, pricing moves, new tiers, market entries or exits in {SHORT}).
- Major changes at smartphone brands (leadership, strategy, restructuring, partnerships, local assembly, channel).
- Geopolitical and macro incidents affecting the {SHORT} smartphone market (conflict, shipping routes, sanctions, tariffs, currency, oil).
- Regulation affecting smartphone adoption in {SHORT}: {POLICY}.
- 5G adoption and digital inclusion. Memory and component pricing.
- Seasonal demand moments now or coming up: {SEASONS}.
- What smartphone and AI leaders said publicly this week: interviews, keynotes, earnings calls, company blogs,
  and X or LinkedIn posts as reported by credible outlets.
- AI: model launches, AI phones and on-device AI, AI infrastructure and sovereign AI in {SHORT}, AI regulation, big deals.
"Hot" = covered by several credible outlets this week AND matters to smartphone companies selling in {REGION}.

Already covered in earlier weeks (skip unless genuinely new, and then say what is new):
${history || "- none yet"}

For each topic: 1 or 2 story angles, each a one-sentence argument answering what smartphone companies in {SHORT}
care about (demand and pricing, supply and memory costs, channel and inventory, share shifts, regulation and taxes,
5G and AI phone opportunities, country-level openings). 2 or 3 evidence items with outlet, date and the real URL
you found. Topic headline max 12 words; why_hot one sentence.

Return ONLY JSON inside <json></json> tags:
<json>{"smartphone":[{"code":"S1","topic":"...","why_hot":"...","stories":["..."],"evidence":[{"outlet":"...","date":"YYYY-MM-DD","title":"...","url":"https://..."}]}],
"ai":[{"code":"A1","topic":"...","why_hot":"...","stories":["..."],"evidence":[]}]}</json>
Exactly 5 per list, codes S1-S5 and A1-A5.`, ctx);

HUB.draftPrompt = (ctx, topic, notes, today, maxWords, maxCharts) => HUB.fill(`
You are drafting for {NAME}, {TITLE}, who covers {REGION}. Write the piece, ready for review.
${HUB.STYLE}
${HUB.DATA_RULES}

TOPIC
${topic}

THE ANALYST'S NOTES (follow them; they override the defaults)
${notes || "(none)"}

FIXED STRUCTURE (always, in this order)
1. Key takeaways: 3 to 5 one-sentence bullets, the "so what" for a C-level reader.
2. Introduction: one smooth paragraph (60 to 110 words) that leads into the argument. The hook goes here.
3. The argument: 2 to 3 short sections with clear headings, each making one point with evidence and saying
   what it means for smartphone companies in {SHORT}. Use country examples from {COUNTRIES} where relevant.
4. Conclusion: one or two paragraphs with the verdict and what OEMs should do next.
HARD LIMIT: the piece must fit 3 pages including charts: at most ${maxWords} words across takeaways,
introduction, argument and conclusion, and at most ${maxCharts} charts. Shorter is better.
Default format: Counterpoint-style blog for smartphone OEMs, distributors and component suppliers in {SHORT}.
Charts use real sourced data, or verify=true with null values if they need Counterpoint data you could not find.
Search the web for current, credible facts first. Today is ${today}.

Return ONLY JSON inside <json></json> tags:
<json>{"title":"...","format":"blog","takeaways":["..."],"introduction":"...",
"sections":[{"heading":"...","paragraphs":["text with **bold**, [1] citations and [[VERIFY: ... || Verify with your data: ...]]"],"chart_after":"c1 or null"}],
"conclusion":["..."],
"charts":[{"id":"c1","title":"Title stating the takeaway","type":"bar | hbar | line | stat","unit":"%","labels":["..."],"series":[{"name":"...","values":[1,2]}],"source":"...","verify":false,"verify_note":""}],
"sources":[{"n":1,"publisher":"...","title":"...","date":"YYYY-MM-DD","url":"https://..."}],
"editor_notes":["short notes for the analyst"]}</json>
"sections" holds only the argument sections. For "stat", one label and one series with one value.`, ctx);

HUB.shortenPrompt = (draft, words, maxWords, maxCharts) => `
This draft is too long. It must fit 3 pages including charts: at most ${maxWords} words of content and at most
${maxCharts} charts. It is now about ${words} words with ${(draft.charts || []).length} chart(s).
Cut it down: keep the structure, voice, strongest evidence, the citations you keep, and every [[VERIFY: ... || ...]]
marker you keep exactly as written. Drop the weakest points first. Add no new facts. Remove uncited sources.
Return the full revised draft as the same JSON inside <json></json> tags.

${JSON.stringify(draft)}`;

HUB.taskPrompt = (ctx, task, notes, today) => HUB.fill(`
You are working for {NAME}, {TITLE}, who covers the smartphone market in {REGION} (countries: {COUNTRIES}) plus AI.
Today is ${today}.
${HUB.STYLE}
${task.search ? HUB.DATA_RULES : "Never invent figures. Keep the analyst's data and structure unless asked. Flag anything wrong or out of date in one line after the text."}
Regional context: seasonal moments: {SEASONS}. Policy themes: {POLICY}.

TASK: ${HUB.fill(task.name, ctx)}
${task.instructions}

THE ANALYST'S INPUT AND NOTES
${notes || "(none: use the attached files)"}

Output in Markdown: the finished text first, with no preamble. Then, if needed, at most two short notes under
a "Notes" heading. Mark anything to verify with ==double equals==.${task.search ? " End with a numbered Sources list with links." : ""}`, ctx);

/* kind: topics (weekly flow) | text (Markdown answer, copy + Word download)
   search: lets Claude search the web; files: lets you attach a chart, PDF or CSV
   {REGION}, {SHORT}, {COUNTRIES} etc. are replaced with the regions chosen in Settings. */
HUB.TASKS = [
  {id:"weekly", g:"Blogs", kind:"topics", search:true, name:"Weekly blog topics", freq:"Weekly",
   desc:"The 5 hottest smartphone and AI topics of the week for {SHORT}, then a 3-page Word draft of the one you pick."},
  {id:"monthly", g:"Commentary", kind:"text", files:true, name:"Monthly {SHORT} market commentary", freq:"1-2 / month",
   desc:"Attach the chart, paste your draft points. Brand-by-brand MoM and YoY, matched to the chart.",
   instructions:"Read the attached chart or table, find the latest month, calculate MoM and YoY for the market and each brand from the unrounded figures. Rewrite the analyst's points as commentary by point: total market first, then brands by size. Each point opens with a bold lead carrying the brand and the number, then 2-3 short sentences on drivers (seasonality, launches, memory shortage, channel inventory, pricing, geopolitics). Numbers must match the chart exactly; if the draft matches a different month or direction, say so in the notes."},
  {id:"quarter", g:"Commentary", kind:"text", files:true, search:true, name:"Quarterly insights", freq:"Quarterly",
   desc:"2-3 bold-lead insights on the quarter, from your notes and data.",
   instructions:"Write 2-3 insights on the {SHORT} smartphone market for the quarter in the commentary style: bold lead, then short cause-and-effect sentences. Use the analyst's notes and data; search only for context such as launch dates or policy changes."},
  {id:"country", g:"Commentary", kind:"text", files:true, search:true, name:"Country commentary", freq:"1-4 / month",
   desc:"One market's month in {SHORT}: what moved and why.",
   instructions:"Write a short country commentary on the smartphone market named in the notes. Search for local drivers (launches, taxes, currency, seasonality, regulation). Use the analyst's numbers; do not add market numbers that were not given."},
  {id:"section", g:"Reports", kind:"text", files:true, name:"Report section rewrite", freq:"Weekly",
   desc:"Turn rough report text into a connected, C-level-ready section.",
   instructions:"Rewrite the text as a section of an analyst report for smartphone OEMs active in {SHORT}: a connected narrative, insight first then evidence, a real example where one exists. Keep the data and structure."},
  {id:"thematic", g:"Reports", kind:"text", search:true, name:"Thematic report outline", freq:"1-2 / month",
   desc:"A report skeleton with the argument, data hooks and C-level takeaways.",
   instructions:"Build an outline for a Counterpoint insight report on the theme in the notes, focused on {REGION}: a title, 3 C-level takeaways, then sections with the argument and the data hook for each. Search for current evidence. Mark every smartphone market number to pull from Counterpoint data with ==Verify with your data: ...==."},
  {id:"forecast", g:"Reports", kind:"text", files:true, name:"Forecast outlook text", freq:"Monthly",
   desc:"A balanced outlook paragraph for the forecast chart.",
   instructions:"Write a short, balanced outlook paragraph for the {SHORT} smartphone forecast from the analyst's numbers and points."},
  {id:"seo", g:"Reports", kind:"text", files:true, name:"Report SEO overview", freq:"1-2 / month",
   desc:"Section bullets and the questions the report answers, no numbers.",
   instructions:"Write an SEO-optimised overview of the attached report for its store page: one bullet per section (bold label then a colon), then 8-10 questions the report answers. No numbers. Readers: OEMs, global media, distributors, component makers."},
  {id:"linkedin", g:"Blogs", kind:"text", name:"LinkedIn post", freq:"2-6 / month",
   desc:"A hook, one argument and an open question, C-level ready.",
   instructions:"Turn the draft into a LinkedIn post for C-level readers: hook in the first line, one clear argument, end on an implication or open question. Under 200 words. Offer one alternative opening line in the notes."},
  {id:"event", g:"Blogs", kind:"text", search:true, name:"Event blog", freq:"0-2 / month",
   desc:"An event or conference day with the analyst angle.",
   instructions:"Write a Counterpoint blog about the event in the notes. Search for the announcements made, map them to what they mean for smartphones and AI in {SHORT}, and flag the gap between announcement and delivery."},
  {id:"news", g:"Research", kind:"text", search:true, name:"{SHORT} news roundup", freq:"Weekly",
   desc:"Launches, brand moves and government announcements across {SHORT} this week.",
   instructions:"Search for this week's smartphone news across {REGION} ({COUNTRIES}): launches, brand moves, and government or regulator announcements. Give a short roundup grouped by country, one or two lines per item, with sources."},
  {id:"brand", g:"Research", kind:"text", search:true, name:"Brand in a market", freq:"8-15 / month",
   desc:"How one brand is doing in one country.",
   instructions:"Research how the brand in the notes is doing in the country in the notes: official presence, distribution partners, best-selling models, pricing, recent launches and campaigns. Say where data is thin. No market share numbers unless published by Counterpoint."},
  {id:"memory", g:"Research", kind:"text", search:true, name:"Memory and component prices", freq:"3-6 / month",
   desc:"Latest DRAM and NAND pricing and what it means for entry-tier BoM.",
   instructions:"Search for the latest DRAM and NAND contract price moves and forecasts, and explain what they mean for entry-tier smartphone BoM and OEM pricing in {SHORT}. Cite sources and dates."},
  {id:"geo", g:"Research", kind:"text", search:true, name:"Geopolitics impact brief", freq:"2-5 / month",
   desc:"An incident's effect on freight, currency, confidence and demand in {SHORT}.",
   instructions:"Brief the analyst on how the development in the notes affects the smartphone market in {REGION}: freight and shipping routes, tariffs, oil and currency, consumer confidence, supply and launch timing. Search for the latest facts."},
  {id:"reg", g:"Research", kind:"text", search:true, name:"Regulation and tax check", freq:"1-3 / month",
   desc:"Policy changes in {SHORT} that affect smartphone adoption.",
   instructions:"Search for recent changes in {REGION} that affect smartphone adoption, especially: {POLICY}. Group by country, cite official or tier-1 sources."},
  {id:"specs", g:"Research", kind:"text", search:true, name:"Spec and price benchmark", freq:"2-4 / month",
   desc:"Compare models in a price band on specs, features and price.",
   instructions:"Benchmark the smartphones, price band and market in the notes on specs, features and price, as a Markdown table with sources. Default to markets in {SHORT}."},
  {id:"rewrite", g:"Other", kind:"text", files:true, name:"Rewrite in my style", freq:"Daily",
   desc:"Polish any text in the house analyst voice.",
   instructions:"Rewrite the text in the house style. Keep its meaning, structure and data."},
  {id:"press", g:"Other", kind:"text", files:true, name:"Press release", freq:"0-1 / month",
   desc:"Lead with the strongest finding, quotes marked for approval.",
   instructions:"Draft a press release from the attached report or the notes. Lead with the strongest finding. Mark every quote [Draft quote - for approval]."},
  {id:"excel", g:"Other", kind:"text", name:"Excel formula fix", freq:"3-6 / month",
   desc:"Debug a tracker formula or chart that won't update.",
   instructions:"Find what is wrong in the Excel formula and give the corrected formula first, then a short explanation."},
  {id:"client", g:"Other", kind:"text", files:true, name:"Client or vendor query", freq:"1-3 / month",
   desc:"Read a client or vendor message and draft a clear reply.",
   instructions:"Explain in two or three lines what the message is really asking, then draft a short, clear reply in a professional style."}
];
HUB.GROUPS = ["All", "Reports", "Blogs", "Commentary", "Research", "Other"];
