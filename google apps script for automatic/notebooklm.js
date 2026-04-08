// ==========================================
// NotebookLM Enterprise API 連携
// ==========================================

function nlmHeaders_() {
  return {
    "Authorization": "Bearer " + ScriptApp.getOAuthToken(),
    "Content-Type": "application/json"
  };
}

function nlmFetch_(path, method, body) {
  var url     = NOTEBOOKLM_BASE_URL + (path || "");
  var options = { method: method || "get", headers: nlmHeaders_(), muteHttpExceptions: true };
  if (body) options.payload = JSON.stringify(body);
  var res  = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  var json = JSON.parse(res.getContentText());
  if (code >= 400) throw new Error(json.error ? json.error.message : "HTTP " + code);
  return json;
}

// ==========================================
// ノートブック作成
// ==========================================
function notebookLMCreate(title) {
  var res = nlmFetch_("", "post", { title: title });
  var id  = res.name ? res.name.split("/").pop() : null;
  if (!id) throw new Error("ノートブックの作成に失敗しました");
  return "📓 NotebookLM にノートブックを作成しました！\n"
       + "タイトル: " + res.title + "\n"
       + "ID: " + id + "\n"
       + "URL: https://notebooklm.google.com/notebook/" + id;
}

// ==========================================
// ノートブック一覧（最近閲覧）
// ==========================================
function notebookLMList() {
  var res      = nlmFetch_(":listRecentlyViewed", "get");
  var notebooks = res.notebooks || [];
  if (!notebooks.length) return "📓 ノートブックはまだありません。";
  var lines = ["📓 最近のノートブック一覧："];
  notebooks.forEach(function(nb) {
    var id = nb.name ? nb.name.split("/").pop() : "?";
    lines.push("• " + (nb.title || "無題") + "\n  ID: " + id
      + "\n  URL: https://notebooklm.google.com/notebook/" + id);
  });
  return lines.join("\n");
}

// ==========================================
// ソース追加（URL / テキスト / Google Drive）
// ==========================================
function notebookLMAddSource(notebookId, sourceType, content, title) {
  var userContent = {};
  if (sourceType === "url") {
    userContent.webContent = { uri: content };
  } else if (sourceType === "text") {
    userContent.textContent = { title: title || "テキストソース", text: content };
  } else if (sourceType === "drive") {
    // content に Google Drive ファイル ID を渡す
    userContent.googleDriveContent = { resourceId: content };
  } else {
    throw new Error("sourceType は url / text / drive のいずれかを指定してください");
  }

  nlmFetch_("/" + notebookId + "/sources:batchCreate", "post",
    { userContents: [userContent] });

  return "✅ ソースを追加しました！\n"
       + "ノートブック ID: " + notebookId + "\n"
       + "種別: " + sourceType + "\n"
       + "内容: " + content.substring(0, 80) + (content.length > 80 ? "..." : "");
}

// ==========================================
// ノートブック削除
// ==========================================
function notebookLMDelete(notebookId) {
  var name = NOTEBOOKLM_BASE_URL + "/" + notebookId;
  name = name.replace("https://", "").replace("global-discoveryengine.googleapis.com/", "");
  // name形式: v1alpha/projects/.../notebooks/ID
  nlmFetch_(":batchDelete", "post", { names: [
    "projects/" + NOTEBOOKLM_PROJECT_NUMBER + "/locations/" + NOTEBOOKLM_LOCATION + "/notebooks/" + notebookId
  ]});
  return "🗑 ノートブック（" + notebookId + "）を削除しました。";
}

// ==========================================
// ダッシュボード用データ取得
// ==========================================
function notebookLMDashData_() {
  try {
    var res       = nlmFetch_(":listRecentlyViewed", "get");
    var notebooks = (res.notebooks || []).slice(0, 6).map(function(nb) {
      var id = nb.name ? nb.name.split("/").pop() : "";
      return { id: id, title: nb.title || "無題" };
    });
    return { notebooks: notebooks, total: (res.notebooks || []).length };
  } catch (e) {
    return { notebooks: [], total: 0, error: e.message };
  }
}

// ==========================================
// AI コンテキスト用文字列
// ==========================================
function notebookLMBuildContext_() {
  try {
    var res       = nlmFetch_(":listRecentlyViewed", "get");
    var notebooks = res.notebooks || [];
    if (!notebooks.length) return "NotebookLM: ノートブックなし";
    var lines = ["利用可能な NotebookLM ノートブック:"];
    notebooks.slice(0, 10).forEach(function(nb) {
      var id = nb.name ? nb.name.split("/").pop() : "?";
      lines.push('  - "' + (nb.title || "無題") + '" (ID: ' + id + ')');
    });
    return lines.join("\n");
  } catch (e) {
    return "NotebookLM: 取得エラー（" + e.message + "）";
  }
}
