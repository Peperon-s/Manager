// ==========================================
// 学習進捗スプレッドシート管理
// NotebookLM → Google Docs → スプレッドシート フロー
// ==========================================

// ==========================================
// 進捗表を新規作成
// rows: [{chapter, problemId, type}]
// ==========================================
function createProgressSheet(title, subject, rows) {
  const ss    = SpreadsheetApp.create(title);
  const sheet = ss.getActiveSheet();
  sheet.setName("進捗");

  // ── ヘッダー ──────────────────────────────
  const headers = ["章", "問題番号", "種別", "状態", "完了日", "メモ"];
  const hRange  = sheet.getRange(1, 1, 1, headers.length);
  hRange.setValues([headers]);
  hRange.setFontWeight("bold");
  hRange.setBackground("#1a73e8");
  hRange.setFontColor("#ffffff");
  sheet.setFrozenRows(1);

  // ── データ行 ──────────────────────────────
  if (rows && rows.length > 0) {
    const data = rows.map(function(r) {
      return [r.chapter || "", r.problemId || "", r.type || "", "⬜ 未着手", "", ""];
    });
    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  }

  // ── 列幅 ──────────────────────────────────
  sheet.setColumnWidth(1, 160);  // 章
  sheet.setColumnWidth(2, 120);  // 問題番号
  sheet.setColumnWidth(3, 80);   // 種別
  sheet.setColumnWidth(4, 100);  // 状態
  sheet.setColumnWidth(5, 85);   // 完了日
  sheet.setColumnWidth(6, 200);  // メモ

  // ── 科目名 → URL をScript Propertiesに保存 ──
  const props = PropertiesService.getScriptProperties();
  const map   = JSON.parse(props.getProperty("PROGRESS_SHEETS") || "{}");
  map[subject] = ss.getUrl();
  props.setProperty("PROGRESS_SHEETS", JSON.stringify(map));

  logToSheet("【進捗表作成】" + title + " (" + subject + ") " + (rows ? rows.length : 0) + "問");

  return "✅ 進捗表を作成しました！\n" +
         "科目: " + subject + "\n" +
         "問題数: " + (rows ? rows.length : 0) + "問\n" +
         "URL: " + ss.getUrl();
}

// ==========================================
// 進捗を更新
// problems: 文字列配列（問題番号）
// status: "✅ 完了" / "🔄 進行中" / "⬜ 未着手"
// ==========================================
function updateProgressSheet(subject, problems, status, note) {
  const url = getProgressSheetUrl_(subject);
  if (!url) return "⚠️ 「" + subject + "」の進捗表が見つかりません。\n先に進捗表を作成してください。";

  const ss    = SpreadsheetApp.openByUrl(url);
  const sheet = ss.getSheetByName("進捗");
  if (!sheet) return "⚠️ 「進捗」シートが見つかりません。";

  const data      = sheet.getDataRange().getValues();
  const statusStr = status || "✅ 完了";
  const today     = Utilities.formatDate(new Date(), "JST", "yyyy/MM/dd");
  let   updated   = 0;

  problems.forEach(function(probId) {
    probId = String(probId).trim();
    for (var i = 1; i < data.length; i++) {
      const cell = String(data[i][1]).trim();
      if (cell === probId || cell.includes(probId) || probId.includes(cell)) {
        sheet.getRange(i + 1, 4).setValue(statusStr);
        sheet.getRange(i + 1, 5).setValue(today);
        if (note) sheet.getRange(i + 1, 6).setValue(note);
        updated++;
        break;
      }
    }
  });

  return "📝 進捗を更新しました！\n" +
         "科目: " + subject + "\n" +
         "更新: " + updated + "問（" + statusStr + "）" +
         (updated < problems.length ? "\n⚠️ " + (problems.length - updated) + "問が見つかりませんでした。" : "");
}

// ==========================================
// 進捗サマリーを取得
// subject: 科目名（省略時は全科目）
// ==========================================
function getProgressSummary(subject) {
  const props = PropertiesService.getScriptProperties();
  const map   = JSON.parse(props.getProperty("PROGRESS_SHEETS") || "{}");

  if (!Object.keys(map).length) return "📊 進捗表はまだ作成されていません。";

  if (subject) {
    const url = map[subject];
    if (!url) return "⚠️ 「" + subject + "」の進捗表が見つかりません。";
    return buildProgressSummary_(subject, url);
  }

  return Object.keys(map).map(function(s) {
    return buildProgressSummary_(s, map[s]);
  }).join("\n─────────────\n");
}

function buildProgressSummary_(subject, url) {
  try {
    const ss    = SpreadsheetApp.openByUrl(url);
    const sheet = ss.getSheetByName("進捗");
    if (!sheet) return "⚠️ シートが見つかりません: " + subject;

    const data  = sheet.getDataRange().getValues().slice(1); // ヘッダー除く
    const total = data.length;
    const done  = data.filter(function(r) { return String(r[3]).includes("✅"); }).length;
    const wip   = data.filter(function(r) { return String(r[3]).includes("🔄"); }).length;
    const todo  = total - done - wip;
    const pct   = total > 0 ? Math.round(done / total * 100) : 0;

    const bar = buildProgressBar_(pct);
    return "📊 *" + subject + "* の進捗\n" +
           bar + " " + pct + "%\n" +
           "✅ 完了: " + done + "問　🔄 進行中: " + wip + "問　⬜ 未着手: " + todo + "問（計" + total + "問）\n" +
           "URL: " + url;
  } catch (e) {
    return "⚠️ " + subject + " の進捗表を開けませんでした: " + e.message;
  }
}

function buildProgressBar_(pct) {
  const filled = Math.round(pct / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

// ==========================================
// 進捗表一覧を表示
// ==========================================
function listProgressSheets() {
  const props = PropertiesService.getScriptProperties();
  const map   = JSON.parse(props.getProperty("PROGRESS_SHEETS") || "{}");

  if (!Object.keys(map).length) return "📋 進捗表はまだ作成されていません。";

  let msg = "📋 *作成済み進捗表一覧*\n";
  Object.keys(map).forEach(function(subject) {
    msg += "\n・" + subject + "\n  " + map[subject] + "\n";
  });
  return msg;
}

// ==========================================
// Google Docs を読み込むヘルパー
// ==========================================
function readGoogleDocText_(docUrl) {
  const docId = extractDocId_(docUrl);
  const doc   = DocumentApp.openById(docId);
  return doc.getBody().getText();
}

// Docsフォルダの最新ファイルを取得
function readLatestDocFromFolder_() {
  if (!NOTEBOOKLM_DOCS_FOLDER_ID) throw new Error("NOTEBOOKLM_DOCS_FOLDER_ID が config.js に設定されていません。");
  const folder = DriveApp.getFolderById(NOTEBOOKLM_DOCS_FOLDER_ID);
  const files  = folder.getFilesByType(MimeType.GOOGLE_DOCS);
  let   latest = null;
  while (files.hasNext()) {
    const f = files.next();
    if (!latest || f.getLastUpdated() > latest.getLastUpdated()) latest = f;
  }
  if (!latest) throw new Error("フォルダにGoogle Docsファイルが見つかりません。");
  return {
    name: latest.getName(),
    text: DocumentApp.openById(latest.getId()).getBody().getText()
  };
}

// URLからDocIDを抽出
function extractDocId_(url) {
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error("Google DocsのURLが正しくありません: " + url);
  return m[1];
}

// メッセージ中のGoogle Docs URLを検出
function extractDocUrlFromMessage_(message) {
  const m = message.match(/https:\/\/docs\.google\.com\/document\/d\/[a-zA-Z0-9_-]+[^\s]*/);
  return m ? m[0] : null;
}

// 科目名からURLを取得
function getProgressSheetUrl_(subject) {
  const props = PropertiesService.getScriptProperties();
  const map   = JSON.parse(props.getProperty("PROGRESS_SHEETS") || "{}");
  return map[subject] || null;
}
