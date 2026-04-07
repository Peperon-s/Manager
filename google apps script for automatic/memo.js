// ==========================================
// メモ機能
// 保存先: config.js の MEMO_SPREADSHEET_ID
// シート名: "メモ"
// 列: ID | 日時 | チャンネル | タグ | 内容
// ==========================================

// ==========================================
// シートを取得（なければ自動作成）
// ==========================================
function memoGetSheet_() {
  const ss  = SpreadsheetApp.openById(MEMO_SPREADSHEET_ID);
  let sheet = ss.getSheetByName("メモ");
  if (!sheet) {
    sheet = ss.insertSheet("メモ");
    const headers = ["ID", "日時", "チャンネル", "タグ", "内容"];
    const hRange  = sheet.getRange(1, 1, 1, headers.length);
    hRange.setValues([headers]);
    hRange.setFontWeight("bold");
    hRange.setBackground("#4a86e8");
    hRange.setFontColor("#ffffff");
    sheet.setColumnWidth(1, 50);
    sheet.setColumnWidth(2, 150);
    sheet.setColumnWidth(3, 120);
    sheet.setColumnWidth(4, 130);
    sheet.setColumnWidth(5, 450);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 次のID（最大ID + 1）を返す
function memoNextId_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues()
                   .map(function(r) { return parseInt(r[0]) || 0; });
  return Math.max.apply(null, ids) + 1;
}

// ==========================================
// メモを保存
// ==========================================
function memoSave(content, channelName, tags) {
  const sheet  = memoGetSheet_();
  const id     = memoNextId_(sheet);
  const now    = Utilities.formatDate(new Date(), "JST", "yyyy/MM/dd HH:mm");
  const tagStr = tags && tags.length ? tags.join(" ") : "";

  sheet.appendRow([id, now, channelName || "", tagStr, content]);

  let msg = "📝 メモを保存しました！\nID: " + id + "\n内容: " + content;
  if (tagStr) msg += "\nタグ: " + tagStr;
  return msg;
}

// ==========================================
// メモ一覧（最新10件 / タグ絞り込み可）
// ==========================================
function memoList(channelName, tagFilter) {
  const sheet   = memoGetSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return "📝 保存されたメモはありません。";

  let data = sheet.getRange(2, 1, lastRow - 1, 5).getValues()
                  .filter(function(r) { return String(r[4]).trim(); });

  if (tagFilter) {
    const f = tagFilter.replace(/^#/, "").toLowerCase();
    data = data.filter(function(r) {
      return String(r[3]).toLowerCase().includes(f);
    });
    if (!data.length) return "📝 タグ「" + tagFilter + "」のメモはありません。";
  }

  const rows = data.slice(-10).reverse();
  let msg = "📝 *メモ一覧*" + (tagFilter ? "（" + tagFilter + "）" : "") +
            "　" + rows.length + "件\n";
  rows.forEach(function(r) {
    msg += "─────────────\n";
    msg += "[" + r[0] + "]  " + r[1] + "  #" + r[2] + "\n";
    if (r[3]) msg += "🏷️ " + r[3] + "\n";
    msg += r[4] + "\n";
  });
  return msg;
}

// ==========================================
// メモ検索（内容・タグをキーワード検索）
// ==========================================
function memoSearch(keyword) {
  const sheet   = memoGetSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return "📝 保存されたメモはありません。";

  const lower = keyword.toLowerCase();
  const hits  = sheet.getRange(2, 1, lastRow - 1, 5).getValues()
    .filter(function(r) {
      return String(r[4]).toLowerCase().includes(lower) ||
             String(r[3]).toLowerCase().includes(lower);
    });

  if (!hits.length) return "🔍 「" + keyword + "」に一致するメモはありません。";

  let msg = "🔍 *検索結果*「" + keyword + "」　" + hits.length + "件\n";
  hits.slice(-10).reverse().forEach(function(r) {
    msg += "─────────────\n";
    msg += "[" + r[0] + "]  " + r[1] + "  #" + r[2] + "\n";
    if (r[3]) msg += "🏷️ " + r[3] + "\n";
    msg += r[4] + "\n";
  });
  return msg;
}

// ==========================================
// メモ削除（ID指定）
// ==========================================
function memoDelete(id) {
  const sheet   = memoGetSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return "⚠️ 削除するメモがありません。";

  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      const content = data[i][4];
      sheet.deleteRow(i + 2);
      return "🗑️ メモ [" + id + "] を削除しました。\n内容: " + content;
    }
  }
  return "⚠️ ID「" + id + "」のメモが見つかりません。";
}

// ==========================================
// メモコマンドの判定と実行
// メモコマンドなら結果文字列を、違えば null を返す
// Geminiを使わず直接処理（高速・APIクォータ節約）
// ==========================================
function checkMemoCommand_(message, channelName) {
  const msg = message.trim();

  // メモ削除: ID
  const delMatch = msg.match(/^メモ削除[：:]\s*(\d+)/);
  if (delMatch) return memoDelete(delMatch[1]);

  // メモ検索: キーワード
  const searchMatch = msg.match(/^メモ検索[：:]\s*(.+)/s);
  if (searchMatch) return memoSearch(searchMatch[1].trim());

  // メモ一覧（タグ絞り込み可）
  const listMatch = msg.match(/^メモ一覧(?:\s*(#\S+))?/);
  if (listMatch) return memoList(channelName, listMatch[1] || null);

  // メモ保存（タグ付き）: メモ #tag1 #tag2 内容
  const saveTagMatch = msg.match(/^メモ\s+((?:#\S+\s*)+)(.+)/s);
  if (saveTagMatch) {
    const tags    = saveTagMatch[1].trim().split(/\s+/);
    const content = saveTagMatch[2].trim();
    return memoSave(content, channelName, tags);
  }

  // メモ保存（タグなし）: メモ: 内容 または メモ 内容
  const saveMatch = msg.match(/^メモ[：:\s]\s*(.+)/s);
  if (saveMatch) return memoSave(saveMatch[1].trim(), channelName, []);

  return null; // メモコマンドではない
}
