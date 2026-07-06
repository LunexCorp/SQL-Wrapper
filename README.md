# SqlWrapper

**SqlWrapper** is a lightweight, dependency-free wrapper around Node.js's built-in `node:sqlite` module. It gives you a clean, expressive API for CRUD operations, raw SQL, transactions (with nested savepoints), and migrations — without pulling in an ORM.

> **Key Features:**
> - **Zero Dependencies**: Built entirely on `node:sqlite`, `node:path`, and `node:fs`.
> - **Object-Based CRUD**: `SQLInsert`, `SQLUpdate`, `SQLUpsert`, `SQLDelete`, `SQLFind`, `SQLFindAll`, `SQLCount` — no manual SQL string-building.
> - **Raw SQL Escape Hatch**: `SQLRaw`, `SQLAll`, `SQLExec` for anything the helpers don't cover.
> - **Nested Transactions**: Automatic `BEGIN`/`COMMIT` at the top level, `SAVEPOINT`/`RELEASE` for nested calls.
> - **Prepared Statement Caching**: Every SQL string is prepared once and reused.
> - **Null-Prototype Safe**: Rows returned by `node:sqlite` are normalized into plain objects.
> - **Global Attach Mode**: Drop the `db.` prefix entirely with `attachGlobal()`.
> - **Built-in Migrations**: Track and apply schema changes via `tblMigrations`.
> - **WAL Mode by Default**: Enabled automatically unless disabled.

---

## Table of Contents

- [Features](#features)
- [How it Works](#how-it-works)
- [Installation](#installation)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Example](#example)
- [Migrations](#migrations)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Automatic Directory Creation** for file-based databases
- **WAL Mode & Foreign Keys** enabled by default (configurable)
- **Verbose Logging Mode** for debugging queries and params
- **Table-Scoped Shortcuts** via `db.table(name)`
- **No Third-Party Dependencies (Uses Only the Node.js Standard Library)**

---

## How it Works

SqlWrapper sits directly on top of `node:sqlite`'s `DatabaseSync`:

1. On construction, it opens (or creates) the database file, creates parent directories if needed, and applies pragmas (WAL, foreign keys).
2. Every query goes through `_prepare()`, which caches compiled statements by SQL string.
3. Returned rows are passed through `_normalize()`, converting null-prototype objects into plain JS objects.
4. Higher-level `SQL*` methods build parameterized SQL for you from plain objects, so you rarely touch raw SQL for common operations.

---

## Installation

1. **Copy the file into your project**

   ```bash
   cp SqlWrapper.js ./lib/SqlWrapper.js
   ```

2. **No additional installation is required!** (Requires Node.js with `node:sqlite` support.)

---

## Usage

```javascript
const SqlWrapper = require('./lib/SqlWrapper');

const db = new SqlWrapper('./data/app.db', {
  wal: true,          // default: true
  foreignKeys: true,  // default: true
  verbose: false,     // default: false — logs every SQL statement + params
});
```

Or use in-memory:

```javascript
const db = new SqlWrapper(':memory:');
```

---

## API Reference

### Core primitives

| Method | Description |
|---|---|
| `run(sql, params)` | Executes a statement, returns the `run()` result (`changes`, `lastInsertRowid`). |
| `get(sql, params)` | Returns a single normalized row, or `undefined`. |
| `all(sql, params)` | Returns all matching rows, normalized. |
| `exec(sql)` | Executes raw SQL with no param binding (supports multiple statements). |
| `pragma(expr)` | Shortcut for `exec('PRAGMA ...')`. |

### Object-based CRUD

| Method | Description |
|---|---|
| `SQLInsert(table, data, opts)` | Inserts a row. `opts.orReplace` / `opts.orIgnore` for `INSERT OR REPLACE` / `INSERT OR IGNORE`. |
| `SQLUpdate(table, data, where)` | Updates rows matching `where`. Throws if `where` is empty (prevents accidental full-table updates). |
| `SQLDelete(table, where)` | Deletes rows matching `where`. Pass `{}` explicitly to delete all rows. |
| `SQLUpsert(table, data, conflictCols)` | `INSERT ... ON CONFLICT DO UPDATE/NOTHING` based on `conflictCols`. |
| `SQLFind(table, where)` | Returns the first matching row (`SELECT *`). |
| `SQLFindAll(table, where, { limit, orderBy })` | Returns all matching rows, with optional ordering/limit. |
| `SQLCount(table, where)` | Returns a row count. |

### Column-select helpers

| Method | Description |
|---|---|
| `SQLGet(table, columns, where)` | Single row, specific columns (`'*'` or array of names). |
| `SQLGetAll(table, columns, where, opts)` | Multiple rows, specific columns, with `limit`/`orderBy`. |

### Raw SQL

| Method | Description |
|---|---|
| `SQLRaw(sql, params)` | Auto-detects `SELECT`/`PRAGMA`/`WITH` vs. mutation and returns rows or a run result accordingly. |
| `SQLAll(sql, params)` | Alias for `all()`. |
| `SQLExec(sql, params)` | Runs multi-statement SQL (no params) via `exec()`, or a single parameterized statement via `run()`. |

### Transactions

```javascript
db.transaction(() => {
  db.SQLInsert('tblUsers', { UserID: 1, Name: 'Christo' });
  db.SQLUpdate('tblUsers', { Name: 'Updated' }, { UserID: 1 });
});
```

Nested calls to `transaction()` automatically use `SAVEPOINT`/`RELEASE`/`ROLLBACK TO` instead of a second `BEGIN`.

### Table-scoped shortcut

```javascript
const users = db.table('tblUsers');

users.insert({ UserID: 1, Name: 'Christo' });
users.find({ UserID: 1 });
users.update({ Name: 'New Name' }, { UserID: 1 });
users.delete({ UserID: 1 });
```

### Dropping the `db.` prefix

```javascript
db.attachGlobal();

SQLInsert('tblUsers', { UserID: 1, Name: 'Christo' });
SQLFind('tblUsers', { UserID: 1 });
```

Or destructure without polluting globals:

```javascript
const { SQLInsert, SQLFind, transaction } = db.functions();
```

---

## Example

```javascript
const db = new SqlWrapper('./data/app.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS tblUsers (
    UserID INTEGER PRIMARY KEY,
    Name TEXT NOT NULL
  )
`);

db.SQLInsert('tblUsers', { UserID: 1, Name: 'Christo' });

const user = db.SQLFind('tblUsers', { UserID: 1 });
console.log(user); // { UserID: 1, Name: 'Christo' }

db.SQLUpdate('tblUsers', { Name: 'Christo LunexCorp' }, { UserID: 1 });
db.SQLUpsert('tblUsers', { UserID: 1, Name: 'Replaced' }, 'UserID');

console.log(db.SQLCount('tblUsers'));       // 1
console.log(db.SQLFindAll('tblUsers'));     // [ { UserID: 1, Name: 'Replaced' } ]

db.close();
```

---

## Migrations

```javascript
db.runMigrations([
  {
    name: '001_create_users',
    up(db) {
      db.exec(`
        CREATE TABLE tblUsers (
          UserID INTEGER PRIMARY KEY,
          Name TEXT NOT NULL
        )
      `);
    },
  },
  {
    name: '002_add_email',
    up(db) {
      db.exec(`ALTER TABLE tblUsers ADD COLUMN Email TEXT`);
    },
  },
]);
```

Applied migrations are tracked in a `tblMigrations` table (`Name`, `AppliedAt`), so each migration only runs once — and each runs inside its own transaction.

---

## Contributing

This is a personal project under LunexCorp. Suggestions, improvements, and bug reports are welcome via issue or pull request.

---

## License

MIT
