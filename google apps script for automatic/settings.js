// ==========================================
// Manager - 設定管理
// API キーを PropertiesService で永続化する
// ==========================================

var SETTINGS_KEYS = {
  // API認証
  togglApiKey:          "TOGGL_API_KEY",
  todoistToken:         "TODOIST_API_TOKEN",
  geminiApiKey:         "GEMINI_API_KEY",
  linearApiKey:         "LINEAR_API_KEY",
  linearTeamId:         "LINEAR_TEAM_ID",
  googleClientId:       "GOOGLE_CLIENT_ID",
  // スプレッドシート
  spreadsheetId:        "SPREADSHEET_ID",
  notebooklmFolderId:   "NOTEBOOKLM_DOCS_FOLDER_ID"
};

// 設定値を取得（UIに返す）
function getSettingsData(token) {
  if (!verifyToken(token)) return { error: "認証エラー" };
  var props  = PropertiesService.getScriptProperties();
  var result = {};
  Object.keys(SETTINGS_KEYS).forEach(function(key) {
    result[key] = props.getProperty(SETTINGS_KEYS[key]) || "";
  });
  return result;
}

// 設定値を保存（UIから受け取る）
function updateSettingsData(token, settings) {
  if (!verifyToken(token)) return { error: "認証エラー" };
  var props = PropertiesService.getScriptProperties();
  Object.keys(SETTINGS_KEYS).forEach(function(key) {
    if (settings[key] !== undefined && settings[key] !== "") {
      props.setProperty(SETTINGS_KEYS[key], settings[key]);
    }
  });
  return { success: true };
}
