// スキル回し比較ツール(画面)
// 流れ: 1 取り込み → 2 8人比較 → 3 個人フォーカス(同じジョブ、いなければ同じロールと比較)

import { authState, login, logout, finishLogin, getReport, getFight, getRange } from './data.js';

// ---------- 基本データ ----------
const JOBS = {
  Paladin: ['ナイト', 'ナ', 'tank', 'tank'], Warrior: ['戦士', '戦', 'tank', 'tank'], DarkKnight: ['暗黒騎士', '暗', 'tank', 'tank'], Gunbreaker: ['ガンブレイカー', 'ガ', 'tank', 'tank'],
  WhiteMage: ['白魔道士', '白', 'healer', 'healer'], Scholar: ['学者', '学', 'healer', 'healer'], Astrologian: ['占星術師', '占', 'healer', 'healer'], Sage: ['賢者', '賢', 'healer', 'healer'],
  Monk: ['モンク', 'モ', 'dps', 'melee'], Dragoon: ['竜騎士', '竜', 'dps', 'melee'], Ninja: ['忍者', '忍', 'dps', 'melee'], Samurai: ['侍', '侍', 'dps', 'melee'], Reaper: ['リーパー', 'リ', 'dps', 'melee'], Viper: ['ヴァイパー', 'ヴ', 'dps', 'melee'],
  Bard: ['吟遊詩人', '詩', 'dps', 'ranged'], Machinist: ['機工士', '機', 'dps', 'ranged'], Dancer: ['踊り子', '踊', 'dps', 'ranged'],
  BlackMage: ['黒魔道士', '黒', 'dps', 'caster'], Summoner: ['召喚士', '召', 'dps', 'caster'], RedMage: ['赤魔道士', '赤', 'dps', 'caster'], Pictomancer: ['ピクトマンサー', 'ピ', 'dps', 'caster'], BlueMage: ['青魔道士', '青', 'dps', 'caster'],
};
const SUBROLE = { tank: 'タンク', healer: 'ヒーラー', melee: '近接DPS', ranged: '物理遠隔DPS', caster: '魔法DPS' };
const jobInfo = j => { const v = JOBS[j]; return v ? { ja: v[0], ab: v[1], role: v[2], sub: v[3] } : { ja: j, ab: (j || '?').slice(0, 2), role: 'dps', sub: 'other' }; };
const ROLE_ORDER = { tank: 0, healer: 1, dps: 2 };
const SUB_ORDER = { tank: 0, healer: 1, melee: 2, ranged: 3, caster: 4, other: 5 };
const LW = 230; // 名前の列の幅

// ---------- 状態 ----------
const S = {
  view: 'import',
  auth: { clientId: false, loggedIn: false },
  reports: {},         // code -> レポート情報(戦闘一覧)
  logs: [],            // {key, code, fightId, data}
  partyKey: null,
  me: null,            // {key, pid}
  picks: {},           // 'key|pid' -> true/false(比較に入れるか。未設定は自動)
  range: null,         // [start, end] 表示上の時間(ms)。null=全体
  zoom: 14,            // 1秒あたりのpx
  align: 'pull',       // pull | phase
  alignPhase: null,
  showOgcd: true,
  showBoss: true,
  official: {},        // 範囲ごとのFFLogs公式値
  loading: false,
};

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = ms => { const neg = ms < 0; ms = Math.abs(ms); const s = Math.floor(ms / 1000); return `${neg ? '-' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmt1 = ms => { const neg = ms < 0; ms = Math.abs(ms); const s = ms / 1000; return `${neg ? '-' : ''}${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const pct = v => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1) + '%';
const num = v => v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('ja-JP');
const parseTime = s => { s = String(s).trim(); if (!s) return null; const m = s.match(/^(-?\d+):(\d{1,2}(?:\.\d+)?)$/); if (m) return (Math.abs(+m[1]) * 60 + +m[2]) * 1000 * (m[1].startsWith('-') ? -1 : 1); const n = Number(s); return isFinite(n) ? n * 1000 : null; };

function toast(msg, ok) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (ok ? ' ok' : ''); t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ok ? 2500 : 6000);
}
function save() {
  try { localStorage.setItem('rotcmp', JSON.stringify({ logs: S.logs.map(l => [l.code, l.fightId, l.role, l.src]), me: S.me, inputs: S.inputs, zoom: S.zoom, showOgcd: S.showOgcd, showBoss: S.showBoss })); } catch {}
}

// ---------- URL解析・読み込み ----------
function parseLogUrl(s) {
  s = s.trim();
  if (!s) return null;
  let code = null;
  const m = s.match(/reports\/(?:a:)?([A-Za-z0-9]+)/);
  if (m) code = m[1];
  else if (/^demo\d/i.test(s)) code = s.slice(0, 5).toLowerCase();
  else if (/^[A-Za-z0-9]{10,}$/.test(s)) code = s;
  if (!code) return null;
  const f = s.match(/[#?&]fight=(\d+|last)/i);
  const src = s.match(/[#?&]source=(\d+)/i);   // FFLogsで選んでいたプレイヤー
  const ph = s.match(/[#?&]phase=(\d+)/i);     // FFLogsで選んでいたフェーズ
  return { code, fight: f ? (f[1].toLowerCase() === 'last' ? 'last' : Number(f[1])) : null, source: src ? Number(src[1]) : null, phase: ph ? Number(ph[1]) : null };
}
const parseLines = text => String(text || '').split(/[\s,]+/).map(parseLogUrl).filter(Boolean);

function defaultFight(rep) {
  const boss = rep.fights.filter(f => f.encounterID > 0);
  const kills = boss.filter(f => f.kill);
  return (kills.at(-1) || boss.at(-1) || rep.fights.at(-1))?.id;
}

async function loadReport(code) {
  if (!S.reports[code]) S.reports[code] = await getReport(code);
  return S.reports[code];
}

// role: 'me'(自分のログ)| 'ref'(比較するログ)、src: そのログで見る人(URLの source=)
async function addLog(code, fight, role = 'ref', src = null) {
  const rep = await loadReport(code);
  if (!rep.fights.length) throw new Error('このログには戦闘がありません');
  let fightId = fight === 'last' ? rep.fights.at(-1).id : fight;
  if (fightId == null || !rep.fights.some(f => f.id === fightId)) fightId = defaultFight(rep);
  const key = `${code}#${fightId}`;
  let log = S.logs.find(l => l.key === key);
  if (!log) {
    const data = await getFight(code, fightId);
    log = { key, code, fightId, data, role, src: null };
    S.logs.push(log);
  }
  if (role === 'me') log.role = 'me';
  if (src != null && getPlayer(log, src)) log.src = src;
  return log;
}

// 自分のログと比較するログを読み込み、個人フォーカス(2つのログの比較)を開く
async function importUrls(meText, refText) {
  const meL = parseLines(meText), refL = parseLines(refText);
  if (!meL.length && !refL.length) { toast('FFLogsのURL(…/reports/XXXX)が見つかりません'); return; }
  const mine = meL[0] || refL.shift();
  S.inputs = { me: meText, ref: refText };
  S.loading = true; S.logs = []; S.me = null; S.picks = {}; S.range = null; S.official = {}; S.align = 'pull'; S.alignPhase = null;
  render();
  const errors = [];
  let meLog = null;
  try { meLog = await addLog(mine.code, mine.fight, 'me', mine.source); }
  catch (e) { errors.push(`自分のログ: ${e.message}`); }
  for (const l of refL) {
    try { await addLog(l.code, l.fight, 'ref', l.source); }
    catch (e) { errors.push(`比較するログ ${l.code}: ${e.message}`); }
  }
  S.loading = false;
  if (errors.length) toast(errors.join('\n'));
  if (meLog) {
    S.partyKey = meLog.key;
    // URLで自分(source=)が分かれば個人フォーカスへ。分からなければ8人比較から自分を選んでもらう
    if (meLog.src != null) S.me = { key: meLog.key, pid: meLog.src };
    S.view = S.me ? 'focus' : 'party';
    // URLにフェーズ(phase=)があれば、範囲をそのフェーズにして、比較相手もそのフェーズの開始で揃える
    const ph = mine.phase != null && meLog.data.phases.find(p => p.id === mine.phase);
    if (ph) setPhaseRange(ph, false);
    save();
    toast(`${S.logs.length}件読み込みました`, true);
  }
  render();
}

// フェーズを範囲にする。比較するログがあるときは、そのフェーズの開始で時間を揃える
function setPhaseRange(ph, doRender = true) {
  S.range = [ph.start, ph.end];
  if (S.logs.some(l => l.role !== 'me' && l.data.phases.some(p => p.id === ph.id))) { S.align = 'phase'; S.alignPhase = ph.id; }
  render.scrollTo = Math.max(0, ph.start / 1000 * S.zoom - 20);
  if (doRender) render();
}

async function changeFight(log, fightId) {
  const idx = S.logs.indexOf(log);
  try {
    const data = await getFight(log.code, fightId);
    const key = `${log.code}#${fightId}`;
    if (S.logs.some(l => l.key === key)) { toast('その戦闘はすでに読み込んであります'); return; }
    const nl = { key, code: log.code, fightId, data };
    S.logs.splice(idx, 1, nl);
    if (S.partyKey === log.key) S.partyKey = key;
    if (S.me?.key === log.key) S.me = null;
    save(); render();
  } catch (e) { toast(e.message); }
}

function removeLog(log) {
  S.logs = S.logs.filter(l => l !== log);
  if (S.partyKey === log.key) S.partyKey = S.logs[0]?.key || null;
  if (S.me?.key === log.key) S.me = null;
  save(); render();
}

const getLog = key => S.logs.find(l => l.key === key);
const getPlayer = (log, pid) => log.data.players.find(p => p.id === pid);

// ---------- 分析(Activeなど) ----------
// GCD稼働率: 各GCDの「詠唱時間かGCDの長い方」を足し合わせ、GCDが回っていた時間の割合を出す
// (FFLogsのActiveとは計算方法が違うので別の名前で表示する。Activeは FFLogs の値を使う)
const ivCache = new Map();
function intervals(log, pid) {
  const k = log.key + '|' + pid;
  if (ivCache.has(k)) return ivCache.get(k);
  const list = log.data.casts[pid] || [];
  const ab = log.data.abilities;
  const g = list.filter(c => ab[c.a]?.gcd && !c.x);
  const gaps = [];
  for (let i = 1; i < g.length; i++) { const d = g[i].t - g[i - 1].t; if (d >= 1400 && d <= 3600) gaps.push(d); }
  gaps.sort((a, b) => a - b);
  let base = gaps.length >= 5 ? gaps[Math.floor(gaps.length * 0.3)] : 2500; // 速い方寄りの代表値=実際のGCD
  base = Math.min(2600, Math.max(1400, base));
  const raw = [];
  for (const c of list) {
    const a = ab[c.a];
    if (c.x) continue;
    if (a?.gcd) {
      const rc = a.recast && a.recast !== 2500 ? a.recast * base / 2500 : base;
      raw.push([c.t, c.t + Math.max(c.cd || 0, rc)]);
    } // アビリティ(oGCD)は数えない
  }
  raw.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of raw) {
    const last = merged.at(-1);
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([...iv]);
  }
  const out = { merged, base };
  ivCache.set(k, out);
  return out;
}

// 自分の時間(エンティティ固有の時間)で [s,e] の統計
function analyze(log, pid, s, e) {
  const { merged, base } = intervals(log, pid);
  let act = 0;
  for (const [a, b] of merged) { const x = Math.max(a, s), y = Math.min(b, e); if (y > x) act += y - x; }
  const list = (log.data.casts[pid] || []).filter(c => c.t >= s && c.t < e);
  const ab = log.data.abilities;
  const gcds = list.filter(c => ab[c.a]?.gcd && !c.x);
  const cancelled = list.filter(c => c.x).length;
  const deaths = log.data.deaths.filter(d => d.id === pid && d.t >= s && d.t < e).length;
  return { active: act / Math.max(1, e - s), activeMs: act, gcd: gcds.length, ogcd: list.length - gcds.length - cancelled, cancelled, base, deaths, list };
}

// 表示時間とエンティティ時間のずれ(フェーズ合わせ)
function offsetOf(log) {
  if (S.view !== 'focus' || S.align !== 'phase' || S.alignPhase == null || !S.me) return 0;
  const meLog = getLog(S.me.key);
  const a = meLog?.data.phases.find(p => p.id === S.alignPhase);
  const b = log.data.phases.find(p => p.id === S.alignPhase);
  if (!a || !b) return 0;
  return b.start - a.start;
}
function ownRange(log) {
  const off = offsetOf(log);
  const dur = log.data.fight.duration;
  if (!S.range) return [0, dur];
  return [Math.max(0, S.range[0] + off), Math.min(dur, S.range[1] + off)];
}

// FFLogs公式の値(Active・ダメージ)。範囲指定時は範囲で取り直す
function officialFor(log) {
  if (!S.range) return log.data.official;
  const [s, e] = ownRange(log).map(v => Math.round(v / 100) * 100);
  if (e <= s) return null;
  const k = `${log.key}|${s}|${e}`;
  const v = S.official[k];
  if (v === undefined) {
    S.official[k] = 'loading';
    clearTimeout(officialFor.t);
    officialFor.q = officialFor.q || new Set();
    officialFor.q.add(JSON.stringify([log.code, log.fightId, s, e, k]));
    officialFor.t = setTimeout(flushOfficial, 400);
    return 'loading';
  }
  return v;
}
async function flushOfficial() {
  const q = [...(officialFor.q || [])].map(x => JSON.parse(x));
  officialFor.q = new Set();
  await Promise.all(q.map(async ([code, fight, s, e, k]) => {
    try { S.official[k] = await getRange(code, fight, s, e); }
    catch (err) { S.official[k] = null; console.warn(err); }
  }));
  render();
}
function officialStats(log, pid) {
  const o = officialFor(log);
  if (o === 'loading') return { loading: true };
  const p = o?.players?.[pid];
  if (!p) return {};
  const tt = o.totalTime || 1;
  return { active: p.active != null ? p.active / tt : null, dps: p.total != null ? p.total / (tt / 1000) : null };
}

// ---------- 描画 ----------
function render() {
  const sc = $('.tl-scroll');
  const keep = sc ? sc.scrollLeft : null;
  document.querySelectorAll('#steps button').forEach(b => {
    b.classList.toggle('on', b.dataset.view === S.view);
    b.disabled = b.dataset.view !== 'import' && !S.logs.length;
  });
  const app = $('#app');
  if (S.view === 'focus' && !(S.me && getLog(S.me.key))) { S.view = 'party'; S.partyKey = S.logs.find(l => l.role === 'me')?.key || S.partyKey; }
  if (S.view === 'import') app.innerHTML = viewImport();
  else if (S.view === 'party') app.innerHTML = viewParty();
  else app.innerHTML = viewFocus();
  const sc2 = $('.tl-scroll');
  if (sc2 && keep != null) sc2.scrollLeft = keep;
  if (render.scrollTo != null && sc2) { sc2.scrollLeft = render.scrollTo; render.scrollTo = null; }
}

function viewImport() {
  const A = S.auth;
  const cfg = !A.clientId ? `
    <div class="panel warn">
      <b>このページはまだFFLogsと連携する設定がされていません。</b> 公開する人が <code>config.js</code> にFFLogsのクライアントIDを書くと、実際のログを読めるようになります(手順は README)。
      設定前でも <button class="btn small" data-act="demo">デモデータで試す</button> で全機能を確認できます。
    </div>` : !A.loggedIn ? `
    <div class="panel warn">
      <b>実際のログを読むには、FFLogsにログインしてください。</b> FFLogsのログイン画面に移動し、許可すると戻ってきます。パスワードはこのページには渡りません。
      <div class="row" style="margin-top:8px"><button class="btn primary" data-act="login">FFLogsでログイン</button>
      <span class="note">ログインせずに <button class="btn small" data-act="demo">デモデータで試す</button> こともできます。</span></div>
    </div>` : `
    <div class="note" style="margin-bottom:8px">FFLogsにログイン中 ・ <button class="btn small ghost" data-act="logout">ログアウト</button></div>`;
  const list = S.logs.map((l, i) => {
    const rep = S.reports[l.code];
    const f = l.data.fight;
    const opts = (rep?.fights || [f]).map(x => `<option value="${x.id}" ${x.id === l.fightId ? 'selected' : ''}>#${x.id} ${esc(x.name)} ${x.kill ? '★撃破' : x.encounterID ? `ワイプ ${x.fightPercentage != null ? x.fightPercentage.toFixed(1) + '%' : ''}` : ''} (${fmt(x.duration)})</option>`).join('');
    const who = l.src != null ? getPlayer(l, l.src) : null;
    return `<div class="logcard">
      <span class="pill ${l.role === 'me' ? 'me' : 'ref'}">${l.role === 'me' ? '自分' : '比較'}</span>
      <div class="grow"><div class="t">${esc(l.data.report.title)}${who ? ` <span class="note">・ ${esc(jobInfo(who.job).ja)} ${esc(who.name)}</span>` : ''}</div>
        <div class="note">${esc(l.code)} ・ ${new Date(l.data.report.startTime + f.startTime).toLocaleString('ja-JP')} ・ ${l.data.players.length}人</div></div>
      <select data-act="fight" data-i="${i}">${opts}</select>
      <span class="pill ${f.kill ? 'kill' : 'wipe'}">${f.kill ? '撃破' : 'ワイプ'} ${fmt(f.duration)}</span>
      <button class="btn small" data-act="openparty" data-i="${i}">8人比較を見る</button>
      <button class="btn small ghost" data-act="remove" data-i="${i}" title="外す">✕</button>
    </div>`;
  }).join('');
  return `
    <h2>ログの取り込み</h2>
    <p class="sub">自分のログと、比べたい人(上手い人など)のログのURLを貼ると、2つのスキル回しを並べて比較します。比べる相手は無くても使えます。</p>
    ${cfg}
    <div class="panel">
      <div class="fld"><b>自分のログ</b><span class="note">FFLogsで自分を選んだ画面のURL(<code>source=</code> が付く)なら、自分を自動で選びます</span></div>
      <input type="text" id="url-me" value="${esc(S.inputs?.me || '')}" placeholder="https://ja.fflogs.com/reports/AbCdEf123456?fight=5&amp;source=3">
      <div class="fld" style="margin-top:12px"><b>比較するログ</b><span class="note">任意。上手い人のログなど。その人を選んだ画面のURLならその人と比べます(なければ同じジョブの人)。複数なら改行</span></div>
      <textarea id="url-ref" style="min-height:60px" placeholder="https://www.fflogs.com/reports/XyZ987654321?fight=12&amp;source=7">${esc(S.inputs?.ref || '')}</textarea>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" data-act="import" ${S.loading ? 'disabled' : ''}>${S.loading ? '<span class="spinner"></span> 読み込み中…' : '比較する'}</button>
        <button class="btn" data-act="demo" ${S.loading ? 'disabled' : ''}>デモデータで試す</button>
        <span class="note">URLに <code>fight=番号</code> が無いときは、最後に撃破した戦闘を選びます(後から変更できます)。</span>
      </div>
    </div>
    ${S.logs.length ? `<h3>読み込んだログ(${S.logs.length})</h3><div class="logs">${list}</div>` : ''}
  `;
}

function logTabs(activeKey, act) {
  return `<div class="tabs">${S.logs.map(l => {
    const f = l.data.fight;
    return `<button class="${l.key === activeKey ? 'on' : ''}" data-act="${act}" data-key="${esc(l.key)}">${esc(l.data.report.title)}<small>#${f.id} ${esc(f.name)} ・ ${f.kill ? '撃破' : 'ワイプ'} ${fmt(f.duration)}</small></button>`;
  }).join('')}</div>`;
}

function rangeBar(phases, maxDur) {
  const r = S.range;
  const chips = phases.map(p => {
    const on = r && Math.abs(r[0] - p.start) < 50 && Math.abs(r[1] - p.end) < 50;
    const short = p.name.split(':')[0];
    return `<button class="chip ${p.inter ? 'inter' : ''} ${on ? 'on' : ''}" data-act="phase" data-id="${p.id}" data-s="${p.start}" data-e="${p.end}" title="${esc(p.name)} ${fmt(p.start)}〜${fmt(p.end)}">${esc(short)}</button>`;
  }).join('');
  return `<div class="rangebar">
    <span class="lbl">範囲</span>
    <input class="time" id="rs" type="text" value="${r ? fmt1(r[0]) : ''}" placeholder="0:00">
    <span>〜</span>
    <input class="time" id="re" type="text" value="${r ? fmt1(r[1]) : ''}" placeholder="${fmt(maxDur)}">
    <button class="btn small" data-act="applyrange">適用</button>
    <button class="btn small ${!r ? 'on' : ''}" data-act="clearrange">全体</button>
    ${phases.length ? `<div class="sep"></div><span class="lbl">フェーズ</span><div class="chips">${chips}</div>` : ''}
    <div class="sep"></div>
    <span class="lbl">拡大</span><input type="range" id="zoom" min="4" max="60" step="1" value="${S.zoom}">
    <button class="btn small" data-act="fit" ${r ? '' : 'disabled'} title="選んだ範囲を画面幅に合わせる">範囲に合わせる</button>
    <div class="sep"></div>
    <label class="chk"><input type="checkbox" data-act="ogcd" ${S.showOgcd ? 'checked' : ''}>アビリティ</label>
    <label class="chk"><input type="checkbox" data-act="boss" ${S.showBoss ? 'checked' : ''}>ボスの詠唱</label>
  </div>`;
}

function statsLine(log, pid) {
  const [s, e] = ownRange(log);
  const a = analyze(log, pid, s, e);
  const o = officialStats(log, pid);
  return { a, o, html: `Active <b title="FFLogsが計算したActive">${o.loading ? '…' : pct(o.active)}</b> ・ <span title="GCDが回っていた時間の割合(このツールの計算)">GCD稼働 <b>${pct(a.active)}</b></span></div><div class="st">GCD <b>${a.gcd}</b> ・ DPS <b>${o.loading ? '…' : num(o.dps)}</b>${a.deaths ? ` ・ <span class="err">戦闘不能${a.deaths}</span>` : ''}` };
}

function sortPlayers(players) {
  return [...players].sort((a, b) => {
    const A = jobInfo(a.job), B = jobInfo(b.job);
    return ROLE_ORDER[A.role] - ROLE_ORDER[B.role] || SUB_ORDER[A.sub] - SUB_ORDER[B.sub] || a.job.localeCompare(b.job) || a.name.localeCompare(b.name);
  });
}

function jobBadge(job) { const j = jobInfo(job); return `<span class="job ${j.role}" title="${esc(j.ja)}">${esc(j.ab)}</span>`; }

function viewParty() {
  const log = getLog(S.partyKey) || S.logs[0];
  if (!log) return `<div class="empty">ログを取り込んでください</div>`;
  S.partyKey = log.key;
  const d = log.data;
  const players = sortPlayers(d.players);
  const rows = players.map(p => {
    const st = statsLine(log, p.id);
    const isMe = S.me && S.me.key === log.key && S.me.pid === p.id;
    return {
      log, pid: p.id, me: isMe, st,
      label: `<div class="nm">${jobBadge(p.job)}<span class="n" title="${esc(p.name)} @${esc(p.server || '')}">${esc(p.name)}</span></div>
        <div class="st">${st.html}</div>
        <div class="acts"><button class="btn small ${isMe ? 'on' : ''}" data-act="setme" data-key="${esc(log.key)}" data-pid="${p.id}">${isMe ? '★ 自分' : 'この人にフォーカス'}</button></div>`,
    };
  });
  const [s, e] = S.range || [0, d.fight.duration];
  const table = rows.map(r => {
    const p = getPlayer(log, r.pid);
    const { a, o } = r.st;
    return `<tr class="${r.me ? 'me' : ''}"><td class="l">${jobBadge(p.job)} ${esc(p.name)}</td>
      <td>${o.loading ? '…' : pct(o.active)}</td><td>${pct(a.active)}</td><td>${a.gcd}</td><td>${(a.base / 1000).toFixed(2)}s</td><td>${a.ogcd}</td><td>${a.cancelled || ''}</td><td>${o.loading ? '…' : num(o.dps)}</td><td>${a.deaths || ''}</td>
      <td><button class="btn small" data-act="setme" data-key="${esc(log.key)}" data-pid="${r.pid}" data-go="1">フォーカス →</button></td></tr>`;
  }).join('');
  return `
    <h2>8人比較</h2>
    <p class="sub">パーティ全員のスキル回しを並べて表示します。目盛り(時間の帯)をドラッグすると範囲を選べ、Activeなどはその範囲で計算し直します。気になる人は「この人にフォーカス」で個人比較へ。</p>
    ${!S.me ? `<div class="panel warn">自分の行の「この人にフォーカス」を押すと、${S.logs.some(l => l.role !== 'me') ? '比較するログの同じジョブの人と並べて比較します' : '自分のスキル回しを詳しく見られます'}。</div>` : ''}
    ${logTabs(log.key, 'party')}
    ${rangeBar(d.phases, d.fight.duration)}
    ${timeline(rows, log, d.fight.duration)}
    ${legend()}
    <h3>範囲内の集計 <span class="small-t">(${fmt1(s)} 〜 ${fmt1(e)})</span></h3>
    <div class="wrap-tbl"><table class="tbl">
      <tr><th>プレイヤー</th><th title="FFLogsが計算した値。範囲を変えると取り直す">Active</th><th title="GCDが回っていた時間の割合(このツールの計算)">GCD稼働率</th><th>GCD数</th><th title="GCD間隔の代表値">GCD間隔</th><th>アビリティ数</th><th>詠唱中断</th><th>DPS(FFLogs)</th><th>戦闘不能</th><th></th></tr>
      ${table}
    </table></div>
  `;
}

function legend() {
  return `<div class="legend">
    <span><i style="background:var(--active)"></i>GCDが回っている時間</span>
    <span><i style="background:rgba(226,100,90,.55)"></i>GCDが回っていない所(0.2秒未満の誤差は除く)</span>
    <span><i style="background:#7f8ea3"></i>詠唱時間</span>
    <span>□ ウェポンスキル・魔法(GCD)/ ○ アビリティ</span>
    <span>目盛りをドラッグで範囲選択、端の黄色いつまみをドラッグで調整、ダブルクリックで解除</span>
  </div>`;
}

// 比較候補: 比較するログの中から、URLで選んだ人 → 同じジョブ → 同じロール(近接/遠隔/魔法/タンク/ヒーラー) → 同じ大分類。
// 比較するログが無いときだけ、同じ戦闘のパーティメンバーから選ぶ
function candidates() {
  const meLog = getLog(S.me.key);
  const me = getPlayer(meLog, S.me.pid);
  const mj = jobInfo(me.job);
  const all = [];
  for (const l of S.logs) for (const p of l.data.players) {
    if (l.key === S.me.key && p.id === S.me.pid) continue;
    const j = jobInfo(p.job);
    // 別のコンテンツ(ボスが違う)の人は自動では比較しない(「ほかのプレイヤー」から手動で追加は可)
    const sameContent = l.data.fight.encounterID === meLog.data.fight.encounterID;
    let lvl = p.job === me.job ? 3 : j.sub === mj.sub ? 2 : j.role === mj.role ? 1 : 0;
    if (l.key !== S.me.key && l.src === p.id) lvl = 4; // 比較するログのURLで選ばれていた人
    else if (!sameContent) lvl = 0;
    all.push({ log: l, p, lvl, team: l.key === S.me.key });
  }
  const hasRef = all.some(c => !c.team);
  if (hasRef) for (const c of all) if (c.team) c.lvl = 0; // 比較するログがあるときは、同じパーティの人は自動で選ばない
  const best = Math.max(0, ...all.map(c => c.lvl));
  for (const c of all) {
    const k = c.log.key + '|' + c.p.id;
    c.auto = best > 0 && c.lvl === best;
    c.on = S.picks[k] ?? c.auto;
    c.k = k;
  }
  all.sort((a, b) => b.lvl - a.lvl || (a.log.key === S.me.key) - (b.log.key === S.me.key) || a.p.name.localeCompare(b.p.name));
  return { all, best, me, mj };
}

function viewFocus() {
  const meLog = getLog(S.me.key);
  const { all, best, me, mj } = candidates();
  const LV = { 4: ['URLで指定', ''], 3: ['同じジョブ', ''], 2: ['同じロール', 'role'], 1: ['同じ大分類', 'role'], 0: ['', ''] };
  const candHtml = all.filter(c => best > 0 && c.lvl === best).map(c => `
    <label class="cand ${c.on ? 'on' : ''}"><input type="checkbox" data-act="pick" data-k="${esc(c.k)}" ${c.on ? 'checked' : ''}>
      ${jobBadge(c.p.job)}<div class="who grow"><div>${esc(c.p.name)}</div><div class="meta">${esc(c.log.data.report.title)} #${c.log.fightId}${c.log.key === S.me.key ? '(同じ戦闘)' : ''}</div></div>
      <span class="match ${LV[c.lvl][1]}">${LV[c.lvl][0]}</span></label>`).join('');
  const others = all.filter(c => !(best > 0 && c.lvl === best));
  const otherHtml = others.length ? `<details style="margin-top:8px"><summary class="note" style="cursor:pointer">ほかのプレイヤーも追加する(${others.length})</summary><div class="cands" style="margin-top:6px">${others.map(c => `
    <label class="cand ${c.on ? 'on' : ''}"><input type="checkbox" data-act="pick" data-k="${esc(c.k)}" ${c.on ? 'checked' : ''}>${jobBadge(c.p.job)}<div class="who grow"><div>${esc(c.p.name)}</div><div class="meta">${esc(c.log.data.report.title)} #${c.log.fightId}</div></div>${c.lvl ? `<span class="match ${LV[c.lvl][1]}">${LV[c.lvl][0]}</span>` : ''}</label>`).join('')}</div></details>` : '';
  const hasRef = all.some(c => !c.team);
  const notice = !hasRef ? '比較するログがありません。上手い人のログなどと比べるには「1 取り込み」の「比較するログ」にURLを入れてください(下は同じパーティの人との比較です)。'
    : best === 0 ? '比較するログに同じジョブ・同じロールの人がいません。「ほかのプレイヤーも追加する」から選んでください。'
    : best < 3 ? `比較するログに同じジョブ(${esc(mj.ja)})がいないため、${best === 2 ? `同じロール(${SUBROLE[mj.sub] || ''})` : '同じ大分類'}の人を候補にしています。` : '';

  const picked = all.filter(c => c.on);
  const rowsData = [{ log: meLog, p: me, me: true }, ...picked.map(c => ({ log: c.log, p: c.p, me: false }))];
  const rows = rowsData.map(r => {
    const st = statsLine(r.log, r.p.id);
    const off = offsetOf(r.log);
    return {
      log: r.log, pid: r.p.id, me: r.me, st, offset: off,
      label: `<div class="nm">${jobBadge(r.p.job)}<span class="n">${r.me ? '★ ' : ''}${esc(r.p.name)}</span></div>
        <div class="src">${esc(r.log.data.report.title)} #${r.log.fightId}${off ? ` ・ ずれ ${(off / 1000).toFixed(1)}s` : ''}</div>
        <div class="st">${st.html}</div>`,
    };
  });
  const maxDur = Math.max(...rows.map(r => r.log.data.fight.duration - r.offset));
  const phOpts = meLog.data.phases.map(p => `<option value="${p.id}" ${S.alignPhase === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

  return `
    <h2>個人フォーカス</h2>
    <p class="sub">自分と比較相手(比較するログの同じジョブの人。いなければ同じロール)のスキル回しを並べます。フェーズを選ぶと、そのフェーズの開始で時間を揃えます。下の表で、範囲内のスキルごとの使用回数の差が分かります。</p>
    <div class="panel">
      <div class="row" style="margin-bottom:10px">
        <span>フォーカス: ${jobBadge(me.job)} <b>${esc(me.name)}</b> <span class="note">${esc(meLog.data.report.title)} #${meLog.fightId}</span></span>
        <button class="btn small" data-act="changeme">変更</button>
        <div class="grow"></div>
        <span class="lbl note">時間の合わせ方</span>
        <select id="align"><option value="pull" ${S.align === 'pull' ? 'selected' : ''}>戦闘開始で揃える</option>${phOpts ? `<option value="phase" ${S.align === 'phase' ? 'selected' : ''}>フェーズ開始で揃える</option>` : ''}</select>
        ${S.align === 'phase' && phOpts ? `<select id="alignph">${phOpts}</select>` : ''}
      </div>
      ${notice ? `<p class="note" style="margin:0 0 8px">${notice}</p>` : ''}
      ${candHtml ? `<div class="cands">${candHtml}</div>` : ''}
      ${otherHtml}
    </div>
    ${rangeBar(meLog.data.phases, maxDur)}
    ${timeline(rows, meLog, maxDur)}
    ${legend()}
    ${focusTables(rows)}
  `;
}

function focusTables(rows) {
  const me = rows[0];
  const stats = rows.map(r => {
    const [s, e] = ownRange(r.log);
    return { r, a: analyze(r.log, r.pid, s, e), o: officialStats(r.log, r.pid), s, e };
  });
  // lowerBetter: 小さい方が良い値(GCD間隔・中断・戦闘不能)は色を逆にする
  const diff = (v, base, f, digits = 0, lowerBetter = false) => {
    if (v == null || base == null || !isFinite(v) || !isFinite(base)) return '';
    const d = v - base;
    if (Math.abs(d) < (digits ? 0.0005 : 0.5)) return '';
    const good = lowerBetter ? d < 0 : d > 0;
    return `<span class="diff ${good ? 'up' : 'down'}">${d > 0 ? '+' : ''}${f(d)}</span>`;
  };
  const m = stats[0];
  const head = stats.map(x => { const p = getPlayer(x.r.log, x.r.pid); return `<th>${jobBadge(p.job)} ${esc(p.name)}${x.r.me ? ' ★' : ''}</th>`; }).join('');
  const line = (label, get, f, dfmt, digits, lowerBetter) => `<tr><td class="l">${label}</td>${stats.map((x, i) => { const v = get(x); return `<td>${v === 'loading' ? '…' : f(v)}${i && v !== 'loading' ? diff(v, get(m) === 'loading' ? null : get(m), dfmt, digits, lowerBetter) : ''}</td>`; }).join('')}</tr>`;
  const summary = `
    <tr class="grp"><td colspan="${stats.length + 1}">概要</td></tr>
    ${line('Active(FFLogs)', x => x.o.loading ? 'loading' : x.o.active, pct, d => (d * 100).toFixed(1) + 'pt', 1)}
    ${line('GCD稼働率', x => x.a.active, pct, d => (d * 100).toFixed(1) + 'pt', 1)}
    ${line('DPS(FFLogs)', x => x.o.loading ? 'loading' : x.o.dps, num, d => Math.round(d).toLocaleString('ja-JP'))}
    ${line('GCD数', x => x.a.gcd, v => v, d => d)}
    ${line('GCD間隔', x => x.a.base / 1000, v => v.toFixed(2) + 's', d => d.toFixed(2) + 's', 2, true)}
    ${line('アビリティ数', x => x.a.ogcd, v => v, d => d)}
    ${line('詠唱中断', x => x.a.cancelled, v => v || '', d => d, 0, true)}
    ${line('戦闘不能', x => x.a.deaths, v => v || '', d => d, 0, true)}`;

  // スキルごとの回数(範囲内)
  const abil = new Map();
  stats.forEach((x, i) => {
    const ab = x.r.log.data.abilities;
    for (const c of x.a.list) {
      if (c.x) continue;
      const a = ab[c.a];
      const key = a?.name || c.a;
      if (!abil.has(key)) abil.set(key, { a, id: c.a, counts: stats.map(() => 0), first: stats.map(() => null), gcd: !!a?.gcd });
      const e = abil.get(key);
      e.counts[i]++;
      if (e.first[i] == null) e.first[i] = c.t - x.r.offset;
    }
  });
  const sortAb = arr => arr.sort((p, q) => q.counts[0] - p.counts[0] || Math.max(...q.counts) - Math.max(...p.counts));
  const all = [...abil.values()];
  const abRow = e => `<tr><td class="l"><span class="ab">${iconHtml(e.a, e.id, 'static')}${esc(e.a?.name || e.id)}</span></td>${e.counts.map((c, i) => `<td>${c ? c : '<span class="cellx">0</span>'}${i ? diff(c, e.counts[0], d => d) : ''}${!e.gcd && c ? ` <span class="small-t">初回 ${fmt(e.first[i])}</span>` : ''}</td>`).join('')}</tr>`;
  const g = sortAb(all.filter(e => e.gcd)), o = sortAb(all.filter(e => !e.gcd));
  const [s, e] = S.range || [0, Math.max(...stats.map(x => x.e))];
  return `
    <h3>比較(範囲 ${fmt1(s)} 〜 ${fmt1(e)})<span class="small-t"> 差分は★との差</span></h3>
    <div class="wrap-tbl"><table class="tbl">
      <tr><th></th>${head}</tr>
      ${summary}
      <tr class="grp"><td colspan="${stats.length + 1}">ウェポンスキル・魔法(GCD)の回数</td></tr>
      ${g.map(abRow).join('')}
      <tr class="grp"><td colspan="${stats.length + 1}">アビリティの回数(初回=最初に使った時間)</td></tr>
      ${o.map(abRow).join('')}
    </table></div>`;
}

function iconHtml(a, id, cls = '', style = '', extra = '') {
  if (a?.icon) return `<img class="ic ${cls}" src="${esc(a.icon)}" style="${style}" ${extra} loading="lazy" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:this.className+' txt',style:this.getAttribute('style'),textContent:${esc(JSON.stringify((a?.name || '?').slice(0, 3)))}}))">`;
  return `<span class="ic txt ${cls}" style="${style}" ${extra}>${esc((a?.name || String(id)).slice(0, 3))}</span>`;
}

// ---------- タイムライン ----------
let TIPS = [];
function timeline(rows, bossLog, maxDur) {
  TIPS = [];
  const z = S.zoom / 1000; // px/ms
  const W = Math.ceil(maxDur * z) + 60;
  const X = t => (t * z).toFixed(1);
  const parts = [];

  // 目盛り
  const steps = [5, 10, 15, 30, 60, 120];
  const step = (steps.find(s => s * S.zoom >= 70) || 120) * 1000;
  const minor = step / 5;
  let ticks = '', grid = '';
  for (let t = 0; t <= maxDur; t += minor) {
    const major = t % step === 0;
    ticks += `<div class="tick ${major ? '' : 'minor'}" style="left:${X(t)}px">${major ? `<span>${fmt(t)}</span>` : ''}</div>`;
    if (major) grid += `<div class="gridline" style="left:${X(t)}px"></div>`;
  }
  const ph = bossLog.data.phases.map(p => `<div class="phase ${p.inter ? 'inter' : ''}" style="left:${X(p.start)}px;width:${Math.max(4, (p.end - p.start) * z - 2).toFixed(1)}px" data-act="phase" data-id="${p.id}" data-s="${p.start}" data-e="${p.end}" title="${esc(p.name)} ${fmt(p.start)}〜${fmt(p.end)}(クリックで範囲に)">${esc(p.name)}</div>`).join('');
  parts.push(`<div class="tl-row ruler"><div class="lab">時間 <span class="note">ドラッグで範囲選択</span></div><div class="trk" id="ruler" style="width:${W}px">${ph}${ticks}</div></div>`);

  // ボス
  if (S.showBoss && bossLog.data.boss.length) {
    const lanes = [];
    let items = '';
    const ab = bossLog.data.abilities;
    for (const c of bossLog.data.boss) {
      const a = ab[c.a];
      const name = (a?.name || `#${c.a}`) + (c.n > 1 ? ` ×${c.n}` : '');
      const x = c.t * z;
      const w = Math.max(c.cd * z, 3);
      const span = Math.max(w, name.length * 11 + 10);
      let lane = lanes.findIndex(end => end <= x);
      // 段は最大5段。空きが無ければ一番早く空く段に重ねる
      if (lane < 0 && lanes.length < 5) { lane = lanes.length; lanes.push(0); }
      if (lane < 0) lane = lanes.indexOf(Math.min(...lanes));
      lanes[lane] = x + span + 4;
      const i = TIPS.push({ kind: 'boss', name, t: c.t, cd: c.cd, id: c.a }) - 1;
      items += `<div class="bc ${c.cd ? '' : 'inst'}" data-i="${i}" style="left:${x.toFixed(1)}px;top:${3 + lane * 20}px;width:${c.cd ? w.toFixed(1) : 2}px">${esc(name)}</div>`;
    }
    const h = Math.max(1, lanes.length) * 20 + 6;
    parts.push(`<div class="tl-row boss"><div class="lab"><div class="nm">ボス</div><div class="src">${esc(bossLog.data.fight.name)}</div></div><div class="trk" style="width:${W}px;height:${h}px">${grid}${items}</div></div>`);
  }

  // プレイヤー
  for (const r of rows) {
    const d = r.log.data;
    const off = r.offset || 0;
    const ab = d.abilities;
    const list = d.casts[r.pid] || [];
    const lanes = [];
    let gcdHtml = '', ogHtml = '', bars = '';
    const GY = 4, AY = 31;
    let lastGcdEnd = null;
    const { merged, base } = intervals(r.log, r.pid);
    for (const c of list) {
      const t = c.t - off;
      const a = ab[c.a];
      const x = t * z;
      const i = TIPS.push({ kind: 'cast', name: a?.name || `#${c.a}`, t, cd: c.cd, x: c.x, gcd: !!a?.gcd, id: c.a }) - 1;
      if (a?.gcd || c.cd) {
        if (c.cd) bars += `<div class="castbar ${c.x ? 'cx' : ''}" style="left:${x.toFixed(1)}px;top:${GY + 25}px;width:${(c.cd * z).toFixed(1)}px"></div>`;
        gcdHtml += iconHtml(a, c.a, c.x ? 'cx' : '', `left:${(x).toFixed(1)}px;top:${GY}px`, `data-i="${i}"`);
        if (!c.x) {
          // GCDの空き(前のGCDの想定終了から0.2秒以上あいた所。それより短いのはGCDの長さの推定誤差として扱う)
          if (lastGcdEnd != null && t - lastGcdEnd >= 200) bars += `<div class="idle" style="left:${(lastGcdEnd * z).toFixed(1)}px;top:${AY}px;width:${((t - lastGcdEnd) * z).toFixed(1)}px" data-i="${TIPS.push({ kind: 'gap', from: lastGcdEnd, to: t }) - 1}"></div>`;
          const rc = a?.recast && a.recast !== 2500 ? a.recast * base / 2500 : base;
          lastGcdEnd = Math.max(lastGcdEnd ?? -1e9, t + Math.max(c.cd || 0, rc));
        }
      } else if (S.showOgcd) {
        let lane = lanes.findIndex(end => end <= x);
        if (lane < 0) { lane = lanes.length; lanes.push(0); }
        lanes[lane] = x + 21;
        ogHtml += iconHtml(a, c.a, 'og', `left:${x.toFixed(1)}px;top:${AY + 7 + lane * 22}px`, `data-i="${i}"`);
      }
    }
    let act = '';
    for (const [s0, e0] of merged) act += `<div class="actstrip" style="left:${((s0 - off) * z).toFixed(1)}px;top:${AY}px;width:${((e0 - s0) * z).toFixed(1)}px"></div>`;
    const deaths = d.deaths.filter(x => x.id === r.pid).map(x => `<div class="death" style="left:${((x.t - off) * z).toFixed(1)}px" data-i="${TIPS.push({ kind: 'death', t: x.t - off }) - 1}"><span>戦闘不能</span></div>`).join('');
    const h = S.showOgcd ? AY + 7 + Math.max(1, lanes.length) * 22 + 2 : AY + 8;
    parts.push(`<div class="tl-row ${r.me ? 'me' : ''}"><div class="lab">${r.label}</div><div class="trk" style="width:${W}px;height:${h}px">${grid}<div class="lanebg" style="top:0;height:${GY + 29}px"></div>${act}${bars}${gcdHtml}${ogHtml}${deaths}</div></div>`);
  }

  // 範囲外を暗くする
  let shade = '';
  if (S.range) {
    const [s, e] = S.range;
    shade = `<div class="shade" id="shl" style="left:${LW}px;width:${Math.max(0, s * z).toFixed(1)}px"></div>
      <div class="shade" id="shr" style="left:${(LW + e * z).toFixed(1)}px;width:${Math.max(0, W - e * z).toFixed(1)}px"></div>
      <div class="redge" id="rel" style="left:${(LW + s * z).toFixed(1)}px"></div><div class="redge" id="rer" style="left:${(LW + e * z).toFixed(1)}px"></div>`;
  }
  return `<div class="tl-scroll" style="--lw:${LW}px"><div class="tl-inner" style="width:${LW + W}px" data-max="${maxDur}">${parts.join('')}${shade}</div></div>`;
}

// ---------- 操作 ----------
// scroll: 範囲の始まりが見える位置まで横に移動する(フェーズ選択・数値入力のとき)
function setRange(s, e, scroll = false) {
  if (s == null || e == null || e - s < 500) { S.range = null; }
  else S.range = [Math.max(0, s), e];
  if (scroll && S.range) render.scrollTo = Math.max(0, S.range[0] / 1000 * S.zoom - 20);
  render();
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) {
    const nav = e.target.closest('#steps button');
    if (nav && !nav.disabled) { S.view = nav.dataset.view; render(); }
    return;
  }
  const act = b.dataset.act;
  const i = Number(b.dataset.i);
  switch (act) {
    case 'import': importUrls($('#url-me').value, $('#url-ref').value); break;
    case 'demo': importUrls('demo1#source=8', 'demo2'); break;
    case 'login': login(JSON.stringify({ me: $('#url-me')?.value || '', ref: $('#url-ref')?.value || '' })).catch(err => toast(err.message)); break;
    case 'logout': logout(); S.auth = authState(); render(); break;
    case 'remove': removeLog(S.logs[i]); break;
    case 'openparty': S.partyKey = S.logs[i].key; S.view = 'party'; render(); break;
    case 'party': S.partyKey = b.dataset.key; render(); break;
    case 'setme': {
      const key = b.dataset.key, pid = Number(b.dataset.pid);
      if (S.me?.key !== key || S.me?.pid !== pid) { S.me = { key, pid }; S.picks = {}; S.align = 'pull'; }
      save();
      S.view = 'focus';
      render(); break;
    }
    case 'changeme': S.me = null; S.view = 'party'; render(); break;
    case 'phase': {
      const scroll = !b.classList.contains('phase');
      const base = S.view === 'focus' && S.me ? getLog(S.me.key) : getLog(S.partyKey);
      const ph = base?.data.phases.find(p => p.id === Number(b.dataset.id));
      if (S.view === 'focus' && ph) { if (!scroll) { const k = render.scrollTo; setPhaseRange(ph, false); render.scrollTo = k; render(); } else setPhaseRange(ph); }
      else setRange(Number(b.dataset.s), Number(b.dataset.e), scroll);
      break;
    }
    case 'clearrange': setRange(null, null); break;
    case 'applyrange': {
      const s = parseTime($('#rs').value) ?? 0;
      const max = Number($('.tl-inner')?.dataset.max || 0);
      const en = parseTime($('#re').value) ?? max;
      if (!(en > s)) { toast('終わりは始まりより後にしてください'); break; }
      setRange(s, en, true); break;
    }
    case 'fit': {
      if (!S.range) break;
      const sc = $('.tl-scroll');
      const avail = sc.clientWidth - LW - 30;
      S.zoom = Math.max(4, Math.min(60, Math.floor(avail / ((S.range[1] - S.range[0]) / 1000))));
      render.scrollTo = Math.max(0, S.range[0] / 1000 * S.zoom - 10);
      save(); render(); break;
    }
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.act === 'fight') { const log = S.logs[Number(t.dataset.i)]; changeFight(log, Number(t.value)); }
  else if (t.dataset.act === 'ogcd') { S.showOgcd = t.checked; save(); render(); }
  else if (t.dataset.act === 'boss') { S.showBoss = t.checked; save(); render(); }
  else if (t.dataset.act === 'pick') { S.picks[t.dataset.k] = t.checked; render(); }
  else if (t.id === 'align') {
    S.align = t.value;
    if (S.align === 'phase' && S.alignPhase == null) S.alignPhase = getLog(S.me.key).data.phases[1]?.id ?? getLog(S.me.key).data.phases[0]?.id;
    render();
  } else if (t.id === 'alignph') { S.alignPhase = Number(t.value); render(); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.target.id === 'rs' || e.target.id === 're')) $('[data-act=applyrange]').click();
});

// ズーム(見ている位置を保ったまま)
let zoomTimer = null;
document.addEventListener('input', e => {
  if (e.target.id !== 'zoom') return;
  const sc = $('.tl-scroll');
  const centerT = sc ? (sc.scrollLeft + (sc.clientWidth - LW) / 2) / S.zoom : 0;
  S.zoom = Number(e.target.value);
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => {
    render.scrollTo = Math.max(0, centerT * S.zoom - (($('.tl-scroll')?.clientWidth || 0) - LW) / 2);
    save(); render();
    $('#zoom')?.focus();
  }, 60);
});

// 目盛りのドラッグで範囲選択
let drag = null;
// 範囲の端(青い線・つまみ)をドラッグすると、その端だけを動かせる
document.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const edge = e.target.closest('.redge');
  const r = edge ? $('#ruler') : e.target.closest('#ruler');
  if (!r || (!edge && e.target.closest('.phase'))) return;
  const rect = r.getBoundingClientRect();
  const max = Number($('.tl-inner').dataset.max);
  const toT = cx => Math.max(0, Math.min(max, (cx - rect.left) / (S.zoom / 1000)));
  let anchor = null; // 動かさない側の端
  if (S.range) {
    const near = t => Math.abs(e.clientX - (rect.left + t * S.zoom / 1000)) <= 6;
    if (edge ? edge.id === 'rel' : near(S.range[0])) anchor = S.range[1];
    else if (edge ? edge.id === 'rer' : near(S.range[1])) anchor = S.range[0];
  }
  if (edge && anchor == null) return;
  drag = { t0: anchor ?? toT(e.clientX), toT, moved: false, x0: e.clientX };
  e.preventDefault();
});
document.addEventListener('mousemove', e => {
  if (drag) {
    if (Math.abs(e.clientX - drag.x0) > 3) drag.moved = true;
    if (!drag.moved) return;
    const t1 = drag.toT(e.clientX);
    const s = Math.min(drag.t0, t1), en = Math.max(drag.t0, t1);
    drawShade(s, en);
    drag.cur = [s, en];
    return;
  }
  const el = e.target.closest?.('[data-i]');
  const tip = $('#tip');
  if (!el || !TIPS[Number(el.dataset.i)] || el.closest('.logcard')) { tip.hidden = true; return; }
  const d = TIPS[Number(el.dataset.i)];
  let h = '';
  if (d.kind === 'cast') h = `<b>${esc(d.name)}</b><span class="m">${fmt1(d.t)} ・ ${d.gcd ? 'GCD' : 'アビリティ'}${d.cd ? ` ・ 詠唱 ${(d.cd / 1000).toFixed(2)}s` : ''}${d.x ? ' ・ <span class="err">詠唱中断</span>' : ''}</span>`;
  else if (d.kind === 'boss') h = `<b>${esc(d.name)}</b><span class="m">${fmt1(d.t)}${d.cd ? ` ・ 詠唱 ${(d.cd / 1000).toFixed(1)}s` : ''}</span>`;
  else if (d.kind === 'gap') h = `<b>GCDの空き ${((d.to - d.from) / 1000).toFixed(1)}s</b><span class="m">${fmt1(d.from)} 〜 ${fmt1(d.to)}</span>`;
  else if (d.kind === 'death') h = `<b class="err">戦闘不能</b><span class="m">${fmt1(d.t)}</span>`;
  tip.innerHTML = h; tip.hidden = false;
  const x = Math.min(window.innerWidth - 290, e.clientX + 14), y = e.clientY + 16;
  tip.style.left = x + 'px'; tip.style.top = (y + 60 > window.innerHeight ? e.clientY - 50 : y) + 'px';
});
document.addEventListener('mouseup', () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.moved && d.cur) setRange(d.cur[0], d.cur[1]);
});
document.addEventListener('dblclick', e => { if (e.target.closest('#ruler')) setRange(null, null); });

function drawShade(s, e) {
  const inner = $('.tl-inner');
  const z = S.zoom / 1000;
  const W = inner.offsetWidth - LW;
  for (const id of ['shl', 'shr', 'rel', 'rer']) $('#' + id)?.remove();
  inner.insertAdjacentHTML('beforeend', `<div class="shade" id="shl" style="left:${LW}px;width:${s * z}px"></div>
    <div class="shade" id="shr" style="left:${LW + e * z}px;width:${Math.max(0, W - e * z)}px"></div>
    <div class="redge" id="rel" style="left:${LW + s * z}px"></div><div class="redge" id="rer" style="left:${LW + e * z}px"></div>`);
  const rs = $('#rs'), re = $('#re');
  if (rs) rs.value = fmt1(s);
  if (re) re.value = fmt1(e);
}

// ---------- 起動 ----------
(async function init() {
  S.auth = authState();
  render();
  // FFLogsのログイン画面から戻ってきたとき: トークンを受け取り、ログイン前に貼っていたURLを読み込む
  let carry = null;
  try { carry = (await finishLogin())?.carry || null; }
  catch (e) { toast(e.message); }
  S.auth = authState();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('rotcmp') || 'null'); } catch {}
  if (saved) {
    S.zoom = saved.zoom || S.zoom;
    S.showOgcd = saved.showOgcd ?? true;
    S.showBoss = saved.showBoss ?? true;
    S.inputs = saved.inputs || null;
    if (saved.logs?.length) {
      S.loading = true; render();
      for (const [code, fight, role, src] of saved.logs) {
        if (!code.startsWith('demo') && !S.auth.loggedIn) continue; // ログインしていなければ実際のログは後回し
        try { await addLog(code, fight, role || 'ref', src ?? null); } catch (e) { console.warn(e); }
      }
      S.loading = false;
      if (saved.me && getLog(saved.me.key)) S.me = saved.me;
      S.partyKey = S.logs.find(l => l.role === 'me')?.key || S.logs[0]?.key || null;
      if (S.logs.length) S.view = S.me ? 'focus' : 'party';
    }
  }
  render();
  if (carry) {
    let c = null;
    try { c = JSON.parse(carry); } catch { c = { me: carry, ref: '' }; }
    if (c && (c.me?.trim() || c.ref?.trim())) await importUrls(c.me || '', c.ref || '');
  }
})();
