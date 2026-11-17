// デモデータ(FFLogs APIの認証情報が無くても画面を試せるようにする)
// FFLogs APIの生データと同じ形で作り、本番と同じ整形処理を通す。

const JOBS = {
  Paladin: { gcd: [9, 15, 3539, 9, 15, 3539, 16459, 7384], cast: { 7384: 1500 }, ogcd: [[20, 60000, 6500], [23, 30000, 8000], [25747, 30000, 8600]] },
  Warrior: { gcd: [31, 37, 42, 31, 37, 45, 3549, 3549], cast: {}, ogcd: [[7389, 60000, 6800], [7387, 30000, 9000], [52, 60000, 12000]] },
  WhiteMage: { gcd: [16532, 25859, 25859, 25859, 25859, 25859, 25859, 25859, 25859, 25859, 25859, 25859], cast: { 25859: 1500 }, ogcd: [[136, 120000, 7000], [3571, 40000, 9500]] },
  Scholar: { gcd: [16540, 25865, 25865, 25865, 25865, 25865, 25865, 25865, 25865, 25865, 25865, 25865], cast: { 25865: 1500 }, ogcd: [[7436, 120000, 8000], [166, 60000, 2000], [167, 20000, 9000]] },
  Dragoon: { gcd: [75, 87, 88, 75, 87, 88], cast: {}, ogcd: [[85, 60000, 6500], [3557, 120000, 7200], [16478, 30000, 9000], [3555, 30000, 11500]] },
  Ninja: { gcd: [2240, 2242, 2255], cast: {}, ogcd: [[2248, 120000, 6000], [2258, 60000, 9000], [7402, 20000, 11000]] },
  Bard: { gcd: [16495, 16495, 7409, 16495, 7406, 16495, 7407, 16495, 7409, 3560], cast: {}, ogcd: [[101, 120000, 6200], [118, 120000, 7000], [110, 15000, 8200], [3558, 15000, 9800]] },
  BlackMage: { gcd: [152, 3577, 3577, 3577, 25797, 3577, 3577, 3577, 16505, 154, 3576, 25797, 153, 16507], cast: { 152: 2000, 3577: 2000, 154: 2000, 3576: 2000, 16505: 2000 }, ogcd: [[3573, 120000, 5000], [7421, 60000, 9000], [25796, 120000, 15000], [158, 120000, 20000]] },
};

// 外部(XIVAPI)に繋がらない場合の予備情報
const FALLBACK = {
  9: ['ファストブレード', 1], 15: ['ライオットソード', 1], 3539: ['ロイヤルアソリティ', 1], 16459: ['コンフィテオル', 1], 7384: ['ホーリースピリット', 1],
  20: ['ファイト・オア・フライト', 0], 23: ['サークル・オブ・ドゥーム', 0], 25747: ['エクスピアシオン', 0],
  31: ['ヘヴィスウィング', 1], 37: ['メイム', 1], 42: ['シュトルムヴィント', 1], 45: ['シュトルムブレハ', 1], 3549: ['フェルクリーヴ', 1],
  7389: ['原初の解放', 0], 7387: ['アップヒーバル', 0], 52: ['ウォークライ', 0],
  16532: ['ディア', 1], 25859: ['グレアガ', 1], 136: ['神速魔', 0], 3571: ['アサイズ', 0],
  16540: ['蠱毒法', 1], 25865: ['極炎法', 1], 7436: ['連環計', 0], 166: ['エーテルフロー', 0], 167: ['エナジードレイン', 0],
  75: ['トゥルースラスト', 1], 87: ['ディセムボウル', 1], 88: ['桜華狂咲', 1], 85: ['ランスチャージ', 0], 3557: ['バトルリタニー', 0], 16478: ['ハイジャンプ', 0], 3555: ['ゲイルスコグル', 0],
  2240: ['双刃旋', 1], 2242: ['風断ち', 1], 2255: ['旋風刃', 1], 2248: ['ぶんどる', 0], 2258: ['だまし討ち', 0], 7402: ['六道輪廻', 0],
  16495: ['バーストショット', 1], 7409: ['リフルジェントアロー', 1], 7406: ['コースティックバイト', 1], 7407: ['ストームバイト', 1], 3560: ['アイアンジョー', 1],
  101: ['猛者の撃', 0], 118: ['バトルボイス', 0], 110: ['ブラッドレッター', 0], 3558: ['エンピリアルアロー', 0],
  152: ['ファイガ', 1], 3577: ['ファイジャ', 1], 25797: ['パラドックス', 1], 16505: ['デスペア', 1], 154: ['ブリザガ', 1], 3576: ['ブリザジャ', 1], 153: ['サンダガ', 1], 16507: ['ゼノグロシー', 1],
  3573: ['黒魔紋', 0], 7421: ['三連魔', 0], 25796: ['アンプリファイア', 0], 158: ['マナフォント', 0],
};

const BOSS = [
  [9000001, 'ヘビーインパクト', 5000], [9000002, 'デュアルバスター', 4000], [9000003, 'フレイムブレス', 6000],
  [9000004, 'メテオストリーム', 7000], [9000005, 'クロスブレイズ', 4500], [9000006, '星の終焉', 9000],
  [9000007, '散開予兆', 0], [9000008, 'テールスイング', 3000],
];

const PARTIES = {
  demo1: { title: 'デモ:自分の固定(零式4層)', names: ['ヒカリ ナイト', 'アカネ ウォー', 'シロ ヒーラー', 'ミドリ ガクシャ', 'ソラ リュウキシ', 'カゲ ニンジャ', 'ユミ バード', 'クロ マドウシ'], server: 'Tiamat',
    fights: [{ id: 1, dur: 190000, kill: false, pct: 72.4 }, { id: 2, dur: 452000, kill: true }] },
  demo2: { title: 'デモ:上位ログ(比較用)', names: ['Aiden Shield', 'Bram Axe', 'Cora Lily', 'Dex Quill', 'Eira Lance', 'Fen Blade', 'Gale Arrow', 'Hex Flare'], server: 'Gilgamesh',
    fights: [{ id: 5, dur: 431000, kill: true }] },
};
const JOB_ORDER = ['Paladin', 'Warrior', 'WhiteMage', 'Scholar', 'Dragoon', 'Ninja', 'Bard', 'BlackMage'];
const REPORT_START = 1763200000000;
const FIGHT_GAP = 600000;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function fightStart(code, id) {
  const p = PARTIES[code];
  let t = 30000;
  for (const f of p.fights) { if (f.id === id) return t; t += f.dur + FIGHT_GAP; }
  return t;
}

export function demoReport(code) {
  const p = PARTIES[code];
  if (!p) { const e = new Error('デモデータは demo1 / demo2 です'); e.status = 404; throw e; }
  return {
    code, title: p.title, startTime: REPORT_START,
    fights: p.fights.map(f => ({ id: f.id, name: 'デモ零式4層', kill: f.kill, encounterID: 9999, difficulty: 101, duration: f.dur, fightPercentage: f.kill ? 0 : f.pct, bossPercentage: f.kill ? 0 : f.pct, startTime: fightStart(code, f.id) })),
  };
}

const memo = new Map();
export function demoFight(code, fightId) {
  const key = code + ':' + fightId;
  if (memo.has(key)) return memo.get(key);
  const p = PARTIES[code];
  const fm = p?.fights.find(f => f.id === fightId);
  if (!fm) { const e = new Error('デモの戦闘が見つかりません'); e.status = 404; throw e; }
  const t0 = fightStart(code, fightId);
  const end = t0 + fm.dur;
  const skilled = code === 'demo2';
  const rand = rng(fightId * 7919 + (skilled ? 17 : 3));
  const inDown = rel => rel > 181000 && rel < 199000; // 中間フェーズ(ボス離脱)

  const actors = JOB_ORDER.map((job, i) => ({ id: i + 1, name: p.names[i], server: p.server, subType: job }));
  const friendly = [];
  const damage = {};
  actors.forEach((a, i) => {
    const kit = JOBS[a.subType];
    const gcdLen = a.subType === 'Ninja' || a.subType === 'Dragoon' ? 2120 : a.subType === 'BlackMage' ? 2390 : 2440;
    let t = t0 + (a.subType === 'BlackMage' || a.subType === 'WhiteMage' || a.subType === 'Scholar' ? 0 : 600);
    let k = 0;
    while (t < end - 500) {
      const rel = t - t0;
      if (inDown(rel)) { t = t0 + 199500 + rand() * 1500; continue; }
      const id = kit.gcd[k++ % kit.gcd.length];
      const c = kit.cast[id] || 0;
      if (rel >= 0 || c) {
        if (c) {
          friendly.push({ timestamp: Math.max(t, t0), type: 'begincast', sourceID: a.id, abilityGameID: id, duration: c });
          // まれに詠唱中断(自分のログだけ)
          if (!skilled && a.subType === 'BlackMage' && rand() < 0.02) { t += c * 0.6 + 300; continue; }
          friendly.push({ timestamp: Math.max(t, t0) + c, type: 'cast', sourceID: a.id, abilityGameID: id });
        } else {
          friendly.push({ timestamp: Math.max(t, t0), type: 'cast', sourceID: a.id, abilityGameID: id });
        }
        damage[a.id] = (damage[a.id] || 0) + 300 + rand() * 200;
      }
      let step = Math.max(gcdLen, c) + rand() * (skilled ? 60 : 140);
      // 自分のログはところどころGCDが空く(移動・ギミック処理の想定)
      if (!skilled && rand() < 0.045) step += 1200 + rand() * 2500;
      if (skilled && rand() < 0.012) step += 800 + rand() * 900;
      t = Math.round(t + step);
    }
    for (const [id, cd, first] of kit.ogcd) {
      let tt = t0 + first + rand() * 300;
      while (tt < end - 1000) {
        if (!inDown(tt - t0)) {
          friendly.push({ timestamp: tt, type: 'cast', sourceID: a.id, abilityGameID: id });
          damage[a.id] = (damage[a.id] || 0) + 200;
          tt = Math.round(tt + cd + (skilled ? rand() * 400 : rand() * 3500));
        } else tt = t0 + 199000 + rand() * 1000;
      }
    }
  });
  // 自分のログのWHMが1回死亡
  const deaths = [];
  if (!skilled && fightId === 2) deaths.push({ timestamp: t0 + 263400, type: 'death', targetID: 3 });

  const enemy = [];
  let bt = t0 + 8000, bi = 0;
  while (bt < end - 3000) {
    const rel = bt - t0;
    if (inDown(rel)) { bt = t0 + 202000; continue; }
    const [id, , dur] = BOSS[bi++ % BOSS.length];
    if (dur) {
      enemy.push({ timestamp: bt, type: 'begincast', sourceID: 100, abilityGameID: id, duration: dur });
      enemy.push({ timestamp: bt + dur, type: 'cast', sourceID: 100, abilityGameID: id });
    } else enemy.push({ timestamp: bt, type: 'cast', sourceID: 100, abilityGameID: id });
    enemy.push({ timestamp: bt + 1200, type: 'cast', sourceID: 100, abilityGameID: 7 }); // オートアタック(除外されることの確認用)
    bt += 12000 + dur + ((bi * 3301) % 7000);
  }
  if (fm.dur > 185000) {
    enemy.push({ timestamp: t0 + 182000, type: 'begincast', sourceID: 100, abilityGameID: 9000006, duration: 9000 });
  }

  const abilities = [
    ...Object.entries(FALLBACK).map(([id, [name, gcd]]) => ({ gameID: Number(id), name, icon: null, type: '1', gcd: !!gcd, recast: gcd ? 2500 : 0 })),
    ...BOSS.map(([id, name]) => ({ gameID: id, name, icon: null, type: '1' })),
    { gameID: 7, name: 'attack', icon: null, type: '1' },
  ];
  const phaseTransitions = [{ id: 1, startTime: t0 }];
  if (fm.dur > 181000) phaseTransitions.push({ id: 2, startTime: t0 + 181000 });
  if (fm.dur > 199000) phaseTransitions.push({ id: 3, startTime: t0 + 199000 });

  const totalSec = fm.dur / 1000;
  const raw = {
    report: { code, title: p.title, startTime: REPORT_START },
    fight: { id: fightId, name: 'デモ零式4層', kill: fm.kill, startTime: t0, endTime: end, encounterID: 9999, difficulty: 101, fightPercentage: fm.kill ? 0 : fm.pct, bossPercentage: fm.kill ? 0 : fm.pct, friendlyPlayers: actors.map(a => a.id), phaseTransitions },
    phaseMeta: [{ id: 1, name: 'P1', isIntermission: false }, { id: 2, name: '中間', isIntermission: true }, { id: 3, name: 'P2', isIntermission: false }],
    actors, abilities, friendly, enemy, deaths,
    table: { data: { totalTime: fm.dur, entries: actors.map(a => ({ id: a.id, total: Math.round((damage[a.id] || 0) * 60), activeTime: Math.round(fm.dur * (skilled ? 0.985 : 0.93)) })) } },
  };
  void totalSec;
  memo.set(key, raw);
  return raw;
}

// 範囲指定の公式値(デモでは範囲内のキャスト数からそれらしく計算)
export function demoRange(code, fightId, s, e) {
  const raw = demoFight(code, fightId);
  const t0 = raw.fight.startTime;
  const players = {};
  for (const a of raw.actors) {
    const n = raw.friendly.filter(ev => ev.sourceID === a.id && ev.type === 'cast' && ev.timestamp - t0 >= s && ev.timestamp - t0 < e).length;
    players[a.id] = { total: Math.round(n * 400 * 60), active: null };
  }
  return { totalTime: e - s, players };
}
