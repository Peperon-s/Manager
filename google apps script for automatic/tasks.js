// ==========================================
// Todoist 連携（REST API v2）
// ==========================================

function getTodoistHeaders_() {
  return {
    "Authorization": "Bearer " + TODOIST_API_TOKEN,
    "Content-Type": "application/json"
  };
}

// JSONパースに失敗したときにログを出して原因を特定するヘルパー
function safeParseJson_(text, label) {
  try {
    return JSON.parse(text);
  } catch (e) {
    logToSheet("【Todoist JSONパースエラー: " + label + "】" + text.substring(0, 200));
    throw new Error("Todoistから予期しない応答がありました。ログを確認してください。");
  }
}

// ==========================================
// プロジェクト一覧を取得（5分キャッシュ）
// ==========================================
function todoistGetProjects() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get("todoist_projects");
  if (cached) return JSON.parse(cached);

  const res      = UrlFetchApp.fetch("https://api.todoist.com/api/v1/projects", {
    headers: getTodoistHeaders_(),
    muteHttpExceptions: true
  });
  const body = safeParseJson_(res.getContentText(), "todoistGetProjects");
  // 配列 or { results: [...] } or { items: [...] } に対応
  const data = Array.isArray(body) ? body
    : (body && Array.isArray(body.results) ? body.results
    : (body && Array.isArray(body.items)   ? body.items : []));
  cache.put("todoist_projects", JSON.stringify(data), 300);
  return data;
}

// プロジェクト名 → ID を解決（null の場合は Inbox 扱い）
function resolveTodoistProjectId_(projectName) {
  if (!projectName) return null;
  const projects = todoistGetProjects();
  const found    = projects.find(function(p) {
    return p.name === projectName || p.name.includes(projectName);
  });
  return found ? found.id : null;
}

// プロジェクトIDマップを生成
function buildProjectMap_() {
  const map = {};
  todoistGetProjects().forEach(function(p) { map[p.id] = p.name; });
  return map;
}

// ==========================================
// タスク一覧を取得（プロジェクト指定可）
// Todoist API v1 はページネーション形式 { results: [...], next_cursor: ... } を返す場合がある
// ==========================================
function todoistGetTasks_(projectName) {
  var url = "https://api.todoist.com/api/v1/tasks";
  var params = [];
  if (projectName) {
    var projectId = resolveTodoistProjectId_(projectName);
    if (projectId) params.push("project_id=" + projectId);
  }
  params.push("limit=200"); // 最大件数を明示
  if (params.length) url += "?" + params.join("&");

  var res  = UrlFetchApp.fetch(url, { headers: getTodoistHeaders_(), muteHttpExceptions: true });
  var body = safeParseJson_(res.getContentText(), "todoistGetTasks");

  // 旧形式: 配列がそのまま返ってくる場合
  if (Array.isArray(body)) return body;
  // 新形式: { results: [...], next_cursor: ... }
  if (body && Array.isArray(body.results)) return body.results;
  // items キーの場合
  if (body && Array.isArray(body.items)) return body.items;

  logToSheet("【todoistGetTasks_ 不明な形式】" + JSON.stringify(body).substring(0, 200));
  return [];
}

// ==========================================
// 優先度ラベル → Todoist API の数値に変換
// Todoist API: 4=p1(緊急), 3=p2(高), 2=p3(中), 1=p4(通常)
// ==========================================
var PRIORITY_MAP_ = { "p1": 4, "p2": 3, "p3": 2, "p4": 1 };
var PRIORITY_LABEL_ = { 4: "🔴 p1(緊急)", 3: "🟠 p2(高)", 2: "🔵 p3(中)", 1: "⚪ p4(通常)" };

// ==========================================
// タスク追加
// ==========================================
function tasksCreate(title, notes, dueDate, projectName, priority) {
  var payload = { content: title };
  if (notes)     payload.description = notes;
  if (dueDate)   payload.due_date    = dueDate;  // "YYYY-MM-DD"
  if (priority)  payload.priority    = PRIORITY_MAP_[priority] || 1;

  var projectId = resolveTodoistProjectId_(projectName);
  if (projectId) payload.project_id = projectId;

  var res    = UrlFetchApp.fetch("https://api.todoist.com/api/v1/tasks", {
    method:  "post",
    headers: getTodoistHeaders_(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var result = safeParseJson_(res.getContentText(), "tasksCreate");
  if (!result.id) throw new Error("タスクの追加に失敗しました: " + JSON.stringify(result));

  var msg = "✅ タスクを追加しました！\nタスク: " + result.content;
  if (result.due)      msg += "\n期限: " + result.due.date;
  if (result.priority) msg += "\n優先度: " + (PRIORITY_LABEL_[result.priority] || result.priority);

  var projects = todoistGetProjects();
  var proj     = projects.find(function(p) { return p.id === result.project_id; });
  if (proj) msg += "\nプロジェクト: " + proj.name;

  return msg;
}

// ==========================================
// 複数タスクをまとめて追加
// ==========================================
function tasksCreateMultiple(taskList) {
  var results = [];
  taskList.forEach(function(t) {
    try {
      var msg = tasksCreate(t.title, t.notes || null, t.dueDate || null, t.projectName || null, t.priority || null);
      results.push(msg);
    } catch (e) {
      results.push("❌ 失敗: " + t.title + "（" + e.message + "）");
    }
  });
  return results.join("\n─────────────\n");
}

// ==========================================
// タスク一覧表示
// ==========================================
function tasksList(projectName) {
  var tasks = todoistGetTasks_(projectName);
  if (!tasks.length) return "📋 タスクはありません。";

  var projectMap = buildProjectMap_();

  // プロジェクト別にグループ化
  var grouped = {};
  tasks.forEach(function(task) {
    var projName = projectMap[task.project_id] || "Inbox";
    if (!grouped[projName]) grouped[projName] = [];
    grouped[projName].push(task);
  });

  var output = "📋 タスク一覧：\n";
  Object.keys(grouped).forEach(function(proj) {
    output += "\n【" + proj + "】\n";
    grouped[proj].forEach(function(task) {
      var due = task.due ? "（期限: " + task.due.date + "）" : "";
      output += "- " + task.content + " " + due + "\n";
    });
  });
  return output;
}

// ==========================================
// タスクを完了にする
// ==========================================
function tasksComplete(taskTitle, projectName) {
  var tasks = todoistGetTasks_(projectName);
  var task  = tasks.find(function(t) {
    return t.content === taskTitle || t.content.includes(taskTitle);
  });
  if (!task) return "⚠️ タスク「" + taskTitle + "」が見つかりません。";

  UrlFetchApp.fetch("https://api.todoist.com/api/v1/tasks/" + task.id + "/close", {
    method:  "post",
    headers: getTodoistHeaders_(),
    muteHttpExceptions: true
  });
  return "✅ タスクを完了しました！\nタスク: " + task.content;
}

// ==========================================
// 期限を設定・変更する
// ==========================================
function tasksSetDue(taskTitle, dueDate, projectName) {
  var tasks = todoistGetTasks_(projectName);
  var task  = tasks.find(function(t) {
    return t.content === taskTitle || t.content.includes(taskTitle);
  });
  if (!task) return "⚠️ タスク「" + taskTitle + "」が見つかりません。";

  UrlFetchApp.fetch("https://api.todoist.com/api/v1/tasks/" + task.id, {
    method:  "post",
    headers: getTodoistHeaders_(),
    payload: JSON.stringify({ due_date: dueDate }),
    muteHttpExceptions: true
  });
  return "📅 期限を設定しました！\nタスク: " + task.content + "\n期限: " + dueDate;
}

// ==========================================
// タスクを編集（タイトル・メモ・期限・優先度・プロジェクトを変更）
// ==========================================
function tasksUpdate(taskTitle, newTitle, newNotes, newDueDate, newProjectName, newPriority) {
  var tasks = todoistGetTasks_(null); // 全タスクから検索
  var task  = tasks.find(function(t) {
    return t.content === taskTitle || t.content.includes(taskTitle);
  });
  if (!task) return "⚠️ タスク「" + taskTitle + "」が見つかりません。";

  var payload = {};
  if (newTitle)       payload.content     = newTitle;
  if (newNotes)       payload.description = newNotes;
  if (newDueDate)     payload.due_date    = newDueDate;
  if (newPriority)    payload.priority    = PRIORITY_MAP_[newPriority] || task.priority;
  if (newProjectName) {
    var projectId = resolveTodoistProjectId_(newProjectName);
    if (projectId) payload.project_id = projectId;
  }
  if (Object.keys(payload).length === 0) return "⚠️ 変更内容が指定されていません。";

  var res        = UrlFetchApp.fetch("https://api.todoist.com/api/v1/tasks/" + task.id, {
    method:  "post",
    headers: getTodoistHeaders_(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var statusCode = res.getResponseCode();
  var bodyText   = res.getContentText();

  // 200 or 204 を成功とみなす（APIによって返却形式が異なる）
  if (statusCode !== 200 && statusCode !== 204) {
    logToSheet("【tasksUpdate HTTPエラー】" + statusCode + ": " + bodyText.substring(0, 200));
    throw new Error("タスクの編集に失敗しました (HTTP " + statusCode + "): " + bodyText.substring(0, 100));
  }

  // レスポンスがある場合はパース、ない場合は更新後のタスクを再取得
  var result = null;
  if (bodyText && bodyText.trim().length > 0) {
    result = safeParseJson_(bodyText, "tasksUpdate");
  }
  if (!result || !result.id) {
    // 204 No Content などの場合は再取得
    var getRes = UrlFetchApp.fetch("https://api.todoist.com/api/v1/tasks/" + task.id, {
      headers: getTodoistHeaders_(),
      muteHttpExceptions: true
    });
    result = safeParseJson_(getRes.getContentText(), "tasksUpdate_get");
  }
  if (!result || !result.id) throw new Error("タスクの編集に失敗しました。");

  var msg = "✏️ タスクを編集しました！\nタスク: " + result.content;
  if (result.due)      msg += "\n期限: " + result.due.date;
  if (result.priority) msg += "\n優先度: " + (PRIORITY_LABEL_[result.priority] || result.priority);
  var proj = todoistGetProjects().find(function(p) { return p.id === result.project_id; });
  if (proj) msg += "\nプロジェクト: " + proj.name;
  return msg;
}

// ==========================================
// Gemini向けコンテキスト文字列を構築
// ==========================================
function tasksBuildContext() {
  var projects = todoistGetProjects();
  if (!projects.length) return "プロジェクトなし";

  var lines = ["利用可能なTodoistプロジェクト:"];
  projects.forEach(function(p) {
    lines.push('  - "' + p.name + '"');
  });
  return lines.join("\n");
}
