// ==========================================
// NotebookLM Enterprise API 連携
// 認証: サービスアカウント JWT (Script Properties: NOTEBOOKLM_SA_KEY)
// ==========================================

// サービスアカウントのJWTでアクセストークンを取得（1時間キャッシュ）
function nlmGetToken_() {
  var cache   = CacheService.getScriptCache();
  var cached  = cache.get("nlm_access_token");
  if (cached) return cached;

  var keyJson = PropertiesService.getScriptProperties().getProperty("NOTEBOOKLM_SA_KEY");
  if (!keyJson) throw new Error("Script Properties に NOTEBOOKLM_SA_KEY が設定されていません");
  var key = JSON.parse(keyJson);

  var now    = Math.floor(Date.now() / 1000);
  var header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: "RS256", typ: "JWT" })).replace(/=+$/, "");
  var claim  = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss:   key.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud:   "https://oauth2.googleapis.com/token",
    exp:   now + 3600,
    iat:   now
  })).replace(/=+$/, "");

  var sigInput  = header + "." + claim;
  var signature = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(sigInput, key.private_key)
  ).replace(/=+$/, "");

  var jwt = sigInput + "." + signature;

  var res    = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method:      "post",
    contentType: "application/x-www-form-urlencoded",
    payload:     "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + jwt,
    muteHttpExceptions: true
  });
  var result = JSON.parse(res.getContentText());
  if (!result.access_token) throw new Error("トークン取得失敗: " + JSON.stringify(result));

  // 55分キャッシュ（有効期限1時間より少し短め）
  cache.put("nlm_access_token", result.access_token, 3300);
  return result.access_token;
}

function nlmHeaders_() {
  return {
    "Authorization": "Bearer " + nlmGetToken_(),
    "Content-Type":  "application/json"
  };
}

function nlmFetch_(path, method, body) {
  var url     = NOTEBOOKLM_BASE_URL + (path || "");
  var options = { method: method || "get", headers: nlmHeaders_(), muteHttpExceptions: true };
  if (body) options.payload = JSON.stringify(body);
  var res  = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  var text = res.getContentText();
  logToSheet("【NLM " + (method||"get").toUpperCase() + " " + path + "】" + code + " / " + text.substring(0, 200));
  if (!text || !text.trim()) return {};          // 204 No Content など
  if (text.trim().charAt(0) !== "{" && text.trim().charAt(0) !== "[") {
    throw new Error("HTTP " + code + " (非JSONレスポンス): " + text.substring(0, 100));
  }
  var json = JSON.parse(text);
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
// ノートブック一覧
// ==========================================
function notebookLMList() {
  var res       = nlmFetch_(":listRecentlyViewed", "get");
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
  nlmFetch_(":batchDelete", "post", { names: [
    "projects/" + NOTEBOOKLM_PROJECT_NUMBER
    + "/locations/" + NOTEBOOKLM_LOCATION
    + "/notebooks/" + notebookId
  ]});
  return "🗑 ノートブック（" + notebookId + "）を削除しました。";
}

// ==========================================
// ダッシュボード用データ取得
// ==========================================
function notebookLMDashData_() {
  try {
    var res       = nlmFetch_(":listRecentlyViewed", "get");
    var all       = res.notebooks || [];
    var notebooks = all.slice(0, 6).map(function(nb) {
      var id = nb.name ? nb.name.split("/").pop() : "";
      return { id: id, title: nb.title || "無題" };
    });
    return { notebooks: notebooks, total: all.length };
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
