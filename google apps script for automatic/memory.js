// ==========================================
// ユーザーメモリ管理（Google Spreadsheet版）
// SPREADSHEET_ID のスプレッドシートに "Memory" シートを自動作成して保存
//
// シート列構成:
//   A: email  B: key  C: value  D: updatedAt
// ==========================================

var MEMORY_SHEET_NAME = 'Memory';

// Memoryシートを取得（なければ自動作成）
function memoryGetSheet_() {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(MEMORY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(MEMORY_SHEET_NAME);
    sheet.appendRow(['email', 'key', 'value', 'updatedAt']);
    sheet.setFrozenRows(1);
    sheet.getRange('A1:D1').setFontWeight('bold');
    sheet.setColumnWidth(1, 200);
    sheet.setColumnWidth(2, 150);
    sheet.setColumnWidth(3, 400);
    sheet.setColumnWidth(4, 140);
  }
  return sheet;
}

// 全メモリ取得（内部用）
// 返り値: { "キー": { value: "内容", updatedAt: "文字列" }, ... }
function memoryGetAll_(email) {
  if (!email) return {};
  var sheet  = memoryGetSheet_();
  var data   = sheet.getDataRange().getValues();
  var result = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      result[data[i][1]] = {
        value:     data[i][2],
        updatedAt: data[i][3]
      };
    }
  }
  return result;
}

// メモリを保存/上書き（内部用）
function memorySave_(email, key, value) {
  if (!email) return { error: 'ユーザー情報が取得できません' };
  var sheet     = memoryGetSheet_();
  var data      = sheet.getDataRange().getValues();
  var now       = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd HH:mm');
  var targetRow = -1;

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === email && data[i][1] === key) {
      targetRow = i + 1; // 1-indexed
      break;
    }
  }

  if (targetRow > 0) {
    // 既存行を更新
    sheet.getRange(targetRow, 3, 1, 2).setValues([[value, now]]);
  } else {
    // 新規行を追加
    sheet.appendRow([email, key, value, now]);
  }
  return memoryGetAll_(email);
}

// メモリを削除（内部用）
function memoryDelete_(email, key) {
  if (!email) return { error: 'ユーザー情報が取得できません' };
  var sheet = memoryGetSheet_();
  var data  = sheet.getDataRange().getValues();

  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === email && data[i][1] === key) {
      sheet.deleteRow(i + 1);
      return memoryGetAll_(email);
    }
  }
  return { error: '「' + key + '」というメモリは存在しません' };
}

// システムプロンプトに埋め込むテキストを生成
function memoryBuildPromptText_(email) {
  if (!email) return '';
  var memories = memoryGetAll_(email);
  var keys     = Object.keys(memories);
  if (!keys.length) return '';
  var lines = ['【ユーザーの個人メモリ（過去に登録した情報）】'];
  keys.forEach(function(k) {
    lines.push('▶ ' + k + ':\n' + memories[k].value);
  });
  lines.push('※ これらの情報はユーザーが明示的に登録したものです。カレンダー登録などで時間帯・場所が不明の場合はメモリから自動的に補完してください。');
  return lines.join('\n');
}

// ==========================================
// 公開API（doPost / AI ツールから呼び出し）
// ==========================================

// AIツール: メモリ保存
function saveMemory(email, key, value) {
  var result = memorySave_(email, key, value);
  if (result && result.error) return result.error;
  return '「' + key + '」をメモリに保存しました。';
}

// AIツール: メモリ削除
function deleteMemory(email, key) {
  var result = memoryDelete_(email, key);
  if (result.error) return result.error;
  return '「' + key + '」をメモリから削除しました。';
}

// AIツール: メモリ一覧取得
function listMemories(email) {
  var memories = memoryGetAll_(email);
  var keys     = Object.keys(memories);
  if (!keys.length) return 'メモリにはまだ何も登録されていません。';
  var lines = ['📋 登録済みメモリ一覧:'];
  keys.forEach(function(k) {
    lines.push('▶ ' + k + ' （更新: ' + memories[k].updatedAt + '）\n  ' + memories[k].value.replace(/\n/g, '\n  '));
  });
  return lines.join('\n');
}

// フロントエンド向け: メモリデータ取得
function getMemoryData(token) {
  var email = verifyToken(token);
  if (!email) return { error: '認証エラー' };
  return memoryGetAll_(email);
}

// フロントエンド向け: メモリ手動保存
function saveMemoryData(token, key, value) {
  var email = verifyToken(token);
  if (!email) return { error: '認証エラー' };
  memorySave_(email, key, value);
  return { success: true };
}

// フロントエンド向け: メモリ手動削除
function deleteMemoryData(token, key) {
  var email = verifyToken(token);
  if (!email) return { error: '認証エラー' };
  return memoryDelete_(email, key);
}
