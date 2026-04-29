/**
 * Instagram分析自動化 GAS
 * Instagram Graph API (v22.0+) を使用してアカウント/投稿インサイトを取得し、
 * スプレッドシートに日次記録、週次・月次集計を自動化する。
 *
 * セットアップ手順:
 *  1) スプレッドシートを作成し、このスクリプトを紐付ける
 *  2) onOpen() → メニューから「初期セットアップ」を実行
 *  3) 「日次取得トリガー設定」で毎日 03:00 自動実行を登録
 *
 * ※ IG_ACCESS_TOKEN / IG_USER_ID はコード内に直接定義済み
 *   トークンを変更する場合は IG_ACCESS_TOKEN 定数を更新してください
 */

const API_VERSION = 'v22.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;
const TZ = 'Asia/Tokyo';

const SHEETS = {
  DAILY: '日次データ',
  POSTS: '投稿別データ',
  WEEKLY: '週間集計',
  MONTHLY: '月間集計',
  CONFIG: '設定',
};

// ===== 日次データシートの列定義 =====
const DAILY_HEADERS = [
  '日付',
  // フォロワー
  'フォロワー', '増加数', 'フォロー数', 'フォロー減少数',
  // エンゲージメント（トータル）
  'アクションを実行したアカウント数', 'フォロワー(エンゲージ)', 'フォロワー外(エンゲージ)',
  // エンゲージメント（投稿）
  '投稿_インタラクション', '投稿_いいね', '投稿_コメント/再投稿', '投稿_保存+再投稿',
  // エンゲージメント（リール）
  'リール_インタラクション', 'リール_いいね', 'リール_コメント数', 'リール_保存数', 'リール_シェア+再投稿',
  // リーチ
  'リーチしたアカウント数', 'リーチ_フォロワー', 'リーチ_フォロワー外',
  'インプレッション(Views)', 'プロフィールアクセス', '外部リンクのタップ',
  // シェアしたコンテンツ
  '投稿数', 'ストーリーズ数', 'リール数',
];

// ==========================================================
// メニュー
// ==========================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Instagram分析')
    .addItem('初期セットアップ(シート作成)', 'setupSheets')
    .addSeparator()
    .addItem('今日のデータを取得', 'fetchDailyData')
    .addItem('指定日のデータを取得', 'fetchDailyDataByPrompt')
    .addItem('過去30日分を一括取得', 'backfillLast30Days')
    .addSeparator()
    .addItem('週間集計を更新', 'updateWeeklyAggregation')
    .addItem('月間集計を更新', 'updateMonthlyAggregation')
    .addSeparator()
    .addItem('日次取得トリガー設定', 'installDailyTrigger')
    .addItem('トリガー削除', 'removeAllTriggers')
    .addToUi();
}

// ==========================================================
// 初期セットアップ
// ==========================================================
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 日次データ
  let sh = ss.getSheetByName(SHEETS.DAILY) || ss.insertSheet(SHEETS.DAILY);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, DAILY_HEADERS.length).setValues([DAILY_HEADERS]);
    sh.getRange(1, 1, 1, DAILY_HEADERS.length)
      .setFontWeight('bold').setBackground('#cfe2f3');
    sh.setFrozenRows(1);
  }

  // 投稿別データ
  sh = ss.getSheetByName(SHEETS.POSTS) || ss.insertSheet(SHEETS.POSTS);
  if (sh.getLastRow() === 0) {
    const headers = ['投稿ID','投稿日時','メディア種別','キャプション','URL',
      'リーチ','いいね','コメント','保存','シェア','再生数(Views)','インタラクション'];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d9ead3');
    sh.setFrozenRows(1);
  }

  // 週間集計
  sh = ss.getSheetByName(SHEETS.WEEKLY) || ss.insertSheet(SHEETS.WEEKLY);
  // 月間集計
  sh = ss.getSheetByName(SHEETS.MONTHLY) || ss.insertSheet(SHEETS.MONTHLY);

  SpreadsheetApp.getUi().alert('シートを作成/確認しました。次は「日次取得トリガー設定」を実行してください。');
}

// ==========================================================
// API 呼び出し
// ==========================================================
const IG_ACCESS_TOKEN = 'EAAZCv2K3985ABRUT9tJpkCGDwZAUt3mz1nbErFu6nFTzEOP6fsN8y6TVvjMPah4ca8ZB98AtQFtYp0c1jAIT8EIXCJJV6ZAiZAcZChDZA6wIYt5UJPQmBziBQvnyWsaZBH4Cjd1VZAOcMA7aiB0ZBDz8ivx7yKucbUCPyxk3ZBhZBef66Rb2gOECBXsWd7cYdwMRKWTDHd8RxLJli';
const IG_USER_ID_VAL = '1784144516565';

function getConfig_() {
  return { token: IG_ACCESS_TOKEN, userId: IG_USER_ID_VAL };
}

function callApi_(path, params) {
  const { token } = getConfig_();
  const query = Object.assign({ access_token: token }, params || {});
  const qs = Object.keys(query).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
  const url = `${BASE_URL}/${path}?${qs}`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) {
    console.warn(`API error ${code}: ${path} -> ${body}`);
    return null;
  }
  return JSON.parse(body);
}

/** insights から total_value を取り出す */
function pickTotal_(json, metric) {
  if (!json || !json.data) return 0;
  const m = json.data.find(d => d.name === metric);
  if (!m) return 0;
  if (m.total_value && typeof m.total_value.value === 'number') return m.total_value.value;
  if (m.values && m.values.length) return m.values[m.values.length - 1].value || 0;
  return 0;
}

/** breakdown (dimension_values) を dict 化 */
function pickBreakdown_(json, metric) {
  const result = {};
  if (!json || !json.data) return result;
  const m = json.data.find(d => d.name === metric);
  if (!m || !m.total_value || !m.total_value.breakdowns) return result;
  const bd = m.total_value.breakdowns[0];
  if (!bd || !bd.results) return result;
  bd.results.forEach(r => {
    const key = (r.dimension_values || []).join('|');
    result[key] = r.value;
  });
  return result;
}

// ==========================================================
// 日次データ取得
// ==========================================================
function fetchDailyData() {
  const y = new Date();
  y.setDate(y.getDate() - 1); // Instagramは前日データが安定
  fetchDailyDataForDate(y);
}

function fetchDailyDataByPrompt() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('取得日 (YYYY-MM-DD)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const d = new Date(res.getResponseText());
  if (isNaN(d.getTime())) { ui.alert('日付形式が不正です'); return; }
  fetchDailyDataForDate(d);
}

function backfillLast30Days() {
  const today = new Date();
  for (let i = 30; i >= 1; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    try { fetchDailyDataForDate(d); } catch (e) { console.error(d, e); }
    Utilities.sleep(600);
  }
  updateWeeklyAggregation();
  updateMonthlyAggregation();
}

/**
 * 指定日 (JST) のアカウントインサイトをまとめて取得し、日次シートへ書き込む
 */
function fetchDailyDataForDate(date) {
  const { userId } = getConfig_();
  const dateStr = Utilities.formatDate(date, TZ, 'yyyy-MM-dd');

  // since/until は Unix秒 (JST 00:00 - 24:00)
  const jstMidnight = new Date(`${dateStr}T00:00:00+09:00`);
  const since = Math.floor(jstMidnight.getTime() / 1000);
  const until = since + 24 * 3600;

  // --- 1) アカウントフォロワー数 (スナップショット) ---
  const account = callApi_(`${userId}`, { fields: 'followers_count,media_count' }) || {};
  const followers = account.followers_count || 0;

  // --- 2) 総合 total_value 系メトリクス ---
  // reach (breakdown: follow_type) : follower / non_follower
  const reachJson = callApi_(`${userId}/insights`, {
    metric: 'reach',
    period: 'day',
    metric_type: 'total_value',
    breakdown: 'follow_type',
    since, until,
  });
  const reachTotal = pickTotal_(reachJson, 'reach');
  const reachBD = pickBreakdown_(reachJson, 'reach');
  const reachFollower = reachBD['FOLLOWER'] || 0;
  const reachNonFollower = reachBD['NON_FOLLOWER'] || 0;

  // views (旧 impressions 相当)
  const viewsJson = callApi_(`${userId}/insights`, {
    metric: 'views', period: 'day', metric_type: 'total_value', since, until,
  });
  const views = pickTotal_(viewsJson, 'views');

  // accounts_engaged
  const engagedJson = callApi_(`${userId}/insights`, {
    metric: 'accounts_engaged', period: 'day', metric_type: 'total_value', since, until,
  });
  const accountsEngaged = pickTotal_(engagedJson, 'accounts_engaged');

  // profile_links_taps (外部リンクタップ)
  const linkTapsJson = callApi_(`${userId}/insights`, {
    metric: 'profile_links_taps', period: 'day', metric_type: 'total_value', since, until,
  });
  const linkTaps = pickTotal_(linkTapsJson, 'profile_links_taps');

  // プロフィールアクセス (views の breakdown には含まれないため、別途取得を試行)
  // ※ profile_views は2025年以降廃止されているため、views代用。APIバージョンによって変動。
  let profileViews = 0;
  const pvJson = callApi_(`${userId}/insights`, {
    metric: 'profile_views', period: 'day', since, until,
  });
  profileViews = pickTotal_(pvJson, 'profile_views');

  // follows_and_unfollows (breakdown: follow_type = FOLLOWER / UNFOLLOWER)
  const fuJson = callApi_(`${userId}/insights`, {
    metric: 'follows_and_unfollows', period: 'day',
    metric_type: 'total_value', breakdown: 'follow_type', since, until,
  });
  const fuBD = pickBreakdown_(fuJson, 'follows_and_unfollows');
  const follows = fuBD['FOLLOWER'] || 0;      // 新規フォロー
  const unfollows = fuBD['NON_FOLLOWER'] || 0; // フォロー解除 (API定義に注意)

  // --- 3) メディア種別ごとの breakdown (likes/comments/saves/shares/total_interactions) ---
  const metricsWithMedia = ['likes','comments','saves','shares','total_interactions'];
  const byMedia = {}; // byMedia[metric][mediaType]
  metricsWithMedia.forEach(m => {
    const j = callApi_(`${userId}/insights`, {
      metric: m, period: 'day', metric_type: 'total_value',
      breakdown: 'media_product_type', since, until,
    });
    byMedia[m] = pickBreakdown_(j, m);
  });

  const get = (metric, mp) => (byMedia[metric] && byMedia[metric][mp]) || 0;

  // 投稿 (FEED) : POST+CAROUSEL を表す "FEED"
  const postLikes    = get('likes', 'FEED');
  const postComments = get('comments', 'FEED');
  const postSaves    = get('saves', 'FEED');
  const postShares   = get('shares', 'FEED');
  const postInter    = get('total_interactions', 'FEED');

  // リール (REELS)
  const reelLikes    = get('likes', 'REELS');
  const reelComments = get('comments', 'REELS');
  const reelSaves    = get('saves', 'REELS');
  const reelShares   = get('shares', 'REELS');
  const reelInter    = get('total_interactions', 'REELS');

  // ストーリー (STORY) - シェアしたコンテンツ件数集計用
  // 投稿件数は media エンドポイントで timestamp フィルタして数える
  const sharedCounts = countMediaByType_(userId, dateStr);

  // --- 行を書き込む ---
  const row = [
    dateStr,
    followers,
    '', // 増加数は後で算出
    '', // フォロー数(自アカウントがフォローしている数) - APIでは取得不可
    unfollows,
    accountsEngaged,
    '', // エンゲージ フォロワー内訳は API で直接取れない
    '',
    postInter + reelInter, // トータル インタラクション
    postLikes, postComments, postSaves,
    reelInter, reelLikes, reelComments, reelSaves, reelShares,
    reachTotal, reachFollower, reachNonFollower,
    views, profileViews, linkTaps,
    sharedCounts.post, sharedCounts.story, sharedCounts.reel,
  ];

  upsertDailyRow_(dateStr, row);
  recalcFollowerDiff_();

  SpreadsheetApp.getActive().toast(`${dateStr} のデータを取得しました`, 'Instagram分析', 3);
}

/**
 * その日投稿された media を MEDIA_PRODUCT_TYPE で集計
 */
function countMediaByType_(userId, dateStr) {
  const res = { post: 0, story: 0, reel: 0 };
  const jstStart = new Date(`${dateStr}T00:00:00+09:00`);
  const jstEnd   = new Date(`${dateStr}T23:59:59+09:00`);
  let url = `${userId}/media`;
  let params = { fields: 'id,media_product_type,timestamp', limit: 100 };
  for (let page = 0; page < 10; page++) {
    const j = callApi_(url, params);
    if (!j || !j.data) break;
    let stop = false;
    j.data.forEach(m => {
      const t = new Date(m.timestamp);
      if (t < jstStart) { stop = true; return; }
      if (t > jstEnd) return;
      const mp = m.media_product_type;
      if (mp === 'REELS') res.reel++;
      else if (mp === 'STORY') res.story++;
      else res.post++;
    });
    if (stop || !j.paging || !j.paging.next) break;
    // next URL の cursor だけ取り出す
    const next = j.paging.cursors && j.paging.cursors.after;
    if (!next) break;
    params = Object.assign({}, params, { after: next });
  }
  return res;
}

/** 同日行があれば更新、無ければ追加 */
function upsertDailyRow_(dateStr, row) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.DAILY);
  const last = sh.getLastRow();
  if (last >= 2) {
    const dates = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
    for (let i = 0; i < dates.length; i++) {
      if (dates[i][0] === dateStr) {
        sh.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sh.appendRow(row);
  sh.getRange(sh.getLastRow(), 1).setNumberFormat('yyyy-mm-dd');
}

/** フォロワー増加数を再計算 (前日比) */
function recalcFollowerDiff_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.DAILY);
  const last = sh.getLastRow();
  if (last < 2) return;
  // 日付昇順にソート
  sh.getRange(2, 1, last - 1, DAILY_HEADERS.length).sort({ column: 1, ascending: true });
  const data = sh.getRange(2, 1, last - 1, 3).getValues(); // 日付 / フォロワー / 増加数
  for (let i = 0; i < data.length; i++) {
    if (i === 0) { data[i][2] = ''; continue; }
    const prev = Number(data[i - 1][1]) || 0;
    const cur = Number(data[i][1]) || 0;
    data[i][2] = cur - prev;
  }
  sh.getRange(2, 1, data.length, 3).setValues(data);
}

// ==========================================================
// 週間集計
// ==========================================================
function updateWeeklyAggregation() {
  aggregate_(SHEETS.WEEKLY, 'week');
}
function updateMonthlyAggregation() {
  aggregate_(SHEETS.MONTHLY, 'month');
}

function aggregate_(targetSheetName, unit) {
  const ss = SpreadsheetApp.getActive();
  const src = ss.getSheetByName(SHEETS.DAILY);
  const dst = ss.getSheetByName(targetSheetName);
  const last = src.getLastRow();
  if (last < 2) return;

  const values = src.getRange(2, 1, last - 1, DAILY_HEADERS.length).getValues();

  // 集計のキー: 週 -> 'YYYY-Www'(月曜始まり) / 月 -> 'YYYY-MM'
  const buckets = {}; // key -> { periodLabel, rows: [] }
  values.forEach(r => {
    const d = new Date(r[0]);
    if (isNaN(d.getTime())) return;
    let key, label;
    if (unit === 'week') {
      const monday = new Date(d);
      const day = monday.getDay();
      const diff = (day === 0 ? -6 : 1 - day);
      monday.setDate(monday.getDate() + diff);
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      key = Utilities.formatDate(monday, TZ, 'yyyy-MM-dd');
      label = `${Utilities.formatDate(monday, TZ, 'yyyy/MM/dd')} 〜 ${Utilities.formatDate(sunday, TZ, 'MM/dd')}`;
    } else {
      key = Utilities.formatDate(d, TZ, 'yyyy-MM');
      label = Utilities.formatDate(d, TZ, 'yyyy年MM月');
    }
    if (!buckets[key]) buckets[key] = { label, rows: [] };
    buckets[key].rows.push(r);
  });

  // 集計ロジック:
  //   フォロワー = 期間最終日の値 (スナップショット)
  //   増加数 = 期間最終日フォロワー - 期間初日前日フォロワー (= 期間増加数合計)
  //   その他 = 合計
  const keys = Object.keys(buckets).sort();
  const agg = [];
  const headers = ['期間', ...DAILY_HEADERS.slice(1)];

  keys.forEach(k => {
    const { label, rows } = buckets[k];
    rows.sort((a, b) => new Date(a[0]) - new Date(b[0]));
    const last = rows[rows.length - 1];
    const first = rows[0];

    const snapshotIdx = new Set([1]); // フォロワー列
    const out = [label];
    for (let i = 1; i < DAILY_HEADERS.length; i++) {
      if (snapshotIdx.has(i)) {
        out.push(last[i]);
      } else if (i === 2) {
        // 増加数 = 最終日フォロワー - 初日フォロワー + 初日増加数
        const diff = (Number(last[1]) || 0) - (Number(first[1]) || 0) + (Number(first[2]) || 0);
        out.push(diff);
      } else {
        let sum = 0;
        rows.forEach(r => { const v = Number(r[i]); if (!isNaN(v)) sum += v; });
        out.push(sum);
      }
    }
    agg.push(out);
  });

  dst.clear();
  dst.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground(unit === 'week' ? '#fff2cc' : '#f4cccc');
  if (agg.length) {
    dst.getRange(2, 1, agg.length, headers.length).setValues(agg);
  }
  dst.setFrozenRows(1);
  dst.autoResizeColumns(1, headers.length);
}

// ==========================================================
// トリガー
// ==========================================================
function installDailyTrigger() {
  removeAllTriggers();
  ScriptApp.newTrigger('dailyJob').timeBased().atHour(3).everyDays(1).create();
  SpreadsheetApp.getUi().alert('毎日 03:00 (JST) に自動取得するトリガーを設定しました。');
}

function dailyJob() {
  fetchDailyData();
  updateWeeklyAggregation();
  updateMonthlyAggregation();
}

function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
}
