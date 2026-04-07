// ==========================================
// GFS Dashboard WebApp
// ==========================================

// WebApp エントリーポイント（GASの旧UI用 / GitHub Pages移行後は不要になる）
function doGet(e) {
  return HtmlService.createTemplateFromFile("dashboard")
    .evaluate()
    .setTitle("Manager")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==========================================
// REST API エンドポイント（GitHub Pages フロントエンド用）
// POST body: { action: "...", ...params }
// ==========================================
function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var action = params.action;
    var result;

    switch (action) {
      case 'getClientConfig':
        result = getClientConfig();
        break;

      case 'verifyToken':
        var email = verifyToken(params.token);
        result = { email: email || null };
        break;

      case 'loginWithPassword':
        result = loginWithPassword(params.email, params.password);
        break;

      case 'registerWithPassword':
        result = registerWithPassword(params.email, params.password, params.name);
        break;

      case 'verifyGoogleCredential':
        result = verifyGoogleCredential(params.credential);
        break;

      case 'registerWithGoogle':
        result = registerWithGoogle(params.credential, params.name);
        break;

      case 'getDashboardData':
        result = JSON.parse(getDashboardData());
        break;

      case 'processChatMessage':
        result = processChatMessage(params.message, params.history || []);
        break;

      case 'getSettingsData':
        result = getSettingsData(params.token);
        break;

      case 'updateSettingsData':
        result = updateSettingsData(params.token, params.settings);
        break;

      case 'changePassword':
        result = changePassword(params.token, params.oldPassword, params.newPassword);
        break;

      case 'logoutUser':
        logoutUser(params.token);
        result = { success: true };
        break;

      default:
        result = { error: 'Unknown action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    logToSheet('【doPost Error】' + err.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// クライアントにGOOGLE_CLIENT_IDを渡す（PropertiesService優先）
function getClientConfig() {
  var id = PropertiesService.getScriptProperties().getProperty("GOOGLE_CLIENT_ID") || GOOGLE_CLIENT_ID;
  return { googleClientId: id };
}

// ==========================================
// ダッシュボードデータ集約
// クライアントJSから google.script.run で呼び出す
// ==========================================
function getDashboardData() {
  try {
    const now = new Date();
    return JSON.stringify({
      date:      Utilities.formatDate(now, "JST", "yyyy/MM/dd"),
      dayOfWeek: Utilities.formatDate(now, "JST", "EEE"),
      time:      Utilities.formatDate(now, "JST", "HH:mm"),
      toggl:     getTogglDashData_(),
      calendar:  getCalendarDashData_(),
      tasks:     getTasksDashData_(),
      progress:  getProgressDashData_()
    });
  } catch (e) {
    logToSheet("【Dashboard Error】" + e.toString());
    return JSON.stringify({ error: e.message });
  }
}

// ==========================================
// Toggl データ（今日の記録 + 実行中タイマー）
// ==========================================
function getTogglDashData_() {
  try {
    const now        = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const res        = UrlFetchApp.fetch(
      "https://api.track.toggl.com/api/v9/me/time_entries" +
      "?start_date=" + startOfDay.toISOString() + "&end_date=" + now.toISOString(),
      { method: "get", headers: getTogglHeaders(), muteHttpExceptions: true }
    );
    const entries = JSON.parse(res.getContentText());
    if (!Array.isArray(entries)) return { byWorkspace: [], totalFormatted: "0分", running: null };

    const wsNames = {};
    Object.keys(TOGGL_WORKSPACES).forEach(function(k) {
      wsNames[TOGGL_WORKSPACES[k].id] = TOGGL_WORKSPACES[k].name;
    });

    // 実行中タイマーを抽出
    let running = null;
    const completed = entries.filter(function(e) {
      if (e.duration < 0) {
        const elapsedSec = Math.round(Date.now() / 1000 + e.duration);
        running = {
          description:    e.description || "作業中",
          elapsedSeconds: elapsedSec,
          workspace:      wsNames[e.workspace_id] || "不明"
        };
        return false;
      }
      return true;
    });

    // ワークスペース別集計
    const byWs = {};
    let totalSec = 0;
    completed.forEach(function(e) {
      const ws = wsNames[e.workspace_id] || "その他";
      byWs[ws] = (byWs[ws] || 0) + e.duration;
      totalSec += e.duration;
    });

    return {
      byWorkspace: Object.keys(byWs).map(function(ws) {
        return { workspace: ws, seconds: byWs[ws], formatted: dashFmtDuration_(byWs[ws]) };
      }),
      total:          totalSec,
      totalFormatted: dashFmtDuration_(totalSec),
      running:        running
    };
  } catch (e) {
    return { byWorkspace: [], totalFormatted: "取得エラー", running: null, error: e.message };
  }
}

// ==========================================
// Calendar データ（今日 + 直近7日）
// ==========================================
function getCalendarDashData_() {
  try {
    const now      = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const weekEnd  = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const todayArr = [], upcomingArr = [];

    CalendarApp.getAllCalendars().forEach(function(cal) {
      if (cal.getName().includes("祝日")) return;
      cal.getEvents(now, weekEnd).forEach(function(ev) {
        const start   = ev.getStartTime();
        const isToday = start <= todayEnd;
        const item = {
          title:    ev.getTitle(),
          start:    Utilities.formatDate(start, "JST", "HH:mm"),
          date:     Utilities.formatDate(start, "JST", "MM/dd(EEE)"),
          calendar: cal.getName()
        };
        if (isToday) todayArr.push(item);
        else         upcomingArr.push(item);
      });
    });

    upcomingArr.sort(function(a, b) {
      return (a.date + a.start).localeCompare(b.date + b.start);
    });
    return { today: todayArr.slice(0, 5), upcoming: upcomingArr.slice(0, 5) };
  } catch (e) {
    return { today: [], upcoming: [], error: e.message };
  }
}

// ==========================================
// Todoist データ（優先度別）
// ==========================================
function getTasksDashData_() {
  try {
    const tasks   = todoistGetTasks_(null);
    const byPriority = { p1: [], p2: [], p3: [], p4: [] };
    const labelMap   = { 4: "p1", 3: "p2", 2: "p3", 1: "p4" };

    tasks.forEach(function(t) {
      const key = labelMap[t.priority] || "p4";
      byPriority[key].push({ content: t.content, due: t.due ? t.due.date : null });
    });

    return { byPriority: byPriority, total: tasks.length };
  } catch (e) {
    return { byPriority: { p1: [], p2: [], p3: [], p4: [] }, total: 0, error: e.message };
  }
}

// ==========================================
// 学習進捗データ
// ==========================================
function getProgressDashData_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const map   = JSON.parse(props.getProperty("PROGRESS_SHEETS") || "{}");
    if (!Object.keys(map).length) return [];

    return Object.keys(map).map(function(subject) {
      try {
        const sheet = SpreadsheetApp.openByUrl(map[subject]).getSheetByName("進捗");
        if (!sheet) return { subject: subject, error: true };
        const data  = sheet.getDataRange().getValues().slice(1);
        const total = data.length;
        const done  = data.filter(function(r) { return String(r[3]).includes("✅"); }).length;
        const wip   = data.filter(function(r) { return String(r[3]).includes("🔄"); }).length;
        return { subject: subject, total: total, done: done, wip: wip,
                 pct: total > 0 ? Math.round(done / total * 100) : 0 };
      } catch (_) {
        return { subject: subject, error: true };
      }
    });
  } catch (e) { return []; }
}

// 秒数 → "X時間Y分" フォーマット
function dashFmtDuration_(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? h + "h " + (m > 0 ? m + "m" : "") : m + "m";
}

// ==========================================
// ダッシュボードコマンドの判定
// ==========================================
function isDashboardCommand_(message) {
  const lower = message.toLowerCase().trim();
  return ["ダッシュボード", "dashboard", "dash", "db"].indexOf(lower) !== -1;
}

// ==========================================
// Slack サマリー生成
// ==========================================
function buildDashboardMessage_() {
  const now  = new Date();
  const date = Utilities.formatDate(now, "JST", "yyyy/MM/dd (EEE)");
  const time = Utilities.formatDate(now, "JST", "HH:mm");

  let msg = "📊 *GFS ダッシュボード*  " + date + "  " + time + "\n";
  msg += "━━━━━━━━━━━━━━━━━━\n";

  // Toggl
  try {
    const t = getTogglDashData_();
    msg += "\n⏱ *TIME TRACKER*\n";
    if (t.running) {
      const s = t.running.elapsedSeconds;
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      const elapsed = (h > 0 ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
      msg += "  🟢 " + t.running.description + "  `" + elapsed + "`\n";
    }
    t.byWorkspace.forEach(function(ws) {
      msg += "  " + ws.workspace + ":  *" + ws.formatted + "*\n";
    });
    msg += "  合計:  *" + t.totalFormatted + "*\n";
  } catch (e) { msg += "  ⚠️ 取得エラー\n"; }

  // Calendar
  try {
    const c = getCalendarDashData_();
    msg += "\n📅 *CALENDAR*\n";
    if (c.today.length) {
      c.today.forEach(function(ev) { msg += "  *今日*  " + ev.start + "  " + ev.title + "\n"; });
    }
    if (c.upcoming.length) {
      c.upcoming.slice(0, 3).forEach(function(ev) {
        msg += "  " + ev.date + "  " + ev.start + "  " + ev.title + "\n";
      });
    }
    if (!c.today.length && !c.upcoming.length) msg += "  予定なし\n";
  } catch (e) { msg += "  ⚠️ 取得エラー\n"; }

  // Tasks
  try {
    const tk = getTasksDashData_();
    msg += "\n✅ *TASKS*  （" + tk.total + "件）\n";
    const emoji = { p1: "🔴", p2: "🟠", p3: "🔵", p4: "⚪" };
    ["p1", "p2", "p3"].forEach(function(p) {
      tk.byPriority[p].slice(0, 3).forEach(function(t) {
        msg += "  " + emoji[p] + "  " + t.content + (t.due ? "  _" + t.due + "_" : "") + "\n";
      });
    });
    if (tk.total === 0) msg += "  タスクなし\n";
  } catch (e) { msg += "  ⚠️ 取得エラー\n"; }

  // Progress
  try {
    const pg = getProgressDashData_();
    if (pg.length) {
      msg += "\n📖 *STUDY PROGRESS*\n";
      pg.forEach(function(p) {
        if (p.error) return;
        const filled = Math.round(p.pct / 10);
        const bar    = "█".repeat(filled) + "░".repeat(10 - filled);
        msg += "  *" + p.subject + "*  " + bar + "  " + p.pct + "%\n";
        msg += "  " + p.done + " / " + p.total + "問完了\n";
      });
    }
  } catch (e) { msg += "  ⚠️ 取得エラー\n"; }

  msg += "\n━━━━━━━━━━━━━━━━━━";
  msg += "\n━━━━━━━━━━━━━━━━━━";
  if (typeof WEBAPP_URL !== 'undefined' && WEBAPP_URL) msg += "\n🔗 <" + WEBAPP_URL + "|ダッシュボードを開く>";
  return msg;
}

// ==========================================
// WebApp チャット受信用エンドポイント
// ==========================================
function processChatMessage(userText, history) {
  try {
    // 認証不要、すでにPIN突破済みのクライアントからのみ呼ばれる前提
    return handleWebChatMessage_(userText, history);
  } catch (e) {
    logToSheet("【Chat Error】" + e.toString());
    return { error: e.message };
  }
}
