function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function makeCommand(type, value) {
  return { __command: type, value };
}

function isCommand(value, type) {
  return value && typeof value === 'object' && value.__command === type;
}

function matchesWhere(doc, where = {}) {
  if (isCommand(where, 'and')) {
    return where.value.every((part) => matchesWhere(doc, part));
  }
  if (isCommand(where, 'or')) {
    return where.value.some((part) => matchesWhere(doc, part));
  }

  return Object.entries(where).every(([key, expected]) => {
    const actual = doc[key];

    if (isCommand(expected, 'or')) {
      return expected.value.some((part) => matchesValue(actual, part, doc, key));
    }

    return matchesValue(actual, expected, doc, key);
  });
}

function matchesValue(actual, expected, doc, key) {
    if (isCommand(expected, 'neq')) return actual !== expected.value;
    if (isCommand(expected, 'in')) return expected.value.includes(actual);
    if (isCommand(expected, 'nin')) return !expected.value.includes(actual);
    if (isCommand(expected, 'lt')) return actual < expected.value;
    if (isCommand(expected, 'gt')) return actual > expected.value;
    if (isCommand(expected, 'gte')) return actual >= expected.value;
    if (isCommand(expected, 'eq')) return actual === expected.value;
    if (isCommand(expected, 'exists')) {
      const exists = Object.prototype.hasOwnProperty.call(doc, key);
      return exists === expected.value;
    }

    return actual === expected;
}

function applyData(target, data = {}) {
  Object.entries(data).forEach(([key, value]) => {
    if (isCommand(value, 'inc')) {
      target[key] = Number(target[key] || 0) + value.value;
    } else {
      target[key] = value;
    }
  });
}

class Query {
  constructor(collection, where = {}) {
    this.collection = collection;
    this.whereClause = where;
    this.sortField = '';
    this.sortDirection = 'asc';
    this.skipCount = 0;
    this.limitCount = null;
  }

  where(where) {
    this.whereClause = where || {};
    return this;
  }

  orderBy(field, direction) {
    this.sortField = field;
    this.sortDirection = direction || 'asc';
    return this;
  }

  skip(count) {
    this.skipCount = count || 0;
    return this;
  }

  limit(count) {
    this.limitCount = count;
    return this;
  }

  _filtered() {
    let rows = this.collection.rows.filter((doc) => matchesWhere(doc, this.whereClause));
    if (this.sortField) {
      const direction = this.sortDirection === 'desc' ? -1 : 1;
      rows = rows.slice().sort((a, b) => {
        if (a[this.sortField] === b[this.sortField]) return 0;
        return a[this.sortField] > b[this.sortField] ? direction : -direction;
      });
    }
    return rows;
  }

  async get() {
    let rows = this._filtered();
    if (this.skipCount) rows = rows.slice(this.skipCount);
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    return { data: clone(rows) };
  }

  async count() {
    return { total: this._filtered().length };
  }

  async update({ data }) {
    let updated = 0;
    this.collection.rows.forEach((doc) => {
      if (matchesWhere(doc, this.whereClause)) {
        applyData(doc, data);
        updated += 1;
      }
    });
    return { stats: { updated } };
  }
}

class DocRef {
  constructor(collection, id) {
    this.collection = collection;
    this.id = id;
  }

  async get() {
    const doc = this.collection.rows.find((item) => item._id === this.id);
    return { data: doc ? clone(doc) : null };
  }

  async update({ data }) {
    const doc = this.collection.rows.find((item) => item._id === this.id);
    if (!doc) return { stats: { updated: 0 } };
    applyData(doc, data);
    return { stats: { updated: 1 } };
  }
}

class Collection {
  constructor(name, store, counters) {
    this.name = name;
    this.store = store;
    this.counters = counters;
    if (!this.store[name]) this.store[name] = [];
  }

  get rows() {
    return this.store[this.name];
  }

  where(where) {
    return new Query(this, where);
  }

  orderBy(field, direction) {
    return new Query(this).orderBy(field, direction);
  }

  skip(count) {
    return new Query(this).skip(count);
  }

  limit(count) {
    return new Query(this).limit(count);
  }

  doc(id) {
    return new DocRef(this, id);
  }

  async add({ data }) {
    const next = clone(data || {});
    if (!next._id) {
      this.counters[this.name] = (this.counters[this.name] || 0) + 1;
      next._id = `${this.name}_${this.counters[this.name]}`;
    }
    if (this.rows.some((item) => item._id === next._id)) {
      throw new Error(`duplicate key: ${next._id}`);
    }
    this.rows.push(next);
    return { _id: next._id };
  }

  async get() {
    return { data: clone(this.rows) };
  }

  async count() {
    return { total: this.rows.length };
  }
}

function createMockCloud(initialData = {}, options = {}) {
  const store = clone(initialData);
  const counters = {};
  const command = {
    inc: (value) => makeCommand('inc', value),
    neq: (value) => makeCommand('neq', value),
    in: (value) => makeCommand('in', value),
    nin: (value) => makeCommand('nin', value),
    lt: (value) => makeCommand('lt', value),
    gt: (value) => makeCommand('gt', value),
    gte: (value) => makeCommand('gte', value),
    eq: (value) => makeCommand('eq', value),
    exists: (value) => makeCommand('exists', value),
    and: (value) => makeCommand('and', value),
    or: (value) => makeCommand('or', value)
  };

  const db = {
    command,
    collection: (name) => new Collection(name, store, counters),
    serverDate: () => options.now || '2026-07-08T00:00:00.000Z'
  };

  return {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: options.openid || 'openid_test' }),
    openapi: {
      subscribeMessage: {
        send: async () => ({ errCode: 0 })
      }
    },
    __store: store,
    __db: db
  };
}

module.exports = {
  createMockCloud
};
