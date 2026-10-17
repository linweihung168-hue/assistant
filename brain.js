// 語音助理的大腦（純網頁版）：聽懂固定句型、查資料、回傳要說的話。
// 所有資料都存在這台裝置（localStorage），不會上傳。
"use strict";

// ============================ 存檔 ============================
const Store = {
  get(key, def) {
    try { const v = localStorage.getItem("va_" + key); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  },
  set(key, val) {
    try { localStorage.setItem("va_" + key, JSON.stringify(val)); return true; } catch (e) { return false; }
  },
};

const DEFAULT_SETTINGS = {
  name: "偉弘", voice: "", rate: 1.0, volume: 1.0,
  repeat_min: 1, snooze_min: 5, chime: true, silence_sec: 1.5,
  ios_reminder: false, last_greet: "",
};
function getSettings() { return Object.assign({}, DEFAULT_SETTINGS, Store.get("settings", {})); }
function saveSettings(s) { const n = Object.assign(getSettings(), s); Store.set("settings", n); return n; }

const pad2 = (n) => String(n).padStart(2, "0");
const WD = "一二三四五六日";            // index: 0=週一
const wdOf = (d) => (d.getDay() + 6) % 7; // 0=週一
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const isoDT = (d) => `${isoDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
const hhmm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const fmtNum = (x) => (x === null || x === undefined ? "?" : Number.isInteger(+x) ? String(+x) : String(+x));
const uid = () => Math.random().toString(36).slice(2, 10);
function nowDate() { return new Date(); }

// ============================ 文字前處理 ============================
const CN_DIG = { "零": 0, "〇": 0, "一": 1, "二": 2, "兩": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
const CN_CHARS = "零〇一二兩两三四五六七八九十百";
function cn2int(s) {
  if (/^\d+$/.test(s)) return +s;
  let total = 0, num = 0;
  for (const ch of s) {
    if (ch in CN_DIG) num = CN_DIG[ch];
    else if (ch === "十") { total += (num || 1) * 10; num = 0; }
    else if (ch === "百") { total += (num || 1) * 100; num = 0; }
  }
  return total + num;
}
function toHalf(s) {
  return s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, " ");
}
function normalize(text) {
  let t = toHalf(text || "").trim().replace(/：/g, ":");
  t = t.replace(/[。！!？?，,、；;]+$/, "");
  t = t.replace(new RegExp(`[${CN_CHARS}]+(?=\\s*(?:分鐘|分|點|號|日|月|小時|個|筆|天|鐘頭|半|h|H|:))`, "g"), (m) => String(cn2int(m)));
  t = t.replace(new RegExp(`第([${CN_CHARS}]+)`, "g"), (m, a) => "第" + cn2int(a));
  t = t.replace(new RegExp(`(點)([${CN_CHARS}]+)(?=分|$|\\D)`, "g"), (m, a, b) => a + cn2int(b));
  return t;
}
function speakify(s) {
  s = s.replace(/\d+(?:\.\d+){2,}/g, (m) => m.split(".").map((p) => p.split("").join(" ")).join(" 點 "));
  s = s.replace(/(?<![\d.:])\d{3,}(?![\d.:])/g, (m) => m.split("").join(" "));
  return s;
}
function fmtDue(d) {
  const today = dayOnly(nowDate());
  const dd = dayOnly(d);
  const diff = Math.round((dd - today) / 864e5);
  if (diff === 0) return hhmm(d);
  if (diff === 1) return "明天 " + hhmm(d);
  if (diff === 2) return "後天 " + hhmm(d);
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm(d)}`;
}
const dateLabel = (d) => `${d.getMonth() + 1}月${d.getDate()}號（週${WD[wdOf(d)]}）`;

// ============================ 日期解析 ============================
const WD_MAP = { "一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6 };
function parseDate(t, base) {
  base = dayOnly(base || nowDate());
  let m = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[號日]?/);
  if (m) { const d = new Date(base.getFullYear(), +m[1] - 1, +m[2]); return d.getMonth() === +m[1] - 1 ? [d, "day"] : [null, "day"]; }
  m = t.match(/(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/);
  if (m) { const d = new Date(base.getFullYear(), +m[1] - 1, +m[2]); return d.getMonth() === +m[1] - 1 ? [d, "day"] : [null, "day"]; }
  const shiftOf = (w) => ({ "下": 7, "下個": 7, "上": -7, "上個": -7 })[w || ""] || 0;
  const monday = addDays(base, -wdOf(base));
  m = t.match(/(這|這個|本|下|下個|上|上個)?\s*(週|周|星期|禮拜)([一二三四五六日天])/);
  if (m) return [addDays(monday, WD_MAP[m[3]] + shiftOf(m[1])), "day"];
  m = t.match(/(這|本|下|下個|上|上個)\s*(週|周|禮拜|星期)/);
  if (m) return [addDays(monday, shiftOf(m[1])), "week"];
  const rel = [["大後天", 3], ["後天", 2], ["明天", 1], ["今天", 0], ["今日", 0], ["昨天", -1], ["前天", -2]];
  for (const [k, v] of rel) if (t.includes(k)) return [addDays(base, v), "day"];
  m = t.match(/(?<![\d月/])(\d{1,2})\s*[號日]/);
  if (m) { const d = new Date(base.getFullYear(), base.getMonth(), +m[1]); return d.getMonth() === base.getMonth() ? [d, "day"] : [null, "day"]; }
  return [null, "day"];
}

// ============================ 提醒時間解析 ============================
function parseWhen(t, base) {
  base = base || nowDate();
  const daily = /每天|每日/.test(t);
  let rest = t.replace(/每天|每日/g, "");
  let m = rest.match(/(\d+(?:\.\d+)?)?\s*個?\s*(半)?\s*(分鐘|分|小時|鐘頭)\s*(後|之後|以後|過後)/);
  if (m && (m[1] || m[2])) {
    let n = m[1] ? parseFloat(m[1]) : 0;
    if (m[2]) n += 0.5;
    const mins = (m[3] === "分鐘" || m[3] === "分") ? n : n * 60;
    const dt = new Date(base.getTime() + mins * 60000);
    if (mins >= 1) dt.setSeconds(0, 0);
    return [dt, false, rest.slice(0, m.index) + rest.slice(m.index + m[0].length)];
  }
  m = rest.match(/(今天|明天|後天)?\s*(早上|上午|中午|下午|晚上|傍晚)?\s*(\d{1,2})\s*(?:點|:)\s*(半|\d{1,2})?\s*分?/);
  if (m) {
    let h = +m[3];
    const mi = m[4] === "半" ? 30 : +(m[4] || 0);
    const q = m[2];
    if (h > 23 || mi > 59) return [null, daily, rest];
    const day = ({ "明天": 1, "後天": 2 })[m[1] || ""] || 0;
    if (["下午", "晚上", "傍晚"].includes(q) && h < 12) h += 12;
    else if (q === "中午" && h <= 2) h += 12;
    const d0 = addDays(dayOnly(base), day);
    const at = (hh) => { const x = new Date(d0); x.setHours(hh, mi, 0, 0); return x; };
    let dt;
    if (q || h >= 12) {
      dt = at(h);
      if (dt <= base && day === 0) dt = addDays(dt, 1);
    } else {
      const c = [at(h), at(h + 12)];
      if (day) dt = h <= 6 ? c[1] : c[0];
      else { const fut = c.filter((x) => x > base); dt = fut.length ? fut[0] : addDays(c[0], 1); }
    }
    return [dt, daily, rest.slice(0, m.index) + rest.slice(m.index + m[0].length)];
  }
  return [null, daily, rest];
}

// ============================ 班別資料 ============================
// 依《藥劑課班別上班時段》修訂 2026-06-04；null＝文件未寫，待確認
const CODE_INFO = {
  N: { name: "正常班", start: "08:00", end: "17:30", hours: 8, night: 0, big: 0, note: "週間 08:00~12:30、14:00~17:30；週六 4h（08:00~12:00，中藥局 09:00~13:00）" },
  R: { name: "休假" }, NN: { name: "國定假", hours: 8 }, HS: { name: "特休", hours: 8 }, ZZ: { name: "公假或其他假", hours: 8 },
  E: { name: "美沙冬＋中午值班", start: "07:30", end: "16:00", hours: 8, night: 0, big: 0, note: "週六 07:30~11:30、12:00~16:00" },
  E7: { name: "週日早班", start: "07:30", end: "16:00", hours: 8.5, night: 0, big: 0, note: "週日" },
  F: { name: "中午值班", start: "08:00", end: "16:30", hours: 8, night: 0, big: 0, note: "F1／F2／FS 皆輸入 F；FS 時段 08:00~12:00、13:30~17:30（FS 代號待確認）" },
  FA: { name: "中午值班、送藥", start: "08:00", end: "17:00", hours: 8, night: 0, big: 0, note: "08:00~12:00、13:00~17:00" },
  A3: { name: "週間小夜（包班）", start: "13:00", end: "21:30", hours: 8, night: 5, big: 0, note: "夜班費 $43.8/hr" },
  A1: { name: "週間小夜（包班）", start: "13:00", end: "21:30", hours: 8, night: 5, big: 0, note: "夜班費 $62.5/hr" },
  S2: { name: "週間小夜（包班）", start: "13:30", end: "22:00", hours: 8, night: 5.5, big: 0, note: "夜班費 $43.8/hr" },
  S1: { name: "週間小夜（包班）", start: "13:30", end: "22:00", hours: 8, night: 5.5, big: 0, note: "夜班費 $62.5/hr" },
  S8: { name: "週六小夜", start: "12:00", end: "22:00", hours: 10, night: 6, big: 0, note: "" },
  S9: { name: "週日小夜", start: "16:00", end: "22:00", hours: 6, night: null, big: 0, note: "小夜時數文件未寫（待確認）" },
  S7: { name: "六日小夜（包班）", start: "12:00", end: "22:00", hours: 10, night: 6, big: 0, note: "週日手動改上班時數" },
  P: { name: "大夜（包班）", start: "22:00", end: "08:00", hours: 10, night: 2, big: 8, note: "冬P 上班h 11（僅指定一人）" },
  B: { name: "助理小夜", start: "12:30", end: "21:00", hours: 8, night: 4.5, big: 0, note: "西藥局 12:30~17:00、17:30~21:00；中藥局 14:00~、6.5+；B4（22:00 下班）小夜 5.5" },
  M1: { name: "中醫白班", start: "08:30", end: "17:30", hours: 7.5, night: 0, big: 0, note: "08:30~12:30、14:00~17:30" },
};
const EXTRA_NAMES = { r: "週六輪休", GB: "產假", N1: "中醫白班", N2: "中醫白班", "N+": "白班（N＋）", B4: "助理小夜", "00": "到職前", "99": "離職後" };

// 班別 × 請假（只放有定論的；guess＝推定、manual＝要人工判斷）
const LEAVE_WEEKDAY = {
  "N|AM": { s: "ok", work: 3.5, night: 0, sp: 4.5 },
  "N|PM": { s: "ok", work: 4, night: 0, sp: 4 },
  "FA|AM": { s: "ok", work: 4, night: 0, sp: 4 },
  "A3|PM": { s: "ok", work: 4, night: 4, sp: 4, note: "只上 17:30~21:30，小夜從 16:00 起算，所以小夜也要改成 4" },
  "A1|PM": { s: "ok", work: 4, night: 4, sp: 4, note: "只上 17:30~21:30，小夜從 16:00 起算，所以小夜也要改成 4" },
  "S2|PM": { s: "guess", work: 4.5, night: 4.5, sp: 3.5 },
  "S1|PM": { s: "guess", work: 4.5, night: 4.5, sp: 3.5 },
};
const LEAVE_MANUAL = ["FA|PM", "A3|AM", "A1|AM", "S2|AM", "S1|AM", "F|AM", "F|PM", "E|AM", "E|PM", "B|AM", "B|PM"];
const SATURDAY = {
  N: { work: 0, rest: 4, note: "系統班別改回 N，休加填 4" },
  E: { work: 0, rest: 4.5, note: "休加填 4.5" },
  E_UD: { work: 8, note: "備註 UD：算工時 8 小時，不休加" },
};
const HOURLY_MANUAL = ["A3", "A1", "S2", "S1", "B", "P", "F", "FA", "E"];

function answerLeave(code, half, hours, sat, ud) {
  if (sat) {
    if (half || hours !== null) return [`週六的 ${code} 請假沒有固定規則，需要人工判斷。`, null];
    const key = code === "E" && ud ? "E_UD" : code;
    const r = SATURDAY[key];
    if (!r) return null;
    let s = `週六 ${code}${key === "E_UD" ? "（UD）" : ""}：上班 ${fmtNum(r.work)} 小時`;
    if (r.rest) s += `，休加 ${fmtNum(r.rest)} 小時`;
    return [s + "。", r.note];
  }
  if (hours !== null) {
    if (code === "N") {
      if (hours >= 8) return ["請 8 小時以上的小時假沒有固定規則，需要人工判斷。", null];
      return [`N 班請 ${fmtNum(hours)} 小時：上班 ${fmtNum(8 - hours)} 小時，特休 ${fmtNum(hours)} 小時。`, `Word 左下角會寫 ${fmtNum(8 - hours)}h（當天實際上班時數）`];
    }
    if (HOURLY_MANUAL.includes(code)) return [`${code} 班請小時假沒有固定規則，需要人工判斷。夜班要注意小夜時數也要一起扣。`, null];
    return null;
  }
  const key = code + "|" + half;
  if (LEAVE_MANUAL.includes(key)) return [`${code} 請${half === "AM" ? "上午" : "下午"}沒有固定規則，需要人工判斷。`, null];
  const r = LEAVE_WEEKDAY[key];
  if (!r) return null;
  let s = `${code} 請 ${half}：上班 ${fmtNum(r.work)} 小時，小夜 ${fmtNum(r.night)} 小時，特休 ${fmtNum(r.sp)} 小時。`;
  if (r.s === "guess") s = "這是推定的，尚待確認。" + s;
  return [s, r.note || null];
}

// ============================ Word 班表讀取 ============================
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const SYS_CODES = new Set(["N", "R", "HS", "E", "FA", "F", "E7", "S8", "S9", "S7", "S1", "A1", "A3", "S2", "B", "P", "NN", "ZZ", "M1"]);
const isCJK = (x) => !!x && [...x].every((c) => c >= "一" && c <= "鿿");

function cellParas(tc) {
  return [...tc.getElementsByTagNameNS(W_NS, "p")].map((p) =>
    [...p.getElementsByTagNameNS(W_NS, "r")].map((r) => {
      const txt = [...r.getElementsByTagNameNS(W_NS, "t")].map((t) => t.textContent).join("");
      const va = r.getElementsByTagNameNS(W_NS, "vertAlign")[0];
      return [txt, va ? va.getAttributeNS(W_NS, "val") || va.getAttribute("w:val") : null];
    }).filter((x) => x[0]));
}
function splitHours(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*[hH]/);
  if (!m) return [text, null];
  return [(text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim(), parseFloat(m[1])];
}
function parseCell(paras) {
  const base = [], full = [];
  let hours = null;
  for (const p of paras) {
    let t = p.filter(([, va]) => !va).map(([x]) => x).join("").trim();
    const [t2, h] = splitHours(t); t = t2;
    if (h !== null) hours = h;
    const f = p.map(([x]) => x).join("").trim();
    const sub = p.filter(([, va]) => va === "subscript").map(([x]) => x).join("").trim();
    if (t === "F" && sub === "A") t = "FA";
    if (t) base.push(t.replace(/\s+/g, ""));
    if (f) full.push(f);
  }
  const raw = full.join(" / ");
  const half = base.find((x) => x === "AM" || x === "PM") || "";
  const rest = base.filter((x) => x !== "AM" && x !== "PM");
  const times = rest.filter((x) => /^[\d:.\-~]+$/.test(x));
  const notes = rest.filter((x) => isCJK(x.replace(/^冬/, "")) && !x.startsWith("冬"));
  const codes = rest.filter((x) => !times.includes(x) && !notes.includes(x));
  let code = codes[0] || "";
  if (code.startsWith("冬")) code = code.slice(1);
  if (/^B\d+$/.test(code)) code = "B";
  if (code === "X") code = "HS";
  if (code === "FS") code = "F";
  if (code === "G") code = "N";
  return { raw, code, half, hours, ud: /UD/i.test(raw) };
}

async function readScheduleDocx(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const f = zip.file("word/document.xml");
  if (!f) throw new Error("這不是 Word 檔");
  const doc = new DOMParser().parseFromString(await f.async("string"), "application/xml");
  const tbls = [...doc.getElementsByTagNameNS(W_NS, "tbl")];
  if (!tbls.length) throw new Error("Word 檔裡找不到表格");
  const rowsOf = (t) => [...t.childNodes].filter((n) => n.localName === "tr");
  const tbl = tbls.reduce((a, b) => (rowsOf(b).length > rowsOf(a).length ? b : a));
  const txt = (el) => [...el.getElementsByTagNameNS(W_NS, "t")].map((x) => x.textContent).join("");
  const body = doc.getElementsByTagNameNS(W_NS, "body")[0];
  let pre = "";
  for (const ch of body.children) { if (ch === tbl || ch.contains(tbl)) break; pre += txt(ch); }
  const ym = pre.match(/(\d{4})\s*年\D{0,5}?(\d{1,2})\s*月/);
  if (!ym) throw new Error("讀不到班表的年月（表格前面要有「2026 年 10 月」這類文字）");
  const year = +ym[1], month = +ym[2];
  const ndays = new Date(year, month, 0).getDate();
  const trs = rowsOf(tbl);
  const cellsOf = (tr) => [...tr.childNodes].filter((n) => n.localName === "tc");
  const holidays = [];
  if (trs.length) cellsOf(trs[0]).forEach((tc, j) => { if (j >= 1 && txt(tc).includes("國假")) holidays.push(j); });
  const people = [];
  for (const tr of trs) {
    const tcs = cellsOf(tr);
    if (!tcs.length) continue;
    const head = txt(tcs[0]).trim();
    const m = head.match(/(\d{3,6})\s*$/);
    if (!m) continue;
    const name = head.slice(0, m.index).trim();
    if (!name || tcs.length < ndays + 1) continue;
    const cells = {};
    for (let d = 1; d <= ndays; d++) cells[d] = parseCell(cellParas(tcs[d]));
    // 推定組別：大夜（P 很多）、中藥局（出現 N2/N+/M1）
    const codes = Object.values(cells).map((c) => c.code);
    const group = codes.filter((c) => c === "P").length >= 3 ? "大夜" : codes.some((c) => ["N2", "N+", "M1", "N1"].includes(c)) ? "中藥局" : "";
    people.push({ id: m[1], name, group, cells });
  }
  if (!people.length) throw new Error("班表裡找不到人員（第一欄要是「姓名＋員工代號」）");
  return { year, month, ndays, holidays, people, updated: isoDT(nowDate()) };
}

function blankCode(person, date, holiday) {
  if (holiday) return "NN";
  if (person.group === "大夜") return "R";
  if (wdOf(date) >= 5) return "R";
  if (person.group === "中藥局") return "M1";
  return "N";
}

// ============================ 班表查詢 ============================
function schedules() { return Store.get("schedules", {}); }
function schedFor(d) { return schedules()[`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`] || null; }
function scheduleLabel() {
  const s = schedules(); const ks = Object.keys(s).sort();
  if (!ks.length) return "";
  const x = s[ks[ks.length - 1]]; const u = new Date(x.updated);
  return `${x.month} 月（${u.getMonth() + 1}/${u.getDate()} 更新）`;
}
const givenName = (full) => (full.length === 4 ? full.slice(2) : full.length >= 3 ? full.slice(1) : full);

function peopleIndex() {
  const seen = {}; const s = schedules();
  for (const k of Object.keys(s).sort()) for (const p of s[k].people) seen[p.id] = { full: p.name, given: givenName(p.name), id: p.id };
  return Object.values(seen);
}
function nicknames() {
  const out = {};
  for (const t of tablesList()) {
    if (!isNickFile(t.file)) continue;
    const nk = t.headers.find((h) => /綽號|暱稱/.test(h)) || t.headers[0];
    const nm = t.headers.find((h) => /名字|姓名/.test(h)) || t.headers[1];
    for (const r of t.rows) { const a = String(r[nk] || "").trim(), b = String(r[nm] || "").trim(); if (a && b) out[a] = b; }
  }
  Object.assign(out, getSettings().nicknames || {});
  return out;
}
function pinyinOf(s) {
  if (!window.pinyinPro) return [];
  return window.pinyinPro.pinyin(s, { toneType: "none", type: "array" });
}
function findPerson(t, allowPinyin = true) {
  const ppl = peopleIndex();
  if (!ppl.length) return [];
  const nk = nicknames();
  const tp = [...t].filter((c) => c >= "一" && c <= "鿿").map((c) => pinyinOf(c)[0]);
  const pyIn = (word) => {          // 同音字也算：「阿宏」也對得到「阿弘」
    const wp = pinyinOf(word); const n = wp.length;
    if (!n || !window.pinyinPro) return false;
    for (let i = 0; i + n <= tp.length; i++) if (wp.every((x, j) => x === tp[i + j])) return true;
    return false;
  };
  const targetHit = (target) => {
    target = target.trim();
    let hit = ppl.filter((p) => p.full === target || p.given === target || p.full.endsWith(target) || target.endsWith(p.given));
    if (!hit.length && window.pinyinPro) {
      const tg = pinyinOf(target).join(" ");
      hit = ppl.filter((p) => pinyinOf(p.full).join(" ") === tg || pinyinOf(p.given).join(" ") === tg || tg.endsWith(pinyinOf(p.given).join(" ")));
    }
    return hit;
  };
  const keys = Object.keys(nk).sort((a, b) => b.length - a.length);
  for (const pass of [0, 1]) {
    for (const k of keys) {
      if (pass === 0 ? t.includes(k) : (allowPinyin && pyIn(k))) {
        const hit = targetHit(nk[k]);
        if (hit.length) return hit;
      }
    }
  }
  let hit = ppl.filter((p) => t.includes(p.full));
  if (hit.length) return hit;
  hit = ppl.filter((p) => p.given && t.includes(p.given));
  if (hit.length) return hit;
  if (allowPinyin && window.pinyinPro) {
    const chars = [...t].filter((c) => c >= "一" && c <= "鿿");
    const tp = chars.map((c) => pinyinOf(c)[0]);
    for (const p of ppl) {
      const gp = pinyinOf(p.given); const n = gp.length;
      if (n < 2) continue;
      for (let i = 0; i + n <= tp.length; i++) if (gp.every((x, j) => x === tp[i + j])) return [p];
    }
  }
  return [];
}

function describeCell(c, person, date, holiday) {
  const raw = (c.raw || "").trim();
  if (raw === "--") return { code: "--", desc: "不上班", raw };
  let code = c.code;
  if (!code) {
    const words = raw.split(/[\s/]+/).filter((x) => x && x !== "AM" && x !== "PM" && !/^[\d:.\-~]+[hH]?$/.test(x));
    code = words.length && words.every(isCJK) ? (wdOf(date) >= 5 ? "R" : "N") : blankCode(person, date, holiday);
  }
  if ((code === "N2" || code === "N+" || code === "N1") && person.group !== "中藥局") code = "N";
  let name = code === "r" ? "週六輪休" : (CODE_INFO[code] ? CODE_INFO[code].name : EXTRA_NAMES[code] || "");
  const extra = [];
  if (c.half) extra.push(`請${c.half === "AM" ? "上午" : "下午"}假（${c.half}）`);
  if (c.hours !== null && c.hours !== undefined) extra.push(`小時假，當天上班 ${fmtNum(c.hours)} 小時`);
  if (holiday) extra.push("國定假日");
  return { code, desc: name + (extra.length ? "，" + extra.join("，") : ""), raw };
}
const codeSay = (code, desc) => (["N", "R", "r", "HS", "NN", "ZZ", "GB", "--", "M1"].includes(code) ? desc : `${code} ${desc}`.trim());

const SHIFT_CATS = {
  "小夜": ["A1", "A3", "S1", "S2", "S7", "S8", "S9", "B"], "大夜": ["P"],
  "夜班": ["A1", "A3", "S1", "S2", "S7", "S8", "S9", "B", "P"], "早班": ["E", "E7"], "美沙冬": ["E"],
  "中午值班": ["F", "FA", "E"], "值班": ["F", "FA", "E"], "送藥": ["FA"],
  "休假": ["R", "r", "HS", "NN", "ZZ", "GB"], "休息": ["R", "r", "HS", "NN", "ZZ", "GB"], "特休": ["HS"],
  "正常班": ["N"], "白班": ["N", "M1"],
};
const CODE_RE = /(?<![A-Z0-9])(A1|A3|S1|S2|S7|S8|S9|E7|FA|NN|HS|ZZ|M1|B4|N|E|F|B|P)(?![A-Z0-9])/g;
// 語音辨識常把英文字母寫成中文同音字，例如「愛斯2」＝S2、「欸3」＝A3
const SOUND_LETTER = [[/(?:愛斯|艾斯|爱斯|ES)\s*(?=[0-9一二三四五六七八九])/gi, "S"], [/(?:欸|誒|ㄟ|诶)\s*(?=[0-9一二三四五六七八九])/g, "A"],
  [/(?:伊|衣|依)\s*(?=[7七])/g, "E"], [/(?:逼|比)\s*(?=[0-9一二三四五六七八九])/g, "B"], [/(?:欸|誒)\s*(?:辅|輔|夫|福)/g, "F"]];
function normCodes(t) {
  for (const [re, l] of SOUND_LETTER) t = t.replace(re, l);
  let u = t.toUpperCase().replace(/\./g, "");
  u = u.replace(/([A-Z])\s+(?=[0-9一二三四五六七八九])/g, "$1");
  u = u.replace(/([A-Z])([一二三四五六七八九])/g, (m, a, b) => a + CN_DIG[b]);
  u = u.replace(/(?<![A-Z])(A|P)\s*M(?![A-Z])/g, "$1M");
  return u;
}
function findCodes(t) {
  const u = normCodes(t);
  const u2 = u.replace(/(?<![A-Z])(AM|PM|UD|IP|OK)(?![A-Z])/g, " ");
  return [[...u2.matchAll(CODE_RE)].map((m) => m[1]), u];
}

function askSchedule(t, s) {
  if (!Object.keys(schedules()).length) return reply("還沒有班表。請到「設定 → 資料」匯入 Word 班表。");
  const [d, mode] = parseDate(t);
  if (!d) return reply("我聽不懂是哪一天，可以說「明天」、「週三」或「10 月 5 號」。");

  if (t.includes("誰")) {
    const [codes] = findCodes(t);
    let want = null, label = "";
    for (const k of Object.keys(SHIFT_CATS).sort((a, b) => b.length - a.length)) if (t.includes(k)) { want = SHIFT_CATS[k]; label = k; break; }
    if (!want && codes.length) { want = codes; label = codes.join("/"); }
    const sch = schedFor(d);
    if (!sch) return reply(`還沒有 ${d.getMonth() + 1} 月的班表。`);
    if (!want) return dayRoster(sch, d);
    const hol = sch.holidays.includes(d.getDate());
    const names = [], lines = [];
    for (const p of sch.people) {
      const c = p.cells[d.getDate()]; if (!c) continue;
      const x = describeCell(c, p, d, hol);
      if (want.includes(x.code)) { names.push(givenName(p.name)); lines.push(`${p.name}：${x.code} ${x.desc}`); }
    }
    const verb = /休|特休/.test(label) ? "" : "上";
    if (!names.length) return reply(`${dateLabel(d)} 沒有人${verb}${label}。`);
    return reply(`${dateLabel(d)} ${verb}${label}的有：${names.join("、")}。`, lines);
  }

  let me = false;
  let ppl = findPerson(t);
  if (!ppl.length && t.includes("我")) {
    const p = peopleIndex().find((p) => s.name && (p.given === s.name || p.full === s.name));
    if (p) { ppl = [p]; me = true; }
  }
  if (!ppl.length) return reply("我找不到這個人。可以只說名字，或在設定裡加綽號。");
  if (ppl.length > 1) return reply(`有 ${ppl.length} 位同名：${ppl.map((p) => p.full).join("、")}，是哪一位？`);
  const who = me ? "你" : ppl[0].given;
  const days = mode === "day" ? [d] : [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(d, i));
  const parts = [], lines = [];
  for (const day of days) {
    const sch = schedFor(day);
    if (!sch) { if (mode === "day") return reply(`還沒有 ${day.getMonth() + 1} 月的班表。`); continue; }
    const per = sch.people.find((p) => p.id === ppl[0].id);
    const c = per && per.cells[day.getDate()];
    if (!c) continue;
    const x = describeCell(c, per, day, sch.holidays.includes(day.getDate()));
    const say = codeSay(x.code, x.desc);
    lines.push(`${dateLabel(day)}：${say}${x.raw && x.raw !== x.code ? "　（班表寫：" + x.raw + "）" : ""}`);
    parts.push([`週${WD[wdOf(day)]}`, say]);
  }
  if (!parts.length) return reply(`班表裡找不到 ${who} 這幾天的資料。`);
  if (mode === "day") return reply(`${who} ${dateLabel(d)}是${parts[0][1]}。`, lines);
  const mon = addDays(dayOnly(nowDate()), -wdOf(nowDate()));
  const diff = Math.round((d - mon) / 864e5);
  const wk = diff === 0 ? "這週" : diff === 7 ? "下週" : diff === -7 ? "上週" : "那週";
  return reply(`${who}${wk}的班：${parts.map((p) => p.join(" ")).join("；")}。`, lines);
}

// 某一天全部人的班（「明天誰上什麼班」）
function dayRoster(sch, d) {
  const hol = sch.holidays.includes(d.getDate());
  const groups = {}, lines = [];
  for (const p of sch.people) {
    const c = p.cells[d.getDate()]; if (!c) continue;
    const x = describeCell(c, p, d, hol);
    const key = ["R", "r", "HS", "NN", "ZZ", "GB", "--"].includes(x.code) ? "休" : x.code;
    (groups[key] = groups[key] || []).push(givenName(p.name) + (c.half ? `（${c.half}）` : ""));
    lines.push(`${x.code.padEnd(3, "　")} ${p.name}　${x.desc}`);
  }
  const order = Object.keys(groups).sort((a, b) => (a === "休") - (b === "休") || (a === "N") - (b === "N") || a.localeCompare(b));
  const say = order.filter((k) => k !== "N" && k !== "休").map((k) => `${k}：${groups[k].join("、")}`);
  if (groups.N) say.push(`正常班 ${groups.N.length} 位`);
  if (groups["休"]) say.push(`休假：${groups["休"].join("、")}`);
  lines.sort();
  return reply(`${dateLabel(d)}。${say.join("。")}。`, lines);
}

function askShiftHours(t, codes, u) {
  const code = codes[0];
  const sat = /週六|星期六|禮拜六|六日/.test(t);
  let half = null;
  if (u.includes("AM") || /請\s*(上午|早上)|上午(假|請假)/.test(t)) half = "AM";
  if (u.includes("PM") || /請\s*下午|下午(假|請假)/.test(t)) half = "PM";
  let hours = null;
  const m = t.match(/請\s*(\d+(?:\.\d+)?)\s*(個)?\s*(半)?\s*(小時|h|H)/) || t.match(/(\d+(?:\.\d+)?)\s*(個)?\s*(半)?\s*(小時|h|H)\s*(的)?\s*假/);
  if (m) hours = parseFloat(m[1]) + (m[3] ? 0.5 : 0);
  else if (/請\s*半\s*(個)?小時/.test(t)) hours = 0.5;
  const ud = u.includes("UD");
  if (half || hours !== null || sat) {
    const r = answerLeave(code, half, hours, sat, ud);
    if (r) return reply(r[0], r[1] ? [r[1]] : null);
    if (half || hours !== null) return reply(`${code} 的這個請假組合我沒有資料，需要人工判斷。`);
  }
  const info = CODE_INFO[code];
  if (!info) return reply(`${code} 我沒有資料。`);
  let s = `${code} ${info.name}`;
  if (info.start) s += `，${info.start} 到 ${info.end}`;
  if (info.hours !== undefined && info.hours !== null) s += `，上班 ${fmtNum(info.hours)} 小時`;
  if (info.night) s += `，小夜 ${fmtNum(info.night)} 小時`;
  if (info.big) s += `，大夜 ${fmtNum(info.big)} 小時`;
  if (info.night === null && info.start) s += "，小夜時數待確認";
  return reply(s + "。", info.note ? [info.note] : null);
}

// ============================ Excel 資料表 ============================
const isNickFile = (fn) => fn.includes("綽號") || /nickname/i.test(fn);
function tablesStore() { return Store.get("tables", {}); }
function tablesList() { const o = tablesStore(); return Object.values(o).flat(); }
function readXlsx(arrayBuffer, filename) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const res = [];
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "", raw: false })
      .map((r) => r.map((v) => String(v ?? "").trim())).filter((r) => r.some((v) => v));
    if (rows.length < 2) continue;
    const heads = rows[0].map((h, i) => h || `欄${i + 1}`);
    const data = rows.slice(1).map((r) => Object.fromEntries(heads.map((h, i) => [h, r[i] || ""])));
    res.push({ file: filename, sheet: sn, headers: heads, rows: data });
  }
  return res;
}
const ANSWER_COLS = ["答案", "回答", "內容", "說明"];
const FILLERS = ["請問", "請告訴我", "告訴我", "幫我查", "幫我", "查一下", "查詢", "我想知道", "想知道", "是多少", "是幾號", "是什麼", "多少", "幾號", "幾", "什麼", "哪裡", "在哪", "怎麼", "是", "的", "嗎", "呢", "啊", "喔", "一下", "請", "查"];
function tokens(q) {
  const toks = [];
  for (const run of q.match(/[一-鿿]+|[A-Za-z0-9.]+/g) || []) {
    if (/^[A-Za-z0-9.]/.test(run)) toks.push(run.toLowerCase());
    else if (run.length === 1) toks.push(run);
    else for (let i = 0; i < run.length - 1; i++) toks.push(run.slice(i, i + 2));
  }
  return toks;
}
function askTables(t) {
  const tbls = tablesList().filter((x) => !isNickFile(x.file));
  if (!tbls.length) return null;
  let best = [];
  for (const tb of tbls) {
    const asked = tb.headers.filter((h) => h && t.includes(h) && !ANSWER_COLS.includes(h));
    let q = t;
    for (const h of [...asked].sort((a, b) => b.length - a.length)) q = q.split(h).join(" ");
    for (const f of FILLERS) q = q.split(f).join(" ");
    const toks = tokens(q);
    if (!toks.length) continue;
    for (const r of tb.rows) {
      const text = Object.values(r).filter(Boolean).join(" ").toLowerCase();
      if (!text) continue;
      const hit = toks.filter((k) => text.includes(k)).length;
      if (hit) best.push([hit / toks.length, tb, r, asked]);
    }
  }
  best = best.filter((b) => b[0] >= 0.6).sort((a, b) => b[0] - a[0]);
  if (!best.length) return null;
  const top = best[0][0];
  const hits = best.filter((b) => b[0] >= top - 0.01).slice(0, 15);
  const sayRow = (tb, r, asked) => {
    const ans = tb.headers.find((h) => ANSWER_COLS.includes(h) && r[h]);
    if (ans) return r[ans];
    if (asked.length) {
      const ident = tb.headers.filter((h) => !asked.includes(h) && r[h] && r[h].length <= 20).slice(0, 3).map((h) => r[h]);
      const vals = asked.filter((h) => r[h]).map((h) => (asked.length > 1 ? `${h} ${r[h]}` : r[h])).join("、");
      return `${ident.join(" ")} 的${asked.length === 1 ? asked[0] : ""}是 ${vals}`;
    }
    return tb.headers.filter((h) => r[h]).map((h) => `${h}：${r[h]}`).join("，");
  };
  const lines = hits.map(([, tb, r, a]) => sayRow(tb, r, a));
  if (lines.length === 1) return reply(lines[0] + "。", [`來源：${hits[0][1].file}`]);
  let say = `找到 ${lines.length} 筆。${lines.slice(0, 3).join("。")}`;
  if (lines.length > 3) say += "。其他的請看畫面";
  return reply(say + "。", lines);
}

// ============================ 提醒、記事 ============================
const reminders = () => Store.get("reminders", []);
function saveReminders(rs) { rs.sort((a, b) => (a.due < b.due ? -1 : 1)); Store.set("reminders", rs); }
function addReminder(text, due, daily) {
  const rs = reminders(); const r = { id: uid(), text, due: isoDT(due), daily, created: isoDT(nowDate()) };
  rs.push(r); saveReminders(rs); return r;
}
function ackReminder(id) {
  const rs = reminders();
  const r = rs.find((x) => x.id === id);
  if (!r) return;
  if (r.daily) { let d = new Date(r.due); while (d <= nowDate()) d = addDays(d, 1); r.due = isoDT(d); saveReminders(rs); }
  else saveReminders(rs.filter((x) => x.id !== id));
}
function snoozeReminder(id, minutes) {
  const rs = reminders(); const r = rs.find((x) => x.id === id);
  if (!r) return;
  const due = isoDT(new Date(nowDate().getTime() + minutes * 60000));
  if (r.daily) { ackReminder(id); const rs2 = reminders(); rs2.push({ id: uid(), text: r.text, due, daily: false, created: isoDT(nowDate()) }); saveReminders(rs2); }
  else { r.due = due; saveReminders(rs); }
}
const deleteReminder = (id) => saveReminders(reminders().filter((x) => x.id !== id));
function cleanTask(rest) {
  let x = rest;
  for (const w of ["提醒我", "提醒一下", "提醒", "叫我", "記得", "幫我", "設定", "設個", "一個", "請", "的時候"]) x = x.split(w).join(" ");
  x = x.replace(/\s+/g, " ").replace(/^[\s，,。:]+|[\s，,。:]+$/g, "");
  x = x.replace(/^(我|要|該|去|在)+/, "").replace(/^(要|該|去)+/, "").trim();
  return x || "提醒";
}
const notes = () => Store.get("notes", []);
function addNote(text) { const ns = notes(); ns.unshift({ id: uid(), text, created: isoDT(nowDate()) }); Store.set("notes", ns); }
const deleteNote = (id) => Store.set("notes", notes().filter((n) => n.id !== id));
function logUnanswered(t) { const u = Store.get("unanswered", []); u.unshift({ text: t, time: isoDT(nowDate()) }); Store.set("unanswered", u.slice(0, 300)); }

// ============================ 回覆 ============================
function reply(text, detail, extra) {
  return Object.assign({ reply: text, speak: speakify(text), detail: (detail || []).filter(Boolean), kind: "answer" }, extra || {});
}
const HELP = [
  ["查資料", ["批價組組長分機", "發藥檯電腦 IP"]],
  ["查班表", ["我明天什麼班", "我這週的班", "明天誰上什麼班", "明天誰上小夜", "明天誰上 S2", "明天誰休假"]],
  ["查時數", ["A3 請 PM 幾小時", "N 班請 1 小時", "週六 E 怎麼算", "S2 是幾點上班"]],
  ["提醒", ["10 分鐘後提醒我影印", "下午三點提醒我開會", "每天四點半提醒我對帳", "今天有哪些提醒", "取消影印的提醒"]],
  ["記事", ["記下來，明天要跟廠商確認交貨", "念出今天的記事", "念出跟廠商有關的記事", "刪除第二筆記事"]],
  ["其他", ["現在幾點", "今天幾號"]],
];

function answer(rawText) {
  const t = normalize(rawText);
  const s = getSettings();
  if (!t) return reply("我沒有聽到內容。");

  if (/你會(做)?什麼|你可以做什麼|怎麼用|使用說明|^說明$|^幫助$/.test(t))
    return reply("你可以問我分機、班表、時數，也可以叫我提醒你或幫你記事。可以說的句子都在右上角的問號裡。", null, { kind: "help" });

  // 記事：新增
  const nm = t.match(/^(請)?(幫我)?(記下來|記一下|記下|記住|記錄一下|記錄|新增記事|記事)\s*[:，, ]*\s*(.+)$/);
  if (nm && !/念|讀|列出|有哪些|有什麼|刪除|刪掉/.test(nm[4].slice(0, 6))) {
    const c = nm[4].replace(/^[\s，,]+|[\s，,]+$/g, "");
    addNote(c);
    return reply(`記下來了：${c}。`, null, { kind: "changed" });
  }

  // 提醒
  if (/提醒|叫我/.test(t)) {
    if (/取消|刪除|刪掉|不用提醒|移除/.test(t)) {
      const rs = reminders();
      if (!rs.length) return reply("目前沒有提醒。");
      const m = t.match(/第\s*(\d+)/);
      let target = null;
      if (m && +m[1] >= 1 && +m[1] <= rs.length) target = rs[+m[1] - 1];
      else {
        const kw = t.replace(/取消|刪除|刪掉|移除|不用提醒|提醒|我|的|那個|這個|請|幫我/g, "").trim();
        target = rs.find((r) => kw && (r.text.includes(kw) || kw.includes(r.text)));
      }
      if (!target) return reply("要取消哪一個提醒？可以說「取消影印的提醒」或「取消第一個提醒」。");
      deleteReminder(target.id);
      return reply(`好，已經取消「${target.text}」的提醒。`, null, { kind: "changed" });
    }
    if (/哪些|有什麼|念|列出|查|看一下|幾個|幾筆/.test(t) && !/\d+\s*(分|點|小時)/.test(t)) {
      let rs = reminders();
      if (t.includes("今天")) rs = rs.filter((r) => r.due.slice(0, 10) === isoDate(nowDate()));
      if (!rs.length) return reply("目前沒有提醒。");
      const items = rs.map((r) => `${fmtDue(new Date(r.due))} ${r.text}${r.daily ? "（每天）" : ""}`);
      return reply(`你有 ${items.length} 個提醒：${items.slice(0, 5).join("；")}。`, items);
    }
    const [due, daily, rest] = parseWhen(t);
    if (!due) return reply("要什麼時候提醒你？例如「10 分鐘後提醒我影印」或「下午三點提醒我開會」。");
    const task = cleanTask(rest);
    const r = addReminder(task, due, daily);
    const when = daily ? "每天 " + hhmm(due) : fmtDue(due);
    return reply(`好的，${when} 提醒你${task}。`, null, { kind: "changed", reminder: r });
  }

  // 記事：查、刪
  if (t.includes("記事") || t.includes("筆記")) {
    const ns = notes();
    if (/刪除|刪掉|移除/.test(t)) {
      const m = t.match(/第\s*(\d+)/);
      if (!m || +m[1] < 1 || +m[1] > ns.length) return reply("要刪除第幾筆記事？編號在「記事」頁裡。");
      const n = ns[+m[1] - 1]; deleteNote(n.id);
      return reply(`已經刪除：${n.text}。`, null, { kind: "changed" });
    }
    let sel = ns, label = "";
    const km = t.match(/(?:跟|和|與|關於|有關)\s*(.+?)\s*(?:有關|相關)?\s*的?\s*記事/);
    if (km && !["今天", "昨天", "這週"].includes(km[1])) { const kw = km[1].trim(); sel = ns.filter((n) => n.text.includes(kw)); label = `跟「${kw}」有關的`; }
    else if (t.includes("今天")) { sel = ns.filter((n) => n.created.slice(0, 10) === isoDate(nowDate())); label = "今天的"; }
    else if (t.includes("昨天")) { const y = isoDate(addDays(nowDate(), -1)); sel = ns.filter((n) => n.created.slice(0, 10) === y); label = "昨天的"; }
    if (!sel.length) return reply(`沒有${label}記事。`);
    const items = sel.map((n) => n.text);
    let say = `${label}記事有 ${items.length} 筆：${items.slice(0, 5).join("；")}`;
    if (items.length > 5) say += "，其他的請看畫面";
    return reply(say + "。", sel.map((n) => `${ns.indexOf(n) + 1}. ${n.text}`));
  }

  // 時間日期
  if (/現在幾點|幾點了|現在時間/.test(t)) { const n = nowDate(); return reply(n.getMinutes() ? `現在是 ${n.getHours()} 點 ${n.getMinutes()} 分。` : `現在是 ${n.getHours()} 點整。`); }
  if (/(今天|明天|昨天)(是)?(幾號|幾月幾號|星期幾|禮拜幾|週幾|日期)/.test(t) && !/班/.test(t)) {
    const [d] = parseDate(t); const w = t.match(/今天|明天|昨天/)[0];
    return reply(`${w}是 ${d.getMonth() + 1} 月 ${d.getDate()} 號，星期${WD[wdOf(d)]}。`);
  }

  // 班別時數
  const [codes, u] = findCodes(t);
  const shiftish = /班|休|上什麼|上不上|誰/.test(t);
  if (codes.length && !t.includes("誰") && !findPerson(t, false).length &&
      /請|時數|小時|小夜|大夜|休加|怎麼算|AM|PM|UD|週六|星期六|幾點|時段|時間|上班|是什麼|代表/.test(u))
    return askShiftHours(t, codes, u);

  // 班表
  if (shiftish) return askSchedule(t, s);

  // Excel 資料
  const r = askTables(t);
  if (r) return r;

  logUnanswered(rawText);
  return reply("抱歉，我找不到答案。這個問題已經記在「查不到的問題」清單，之後可以補資料。", null, { kind: "unknown" });
}

function greeting() {
  const s = getSettings();
  const today = isoDate(nowDate());
  const first = s.last_greet !== today;
  saveSettings({ last_greet: today });
  if (!first) return "我在，請說。";
  const n = reminders().filter((r) => r.due.slice(0, 10) === today).length;
  return `嗨 ${s.name}，很高興為您服務。` + (n ? `今天有 ${n} 個提醒。` : "");
}

// ============================ 匯入檔案 ============================
async function importFile(file) {
  const name = file.name || "";
  const buf = await file.arrayBuffer();
  if (/\.docx$/i.test(name)) {
    const sch = await readScheduleDocx(buf);
    const all = schedules(); all[`${sch.year}-${pad2(sch.month)}`] = sch;
    if (!Store.set("schedules", all)) throw new Error("手機空間不足，存不下班表");
    return `已更新 ${sch.year} 年 ${sch.month} 月班表，共 ${sch.people.length} 位人員。`;
  }
  if (/\.xlsx$/i.test(name)) {
    const t = readXlsx(buf, name);
    if (!t.length) throw new Error("這個 Excel 沒有資料（第一列要是欄位名稱，下面要有資料）");
    const all = tablesStore(); all[name] = t;
    if (!Store.set("tables", all)) throw new Error("手機空間不足，存不下這個資料表");
    return `已加入資料表「${name}」，共 ${t.reduce((a, x) => a + x.rows.length, 0)} 筆。`;
  }
  throw new Error("只接受 Word 班表（.docx）或 Excel 資料表（.xlsx）。");
}

// 備份：全部資料匯出成一個檔案
function exportAll() {
  const out = {};
  for (const k of ["settings", "reminders", "notes", "schedules", "tables", "unanswered"]) out[k] = Store.get(k, null);
  return JSON.stringify({ app: "voice-assistant", v: 1, at: isoDT(nowDate()), data: out });
}
function importAll(text) {
  const j = JSON.parse(text);
  if (j.app !== "voice-assistant") throw new Error("這不是助理的備份檔");
  for (const [k, v] of Object.entries(j.data)) if (v !== null) Store.set(k, v);
}
