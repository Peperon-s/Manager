// ==========================================
// Manager - 認証システム
// ==========================================

var AUTH_SALT = "manager-auth-2026";

// ── ユーティリティ ──────────────────────────

function authHashPassword_(password) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, password + AUTH_SALT
  );
  return bytes.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function authGetUsers_() {
  var val = PropertiesService.getScriptProperties().getProperty("MANAGER_USERS");
  return JSON.parse(val || "{}");
}

function authSaveUsers_(users) {
  PropertiesService.getScriptProperties().setProperty("MANAGER_USERS", JSON.stringify(users));
}

function authGetTokens_() {
  var val = PropertiesService.getScriptProperties().getProperty("MANAGER_TOKENS");
  return JSON.parse(val || "{}");
}

function authSaveTokens_(tokens) {
  PropertiesService.getScriptProperties().setProperty("MANAGER_TOKENS", JSON.stringify(tokens));
}

function authIssueToken_(email) {
  var token  = Utilities.getUuid();
  var tokens = authGetTokens_();
  // 期限: 7日
  tokens[token] = { email: email, expiry: Date.now() + 7 * 24 * 60 * 60 * 1000 };
  authSaveTokens_(tokens);
  return token;
}

// ── Google認証 ──────────────────────────────

// GIS が発行したIDトークンをサーバーで検証
function verifyGoogleCredential(credential) {
  try {
    var res  = UrlFetchApp.fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" + credential,
      { muteHttpExceptions: true }
    );
    var data = JSON.parse(res.getContentText());
    if (data.error) return { error: "Googleトークンが無効です" };

    var email = data.email;
    var users = authGetUsers_();

    if (!users[email]) {
      // 未登録 → 登録画面へ誘導
      return { needsRegistration: true, email: email, name: data.name || "" };
    }

    var token = authIssueToken_(email);
    return { token: token, email: email, name: users[email].name };
  } catch (e) {
    return { error: e.message };
  }
}

// Googleアカウントで新規登録
function registerWithGoogle(credential, name) {
  try {
    var res  = UrlFetchApp.fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" + credential,
      { muteHttpExceptions: true }
    );
    var data = JSON.parse(res.getContentText());
    if (data.error) return { error: "Googleトークンが無効です" };

    var email = data.email;
    var users = authGetUsers_();
    if (users[email]) return { error: "このアカウントはすでに登録されています" };

    users[email] = { name: name || data.name || email, type: "google" };
    authSaveUsers_(users);

    var token = authIssueToken_(email);
    return { token: token, email: email, name: users[email].name };
  } catch (e) {
    return { error: e.message };
  }
}

// ── メール/パスワード認証 ────────────────────

function registerWithPassword(email, password, name) {
  var users = authGetUsers_();
  if (users[email]) return { error: "このメールアドレスはすでに登録されています" };

  users[email] = { name: name || email, type: "local", hash: authHashPassword_(password) };
  authSaveUsers_(users);

  var token = authIssueToken_(email);
  return { token: token, email: email, name: users[email].name };
}

function loginWithPassword(email, password) {
  var users = authGetUsers_();
  var user  = users[email];
  if (!user)       return { error: "アカウントが見つかりません" };
  if (!user.hash)  return { error: "このアカウントはGoogleログイン専用です" };
  if (user.hash !== authHashPassword_(password)) return { error: "パスワードが違います" };

  var token = authIssueToken_(email);
  return { token: token, email: email, name: user.name };
}

// ── セッション管理 ──────────────────────────

function verifyToken(token) {
  if (!token) return null;
  var tokens  = authGetTokens_();
  var session = tokens[token];
  if (!session) return null;
  if (Date.now() > session.expiry) {
    delete tokens[token];
    authSaveTokens_(tokens);
    return null;
  }
  return session.email;
}

function logoutUser(token) {
  var tokens = authGetTokens_();
  delete tokens[token];
  authSaveTokens_(tokens);
  return { success: true };
}

// ── パスワード変更 ───────────────────────────

function changePassword(token, oldPassword, newPassword) {
  var email = verifyToken(token);
  if (!email) return { error: "セッションが無効です。再ログインしてください。" };

  var users = authGetUsers_();
  var user  = users[email];

  // Googleユーザーが初めてパスワードを設定する場合はoldPasswordなし
  if (user.type === "google" && !user.hash) {
    users[email].hash = authHashPassword_(newPassword);
    authSaveUsers_(users);
    return { success: true };
  }

  if (user.hash !== authHashPassword_(oldPassword)) {
    return { error: "現在のパスワードが違います" };
  }
  users[email].hash = authHashPassword_(newPassword);
  authSaveUsers_(users);
  return { success: true };
}
