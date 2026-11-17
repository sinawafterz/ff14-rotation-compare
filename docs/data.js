// データの取得・整形(ブラウザだけで動く)
// FFLogs API v2 には、使う人が自分のFFLogsアカウントでログインして(OAuth PKCE)アクセスする。
// 秘密の値(クライアントシークレット)は使わないので、このファイルをそのまま公開してよい。
import { FFLOGS_CLIENT_ID } from './config.js';
import { demoReport, demoFight, demoRange } from './demo.js';

const FFLOGS = 'https://www.fflogs.com';
const TOKEN_KEY = 'rotcmp-token';
const PKCE_KEY = 'rotcmp-pkce';

const err = (message, status) => Object.assign(new Error(message), { status });

// ---------- 小さな保存領域(IndexedDB。使えないときはメモリだけ)----------
const mem = new Map();
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise(res => {
    try {
      const r = indexedDB.open('rotcmp', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
async function cacheGet(key) {
  if (mem.has(key)) return mem.get(key);
  const d = await db();
  if (!d) return undefined;
  return new Promise(res => {
    try {
      const r = d.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(undefined);
    } catch { res(undefined); }
  });
}
async function cacheSet(key, val) {
  mem.set(key, val);
  const d = await db();
  if (!d) return;
  try { d.transaction('kv', 'readwrite').objectStore('kv').put(val, key); } catch {}
}

// ---------- ログイン(OAuth PKCE)----------
const redirectUri = () => location.origin + location.pathname;
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randStr = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

function readToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    if (t?.value && t.exp > Date.now() + 60_000) return t;
  } catch {}
  return null;
}

export function authState() {
  return { clientId: !!FFLOGS_CLIENT_ID, loggedIn: !!readToken() };
}

// FFLogsのログイン画面へ移動する。戻ってきたら finishLogin が続きを行う。
export async function login(carry) {
  if (!FFLOGS_CLIENT_ID) throw err('このページはまだFFLogsと連携する設定がされていません(config.js)。デモデータは使えます。');
  if (!crypto?.subtle) throw err('このブラウザ(またはhttpのページ)ではログインできません。https か localhost で開いてください。');
  const verifier = randStr(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = randStr(16);
  try { sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, carry })); } catch {}
  const q = new URLSearchParams({
    client_id: FFLOGS_CLIENT_ID, code_challenge: challenge, code_challenge_method: 'S256',
    state, redirect_uri: redirectUri(), response_type: 'code',
  });
  location.assign(`${FFLOGS}/oauth/authorize?${q}`);
}

// ログイン画面から戻ったとき(URLに ?code= がある)にトークンを受け取る。
// 戻り値: { carry } ログイン前に入力していた内容。ログインの戻りでなければ null。
export async function finishLogin() {
  const u = new URL(location.href);
  const code = u.searchParams.get('code'), state = u.searchParams.get('state');
  const denied = u.searchParams.get('error');
  if (!code && !denied) return null;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null'); sessionStorage.removeItem(PKCE_KEY); } catch {}
  history.replaceState(null, '', redirectUri() + u.hash);
  if (denied) throw err('FFLogsへのログインがキャンセルされました。');
  if (!saved || saved.state !== state) throw err('ログインの確認に失敗しました。もう一度ログインしてください。');
  const res = await fetch(`${FFLOGS}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: FFLOGS_CLIENT_ID, code_verifier: saved.verifier, redirect_uri: redirectUri(), code }),
  });
  if (!res.ok) throw err(`FFLogsへのログインに失敗しました(${res.status})。`);
  const j = await res.json();
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 })); } catch {}
  return { carry: saved.carry };
}

export function logout() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }

// ---------- FFLogs API ----------
async function gql(query, variables) {
  const t = readToken();
  if (!t) throw err('実際のログを読むには、FFLogsにログインしてください(上の「FFLogsでログイン」)。', 401);
  const res = await fetch(`${FFLOGS}/api/v2/user`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.value}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) { logout(); throw err('FFLogsのログインが切れました。もう一度ログインしてください。', 401); }
  if (res.status === 429) throw err('FFLogs APIの利用上限に達しました。しばらく待ってから試してください。', 429);
  let j;
  try { j = await res.json(); } catch { throw err(`FFLogs APIの応答を読めませんでした(${res.status})`); }
  if (j.errors?.length) {
    const msg = j.errors.map(e => e.message).join(' / ');
    if (/permission|private|not exist|does not exist/i.test(msg)) throw err(`ログが見つからないか、非公開です: ${msg}`, 404);
    throw err(`FFLogs APIエラー: ${msg}`);
  }
  return j.data;
}

const REPORT_Q = `query($code:String!){reportData{report(code:$code){
  code title startTime endTime
  fights{ id name kill startTime endTime encounterID difficulty fightPercentage bossPercentage }
}}}`;

const FIGHT_Q = `query($code:String!,$f:[Int]){reportData{report(code:$code){
  code title startTime
  fights(fightIDs:$f){ id name kill startTime endTime encounterID difficulty fightPercentage bossPercentage friendlyPlayers phaseTransitions{ id startTime } }
  phases{ encounterID phases{ id name isIntermission } }
  masterData{ actors(type:"Player"){ id name server subType } abilities{ gameID name icon type } }
}}}`;

const EVENTS_Q = `query($code:String!,$f:[Int],$s:Float,$e:Float,$h:HostilityType,$d:EventDataType){reportData{report(code:$code){
  events(fightIDs:$f,startTime:$s,endTime:$e,hostilityType:$h,dataType:$d,limit:10000){ data nextPageTimestamp }
}}}`;

const TABLE_Q = `query($code:String!,$f:[Int],$s:Float,$e:Float){reportData{report(code:$code){
  d:table(fightIDs:$f,startTime:$s,endTime:$e,dataType:DamageDone)
  c:table(fightIDs:$f,startTime:$s,endTime:$e,dataType:Casts)
}}}`;

async function allEvents(code, fightId, s, e, hostility, dataType) {
  const out = [];
  let start = s;
  for (let page = 0; page < 50; page++) {
    const d = await gql(EVENTS_Q, { code, f: [fightId], s: start, e, h: hostility, d: dataType });
    const ev = d.reportData.report.events;
    if (ev?.data) out.push(...ev.data);
    if (ev?.nextPageTimestamp == null) break;
    start = ev.nextPageTimestamp;
  }
  return out;
}

const reportMem = new Map(); // code -> {at, data}
export async function getReport(code) {
  if (code.startsWith('demo')) return demoReport(code);
  const hit = reportMem.get(code);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
  const d = await gql(REPORT_Q, { code });
  const r = d.reportData?.report;
  if (!r) throw err('ログが見つかりません。URLを確認してください。', 404);
  const data = {
    code: r.code, title: r.title, startTime: r.startTime,
    fights: r.fights.map(f => ({
      id: f.id, name: f.name, kill: !!f.kill, encounterID: f.encounterID, difficulty: f.difficulty,
      duration: f.endTime - f.startTime, fightPercentage: f.fightPercentage, bossPercentage: f.bossPercentage,
      startTime: f.startTime,
    })),
  };
  reportMem.set(code, { at: Date.now(), data });
  return data;
}

export async function getFight(code, fightId) {
  if (code.startsWith('demo')) return finalizeFight(demoFight(code, fightId));
  const key = `raw-${code}-${fightId}`;
  const cached = await cacheGet(key);
  if (cached) { try { return await finalizeFight(cached); } catch (e) { console.warn(e); } }

  const d = await gql(FIGHT_Q, { code, f: [fightId] });
  const r = d.reportData?.report;
  if (!r) throw err('ログが見つかりません。', 404);
  const f = r.fights?.[0];
  if (!f) throw err(`戦闘 #${fightId} が見つかりません。`, 404);

  const [friendly, enemy, deaths] = await Promise.all([
    allEvents(code, f.id, f.startTime, f.endTime, 'Friendlies', 'Casts'),
    allEvents(code, f.id, f.startTime, f.endTime, 'Enemies', 'Casts'),
    allEvents(code, f.id, f.startTime, f.endTime, 'Friendlies', 'Deaths'),
  ]);
  let table = null;
  try {
    const t = await gql(TABLE_Q, { code, f: [f.id], s: f.startTime, e: f.endTime });
    table = { d: t.reportData.report.d, c: t.reportData.report.c };
  } catch (e) { console.warn('table取得失敗', e.message); }

  const raw = {
    report: { code: r.code, title: r.title, startTime: r.startTime },
    fight: f,
    phaseMeta: (r.phases || []).find(p => p.encounterID === f.encounterID)?.phases || [],
    actors: r.masterData.actors,
    abilities: r.masterData.abilities,
    friendly, enemy, deaths, table,
  };
  const out = await finalizeFight(raw);
  await cacheSet(key, raw);
  return out;
}

// FFLogsの生データ → 画面で使う形に整える(デモもこの形の生データを返す)
async function finalizeFight(raw) {
  const f = raw.fight;
  const t0 = f.startTime;
  const playerIds = new Set(f.friendlyPlayers || []);
  const actorMap = new Map(raw.actors.map(a => [a.id, a]));
  const players = [...playerIds].map(id => actorMap.get(id)).filter(Boolean)
    .filter(a => a.subType && a.subType !== 'LimitBreak' && a.subType !== 'Unknown')
    .map(a => ({ id: a.id, name: a.name, server: a.server, job: a.subType }));
  const ids = new Set(players.map(p => p.id));

  // キャスト: begincast と cast を1件にまとめる
  const casts = {};
  const pending = {};
  for (const p of players) casts[p.id] = [];
  const sorted = [...raw.friendly].sort((a, b) => a.timestamp - b.timestamp);
  for (const ev of sorted) {
    if (!ids.has(ev.sourceID)) continue;
    const list = casts[ev.sourceID];
    const pend = pending[ev.sourceID];
    if (ev.type === 'begincast') {
      if (pend) list.push({ t: pend.t - t0, a: pend.a, cd: pend.dur, x: 1 }); // 前の詠唱は中断
      pending[ev.sourceID] = { t: ev.timestamp, a: ev.abilityGameID, dur: ev.duration || 0 };
    } else if (ev.type === 'cast') {
      if (pend && pend.a === ev.abilityGameID && ev.timestamp - pend.t <= pend.dur + 1500) {
        list.push({ t: pend.t - t0, a: ev.abilityGameID, cd: pend.dur });
        pending[ev.sourceID] = null;
      } else {
        if (pend && ev.timestamp - pend.t > pend.dur + 1500) { list.push({ t: pend.t - t0, a: pend.a, cd: pend.dur, x: 1 }); pending[ev.sourceID] = null; }
        list.push({ t: ev.timestamp - t0, a: ev.abilityGameID, cd: 0 });
      }
    }
  }
  for (const [sid, pend] of Object.entries(pending)) if (pend) casts[sid].push({ t: pend.t - t0, a: pend.a, cd: pend.dur, x: 1 });
  for (const k of Object.keys(casts)) casts[k].sort((a, b) => a.t - b.t);

  // ボスの詠唱
  const bossRaw = [];
  const bpend = {};
  for (const ev of [...raw.enemy].sort((a, b) => a.timestamp - b.timestamp)) {
    if (ids.has(ev.sourceID)) continue;
    const key = `${ev.sourceID}:${ev.sourceInstance || 0}`;
    if (ev.type === 'begincast') {
      bpend[key] = { t: ev.timestamp - t0, a: ev.abilityGameID, cd: ev.duration || 0 };
      bossRaw.push(bpend[key]);
    } else if (ev.type === 'cast') {
      const p = bpend[key];
      if (p && p.a === ev.abilityGameID && ev.timestamp - t0 - p.t <= p.cd + 1500) { bpend[key] = null; continue; }
      bossRaw.push({ t: ev.timestamp - t0, a: ev.abilityGameID, cd: 0 });
    }
  }

  const deaths = raw.deaths.filter(ev => ev.type === 'death' && ids.has(ev.targetID)).map(ev => ({ t: ev.timestamp - t0, id: ev.targetID }));

  // アビリティ情報
  const used = new Set();
  for (const l of Object.values(casts)) for (const c of l) used.add(c.a);
  for (const c of bossRaw) used.add(c.a);
  const ffAb = new Map(raw.abilities.map(a => [a.gameID, a]));
  const xiv = await xivActions([...used]);
  const abilities = {};
  for (const id of used) {
    const fa = ffAb.get(id) || {};
    const xa = xiv[id];
    const name = (xa?.name) || fa.name || `#${id}`;
    abilities[id] = {
      name,
      en: fa.name || '',
      icon: xa?.icon ? iconUrl(xa.icon) : (fa.icon ? `https://assets.rpglogs.com/img/ff/abilities/${fa.icon}` : null),
      gcd: xa ? xa.gcd : !!fa.gcd,
      recast: xa ? xa.recast : (fa.recast || 0),
      cast: xa ? xa.cast : 0,
    };
  }
  // オートアタックや名前の無い内部処理はボスのタイムラインから除く
  const isAuto = id => {
    const a = abilities[id];
    if (id === 7 || id === 8 || !a) return true;
    if (/^(攻撃|attack)$/i.test(a.name)) return true;
    if (!xiv[id]?.name && /^(attack|unknown_|#)/i.test(a.name)) return true;
    return false;
  };
  for (const k of Object.keys(casts)) casts[k] = casts[k].filter(c => c.a !== 7 && c.a !== 8);
  // 同じ名前の技を同時に使った場合(複数の敵・内部IDだけ違う技)は1件にまとめ、詠唱は長い方を残す
  const boss = [];
  const lastSeen = new Map();
  for (const c of bossRaw.sort((a, b) => a.t - b.t)) {
    if (isAuto(c.a)) continue;
    const name = abilities[c.a].name;
    const prev = lastSeen.get(name);
    if (prev && c.t - prev.t < 1000) { if (c.cd > prev.cd) { prev.cd = c.cd; prev.a = c.a; } continue; }
    const item = { ...c };
    lastSeen.set(name, item);
    // 詠唱なしの同じ技が3秒以内に続く(多段・連続ヒット)ときは「×回数」にまとめる
    const grp = lastSeen.get('#grp:' + name);
    if (!c.cd && grp && !grp.cd && c.t - grp.t < 3000) { grp.n = (grp.n || 1) + 1; continue; }
    if (!c.cd) lastSeen.set('#grp:' + name, item);
    boss.push(item);
  }

  // フェーズ
  const meta = new Map((raw.phaseMeta || []).map(p => [p.id, p]));
  const pt = (f.phaseTransitions || []).slice().sort((a, b) => a.startTime - b.startTime);
  const phases = pt.map((p, i) => ({
    id: p.id,
    name: meta.get(p.id)?.name || `P${p.id}`,
    inter: !!meta.get(p.id)?.isIntermission,
    start: Math.max(0, p.startTime - t0),
    end: (pt[i + 1]?.startTime ?? f.endTime) - t0,
  })).filter(p => p.end - p.start > 500); // 途中から始まるログ(門の後など)の長さ0のフェーズは除く

  // FFLogs公式の値(全体)
  const official = parseTable(raw.table, f.endTime - f.startTime);

  return {
    report: raw.report,
    fight: {
      id: f.id, name: f.name, kill: !!f.kill, encounterID: f.encounterID, difficulty: f.difficulty,
      duration: f.endTime - f.startTime, fightPercentage: f.fightPercentage, bossPercentage: f.bossPercentage,
      startTime: f.startTime,
    },
    players, casts, boss, deaths, phases, abilities, official,
  };
}

// ダメージは「与ダメージ」表、Activeは「キャスト」表の値を使う
// (与ダメージ表のActiveは攻撃した時間しか数えず、ヒーラーの回復などが抜けるため)
function parseTable(table, fallbackTime) {
  const dmg = table?.d ? (table.d.data || table.d) : (table?.data || table);
  const cst = table?.c ? (table.c.data || table.c) : null;
  if (!dmg?.entries && !cst?.entries) return null;
  const totalTime = dmg?.totalTime || cst?.totalTime || fallbackTime;
  const players = {};
  for (const e of dmg?.entries || []) players[e.id] = { total: e.total ?? null, active: cst ? null : (e.activeTime ?? null) };
  for (const e of cst?.entries || []) (players[e.id] ??= { total: null, active: null }).active = e.activeTime ?? null;
  return { totalTime, players };
}

// 範囲を区切ったときのFFLogs公式値(Active・ダメージ)
export async function getRange(code, fightId, startRel, endRel) {
  if (code.startsWith('demo')) return demoRange(code, fightId, startRel, endRel);
  const rep = await getReport(code);
  const f = rep.fights.find(x => x.id === fightId);
  if (!f) throw err('戦闘が見つかりません', 404);
  const s = f.startTime + Math.max(0, startRel);
  const e = f.startTime + Math.min(f.duration, endRel);
  const key = `range-${code}-${fightId}-${Math.round(s)}-${Math.round(e)}`;
  const cached = await cacheGet(key);
  if (cached) return cached;
  const d = await gql(TABLE_Q, { code, f: [fightId], s, e });
  const out = parseTable({ d: d.reportData.report.d, c: d.reportData.report.c }, e - s) || { totalTime: e - s, players: {} };
  out.totalTime = e - s; // 範囲の長さで割る
  await cacheSet(key, out);
  return out;
}

// ---------- XIVAPI(日本語名・GCD判定・アイコン)----------
function iconUrl(id) {
  const folder = String(Math.floor(id / 1000) * 1000).padStart(6, '0');
  const name = String(id).padStart(6, '0');
  return `https://v2.xivapi.com/api/asset?path=ui/icon/${folder}/${name}_hr1.tex&format=png`;
}

const XIV_KEY = 'xivapi-actions-v1';
let xivCache = null;
async function xivActions(ids) {
  if (!xivCache) xivCache = (await cacheGet(XIV_KEY)) || {};
  const want = ids.filter(id => Number.isInteger(id) && id > 0 && id < 100000 && !(id in xivCache));
  for (let i = 0; i < want.length; i += 80) {
    let chunk = want.slice(i, i + 80);
    for (let attempt = 0; attempt < 20 && chunk.length; attempt++) {
      const url = `https://v2.xivapi.com/api/sheet/Action?rows=${chunk.join(',')}&fields=Name,ActionCategory.value,CooldownGroup,AdditionalCooldownGroup,Recast100ms,Cast100ms,Icon&language=ja`;
      let res;
      try { res = await fetch(url); } catch (e) { console.warn('XIVAPIに接続できません', e.message); return pick(ids); }
      if (res.status === 404) {
        // 存在しない行が混じると全体が404になるので、その行を外して取り直す
        const msg = (await res.json().catch(() => ({}))).message || '';
        const m = msg.match(/Action\/(\d+)/);
        if (!m) break;
        const bad = Number(m[1]);
        xivCache[bad] = null;
        chunk = chunk.filter(x => x !== bad);
        continue;
      }
      if (!res.ok) { console.warn('XIVAPIエラー', res.status); break; }
      const j = await res.json();
      for (const r of j.rows || []) {
        const fl = r.fields;
        xivCache[r.row_id] = {
          name: fl.Name || '',
          gcd: fl.CooldownGroup === 58 || fl.AdditionalCooldownGroup === 58,
          recast: (fl.Recast100ms || 0) * 100,
          cast: (fl.Cast100ms || 0) * 100,
          icon: fl.Icon?.id || 0,
          cat: fl.ActionCategory?.value || 0,
        };
      }
      break;
    }
  }
  if (want.length) await cacheSet(XIV_KEY, { ...xivCache });
  return pick(ids);
}
function pick(ids) {
  const out = {};
  for (const id of ids) if (xivCache[id]) out[id] = xivCache[id];
  return out;
}
