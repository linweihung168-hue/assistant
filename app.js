// 語音助理（純網頁版）畫面與語音
"use strict";
const $ = (id) => document.getElementById(id);
const WEEK = "日一二三四五六";
let started = false, state = "idle", recog = null, voices = [];
let remQueue = [], remShowing = null, remTimer = null;
const fired = new Set();

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function toast(msg, ms = 3500) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 狀態 ----------
const STATUS = { idle: "點麥克風說話", listening: "我在聽…", thinking: "查詢中…", speaking: "說話中…（點一下可打斷）" };
function setState(s, text) {
  state = s;
  $("micCard").dataset.state = s;
  $("status").textContent = text || STATUS[s];
  $("micBtn").setAttribute("aria-label", s === "listening" ? "停止聆聽" : "開始說話");
}
function tickClock() { const d = new Date(); $("clock").textContent = `${d.getMonth() + 1}/${d.getDate()} 週${WEEK[d.getDay()]}　${hhmm(d)}`; }

// ---------- 說話 ----------
function loadVoices() { voices = speechSynthesis.getVoices(); fillVoiceSelect(); }
function pickVoice() {
  if (!voices.length) voices = speechSynthesis.getVoices();
  const want = getSettings().voice;
  if (want) { const v = voices.find((v) => v.name === want); if (v) return v; }
  for (const re of [/HsiaoChen.*Natural/i, /HsiaoYu.*Natural/i, /Online.*Natural.*Taiwan/i, /美佳|Mei-?Jia/i]) { const v = voices.find((v) => re.test(v.name)); if (v) return v; }
  return voices.find((v) => /zh[-_]TW/i.test(v.lang)) || voices.find((v) => /^zh/i.test(v.lang)) || null;
}
async function speak(text, voiceOverride) {
  if (!text || !("speechSynthesis" in window)) return;
  if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); await sleep(250); } // Safari：cancel 後馬上 speak 會沒聲音
  return new Promise((resolve) => {
    const s = getSettings();
    const u = new SpeechSynthesisUtterance(text);
    const v = voiceOverride !== undefined ? voices.find((x) => x.name === voiceOverride) || pickVoice() : pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "zh-TW";
    u.rate = Number(s.rate || 1); u.volume = 1;
    let done = false;
    const end = () => { if (done) return; done = true; if (state === "speaking") setState("idle"); resolve(); };
    u.onend = end; u.onerror = end;
    setState("speaking");
    speechSynthesis.speak(u);
    setTimeout(() => { if (!speechSynthesis.speaking && !speechSynthesis.pending) end(); }, 2000 + text.length * 450);
  });
}
function stopSpeaking() { if ("speechSynthesis" in window) speechSynthesis.cancel(); if (state === "speaking") setState("idle"); }

let actx = null;
function chime() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    actx.resume();
    const t0 = actx.currentTime;
    [[880, 0], [1175, 0.18]].forEach(([f, dt]) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.5);
      o.connect(g).connect(actx.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.55);
    });
  } catch (e) {}
  return sleep(700);
}

// ---------- 聽 ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function listen() {
  if (!SR) { toast("這個瀏覽器不能語音輸入，請用 iPhone 的 Safari 或電腦的 Edge。打字仍然可以用。"); return; }
  if (state === "listening") { try { recog.stop(); } catch (e) {} return; }
  stopSpeaking();
  const silence = Number(getSettings().silence_sec || 1.5) * 1000;
  recog = new SR();
  recog.lang = "zh-TW"; recog.interimResults = true; recog.continuous = true; recog.maxAlternatives = 1;
  let finalText = "", interim = "", err = "", silenceT = null;
  const maxT = setTimeout(() => { try { recog.stop(); } catch (e) {} }, 15000);
  const arm = () => { clearTimeout(silenceT); silenceT = setTimeout(() => { try { recog.stop(); } catch (e) {} }, silence); };
  recog.onresult = (ev) => {
    interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
    }
    setState("listening", "「" + (finalText + interim) + "」");
    arm();
  };
  recog.onerror = (ev) => { err = ev.error; };
  recog.onend = async () => {
    clearTimeout(silenceT); clearTimeout(maxT);
    const txt = (finalText || interim).trim();
    if (txt) { await sleep(300); return handle(txt); }   // iPhone：等麥克風關好再出聲
    const msg = {
      "not-allowed": "麥克風被拒絕了：請到 iPhone「設定 → Safari → 麥克風」允許。",
      "service-not-allowed": "語音辨識不能用：請到 iPhone「設定 → Siri」打開 Siri。",
      "network": "語音辨識需要網路。", "audio-capture": "抓不到麥克風。", "no-speech": "沒有聽到聲音，再試一次。",
    }[err];
    setState("idle", msg);
    if (msg) setTimeout(() => { if (state === "idle") setState("idle"); }, 5000);
  };
  setState("listening");
  try { recog.start(); } catch (e) { setState("idle"); }
}

// ---------- 對話 ----------
function addBubble(who, text, detail, kind) {
  const chat = $("chat");
  const b = document.createElement("div");
  b.className = "bub " + who + (kind === "unknown" ? " unknown" : "");
  b.innerHTML = esc(text) + (detail && detail.length ? `<ul class="det">${detail.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "");
  chat.appendChild(b);
  while (chat.children.length > 40) chat.removeChild(chat.firstChild);
  b.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
async function handle(text) {
  text = (text || "").trim();
  if (!text) return;
  if (remShowing) {
    if (/知道|收到|好了|關掉|OK|ok|好的/.test(text)) { addBubble("me", text); return ack(); }
    if (/等一下|等等|再提醒|晚點|稍後|待會/.test(text)) { addBubble("me", text); return snooze(); }
  }
  showTab("chat");
  addBubble("me", text);
  setState("thinking");
  let r;
  try { r = answer(text); } catch (e) { r = reply("抱歉，出了一點問題：" + e.message); }
  addBubble("ai", r.reply, r.detail, r.kind);
  render();
  if (r.kind === "help") openHelp();
  await speak(r.speak || r.reply);
  if (r.reminder && getSettings().ios_reminder) sendToIOS(r.reminder);
}
function sendToIOS(r) {
  const d = new Date(r.due);
  const txt = `${r.text}\n${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hhmm(d)}`;
  location.href = "shortcuts://run-shortcut?name=" + encodeURIComponent("助理提醒") + "&input=text&text=" + encodeURIComponent(txt);
}

// ---------- 畫面 ----------
function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === name));
  document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("on", p.dataset.pane === name));
}
function render() {
  const s = getSettings();
  $("hi").textContent = `嗨 ${s.name}！`; $("startHi").textContent = `嗨 ${s.name}！`;
  const now = new Date(), today = now.toDateString();
  const rs = reminders();
  const todays = rs.filter((r) => new Date(r.due).toDateString() === today || new Date(r.due) < now);
  const later = rs.filter((r) => !todays.includes(r));
  $("remCount").textContent = rs.length;
  $("remDot").hidden = !todays.length;
  const row = (r, i, isLater) => {
    const d = new Date(r.due), sub = [];
    if (r.daily) sub.push("每天");
    if (isLater) sub.push(`${d.getMonth() + 1}/${d.getDate()}`);
    else { const m = Math.round((d - now) / 60000); if (m > 0 && m < 60) sub.push(`${m} 分鐘後`); else if (m <= 0) sub.push("時間到了"); }
    return `<div class="item"><div class="t ${i === 0 && !isLater ? "next" : ""}">${hhmm(d)}</div><div class="body"><div class="main-t">${esc(r.text)}</div>${sub.length ? `<div class="sub">${sub.join("・")}</div>` : ""}</div><button class="x" data-del-rem="${r.id}" aria-label="刪除提醒">✕</button></div>`;
  };
  $("remList").innerHTML = !rs.length ? `<div class="empty">沒有提醒。到「助理」說「10 分鐘後提醒我影印」試試看。</div>` :
    (todays.length ? `<div class="sec">今天</div>` + todays.map((r, i) => row(r, i, false)).join("") : "") +
    (later.length ? `<div class="sec">之後</div>` + later.map((r, i) => row(r, i, true)).join("") : "");
  const ns = notes();
  $("noteCount").textContent = ns.length;
  $("noteList").innerHTML = !ns.length ? `<div class="empty">還沒有記事。到「助理」說「記下來，明天要跟廠商確認交貨」試試看。</div>` :
    ns.slice(0, 50).map((n, i) => {
      const d = new Date(n.created);
      const when = (d.toDateString() === today ? "今天" : new Date(now - 864e5).toDateString() === d.toDateString() ? "昨天" : `${d.getMonth() + 1}/${d.getDate()}`) + " " + hhmm(d);
      return `<div class="item"><div class="num">${i + 1}</div><div class="body"><div class="main-t">${esc(n.text)}</div><div class="sub">${when}</div></div><button class="x" data-del-note="${n.id}" aria-label="刪除記事">✕</button></div>`;
    }).join("");
  const lab = scheduleLabel(), nt = Object.keys(tablesStore()).length;
  $("foot").textContent = `${lab ? "班表：" + lab : "還沒有班表"}　・　${nt ? "資料表 " + nt + " 個" : "還沒有資料表"}`;
}

// ---------- 提醒計時 ----------
function checkReminders() {
  if (!started) return;
  const now = new Date();
  for (const r of reminders()) if (new Date(r.due) <= now && !fired.has(r.id + r.due)) { fired.add(r.id + r.due); remQueue.push(r); }
  if (!remShowing && remQueue.length) showReminder(remQueue.shift());
  if (now.getSeconds() === 0) render();
}
async function announce(r) { if (getSettings().chime) await chime(); await speak(`提醒你：${r.text}`); }
function showReminder(r) {
  const s = getSettings();
  remShowing = r;
  $("remTitle").textContent = r.text;
  $("remTime").textContent = hhmm(new Date(r.due)) + (r.daily ? "・每天" : "");
  $("remHint").innerHTML = `按「知道了」之前，每 ${s.repeat_min} 分鐘會再念一次<br>也可以說「知道了」或「等一下再提醒」`;
  $("snoozeBtn").textContent = `${s.snooze_min} 分鐘後再提醒`;
  $("remModal").hidden = false;
  announce(r);
  clearInterval(remTimer);
  remTimer = setInterval(() => { if (remShowing && state !== "listening") announce(remShowing); }, s.repeat_min * 60000);
}
function closeReminder() {
  clearInterval(remTimer); remShowing = null; $("remModal").hidden = true; render();
  if (remQueue.length) setTimeout(() => showReminder(remQueue.shift()), 800);
}
async function ack() { if (!remShowing) return; ackReminder(remShowing.id); closeReminder(); speak("好的。"); }
async function snooze() { if (!remShowing) return; const m = Number(getSettings().snooze_min); snoozeReminder(remShowing.id, m); closeReminder(); speak(`好，${m} 分鐘後再提醒你。`); }

// ---------- 說明 ----------
function openHelp() {
  $("helpBody").innerHTML = HELP.map(([g, qs]) => `<div class="help-g">${esc(g)}</div>` + qs.map((q) => `<button class="help-q" data-q="${esc(q)}">${esc(q)}</button>`).join("")).join("");
  $("helpModal").hidden = false;
}

// ---------- 設定 ----------
function fillVoiceSelect() {
  const sel = $("sVoice"); if (!sel) return;
  const zh = voices.filter((v) => /^zh/i.test(v.lang));
  const list = (zh.length ? zh : voices).sort((a, b) => (/TW/i.test(b.lang) - /TW/i.test(a.lang)));
  const cur = !$("setModal").hidden && sel.options.length ? sel.value : getSettings().voice;
  const auto = pickVoice();
  sel.innerHTML = `<option value="">自動（${esc(auto ? auto.name : "預設")}）</option>` +
    list.map((v) => `<option value="${esc(v.name)}" ${v.name === cur ? "selected" : ""}>${esc(v.name)}（${esc(v.lang)}）</option>`).join("");
}
function fillSettings() {
  const s = getSettings();
  $("sName").value = s.name; $("sRate").value = s.rate; $("rateVal").textContent = `（${Number(s.rate).toFixed(2)}）`;
  $("sSilence").value = String(s.silence_sec); $("sRepeat").value = String(s.repeat_min); $("sSnooze").value = String(s.snooze_min);
  $("sChime").checked = !!s.chime; $("sIos").checked = !!s.ios_reminder;
  fillVoiceSelect(); fillData();
}
function fillData() {
  const sch = schedules(), tb = tablesStore();
  const items = Object.keys(sch).sort().map((k) => `<div><span>${sch[k].year} 年 ${sch[k].month} 月班表・${sch[k].people.length} 位</span><button data-del-sch="${k}">刪除</button></div>`)
    .concat(Object.keys(tb).map((k) => `<div><span>${esc(k)}・${tb[k].reduce((a, x) => a + x.rows.length, 0)} 筆</span><button data-del-tb="${esc(k)}">刪除</button></div>`));
  $("dataList").innerHTML = items.join("") || `<div><span>還沒有資料</span></div>`;
  const nk = getSettings().nicknames || {};
  $("nickList").innerHTML = Object.keys(nk).map((k) => `<div><span>${esc(k)} → ${esc(nk[k])}</span><button data-del-nk="${esc(k)}">刪除</button></div>`).join("");
  const un = Store.get("unanswered", []);
  $("unCount").textContent = un.length;
  $("unList").innerHTML = un.length ? un.slice(0, 50).map((u) => { const d = new Date(u.time); return `<div><span>${esc(u.text)}</span><small>${d.getMonth() + 1}/${d.getDate()} ${hhmm(d)}</small></div>`; }).join("") : `<div><span>目前沒有</span></div>`;
}
function saveFromForm() {
  saveSettings({
    name: $("sName").value.trim() || "偉弘", voice: $("sVoice").value, rate: Number($("sRate").value),
    silence_sec: Number($("sSilence").value), repeat_min: Number($("sRepeat").value), snooze_min: Number($("sSnooze").value),
    chime: $("sChime").checked, ios_reminder: $("sIos").checked,
  });
  $("rateVal").textContent = `（${Number($("sRate").value).toFixed(2)}）`;
  render();
}

async function importFiles(files) {
  for (const f of files) {
    try { const msg = await importFile(f); toast(msg, 5000); addBubble("ai", msg); }
    catch (e) { toast("匯入失敗：" + e.message, 6000); addBubble("ai", "匯入失敗：" + e.message, null, "unknown"); }
  }
  fillData(); render();
}
async function exportBackup() {
  const name = `語音助理備份_${isoDate(new Date())}.json`;
  const blob = new Blob([exportAll()], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}

// ---------- 開始 ----------
async function start() {
  if (started) return;
  started = true;
  $("start").hidden = true;
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch (e) {}
  for (let i = 0; i < 20 && !voices.length; i++) { await sleep(100); voices = speechSynthesis.getVoices(); }
  let text = greeting();
  const missed = reminders().filter((r) => new Date(r.due) < new Date(Date.now() - 60000));
  if (missed.length) text += `你有 ${missed.length} 個錯過的提醒。`;
  addBubble("ai", text);
  await speak(text);
  checkReminders();
}

function bind() {
  $("startBtn").onclick = start;
  $("micBtn").onclick = () => (state === "speaking" ? stopSpeaking() : listen());
  $("typeForm").onsubmit = (e) => { e.preventDefault(); const v = $("typed").value; $("typed").value = ""; $("typed").blur(); handle(v); };
  $("helpBtn").onclick = openHelp;
  $("setBtn").onclick = () => { fillSettings(); $("setModal").hidden = false; };
  $("ackBtn").onclick = ack; $("snoozeBtn").onclick = snooze;
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => (b.closest(".overlay").hidden = true)));
  ["helpModal", "setModal"].forEach((id) => $(id).addEventListener("click", (e) => { if (e.target.id === id) $(id).hidden = true; }));
  $("helpBody").onclick = (e) => { const q = e.target.dataset.q; if (q) { $("helpModal").hidden = true; handle(q); } };

  document.body.addEventListener("click", (e) => {
    const t = e.target.closest("[data-del-rem],[data-del-note],[data-del-sch],[data-del-tb],[data-del-nk]");
    if (!t) return;
    if (t.dataset.delRem) deleteReminder(t.dataset.delRem);
    if (t.dataset.delNote) deleteNote(t.dataset.delNote);
    if (t.dataset.delSch && confirm("刪除這個月的班表？")) { const s = schedules(); delete s[t.dataset.delSch]; Store.set("schedules", s); }
    if (t.dataset.delTb && confirm("刪除這個資料表？")) { const s = tablesStore(); delete s[t.dataset.delTb]; Store.set("tables", s); }
    if (t.dataset.delNk) { const s = getSettings(); const nk = s.nicknames || {}; delete nk[t.dataset.delNk]; saveSettings({ nicknames: nk }); }
    fillData(); render();
  });

  ["sName", "sVoice", "sRate", "sSilence", "sRepeat", "sSnooze", "sChime", "sIos"].forEach((id) => $(id).addEventListener("change", saveFromForm));
  $("sRate").addEventListener("input", () => ($("rateVal").textContent = `（${Number($("sRate").value).toFixed(2)}）`));
  $("testVoice").onclick = () => { saveFromForm(); speak(`嗨 ${getSettings().name}，這是我現在的聲音。`, $("sVoice").value); };
  $("fileInput").onchange = (e) => { importFiles([...e.target.files]); e.target.value = ""; };
  $("nkAdd").onclick = () => {
    const a = $("nkA").value.trim(), b = $("nkB").value.trim();
    if (!a || !b) return toast("綽號和名字都要填");
    const nk = getSettings().nicknames || {}; nk[a] = b; saveSettings({ nicknames: nk });
    $("nkA").value = ""; $("nkB").value = ""; fillData();
  };
  $("unClear").onclick = () => { Store.set("unanswered", []); fillData(); };
  $("bkOut").onclick = exportBackup;
  $("bkIn").onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    try { importAll(await f.text()); toast("備份已還原"); fillSettings(); render(); } catch (err) { toast("還原失敗：" + err.message, 6000); }
  };

  // 電腦：空白鍵說話
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat) return;
    const tag = (document.activeElement?.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag)) return;
    e.preventDefault();
    if (!started) return start();
    if (!$("helpModal").hidden || !$("setModal").hidden) return;
    listen();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") ["helpModal", "setModal"].forEach((id) => ($(id).hidden = true)); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { tickClock(); render(); checkReminders(); } });
}

(function init() {
  bind();
  showTab("chat");
  tickClock(); setInterval(tickClock, 5000);
  const miss = [];
  if (!SR) miss.push("語音輸入");
  if (!window.JSZip || !window.XLSX) miss.push("讀檔元件（請確認網路）");
  if (miss.length) { $("banner").textContent = "目前無法使用：" + miss.join("、") + "。打字仍然可以用。"; $("banner").hidden = false; }
  if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  if (window.matchMedia("(min-width:900px)").matches) $("status").textContent = "按空白鍵或點麥克風說話";
  STATUS.idle = $("status").textContent;
  render();
  setInterval(checkReminders, 1000);
})();
