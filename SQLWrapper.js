const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

class SqlWrapper {
  constructor(dbPath, opts = {}) {
    const { wal = true, foreignKeys = true, verbose = false } = opts;

    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    this.path = dbPath;
    this.verbose = verbose;
    this.db = new DatabaseSync(dbPath);
    this._stmtCache = new Map();

    if (wal) this.pragma('journal_mode = WAL');
    if (foreignKeys) this.pragma('foreign_keys = ON');
  }

  _log(sql, params) {
    if (this.verbose) {
      console.log(`[SqlWrapper] ${sql}`, params && Object.keys(params).length ? params : '');
    }
  }

  _prepare(sql) {
    let stmt = this._stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this._stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  _normalize(value) {
    if (value == null) return value;

    if (Array.isArray(value)) {
        return value.map(v => this._normalize(v));
    }

    if (typeof value === 'object') {
        return { ...value }; // converts null-prototype objects to plain objects
    }

    return value;
    }

    _normalizeParams(params) {
    return params && typeof params === 'object'
        ? { ...params }
        : params;
    }

  // ---------------------------------------------------------------------
  // Core primitives
  // ---------------------------------------------------------------------

  run(sql, params = {}) {
    this._log(sql, params);
    const stmt = this._prepare(sql);
    return stmt.run(params);
  }

  get(sql, params = {}) {
    this._log(sql, params);
    const stmt = this._prepare(sql);
    return this._normalize(stmt.get(params));
  }

  all(sql, params = {}) {
    this._log(sql, params);
    const stmt = this._prepare(sql);
    return stmt.all(params).map((row) => this._normalize(row));
  }

  exec(sql) {
    this._log(sql, {});
    this.db.exec(sql);
  }

  pragma(expr) {
    return this.exec(`PRAGMA ${expr};`);
  }

  // ---------------------------------------------------------------------
  // Object-based CRUD helpers
  // ---------------------------------------------------------------------

  SQLInsert(table, data, opts = {}) {
    const cols = Object.keys(data);
    if (!cols.length) throw new Error('SQLInsert() requires at least one column');
    const placeholders = cols.map((c) => `@${c}`).join(', ');
    const verb = opts.orReplace ? 'INSERT OR REPLACE' : opts.orIgnore ? 'INSERT OR IGNORE' : 'INSERT';
    const sql = `${verb} INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
    return this.run(sql, data);
  }

  SQLUpdate(table, data, where) {
    if (!where || !Object.keys(where).length) {
      throw new Error('SQLUpdate() requires a non-empty where clause to avoid full-table updates');
    }
    const setCols = Object.keys(data);
    const whereCols = Object.keys(where);

    const setClause = setCols.map((c) => `${c} = @set_${c}`).join(', ');
    const whereClause = whereCols.map((c) => `${c} = @where_${c}`).join(' AND ');

    const params = {};
    for (const c of setCols) params[`set_${c}`] = data[c];
    for (const c of whereCols) params[`where_${c}`] = where[c];

    const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;
    return this.run(sql, params);
  }

  SQLDelete(table, where) {
    if (where === undefined) {
      throw new Error('SQLDelete() requires a where object (pass {} explicitly to delete all rows)');
    }
    const cols = Object.keys(where);
    if (!cols.length) {
      return this.run(`DELETE FROM ${table}`);
    }
    const clause = cols.map((c) => `${c} = @${c}`).join(' AND ');
    return this.run(`DELETE FROM ${table} WHERE ${clause}`, where);
  }

  SQLUpsert(table, data, conflictCols) {
    const cols = Object.keys(data);
    const conflict = Array.isArray(conflictCols) ? conflictCols : [conflictCols];
    const placeholders = cols.map((c) => `@${c}`).join(', ');
    const updateSet = cols
      .filter((c) => !conflict.includes(c))
      .map((c) => `${c} = excluded.${c}`)
      .join(', ');

    const sql = updateSet
      ? `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
         ON CONFLICT(${conflict.join(', ')}) DO UPDATE SET ${updateSet}`
      : `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
         ON CONFLICT(${conflict.join(', ')}) DO NOTHING`;

    return this.run(sql, data);
  }

  SQLFind(table, where = {}) {
    const cols = Object.keys(where);
    const clause = cols.length ? `WHERE ${cols.map((c) => `${c} = @${c}`).join(' AND ')}` : '';
    return this.get(`SELECT * FROM ${table} ${clause}`, where);
  }

  SQLFindAll(table, where = {}, { limit, orderBy } = {}) {
    const cols = Object.keys(where);
    const clause = cols.length ? `WHERE ${cols.map((c) => `${c} = @${c}`).join(' AND ')}` : '';
    const order = orderBy ? `ORDER BY ${orderBy}` : '';
    const lim = limit ? `LIMIT ${Number(limit)}` : '';
    return this.all(`SELECT * FROM ${table} ${clause} ${order} ${lim}`, where);
  }

  SQLCount(table, where = {}) {
    const cols = Object.keys(where);
    const clause = cols.length ? `WHERE ${cols.map((c) => `${c} = @${c}`).join(' AND ')}` : '';
    const row = this.get(`SELECT COUNT(*) AS n FROM ${table} ${clause}`, where);
    return row ? row.n : 0;
  }

  // ---------------------------------------------------------------------
  // Column-select helpers
  // ---------------------------------------------------------------------

  SQLGet(table, columns, where = {}) {
    const cols = columns === '*' || !columns ? '*' : columns.join(', ');
    const whereKeys = Object.keys(where);
    const clause = whereKeys.length ? `WHERE ${whereKeys.map((c) => `${c} = @${c}`).join(' AND ')}` : '';
    return this.get(`SELECT ${cols} FROM ${table} ${clause}`, where);
  }

  SQLGetAll(table, columns, where = {}, opts = {}) {
    const cols = columns === '*' || !columns ? '*' : columns.join(', ');
    const whereKeys = Object.keys(where);
    const clause = whereKeys.length ? `WHERE ${whereKeys.map((c) => `${c} = @${c}`).join(' AND ')}` : '';
    const order = opts.orderBy ? `ORDER BY ${opts.orderBy}` : '';
    const lim = opts.limit ? `LIMIT ${Number(opts.limit)}` : '';
    return this.all(`SELECT ${cols} FROM ${table} ${clause} ${order} ${lim}`, where);
  }

  // ---------------------------------------------------------------------
  // Raw SQL
  // ---------------------------------------------------------------------

  SQLRaw(sql, params = {}) {
    this._log(sql, params);
    const isSelect = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql);
    const stmt = this._prepare(sql);
    return isSelect ? stmt.all(params).map((row) => this._normalize(row)) : stmt.run(params);
  }

  SQLAll(sql, params = {}) {
    return this.all(sql, params);
  }

  SQLExec(sql, params = {}) {
    if (Object.keys(params).length === 0 && sql.trim().includes(';')) {
      return this.exec(sql);
    }
    return this.run(sql, params);
  }

  // ---------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------

  transaction(fn) {
    const depth = (this._txDepth = (this._txDepth || 0) + 1);
    const label = `sp_${depth}`;

    try {
      if (depth === 1) this.exec('BEGIN');
      else this.exec(`SAVEPOINT ${label}`);

      const result = fn(this);

      if (depth === 1) this.exec('COMMIT');
      else this.exec(`RELEASE ${label}`);

      return result;
    } catch (err) {
      if (depth === 1) this.exec('ROLLBACK');
      else this.exec(`ROLLBACK TO ${label}`);
      throw err;
    } finally {
      this._txDepth--;
    }
  }

  // ---------------------------------------------------------------------
  // Table-scoped shortcut
  // ---------------------------------------------------------------------

  table(name) {
    return {
      insert: (data, opts) => this.SQLInsert(name, data, opts),
      update: (data, where) => this.SQLUpdate(name, data, where),
      upsert: (data, conflictCols) => this.SQLUpsert(name, data, conflictCols),
      delete: (where) => this.SQLDelete(name, where),
      find: (where) => this.SQLFind(name, where),
      findAll: (where, opts) => this.SQLFindAll(name, where, opts),
      count: (where) => this.SQLCount(name, where),
    };
  }

  // ---------------------------------------------------------------------
  // Migrations
  // ---------------------------------------------------------------------

  runMigrations(migrations) {
    this.exec(`
      CREATE TABLE IF NOT EXISTS tblMigrations (
        Name TEXT PRIMARY KEY,
        AppliedAt TEXT DEFAULT (datetime('now'))
      )
    `);

    for (const m of migrations) {
      const already = this.get('SELECT 1 FROM tblMigrations WHERE Name = @Name', { Name: m.name });
      if (already) continue;

      this.transaction(() => {
        m.up(this);
        this.SQLInsert('tblMigrations', { Name: m.name });
      });
      console.log(`[SqlWrapper] applied migration: ${m.name}`);
    }
  }

  // ---------------------------------------------------------------------
  // Drop the "db." prefix
  // ---------------------------------------------------------------------

  functions() {
    return {
      SQLGet: this.SQLGet.bind(this),
      SQLGetAll: this.SQLGetAll.bind(this),
      SQLAll: this.SQLAll.bind(this),
      SQLExec: this.SQLExec.bind(this),
      SQLRaw: this.SQLRaw.bind(this),
      SQLInsert: this.SQLInsert.bind(this),
      SQLUpdate: this.SQLUpdate.bind(this),
      SQLUpsert: this.SQLUpsert.bind(this),
      SQLDelete: this.SQLDelete.bind(this),
      SQLFind: this.SQLFind.bind(this),
      SQLFindAll: this.SQLFindAll.bind(this),
      SQLCount: this.SQLCount.bind(this),
      run: this.run.bind(this),
      get: this.get.bind(this),
      all: this.all.bind(this),
      exec: this.exec.bind(this),
      pragma: this.pragma.bind(this),
      transaction: this.transaction.bind(this),
      table: this.table.bind(this),
    };
  }

  attachGlobal() {
    const fns = this.functions();
    for (const [name, fn] of Object.entries(fns)) {
      globalThis[name] = fn;
    }
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  close() {
    this._stmtCache.clear();
    this.db.close();
  }
}

module.exports = SqlWrapper;