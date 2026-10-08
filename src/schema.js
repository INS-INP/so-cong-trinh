// Cấu trúc dữ liệu (SQLite trong Durable Object). Chỉ THÊM bảng/cột mới qua MIGRATIONS, không sửa/xoá bảng cũ.
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL, role TEXT NOT NULL,
     pass_hash TEXT NOT NULL, pass_salt TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
     fail_count INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS shareholders (id INTEGER PRIMARY KEY, name TEXT NOT NULL, pct_bp INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '');
   CREATE TABLE IF NOT EXISTS partners (
     id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, mst TEXT NOT NULL DEFAULT '',
     address TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS projects (
     id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, customer_id INTEGER,
     address TEXT NOT NULL DEFAULT '', contract_value INTEGER NOT NULL DEFAULT 0, vat_rate INTEGER NOT NULL DEFAULT 8,
     status TEXT NOT NULL DEFAULT 'dang_thi_cong', start_date TEXT NOT NULL, accepted_date TEXT,
     manager_user_id INTEGER, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS costs (
     id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, date TEXT NOT NULL, project_id INTEGER, category TEXT NOT NULL,
     partner_id INTEGER, description TEXT NOT NULL, amount_net INTEGER NOT NULL, vat INTEGER NOT NULL DEFAULT 0,
     pay_method TEXT NOT NULL, invoice_no TEXT NOT NULL DEFAULT '', invoice_date TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL, reverses_id INTEGER, reversed_by_id INTEGER, reason TEXT NOT NULL DEFAULT '',
     source TEXT NOT NULL DEFAULT 'tay', einvoice_key TEXT UNIQUE,
     created_by INTEGER NOT NULL, created_at TEXT NOT NULL, approved_by INTEGER, approved_at TEXT);
   CREATE TABLE IF NOT EXISTS cost_lines (
     id INTEGER PRIMARY KEY, cost_id INTEGER NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '',
     qty REAL NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0, amount INTEGER NOT NULL DEFAULT 0, vat_rate TEXT NOT NULL DEFAULT '');
   CREATE TABLE IF NOT EXISTS revenues (
     id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, date TEXT NOT NULL, project_id INTEGER NOT NULL,
     description TEXT NOT NULL, amount_net INTEGER NOT NULL, vat INTEGER NOT NULL DEFAULT 0, invoice_no TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL, reverses_id INTEGER, reversed_by_id INTEGER, reason TEXT NOT NULL DEFAULT '',
     created_by INTEGER NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS receipts (
     id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, date TEXT NOT NULL, project_id INTEGER NOT NULL,
     amount INTEGER NOT NULL, method TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL, reverses_id INTEGER, reversed_by_id INTEGER, reason TEXT NOT NULL DEFAULT '',
     created_by INTEGER NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS payments (
     id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, date TEXT NOT NULL, partner_id INTEGER NOT NULL,
     amount INTEGER NOT NULL, method TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL, reverses_id INTEGER, reversed_by_id INTEGER, reason TEXT NOT NULL DEFAULT '',
     created_by INTEGER NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS attachments (
     id INTEGER PRIMARY KEY, owner_type TEXT NOT NULL, owner_id INTEGER NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
     size INTEGER NOT NULL, data BLOB NOT NULL, created_by INTEGER NOT NULL, created_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_att_owner ON attachments(owner_type, owner_id);
   CREATE TABLE IF NOT EXISTS month_locks (
     month TEXT PRIMARY KEY, locked_by INTEGER NOT NULL, locked_at TEXT NOT NULL, figures_json TEXT NOT NULL, figures_hash TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS signoffs (
     id INTEGER PRIMARY KEY, month TEXT NOT NULL, user_id INTEGER NOT NULL, signed_at TEXT NOT NULL,
     figures_hash TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', UNIQUE(month, user_id));
   CREATE TABLE IF NOT EXISTS audit (
     id INTEGER PRIMARY KEY, at TEXT NOT NULL, user_id INTEGER, action TEXT NOT NULL, entity TEXT NOT NULL,
     entity_id TEXT NOT NULL DEFAULT '', before_json TEXT NOT NULL DEFAULT '', after_json TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '');
   CREATE INDEX IF NOT EXISTS idx_costs_date ON costs(date);
   CREATE INDEX IF NOT EXISTS idx_costs_project ON costs(project_id);`,
];

export function migrate(db) {
  db.execScript(`CREATE TABLE IF NOT EXISTS _migrations (n INTEGER PRIMARY KEY)`);
  const done = new Set(db.all(`SELECT n FROM _migrations`).map(r => Number(r.n)));
  MIGRATIONS.forEach((sql, i) => {
    if (done.has(i)) return;
    db.execScript(sql);
    db.run(`INSERT INTO _migrations (n) VALUES (?)`, i);
  });
}
