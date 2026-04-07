-- ============================================================
-- CFS Web Application - データベーススキーマ
-- 対象: v4（Node.js Standalone Edition）のみ
-- DB:   SQLite（better-sqlite3）
-- ============================================================
-- 【設計方針】
--   v3（GAS）は引き続きGoogle Sheetsで全データを管理する。
--   v4移行時に、運用データのみSQLiteで管理する。
--
--   SQLで管理するもの:
--     - ログ（操作・エラー記録）
--     - チャット履歴（将来的にセッション跨ぎで保持したい場合）
--
--   Google Sheetsで管理し続けるもの:
--     - 進捗管理（科目・問題）
--       → NotebookLM → Google Docs → Sheets の連携フローを維持
-- ============================================================


-- ------------------------------------------------------------
-- ログテーブル
-- 旧: Google Sheets の "Logs" シート（列: Timestamp | Message）
-- 新: level列を追加して info / warn / error を区別
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  level      TEXT    NOT NULL DEFAULT 'info'
                     CHECK(level IN ('info', 'warn', 'error')),
  message    TEXT    NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC);


-- ------------------------------------------------------------
-- チャット履歴テーブル（将来用・現状は任意）
-- 現状: フロントエンドのJSメモリ上にのみ保持（ページリロードで消える）
-- 将来: セッションを跨いで会話を引き継ぎたくなったときに有効化
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT    NOT NULL CHECK(role IN ('user', 'ai')),
  message    TEXT    NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_history_created_at ON chat_history(created_at DESC);
