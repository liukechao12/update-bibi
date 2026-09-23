'use strict';

// Run: node scripts/data-quality-push.test.cjs
// Offline only: no .env, real Prisma client, customer/WeChat HTTP, or configuration writes.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const crypto = require('node:crypto');
const zod = require('zod');

require('ts-node').register({
  skipProject: true,
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', esModuleInterop: true }
});

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'src');
const allowedSources = new Set([
  'src/lib/push.ts', 'src/lib/push-config.ts', 'src/lib/push-workflow.ts',
  'src/lib/schemas.ts', 'src/lib/mapping.ts', 'src/lib/media-classification.ts',
  'src/lib/metric-capability.ts', 'src/app/api/push/jobs/route.ts', 'src/app/api/push/retry/route.ts'
].map((file) => path.join(root, file)));
const crawlTime = '2020-01-02T01:02:03.456Z';
const clone = (value) => structuredClone(value);
const ids = (count) => Array.from({ length: count }, (_, index) => `record-${index + 1}`);
const success = (count) => ({ inserted: count, failed: 0, errors: [] });
const allFailed = (count, message = 'offline rejection') => ({
  inserted: 0, failed: count,
  errors: Array.from({ length: count }, (_, index) => ({ index, error: message }))
});

function outgoing(index = 1, overrides = {}) {
  return {
    textId: `TEXT_${index}`, title: `Offline title ${index}`, text: `Offline content ${index}`,
    publishTime: '2020-01-01 08:00:00', crawlTime, author: 'Offline author',
    originType: 'media', publisherType: 'MEDIA', authorType: null,
    url: `https://example.invalid/article/${index}`,
    commentNum: 0, forwardNum: null, praiseNum: null, viewNum: null, ...overrides
  };
}

function stored(index = 1, overrides = {}) {
  return {
    ...outgoing(index), id: `record-${index}`, createdById: 'user-1', batchId: 'import-1',
    publishTime: new Date('2020-01-01T00:00:00.000Z'), crawlTime: new Date(crawlTime),
    createdAt: new Date(Date.parse('2020-01-02T02:00:00Z') + index),
    updatedAt: new Date(Date.now() - 1000), recordStatus: 'PENDING_PUSH',
    sourceName: 'Offline source', pushItems: [], ...overrides
  };
}

function history(status, overrides = {}) {
  return {
    status, pushType: 'CREATE', createdAt: new Date(Date.now() - 60_000),
    previousCommentNum: 0, previousForwardNum: null, previousPraiseNum: null, previousViewNum: null,
    pushJob: { status, updatedAt: new Date() }, ...overrides
  };
}

// Match the filters actually issued by Prisma calls; unsupported operators fail rather than pass.
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((part) => matches(row, part));
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every((part) => matches(row, part));
    if (key === 'NOT') return !(Array.isArray(value) ? value : [value]).some((part) => matches(row, part));
    const actual = row[key];
    if (value instanceof Date) return actual instanceof Date && actual.getTime() === value.getTime();
    if (value && typeof value === 'object') {
      return Object.entries(value).every(([operator, operand]) => {
        switch (operator) {
          case 'in': return operand.includes(actual);
          case 'notIn': return !operand.includes(actual);
          case 'not': return !matches({ value: actual }, { value: operand });
          case 'equals': return matches({ value: actual }, { value: operand });
          case 'gte': return actual >= operand;
          case 'gt': return actual > operand;
          case 'lte': return actual <= operand;
          case 'lt': return actual < operand;
          case 'none': return !(actual || []).some((item) => matches(item, operand));
          case 'some': return (actual || []).some((item) => matches(item, operand));
          default:
            assert.ok(actual && typeof actual === 'object', `unsupported filter ${key}.${operator}`);
            return matches(actual, { [operator]: operand });
        }
      });
    }
    return actual === value;
  });
}

function sortRows(rows, orderBy) {
  for (const order of (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean).reverse()) {
    const [key, direction] = Object.entries(order)[0];
    rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (direction === 'desc' ? -1 : 1));
  }
  return rows;
}

function memoryPrisma(options) {
  const state = {
    records: clone(options.records || []), jobs: clone(options.jobs || []), items: clone(options.items || []),
    batches: [{ id: 'import-1', status: 'PENDING_PUSH' }], calls: [], fetches: [], boundaryErrors: [], transactionDepth: 0
  };
  const log = (method, args) => state.calls.push({ method, args: clone(args) });
  const apply = (row, data) => {
    for (const [key, value] of Object.entries(data)) {
      row[key] = value && typeof value === 'object' && 'increment' in value
        ? (row[key] || 0) + value.increment : clone(value);
    }
    row.updatedAt = new Date();
  };
  function table(name, key) {
    return {
      async findUnique(args) {
        log(`${name}.findUnique`, args);
        return clone(state[key].find((row) => matches(row, args.where)) || null);
      },
      async findFirst(args) {
        log(`${name}.findFirst`, args);
        return clone(sortRows(state[key].filter((row) => matches(row, args.where)), args.orderBy)[0] || null);
      },
      async findMany(args = {}) {
        log(`${name}.findMany`, args);
        const rows = state[key].filter((row) => matches(row, args.where)).map(clone);
        if (name === 'dataRecord' && args.include?.pushItems) {
          for (const row of rows) {
            row.pushItems = sortRows([
              ...row.pushItems,
              ...state.items.filter((item) => item.recordId === row.id).map((item) => ({
                ...clone(item), pushJob: clone(state.jobs.find((job) => job.id === item.pushJobId))
              }))
            ], args.include.pushItems.orderBy);
          }
        }
        return sortRows(rows, args.orderBy);
      },
      async create({ data }) {
        log(`${name}.create`, { data });
        const row = { id: `${name}-${state[key].length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...clone(data) };
        state[key].push(row);
        return clone(row);
      },
      async createMany({ data }) {
        log(`${name}.createMany`, { data });
        for (const item of data) {
          state[key].push({ id: `${name}-${state[key].length + 1}`, createdAt: new Date(), ...clone(item) });
        }
        return { count: data.length };
      },
      async update({ where, data }) {
        log(`${name}.update`, { where, data });
        const row = state[key].find((item) => matches(item, where));
        assert.ok(row, `${name}.update must target an existing row`);
        apply(row, data);
        return clone(row);
      },
      async updateMany({ where, data }) {
        log(`${name}.updateMany`, { where, data });
        let rows = state[key].filter((row) => matches(row, where));
        if (name === 'dataRecord' && data.recordStatus === 'PUSHING') {
          assert.ok(where && (where.OR || where.updatedAt || where.recordStatus), 'claim must be conditional');
          if (options.claimCount !== undefined) rows = rows.slice(0, options.claimCount);
        }
        rows.forEach((row) => apply(row, data));
        return { count: rows.length };
      }
    };
  }
  const values = {
    VENDOR_API_URL: 'https://vendor.invalid/api/messages', VENDOR_API_TOKEN: 'offline-dummy-token',
    PUSH_BATCH_SIZE: '100', PUSH_MAX_RETRIES: '0', PUSH_TIMEOUT_MS: '10000', PUSH_API_VERSION: '3',
    ...options.config
  };
  const prisma = {
    user: { async findUnique(args) {
      log('user.findUnique', args);
      return options.missingUser ? null : { id: 'user-1', roles: options.admin ? [{ role: { roleCode: 'SUPER_ADMIN' } }] : [] };
    } },
    systemConfig: { async findUnique({ where }) {
      log('systemConfig.findUnique', { where });
      return values[where.configKey] === undefined ? null : { configValue: values[where.configKey] };
    } },
    mediaMetricCapability: { async findMany(args) {
      log('mediaMetricCapability.findMany', args);
      return [{ sourceName: 'Offline source', commentCollectable: true, forwardCollectable: true, praiseCollectable: true }];
    } },
    dataRecord: table('dataRecord', 'records'), dataBatch: table('dataBatch', 'batches'),
    pushJob: table('pushJob', 'jobs'), pushJobItem: table('pushJobItem', 'items'),
    async $transaction(callback) {
      assert.equal(typeof callback, 'function');
      const snapshot = clone({ records: state.records, jobs: state.jobs, items: state.items, batches: state.batches });
      state.transactionDepth += 1;
      try { return await callback(prisma); }
      catch (error) { Object.assign(state, snapshot); throw error; }
      finally { state.transactionDepth -= 1; }
    }
  };
  prisma.dataRecord.groupBy = async (args) => {
    log('dataRecord.groupBy', args);
    const groups = new Map();
    for (const row of state.records.filter((item) => matches(item, args.where))) {
      const key = `${row.batchId}:${row.recordStatus}`;
      const group = groups.get(key) || { batchId: row.batchId, recordStatus: row.recordStatus, _count: { _all: 0 } };
      group._count._all += 1;
      groups.set(key, group);
    }
    return [...groups.values()];
  };
  return { prisma, state };
}

function response(body, status = 200, headers = {}) {
  return {
    status, ok: status >= 200 && status < 300,
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    json: async () => clone(body)
  };
}

// Each case gets fresh TS modules, config cache, in-memory tables and a fail-closed module loader.
async function sandbox(options, run) {
  const { prisma, state } = memoryPrisma(options);
  const originalLoad = Module._load;
  const originalFetch = globalThis.fetch;
  const previousCache = new Map([...allowedSources].map((filename) => [filename, require.cache[filename]]));
  let sequence = 0;
  const mocks = {
    '@/lib/prisma': { prisma },
    '@/lib/env': { env: { VENDOR_API_TOKEN: 'offline-default-token' } },
    '@/lib/business-no': { generateBatchNo: () => `OFFLINE-BATCH-${++sequence}`, generateJobNo: () => `OFFLINE-JOB-${++sequence}` },
    '@prisma/client': { BatchStatus: {} },
    'next/server': { NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, json: async () => body }) } },
    '@/lib/api-auth': { requireApiUser: async () => options.auth || { user: { id: 'user-1', roles: options.admin ? ['SUPER_ADMIN'] : [] } } },
    ...(options.routeWorkflow ? { '@/lib/push-workflow': options.routeWorkflow } : {}),
    crypto, zod
  };
  for (const filename of allowedSources) delete require.cache[filename];
  Module._load = function (request, parent, isMain) {
    if (Object.hasOwn(mocks, request)) return mocks[request];
    if (parent?.filename?.startsWith(`${sourceRoot}${path.sep}`)) {
      const filename = request.startsWith('@/') ? path.join(sourceRoot, request.slice(2))
        : request.startsWith('.') ? path.resolve(path.dirname(parent.filename), request) : request;
      const resolved = filename.endsWith('.ts') ? filename : `${filename}.ts`;
      assert.ok(allowedSources.has(resolved), `offline test forbids unmocked import: ${request}`);
      return originalLoad.call(this, resolved, parent, isMain);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const fakeFetch = async (url, init) => {
    assert.equal(new URL(url).hostname, 'vendor.invalid', 'only the synthetic vendor URL is accepted');
    assert.equal(init.method, 'POST');
    const call = { url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) };
    state.fetches.push(call);
    assert.equal(state.transactionDepth, 0, 'network must not run inside a database transaction');
    if (options.workflow) {
      const job = state.jobs.at(-1);
      assert.ok(job, 'job must exist before sending');
      assert.deepEqual(job.requestBody, call.body, 'persisted request must equal transmitted payload');
      const items = state.items.filter((item) => item.pushJobId === job.id);
      assert.equal(items.length, call.body.records.length, 'every outgoing row needs an item');
      for (const [index, item] of items.entries()) {
        assert.equal(item.itemIndex, index + 1);
        const record = state.records.find((row) => row.id === item.recordId);
        assert.equal(record.textId, call.body.records[index].textId);
        assert.equal(record.recordStatus, 'PUSHING', 'record must be claimed before sending');
      }
    }
    assert.ok(options.fetch || options.workflow, 'this case must not send');
    return options.fetch ? options.fetch(call, state.fetches.length, state) : response(success(call.body.records.length));
  };
  globalThis.fetch = async (...args) => {
    try { return await fakeFetch(...args); }
    catch (error) {
      if (error.code === 'ERR_ASSERTION') state.boundaryErrors.push(error.message);
      throw error;
    }
  };
  try {
    const load = (file) => {
      const filename = path.join(root, file);
      assert.ok(allowedSources.has(filename));
      return require(filename);
    };
    const result = await run({ state, prisma, load });
    assert.deepEqual(state.boundaryErrors, [], 'business catch blocks must not swallow test assertions');
    return result;
  } finally {
    Module._load = originalLoad;
    globalThis.fetch = originalFetch;
    for (const [filename, cached] of previousCache) {
      delete require.cache[filename];
      if (cached) require.cache[filename] = cached;
    }
  }
}

function checkAllFailed(result, count) {
  assert.equal(result.inserted, 0);
  assert.equal(result.failed, count);
  assert.deepEqual(result.errors.map((entry) => entry.index).sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i));
}

for (const configured of ['1000', '101', '100', '99.9', '1', '0', '-3', 'NaN', 'Infinity', '']) {
  test(`getPushConfig: batchSize=${JSON.stringify(configured)} stays within 1..100`, async () => {
    await sandbox({ config: { PUSH_BATCH_SIZE: configured, PUSH_MAX_RETRIES: '0' } }, async ({ load }) => {
      const config = await load('src/lib/push-config.ts').getPushConfig();
      assert.ok(Number.isInteger(config.batchSize) && config.batchSize >= 1 && config.batchSize <= 100);
      if (Number(configured) >= 100) assert.equal(config.batchSize, 100);
      assert.equal(config.maxRetries, 0);
    });
  });
}

test('mapPushFailures: whole-chunk rejection with one error fails every row', async () => {
  await sandbox({}, async ({ load }) => {
    const failures = load('src/lib/push.ts').mapPushFailures({ inserted: 0, failed: 3, errors: [{ index: 0, error: 'batch rejected', code: 422 }] }, 3);
    assert.deepEqual([...failures.keys()], [0, 1, 2]);
    for (const item of failures.values()) assert.deepEqual(item, { error: 'batch rejected', code: 422 });
  });
});

test('mapPushFailures: valid success and noncontiguous partial indexes retain exact associations', async () => {
  await sandbox({}, async ({ load }) => {
    const { mapPushFailures } = load('src/lib/push.ts');
    assert.equal(mapPushFailures(success(4), 4).size, 0);
    const result = mapPushFailures({ inserted: 2, failed: 2, errors: [{ index: 3, error: 'last', code: 'BAD' }, { index: 1, error: 'second' }] }, 4);
    assert.deepEqual([...result.keys()].sort(), [1, 3]);
    assert.equal(result.get(3).error, 'last');
    assert.equal(result.get(3).code, 'BAD');
  });
});

const invalidReceipts = [
  ['negative counts', { inserted: -1, failed: 4, errors: [] }],
  ['fractional counts', { inserted: 1.5, failed: 1.5, errors: [] }],
  ['string counts', { inserted: '3', failed: 0, errors: [] }],
  ['counts do not add up', { inserted: 2, failed: 0, errors: [] }],
  ['missing counts', { errors: [] }],
  ['NaN counts', { inserted: NaN, failed: 0, errors: [] }],
  ['infinite counts', { inserted: Infinity, failed: 0, errors: [] }],
  ['duplicate indexes', { inserted: 1, failed: 2, errors: [{ index: 1, error: 'one' }, { index: 1, error: 'duplicate' }] }],
  ['missing index', { inserted: 2, failed: 1, errors: [{ error: 'missing' }] }],
  ['missing failure detail', { inserted: 2, failed: 1, errors: [] }],
  ['out-of-range index', { inserted: 2, failed: 1, errors: [{ index: 3, error: 'outside' }] }],
  ['negative index', { inserted: 2, failed: 1, errors: [{ index: -1, error: 'negative' }] }],
  ['fractional index', { inserted: 2, failed: 1, errors: [{ index: 0.5, error: 'fraction' }] }],
  ['string index', { inserted: 2, failed: 1, errors: [{ index: '1', error: 'string' }] }],
  ['null error entry', { inserted: 2, failed: 1, errors: [null] }],
  ['extra failure despite success counts', { inserted: 3, failed: 0, errors: [{ index: 1, error: 'extra' }] }]
];

for (const [label, receipt] of invalidReceipts) {
  test(`mapPushFailures: ${label} fails closed`, async () => {
    await sandbox({}, async ({ load }) => {
      assert.deepEqual([...load('src/lib/push.ts').mapPushFailures(receipt, 3).keys()], [0, 1, 2]);
    });
  });
  test(`pushBatch: ${label} cannot acknowledge unconfirmed rows`, async () => {
    await sandbox({ fetch: () => response(receipt) }, async ({ load, state }) => {
      let result;
      try { result = await load('src/lib/push.ts').pushBatch([outgoing(1), outgoing(2), outgoing(3)]); }
      catch (error) {
        assert.match(error.message, /回执|确认|格式/);
        assert.equal(state.fetches.length, 1);
        return;
      }
      checkAllFailed(result, 3);
      assert.equal(state.fetches.length, 1);
    });
  });
}

for (const [label, reply] of [
  ['non-JSON response', () => response(null, 200, { 'content-type': 'text/html' })],
  ['invalid JSON', () => ({ ...response(null), json: async () => { throw new SyntaxError('bad JSON'); } })],
  ['null body', () => response(null)],
  ['missing errors array', () => response({ inserted: 1, failed: 0 })],
  ['non-array errors', () => response({ inserted: 1, failed: 0, errors: {} })],
  ['non-string error', () => response({ inserted: 0, failed: 1, errors: [{ index: 0, error: {} }] })]
]) {
  test(`pushBatch: rejects ${label}`, async () => {
    await sandbox({ fetch: reply }, async ({ load, state }) => {
      await assert.rejects(load('src/lib/push.ts').pushBatch([outgoing()]), /回执|确认|格式/);
      assert.equal(state.fetches.length, 1);
    });
  });
}

test('pushBatch: maxRetries=0 still sends once and accepts a valid receipt', async () => {
  await sandbox({ fetch: () => response(success(1)) }, async ({ load, state }) => {
    assert.deepEqual(await load('src/lib/push.ts').pushBatch([outgoing()]), { ...success(1), httpStatus: 200 });
    assert.equal(state.fetches.length, 1);
    assert.equal(state.fetches[0].headers.get('authorization'), 'Bearer offline-dummy-token');
  });
});

test('pushBatch: valid partial receipt and a single whole-chunk error are mapped safely', async () => {
  const partial = { inserted: 2, failed: 1, errors: [{ index: 1, error: 'row rejected', code: 422 }] };
  await sandbox({ fetch: (_call, attempt) => response(attempt === 1 ? partial : { inserted: 0, failed: 3, errors: [{ index: 0, error: 'chunk rejected' }] }) }, async ({ load }) => {
    const push = load('src/lib/push.ts');
    const records = [outgoing(1), outgoing(2), outgoing(3)];
    assert.deepEqual(await push.pushBatch(records), { ...partial, httpStatus: 200 });
    checkAllFailed(await push.pushBatch(records), 3);
  });
});

for (const count of [0, 101]) {
  test(`pushBatch: ${count} rows rejected before fetch`, async () => {
    await sandbox({}, async ({ load, state }) => {
      await assert.rejects(load('src/lib/push.ts').pushBatch(Array.from({ length: count }, (_, i) => outgoing(i + 1))), /100/);
      assert.equal(state.fetches.length, 0);
    });
  });
}

test('pushBatch: exactly 100 rows accepted even with oversized saved batch config', async () => {
  await sandbox({ config: { PUSH_BATCH_SIZE: '1000' }, fetch: (call) => response(success(call.body.records.length)) }, async ({ load, state }) => {
    const result = await load('src/lib/push.ts').pushBatch(Array.from({ length: 100 }, (_, i) => outgoing(i + 1)));
    assert.equal(result.inserted, 100);
    assert.equal(state.fetches.length, 1);
  });
});

for (const key of [undefined, 'offline-fixed-idempotency-key']) {
  test(`pushBatch: 429 retry keeps ${key ? 'supplied' : 'generated'} UPDATE idempotency key and payload`, async () => {
    await sandbox({ config: { PUSH_MAX_RETRIES: '2' }, fetch: (_call, attempt) => attempt < 3
      ? response({ message: 'rate limited' }, 429, { 'retry-after': '0' }) : response(success(1)) }, async ({ load, state }) => {
      const result = await load('src/lib/push.ts').pushBatch([outgoing()], undefined, { pushType: 'UPDATE', idempotencyKey: key });
      assert.equal(result.inserted, 1);
      assert.equal(state.fetches.length, 3, 'maxRetries counts retries in addition to the initial attempt');
      const used = state.fetches.map((call) => call.headers.get('idempotency-key'));
      assert.ok(used[0]);
      assert.equal(new Set(used).size, 1);
      if (key) assert.equal(used[0], key);
      for (const call of state.fetches) {
        assert.equal(new URL(call.url).pathname, '/api/messages/revisions');
        assert.deepEqual(call.body, state.fetches[0].body);
        assert.equal(call.body.records[0].data.crawlTime, crawlTime);
      }
    });
  });
}

for (const maxRetries of [0, 2]) {
  test(`pushBatch: exhausted 429 with maxRetries=${maxRetries} makes exactly ${maxRetries + 1} attempts`, async () => {
    await sandbox({ config: { PUSH_MAX_RETRIES: String(maxRetries) }, fetch: () => response({ message: 'limited' }, 429, { 'retry-after': '0' }) }, async ({ load, state }) => {
      await assert.rejects(load('src/lib/push.ts').pushBatch([outgoing()], undefined, { pushType: 'UPDATE' }), /重试/);
      assert.equal(state.fetches.length, maxRetries + 1);
      assert.equal(new Set(state.fetches.map((call) => call.headers.get('idempotency-key'))).size, 1);
    });
  });
}

test('pushBatch: terminal HTTP rejection fails the whole chunk without retry', async () => {
  await sandbox({ config: { PUSH_MAX_RETRIES: '2' }, fetch: () => response({ message: 'unauthorized' }, 401) }, async ({ load, state }) => {
    checkAllFailed(await load('src/lib/push.ts').pushBatch([outgoing(1), outgoing(2)]), 2);
    assert.equal(state.fetches.length, 1);
  });
});

for (const pushType of ['CREATE', 'UPDATE']) {
  test(`buildVendorPushPayload: ${pushType} preserves original crawlTime and lowercase vendor enums`, async () => {
    await sandbox({}, async ({ load }) => {
      const { buildVendorPushPayload } = load('src/lib/push.ts');
      const records = [outgoing(1, { authorType: 'BLUE_V' })];
      const original = clone(records);
      const first = await buildVendorPushPayload(records, pushType);
      const second = await buildVendorPushPayload(records, pushType);
      assert.deepEqual(first, second);
      assert.deepEqual(records, original);
      const data = pushType === 'UPDATE' ? first.records[0].data : first.records[0];
      assert.equal(data.crawlTime, crawlTime);
      assert.equal(data.publisherType, 'media');
      assert.equal(data.authorType, 'blue_v');
      assert.equal(first.version, '3');
      if (pushType === 'UPDATE') assert.equal(first.records[0].changeType, 'update');
      await assert.rejects(buildVendorPushPayload([outgoing(1, { crawlTime: undefined })], pushType), /抓取时间/);
    });
  });
}

for (const [label, record, expected] of [
  ['no history', stored(), 'CREATE'],
  ['failed CREATE only', stored(1, { recordStatus: 'FAILED', pushItems: [history('FAILED')] }), 'CREATE'],
  ['pending after SUCCESS', stored(1, { pushItems: [history('SUCCESS')] }), 'UPDATE'],
  ['failed after SUCCESS', stored(1, { recordStatus: 'FAILED', pushItems: [history('FAILED'), history('SUCCESS')] }), 'UPDATE'],
  ['unchanged SUCCESS', stored(1, { recordStatus: 'SUCCESS', pushItems: [history('SUCCESS')] }), 'SKIP'],
  ['newer failed attempt must not replace SUCCESS baseline', stored(1, { recordStatus: 'SUCCESS', pushItems: [history('FAILED', { previousCommentNum: 99 }), history('SUCCESS')] }), 'SKIP'],
  ...['commentNum', 'forwardNum', 'praiseNum', 'viewNum'].map((field) => [`changed ${field}`, stored(1, { recordStatus: 'SUCCESS', [field]: 5, pushItems: [history('SUCCESS')] }), 'UPDATE'])
]) {
  test(`decidePushType: ${label} -> ${expected}`, async () => {
    await sandbox({}, async ({ load }) => assert.equal(load('src/lib/push.ts').decidePushType(record), expected));
  });
}

test('workflow: 101 records split into 100+1 with one-to-one persisted request/job/item associations', async () => {
  await sandbox({ workflow: true, records: Array.from({ length: 101 }, (_, i) => stored(i + 1)), config: { PUSH_BATCH_SIZE: '1000' } }, async ({ load, state }) => {
    const result = await load('src/lib/push-workflow.ts').pushExistingRecords('user-1', [...ids(101), 'record-1']);
    assert.deepEqual(state.fetches.map((call) => call.body.records.length), [100, 1]);
    assert.deepEqual(result.results.map((item) => item.inserted), [100, 1]);
    assert.equal(state.jobs.length, 2);
    assert.equal(state.items.length, 101);
    assert.equal(new Set(state.items.map((item) => item.recordId)).size, 101);
    assert.deepEqual(state.items.filter((item) => item.pushJobId === state.jobs[1].id).map((item) => item.itemIndex), [1]);
    assert.ok(state.items.every((item) => item.status === 'SUCCESS'));
    assert.ok(state.records.every((record) => record.recordStatus === 'SUCCESS'));
    assert.ok(state.fetches.every((call) => call.body.records.every((record) => record.crawlTime === crawlTime)));
    assert.equal(state.batches.find((batch) => batch.id === result.batchId).status, 'SUCCESS');
    assert.equal(state.batches.find((batch) => batch.id === 'import-1').status, 'SUCCESS');
  });
});

test('workflow: zero-based vendor indexes map to itemIndex-1, including a later chunk', async () => {
  await sandbox({ workflow: true, records: Array.from({ length: 101 }, (_, i) => stored(i + 1)), fetch: (_call, attempt) => response(attempt === 1
    ? { inserted: 98, failed: 2, errors: [{ index: 99, error: 'last in first chunk', code: 499 }, { index: 0, error: 'first', code: 'E_FIRST' }] }
    : { inserted: 0, failed: 1, errors: [{ index: 0, error: 'second chunk', code: 422 }] }) }, async ({ load, state }) => {
    const result = await load('src/lib/push-workflow.ts').pushExistingRecords('user-1', ids(101));
    assert.deepEqual(result.results.map((item) => [item.inserted, item.failed]), [[98, 2], [0, 1]]);
    assert.deepEqual(state.items.filter((item) => item.status === 'FAILED').map((item) => item.recordId), ['record-1', 'record-100', 'record-101']);
    assert.equal(state.items.find((item) => item.recordId === 'record-100').vendorResponseCode, '499');
    assert.equal(state.items.find((item) => item.recordId === 'record-101').errorMessage, 'second chunk');
    assert.equal(state.items.find((item) => item.recordId === 'record-2').errorMessage, null);
    assert.equal(state.records.find((record) => record.id === 'record-99').recordStatus, 'SUCCESS');
    assert.equal(state.records.find((record) => record.id === 'record-100').recordStatus, 'FAILED');
    assert.equal(state.batches.find((batch) => batch.id === result.batchId).status, 'PARTIAL_SUCCESS');
    assert.equal(state.batches.find((batch) => batch.id === 'import-1').status, 'PARTIAL_SUCCESS');
  });
});

test('workflow: inserted=0 failed=N with a single error marks all items FAILED', async () => {
  await sandbox({ workflow: true, records: [stored(1), stored(2), stored(3)], fetch: () => response({ inserted: 0, failed: 3, errors: [{ index: 0, error: 'batch rejected' }] }) }, async ({ load, state }) => {
    const result = await load('src/lib/push-workflow.ts').pushExistingRecords('user-1', ids(3));
    checkAllFailed(result.results[0], 3);
    assert.ok(state.items.every((item) => item.status === 'FAILED'));
    assert.ok(state.records.every((record) => record.recordStatus === 'FAILED'));
    assert.equal(state.jobs[0].failedCount, 3);
  });
});

for (const errorName of ['AbortError', 'TimeoutError']) {
  test(`workflow: ${errorName} remains in results and does not hide the next chunk`, async () => {
    await sandbox({ workflow: true, records: Array.from({ length: 101 }, (_, i) => stored(i + 1)), fetch: (call, attempt) => {
      if (attempt === 1) throw new DOMException('offline timeout', errorName);
      return response(success(call.body.records.length));
    } }, async ({ load, state }) => {
      const result = await load('src/lib/push-workflow.ts').pushExistingRecords('user-1', ids(101));
      assert.equal(result.results.length, 2);
      checkAllFailed(result.results[0], 100);
      assert.equal(result.results[1].inserted, 1);
      assert.match(result.results[0].errors[0].error, /超时/);
      assert.deepEqual(state.jobs.map((job) => [job.status, job.httpStatus, job.insertedCount, job.failedCount]), [['FAILED', 504, 0, 100], ['SUCCESS', 200, 1, 0]]);
      assert.equal(state.items.filter((item) => item.status === 'FAILED').length, 100);
      assert.equal(state.records.filter((record) => record.recordStatus === 'FAILED').length, 100);
      assert.equal(state.batches.find((batch) => batch.id === result.batchId).status, 'PARTIAL_SUCCESS');
    });
  });
}

test('workflow: ownership of every selected record is checked before any sending or claim', async () => {
  await sandbox({ workflow: true, records: [stored(1), stored(2, { createdById: 'other-user' })] }, async ({ load, state }) => {
    await assert.rejects(load('src/lib/push-workflow.ts').pushExistingRecords('user-1', ids(2)), /无权限/);
    assert.equal(state.fetches.length, 0);
    assert.equal(state.jobs.length, 0);
    assert.equal(state.items.length, 0);
    assert.ok(!state.calls.some((call) => /create|update/i.test(call.method)));
  });
});

test('workflow: SUPER_ADMIN may push another user record', async () => {
  await sandbox({ workflow: true, admin: true, records: [stored(1, { createdById: 'other-user' })] }, async ({ load, state }) => {
    const result = await load('src/lib/push-workflow.ts').pushExistingRecords('user-1', ids(1));
    assert.equal(result.results[0].inserted, 1);
    assert.equal(state.fetches.length, 1);
  });
});

for (const status of ['SENDING', 'RETRYING']) {
  test(`workflow: live ${status} prevents duplicate sends`, async () => {
    await sandbox({ workflow: true, records: [stored(1, { pushItems: [history(status)] })] }, async ({ load, state }) => {
      await assert.rejects(load('src/lib/push-workflow.ts').pushExistingRecords('user-1', ids(1)), /重复|推送/);
      assert.equal(state.fetches.length, 0);
      assert.equal(state.jobs.length, 0);
    });
  });
}

test('workflow: older SENDING with a newer SUCCESS does not permanently block UPDATE', async () => {
  const oldSending = history('SENDING', { createdAt: new Date(Date.now() - 120_000) });
  const newerSuccess = history('SUCCESS', { createdAt: new Date(Date.now() - 30_000) });
  await sandbox({ workflow: true, records: [stored(1, { recordStatus: 'FAILED', pushItems: [oldSending, newerSuccess] })] }, async ({ load, state }) => {
    const result = await load('src/lib/push-workflow.ts').pushExistingRecords('user-1', ids(1));
    assert.equal(result.results[0].inserted, 1);
    assert.equal(state.fetches.length, 1);
    assert.equal(state.jobs[0].pushType, 'UPDATE');
  });
});

test('workflow: expired PUSHING/SENDING may be reclaimed instead of blocking forever', async () => {
  const old = new Date(Date.now() - 600_000);
  await sandbox({ workflow: true, records: [stored(1, { recordStatus: 'PUSHING', updatedAt: old,
    pushItems: [history('SENDING', { createdAt: old, pushJob: { status: 'SENDING', updatedAt: old } })] })] }, async ({ load, state }) => {
    const result = await load('src/lib/push-workflow.ts').pushExistingRecords('user-1', ids(1));
    assert.equal(result.results[0].inserted, 1);
    assert.equal(state.fetches.length, 1);
  });
});

for (const claimCount of [0, 1]) {
  test(`workflow: conditional updateMany claiming ${claimCount}/2 rolls back and never sends`, async () => {
    await sandbox({ workflow: true, claimCount, records: [stored(1), stored(2)] }, async ({ load, state }) => {
      const before = clone(state.records);
      const result = await load('src/lib/push-workflow.ts').pushExistingRecords('user-1', ids(2));
      assert.equal(state.fetches.length, 0);
      assert.equal(state.jobs.length, 0);
      assert.equal(state.items.length, 0);
      assert.deepEqual(state.records, before);
      checkAllFailed(result.results[0], 2);
      assert.match(result.results[0].errors[0].error, /状态|变化|重试/);
    });
  });
}

test('workflow: unchanged SUCCESS is skipped without a new job or request', async () => {
  await sandbox({ workflow: true, records: [stored(1, { recordStatus: 'SUCCESS', pushItems: [history('SUCCESS')] })] }, async ({ load, state }) => {
    const result = await load('src/lib/push-workflow.ts').pushExistingRecords('user-1', ids(1));
    assert.equal(result.skipped, 1);
    assert.deepEqual(result.results, []);
    assert.equal(state.fetches.length, 0);
    assert.equal(state.jobs.length, 0);
  });
});

test('workflow: legacy null crawlTime uses fixed createdAt rather than the retry clock', async () => {
  const createdAt = new Date('2020-01-03T04:05:06.789Z');
  await sandbox({ workflow: true, records: [stored(1, { crawlTime: null, createdAt })], fetch: () => response(allFailed(1)) }, async ({ load, state }) => {
    const workflow = load('src/lib/push-workflow.ts');
    await workflow.pushExistingRecords('user-1', ids(1));
    await workflow.pushExistingRecords('user-1', ids(1));
    assert.equal(state.fetches.length, 2);
    assert.deepEqual(state.fetches.map((call) => call.body.records[0].crawlTime), [createdAt.toISOString(), createdAt.toISOString()]);
  });
});

const jobsRoute = 'src/app/api/push/jobs/route.ts';
const retryRoute = 'src/app/api/push/retry/route.ts';
const request = (body) => ({ json: async () => clone(body) });
const workflowResult = (result = success(1)) => ({ batchId: 'new-batch', batchNo: 'NEW-BATCH', results: [result] });

test('jobs POST records: save first, then push only persisted IDs, never the raw records', async () => {
  const calls = [];
  const records = [outgoing(1), outgoing(1), outgoing(2)];
  const result = workflowResult(success(2));
  await sandbox({ routeWorkflow: {
    saveParsedRecordsOnly: async (userId, input) => {
      calls.push(['save', userId, clone(input)]);
      return { createdRecords: [{ id: 'existing-legacy', textId: 'LEGACY_TEXT' }, { id: 'new-record', textId: 'TEXT_2' }] };
    },
    pushExistingRecords: async (userId, recordIds) => { calls.push(['push', userId, recordIds]); return result; }
  } }, async ({ load, state }) => {
    const reply = await load(jobsRoute).POST(request({ records }));
    assert.equal(reply.status, 200);
    assert.deepEqual(calls, [['save', 'user-1', records], ['push', 'user-1', ['existing-legacy', 'new-record']]]);
    assert.deepEqual(await reply.json(), { ...result, batches: 1 });
    assert.equal(state.calls.length, 0, 'route must not bypass workflow by directly creating records/jobs');
    assert.equal(state.fetches.length, 0);
  });
});

test('jobs POST records: failed save never starts a push', async () => {
  let pushes = 0;
  await sandbox({ routeWorkflow: {
    saveParsedRecordsOnly: async () => { throw new Error('offline save failed'); },
    pushExistingRecords: async () => { pushes += 1; return workflowResult(); }
  } }, async ({ load }) => {
    const reply = await load(jobsRoute).POST(request({ records: [outgoing()] }));
    assert.equal(reply.status, 500);
    assert.match((await reply.json()).message, /save failed/);
    assert.equal(pushes, 0);
  });
});

test('jobs POST recordIds: use existing-record workflow without saving', async () => {
  const calls = [];
  await sandbox({ routeWorkflow: {
    saveParsedRecordsOnly: async () => { calls.push('unexpected save'); },
    pushExistingRecords: async (userId, recordIds) => { calls.push([userId, recordIds]); return workflowResult(); }
  } }, async ({ load }) => {
    assert.equal((await load(jobsRoute).POST(request({ recordIds: ['stored-id'] }))).status, 200);
    assert.deepEqual(calls, [['user-1', ['stored-id']]]);
  });
});

test('jobs POST invalid input: no save, push, database writes or fetch', async () => {
  const calls = [];
  await sandbox({ routeWorkflow: {
    saveParsedRecordsOnly: async () => { calls.push('save'); },
    pushExistingRecords: async () => { calls.push('push'); }
  } }, async ({ load, state }) => {
    for (const body of [{ recordIds: [' '] }, { recordIds: [123] }, { records: [outgoing(1, { title: '' })] }, {}]) {
      assert.equal((await load(jobsRoute).POST(request(body))).status, 400);
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(state.calls, []);
    assert.equal(state.fetches.length, 0);
  });
});

function retryFixture() {
  return {
    jobs: [{ id: 'old-job', batchId: 'shared-batch', createdById: 'user-1', status: 'FAILED', retryCount: 7,
      requestBody: { records: ['historical payload'] }, responseBody: { inserted: 1, failed: 2, errors: [{ index: 1, error: 'original receipt' }] },
      httpStatus: 200, insertedCount: 1, failedCount: 2 }],
    items: [
      { id: 'old-success', pushJobId: 'old-job', recordId: 'already-successful', itemIndex: 1, status: 'SUCCESS' },
      { id: 'old-failed-1', pushJobId: 'old-job', recordId: 'failed-first', itemIndex: 2, status: 'FAILED', errorMessage: 'original error' },
      { id: 'old-failed-2', pushJobId: 'old-job', recordId: 'failed-second', itemIndex: 3, status: 'FAILED' },
      { id: 'old-duplicate', pushJobId: 'old-job', recordId: 'failed-first', itemIndex: 4, status: 'FAILED' },
      { id: 'other-job-item', pushJobId: 'other-job', recordId: 'unrelated-failure', itemIndex: 1, status: 'FAILED' }
    ],
    records: [stored(1, { id: 'unrelated-same-batch', batchId: 'shared-batch' })]
  };
}

for (const outcome of ['success', 'partial failure', 'throws']) {
  test(`retry POST ${outcome}: only FAILED job items retried; original receipt and items preserved`, async () => {
    const calls = [];
    const fixture = retryFixture();
    await sandbox({ ...fixture, routeWorkflow: {
      pushExistingRecords: async (userId, recordIds) => {
        calls.push([userId, recordIds]);
        if (outcome === 'throws') throw new Error('offline retry failed');
        return workflowResult(outcome === 'success' ? success(2) : { inserted: 1, failed: 1, errors: [{ index: 1, error: 'new failure' }] });
      }
    } }, async ({ load, state }) => {
      const reply = await load(retryRoute).POST(request({ jobId: 'old-job' }));
      assert.equal(reply.status, { success: 200, 'partial failure': 502, throws: 500 }[outcome]);
      assert.equal((await reply.json()).ok, outcome === 'success');
      assert.deepEqual(calls, [['user-1', ['failed-first', 'failed-second']]]);
      const lookup = state.calls.find((call) => call.method === 'pushJobItem.findMany');
      assert.deepEqual(lookup.args.where, { pushJobId: 'old-job', status: 'FAILED' });
      assert.ok(!state.calls.some((call) => call.method.startsWith('dataRecord.')), 'never enumerate the original batch');
      const writes = state.calls.filter((call) => /\.update|\.create/.test(call.method));
      for (const write of writes) {
        assert.equal(write.method, 'pushJob.update');
        assert.deepEqual(write.args, { where: { id: 'old-job' }, data: { retryCount: { increment: 1 } } });
      }
      if (outcome !== 'throws') assert.equal(state.jobs[0].retryCount, 8);
      const { retryCount, updatedAt, ...historical } = state.jobs[0];
      const { retryCount: previousRetryCount, ...original } = fixture.jobs[0];
      assert.ok(retryCount === previousRetryCount || retryCount === previousRetryCount + 1);
      assert.deepEqual(historical, original);
      assert.deepEqual(state.items, fixture.items);
      assert.equal(state.fetches.length, 0);
    });
  });
}

test('retry POST: no FAILED items returns 400 without retrying successes or incrementing count', async () => {
  const fixture = retryFixture();
  fixture.items = fixture.items.filter((item) => item.status === 'SUCCESS' || item.pushJobId !== 'old-job');
  let pushes = 0;
  await sandbox({ ...fixture, routeWorkflow: { pushExistingRecords: async () => { pushes += 1; return workflowResult(); } } }, async ({ load, state }) => {
    const reply = await load(retryRoute).POST(request({ jobId: 'old-job' }));
    assert.equal(reply.status, 400);
    assert.equal(pushes, 0);
    assert.deepEqual(state.jobs, fixture.jobs);
  });
});

test('retry POST: permission check precedes failed-item lookup and retry', async () => {
  const fixture = retryFixture();
  fixture.jobs[0].createdById = 'someone-else';
  let pushes = 0;
  await sandbox({ ...fixture, routeWorkflow: { pushExistingRecords: async () => { pushes += 1; return workflowResult(); } } }, async ({ load, state }) => {
    const reply = await load(retryRoute).POST(request({ jobId: 'old-job' }));
    assert.equal(reply.status, 403);
    assert.equal(pushes, 0);
    assert.ok(!state.calls.some((call) => call.method === 'pushJobItem.findMany'));
    assert.deepEqual(state.jobs, fixture.jobs);
  });
});

for (const httpStatus of [400, 429, 503]) {
  test(`workflow: preserves actual HTTP ${httpStatus} in the job log`, async () => {
    await sandbox({ workflow: true, records: [stored()], fetch: () => response({ message: 'offline rejection' }, httpStatus) }, async ({ load, state }) => {
      const result = await load('src/lib/push-workflow.ts').pushExistingRecords('user-1', ['record-1']);
      assert.equal(state.jobs[0].httpStatus, httpStatus);
      assert.equal(state.jobs[0].status, 'FAILED');
      assert.equal(result.results[0].failed, 1);
    });
  });
}

test('saveParsedRecordsOnly: duplicate inputs create one persisted record and preserve classifications and crawlTime', async () => {
  await sandbox({}, async ({ load, state }) => {
    const result = await load('src/lib/push-workflow.ts').saveParsedRecordsOnly('user-1', [outgoing(), outgoing()]);
    assert.equal(state.records.length, 1);
    assert.equal(result.createdRecords.length, 1);
    assert.equal(state.records[0].publisherType, 'MEDIA');
    assert.equal(state.records[0].authorType, null);
    assert.equal(state.records[0].crawlTime.toISOString(), crawlTime);
    assert.equal(state.fetches.length, 0);
  });
});

test('saveParsedRecordsOnly: URL matches preserve stored textId and update only that record', async () => {
  await sandbox({ records: [stored(1, { textId: 'LEGACY_ID', recordStatus: 'SUCCESS' })] }, async ({ load, state }) => {
    const result = await load('src/lib/push-workflow.ts').saveParsedRecordsOnly('user-1', [outgoing(1, { title: 'Changed title' })]);
    assert.equal(state.records.length, 1);
    assert.equal(state.records[0].title, 'Changed title');
    assert.equal(state.records[0].textId, 'LEGACY_ID');
    assert.equal(state.records[0].recordStatus, 'PENDING_PUSH');
    assert.deepEqual(result.createdRecords, [{ id: 'record-1', textId: 'LEGACY_ID' }]);
  });
});

test('saveParsedRecordsOnly: refreshing crawlTime alone does not mark successful content pending', async () => {
  await sandbox({ records: [stored(1, { recordStatus: 'SUCCESS' })] }, async ({ load, state }) => {
    await load('src/lib/push-workflow.ts').saveParsedRecordsOnly('user-1', [outgoing(1, { crawlTime: new Date().toISOString() })]);
    assert.equal(state.records[0].recordStatus, 'SUCCESS');
    assert.equal(state.records[0].crawlTime.toISOString(), crawlTime);
    assert.ok(!state.calls.some((call) => call.method === 'dataRecord.updateMany'));
  });
});

for (const overrides of [{ createdById: 'other-user' }, { recordStatus: 'PUSHING' }, { recordStatus: 'RETRYING' }]) {
  test(`saveParsedRecordsOnly: blocked writes roll back the entire submission ${JSON.stringify(overrides)}`, async () => {
    await sandbox({ records: [stored(1, overrides)] }, async ({ load, state }) => {
      const before = clone(state.records);
      await assert.rejects(load('src/lib/push-workflow.ts').saveParsedRecordsOnly('user-1', [outgoing(2), outgoing()]));
      assert.deepEqual(state.records, before);
      assert.equal(state.batches.length, 1);
      assert.equal(state.fetches.length, 0);
    });
  });
}
