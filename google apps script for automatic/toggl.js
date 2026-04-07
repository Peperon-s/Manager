// ==========================================
// Toggl Track 連携
// ==========================================

function getTogglHeaders() {
  return {
    "Authorization": "Basic " + Utilities.base64Encode(TOGGL_API_KEY + ":api_token"),
    "Content-Type": "application/json"
  };
}

// ==========================================
// 初回セットアップ用
// この関数を手動実行して、ワークスペースIDをログで確認してください
// ==========================================
function togglSetupWorkspaces() {
  const response = UrlFetchApp.fetch("https://api.track.toggl.com/api/v9/me/workspaces", {
    method: "get",
    headers: getTogglHeaders(),
    muteHttpExceptions: true
  });
  const workspaces = JSON.parse(response.getContentText());
  const info = workspaces.map(w => `"${w.name}": ${w.id}`).join("\n");
  logToSheet("【ワークスペース一覧】\n" + info);
  return info;
}

// ==========================================
// キャッシュ付きでTogglデータを取得する汎用関数（5分キャッシュ）
// ==========================================
function togglFetchCached_(cacheKey, url) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: getTogglHeaders(),
    muteHttpExceptions: true
  });
  const result = JSON.parse(response.getContentText());
  const data = Array.isArray(result) ? result : [];
  cache.put(cacheKey, JSON.stringify(data), 300);
  return data;
}

function togglGetClients(workspaceId) {
  return togglFetchCached_(
    "toggl_clients_" + workspaceId,
    "https://api.track.toggl.com/api/v9/workspaces/" + workspaceId + "/clients"
  );
}

function togglGetProjects(workspaceId) {
  return togglFetchCached_(
    "toggl_projects_" + workspaceId,
    "https://api.track.toggl.com/api/v9/workspaces/" + workspaceId + "/projects"
  );
}

function togglGetTags(workspaceId) {
  return togglFetchCached_(
    "toggl_tags_" + workspaceId,
    "https://api.track.toggl.com/api/v9/workspaces/" + workspaceId + "/tags"
  );
}

// ==========================================
// Gemini向けコンテキスト文字列を構築
// workspaceKey: "lifelog" or "study"
// clientFilter: クライアント名（固定の場合のみ）
// ==========================================
function togglBuildContext(workspaceKey, clientFilter) {
  const wsConfig = TOGGL_WORKSPACES[workspaceKey];
  if (!wsConfig || !wsConfig.id) {
    return {
      text: "⚠️ " + workspaceKey + " のワークスペースIDが未設定です（config.jsを確認）",
      projects: [], tags: [], clients: []
    };
  }

  const wsId = wsConfig.id;
  const clients  = togglGetClients(wsId);
  const projects = togglGetProjects(wsId);
  const tags     = togglGetTags(wsId);

  // クライアントフィルター適用
  let filteredProjects = projects;
  if (clientFilter) {
    const matchedClient = clients.find(function(c) { return c.name === clientFilter; });
    if (matchedClient) {
      filteredProjects = projects.filter(function(p) { return p.client_id === matchedClient.id; });
    }
  }

  const lines = ["ワークスペース: " + wsConfig.name];
  if (clientFilter) lines.push("クライアント: " + clientFilter + "（固定）");

  if (filteredProjects.length > 0) {
    lines.push("プロジェクト:");
    filteredProjects.forEach(function(p) {
      const cn = (clients.find(function(c) { return c.id === p.client_id; }) || {}).name || "";
      lines.push('  - "' + p.name + '"' + (cn ? " [クライアント: " + cn + "]" : ""));
    });
  } else {
    lines.push("プロジェクト: なし");
  }

  if (tags.length > 0) {
    lines.push("タグ: " + tags.map(function(t) { return '"' + t.name + '"'; }).join(", "));
  }

  return { text: lines.join("\n"), projects: filteredProjects, tags: tags, clients: clients };
}

// ==========================================
// プロジェクト名 → ID を解決
// ==========================================
function resolveProjectId(workspaceId, projectName, clientName) {
  if (!projectName) return null;
  const projects = togglGetProjects(workspaceId);

  if (clientName) {
    const clients = togglGetClients(workspaceId);
    const client  = clients.find(function(c) { return c.name === clientName; });
    if (client) {
      const proj = projects.find(function(p) {
        return p.client_id === client.id && p.name === projectName;
      });
      if (proj) return proj.id;
    }
  }

  const proj = projects.find(function(p) { return p.name === projectName; });
  return proj ? proj.id : null;
}

// ==========================================
// タイマー開始
// workspaceId: 数値
// projectId: 数値 or null
// tags: 文字列の配列 or []
// ==========================================
function togglStartTimer(description, workspaceId, projectId, tags) {
  const payload = {
    description:  description || "作業中",
    start:        new Date().toISOString(),
    created_with: "GAS",
    workspace_id: workspaceId,
    duration:     -1
  };
  if (projectId)              payload.project_id = projectId;
  if (tags && tags.length > 0) payload.tags = tags;

  const response = UrlFetchApp.fetch(
    "https://api.track.toggl.com/api/v9/workspaces/" + workspaceId + "/time_entries",
    {
      method: "post",
      headers: getTogglHeaders(),
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }
  );

  const result = JSON.parse(response.getContentText());
  if (!result.id) {
    logToSheet("【Toggl開始エラー】" + JSON.stringify(result));
    throw new Error("タイマーの開始に失敗しました: " + JSON.stringify(result));
  }

  let msg = "✅ タイマー開始！\n作業: " + result.description +
            "\n開始: " + Utilities.formatDate(new Date(result.start), "JST", "HH:mm");

  if (result.project_id) {
    const projects = togglGetProjects(workspaceId);
    const proj = projects.find(function(p) { return p.id === result.project_id; });
    if (proj) msg += "\nプロジェクト: " + proj.name;
  }
  if (result.tags && result.tags.length > 0) {
    msg += "\nタグ: " + result.tags.join(", ");
  }
  return msg;
}

// ==========================================
// 直近N日間のエントリを取得（生データ）
// ==========================================
function togglGetRecentEntries_(days) {
  const now   = new Date();
  const start = new Date(now.getTime() - (days || 7) * 24 * 60 * 60 * 1000);
  const res   = UrlFetchApp.fetch(
    "https://api.track.toggl.com/api/v9/me/time_entries" +
    "?start_date=" + start.toISOString() + "&end_date=" + now.toISOString(),
    { method: "get", headers: getTogglHeaders(), muteHttpExceptions: true }
  );
  const entries = JSON.parse(res.getContentText());
  return Array.isArray(entries) ? entries : [];
}

// 説明文で直近のエントリを検索（完全一致 → 部分一致）
function togglFindEntry_(description, workspaceId) {
  const entries  = togglGetRecentEntries_(3);
  const filtered = workspaceId
    ? entries.filter(function(e) { return e.workspace_id === workspaceId; })
    : entries;
  return filtered.find(function(e) { return e.description === description; }) ||
         filtered.find(function(e) { return e.description && e.description.includes(description); }) ||
         null;
}

// ==========================================
// 記録を編集（説明・開始時間・終了時間を変更）
// ==========================================
function togglEditEntry(description, workspaceKey, newDescription, newStartTime, newStopTime) {
  const wsId  = workspaceKey ? TOGGL_WORKSPACES[workspaceKey].id : null;
  const entry = togglFindEntry_(description, wsId);
  if (!entry) return "⚠️ 「" + description + "」の記録が直近3日以内に見つかりません。";

  const payload = {};
  if (newDescription) payload.description = newDescription;
  if (newStartTime) {
    const startDate = new Date(newStartTime);
    payload.start = startDate.toISOString();
    if (newStopTime) {
      const stopDate = new Date(newStopTime);
      payload.stop     = stopDate.toISOString();
      payload.duration = Math.round((stopDate - startDate) / 1000);
    }
  } else if (newStopTime) {
    const startDate = new Date(entry.start);
    const stopDate  = new Date(newStopTime);
    payload.stop     = stopDate.toISOString();
    payload.duration = Math.round((stopDate - startDate) / 1000);
  }

  const res    = UrlFetchApp.fetch(
    "https://api.track.toggl.com/api/v9/workspaces/" + entry.workspace_id +
    "/time_entries/" + entry.id,
    { method: "put", headers: getTogglHeaders(), payload: JSON.stringify(payload), muteHttpExceptions: true }
  );
  const result = JSON.parse(res.getContentText());
  if (!result.id) throw new Error("記録の編集に失敗しました: " + JSON.stringify(result));

  const fmt = function(d) { return Utilities.formatDate(new Date(d), "JST", "HH:mm"); };
  return "✏️ 記録を編集しました！\n" +
         "作業: " + result.description +
         (result.start ? "\n開始: " + fmt(result.start) : "") +
         (result.stop  ? "　終了: " + fmt(result.stop)  : "");
}

// ==========================================
// 記録を削除
// ==========================================
function togglDeleteEntry(description, workspaceKey) {
  const wsId  = workspaceKey ? TOGGL_WORKSPACES[workspaceKey].id : null;
  const entry = togglFindEntry_(description, wsId);
  if (!entry) return "⚠️ 「" + description + "」の記録が直近3日以内に見つかりません。";

  UrlFetchApp.fetch(
    "https://api.track.toggl.com/api/v9/workspaces/" + entry.workspace_id +
    "/time_entries/" + entry.id,
    { method: "delete", headers: getTogglHeaders(), muteHttpExceptions: true }
  );
  return "🗑️ 記録を削除しました。\n作業: " + entry.description;
}

// ==========================================
// 週次サマリー（直近7日）
// ==========================================
function togglGetWeeklySummary() {
  const entries = togglGetRecentEntries_(7);
  if (!entries.length) return "📊 今週の記録はありません。";

  const wsNames = {};
  Object.keys(TOGGL_WORKSPACES).forEach(function(k) {
    wsNames[TOGGL_WORKSPACES[k].id] = TOGGL_WORKSPACES[k].name;
  });

  function fmtTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? h + "時間" + (m > 0 ? m + "分" : "") : m + "分";
  }

  let totalSec = 0;
  const byWs  = {};
  const byDay = {};

  entries.forEach(function(e) {
    if (e.duration < 0) return; // 実行中タイマーはスキップ
    totalSec += e.duration;

    const wsName = wsNames[e.workspace_id] || "その他";
    byWs[wsName] = (byWs[wsName] || 0) + e.duration;

    const day = Utilities.formatDate(new Date(e.start), "JST", "MM/dd(EEE)");
    byDay[day] = (byDay[day] || 0) + e.duration;
  });

  let msg = "📊 *今週のサマリー（直近7日）*\n合計: " + fmtTime(totalSec) + "\n";

  msg += "\n【ワークスペース別】\n";
  Object.keys(byWs).forEach(function(ws) {
    const pct = Math.round(byWs[ws] / totalSec * 100);
    msg += "  " + ws + ": " + fmtTime(byWs[ws]) + "（" + pct + "%）\n";
  });

  msg += "\n【日別】\n";
  Object.keys(byDay).sort().forEach(function(day) {
    msg += "  " + day + ": " + fmtTime(byDay[day]) + "\n";
  });

  return msg;
}

// ==========================================
// 開始・終了時間を指定して記録を追加
// startTime / stopTime: ISO 8601形式 (例: "2026-03-18T09:00:00+09:00")
// ==========================================
function togglCreateEntry(description, startTime, stopTime, workspaceId, projectId, tags) {
  const startDate = new Date(startTime);
  const stopDate  = new Date(stopTime);
  const duration  = Math.round((stopDate - startDate) / 1000); // 秒数

  if (duration <= 0) {
    throw new Error("終了時間は開始時間より後に設定してください。");
  }

  const payload = {
    description:  description || "記録",
    start:        startDate.toISOString(),
    stop:         stopDate.toISOString(),
    duration:     duration,
    created_with: "GFS",
    workspace_id: workspaceId
  };
  if (projectId)               payload.project_id = projectId;
  if (tags && tags.length > 0) payload.tags = tags;

  const response = UrlFetchApp.fetch(
    "https://api.track.toggl.com/api/v9/workspaces/" + workspaceId + "/time_entries",
    {
      method: "post",
      headers: getTogglHeaders(),
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }
  );

  const result = JSON.parse(response.getContentText());
  if (!result.id) {
    logToSheet("【Toggl手動登録エラー】" + JSON.stringify(result));
    throw new Error("記録の追加に失敗しました: " + JSON.stringify(result));
  }

  const fmt = function(d) { return Utilities.formatDate(d, "JST", "HH:mm"); };
  const mins = Math.round(duration / 60);
  const h    = Math.floor(mins / 60);
  const m    = mins % 60;
  const durationStr = h > 0 ? h + "時間" + (m > 0 ? m + "分" : "") : m + "分";

  let msg = "✅ 記録を追加しました！\n" +
            "作業: " + result.description + "\n" +
            "開始: " + fmt(startDate) + "　終了: " + fmt(stopDate) + "\n" +
            "時間: " + durationStr;
  if (result.project_id) {
    const wsKey = workspaceId === TOGGL_WORKSPACES.study.id ? "study" : "lifelog";
    const projects = togglGetProjects(workspaceId);
    const proj = projects.find(function(p) { return p.id === result.project_id; });
    if (proj) msg += "\nプロジェクト: " + proj.name;
  }
  return msg;
}

// ==========================================
// タイマー停止（実行中のワークスペースを自動判定）
// ==========================================
function togglStopTimer() {
  const currentRes = UrlFetchApp.fetch(
    "https://api.track.toggl.com/api/v9/me/time_entries/current",
    { method: "get", headers: getTogglHeaders(), muteHttpExceptions: true }
  );
  const current = JSON.parse(currentRes.getContentText());
  if (!current || !current.id) return "⚠️ 現在実行中のタイマーはありません。";

  const stopRes = UrlFetchApp.fetch(
    "https://api.track.toggl.com/api/v9/workspaces/" + current.workspace_id +
    "/time_entries/" + current.id + "/stop",
    { method: "patch", headers: getTogglHeaders(), muteHttpExceptions: true }
  );
  const stopped = JSON.parse(stopRes.getContentText());

  const duration = Math.round(stopped.duration / 60);
  let msg = "⏹️ タイマー停止！\n作業: " + stopped.description +
            "\n経過時間: " + duration + "分";
  if (stopped.tags && stopped.tags.length > 0) {
    msg += "\nタグ: " + stopped.tags.join(", ");
  }
  return msg;
}

// ==========================================
// 今日の記録を取得（両ワークスペース統合）
// ==========================================
function togglGetTodayEntries() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const startISO = startOfDay.toISOString();
  const endISO   = now.toISOString();

  const response = UrlFetchApp.fetch(
    "https://api.track.toggl.com/api/v9/me/time_entries" +
    "?start_date=" + encodeURIComponent(startISO) +
    "&end_date="   + encodeURIComponent(endISO),
    { method: "get", headers: getTogglHeaders(), muteHttpExceptions: true }
  );

  const entries = JSON.parse(response.getContentText());
  if (!entries || entries.length === 0) return "📋 今日の記録はまだありません。";

  // ワークスペース名マップ
  const wsMap = {};
  Object.values(TOGGL_WORKSPACES).forEach(function(ws) {
    if (ws.id) wsMap[ws.id] = ws.name;
  });

  let totalSeconds = 0;
  const grouped = {};

  entries.forEach(function(entry) {
    const wsName = wsMap[entry.workspace_id] || ("WS-" + entry.workspace_id);
    if (!grouped[wsName]) grouped[wsName] = [];
    const dur = entry.duration > 0
      ? entry.duration
      : Math.round((Date.now() / 1000) + entry.duration);
    totalSeconds += Math.max(0, dur);
    grouped[wsName].push({ entry: entry, dur: dur });
  });

  let list = "📋 今日の作業記録：\n";
  Object.keys(grouped).forEach(function(wsName) {
    list += "\n【" + wsName + "】\n";
    grouped[wsName]
      .sort(function(a, b) { return new Date(a.entry.start) - new Date(b.entry.start); })
      .forEach(function(item) {
        const min     = Math.round(item.dur / 60);
        const startStr = Utilities.formatDate(new Date(item.entry.start), "JST", "HH:mm");
        const tags    = (item.entry.tags && item.entry.tags.length > 0)
          ? " [" + item.entry.tags.join(", ") + "]" : "";
        list += "- " + startStr + " [" + min + "分] " +
                (item.entry.description || "（タイトルなし）") + tags + "\n";
      });
  });

  const totalMin = Math.floor(totalSeconds / 60);
  list += "\n⏱️ 合計: " + Math.floor(totalMin / 60) + "時間" + (totalMin % 60) + "分";
  return list;
}
