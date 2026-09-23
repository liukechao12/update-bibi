const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const ExcelJS = require('exceljs');

// Only these pure modules and the four ingestion files may execute. All I/O boundaries are mocked.
const root = path.resolve(__dirname, '..');
const allowed = new Set([
  'src/lib/mapping.ts', 'src/lib/media-classification.ts', 'src/lib/schemas.ts',
  'src/lib/raw-parser.ts', 'src/lib/tencent-document-sync.ts',
  'src/app/api/records/route.ts', 'src/app/api/import/excel/route.ts'
]);
const compiled = new Map();
const receivedAt = '2026-09-01T01:02:03.456Z';
const originalCrawlTime = '2026-07-01T01:00:00.000Z';
const raw = {
  tendency: '中性', source: '样例来源', author: '样例作者', time: '2026-07-01 08:00:00',
  title: '样例标题', link: 'https://example.com/article?id=1', summary: '样例正文',
  commentNum: 0, forwardNum: null, praiseNum: null, viewNum: null
};
const toRow = (overrides = {}) => ({
  倾向性: raw.tendency, 来源: raw.source, 作者: raw.author, 时间: raw.time,
  标题: raw.title, 链接: raw.link, 简述: raw.summary, 评论数: '0', ...overrides
});
const toText = (row) => Object.entries(row).map(([key, value]) => `【${key}】${value}`).join('\n');
const clone = (value) => structuredClone(value);

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some((condition) => matches(row, condition));
    if (key === 'pushItems') return !(row.pushItems || []).some((item) => matches(item, value.none));
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
      if ('lte' in value) return row[key] != null && row[key] <= value.lte;
      return row[key] != null && matches(row[key], value);
    }
    return row[key] === value;
  });
}

function harness(options = {}) {
  let clock = Date.parse(receivedAt);
  const state = { records: [], writes: [], batches: [], events: [], pushes: [], guards: [], sourceUpdates: [], lookups: 0 };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
    static [Symbol.hasInstance](value) { return value instanceof Date; }
  }
  const user = { id: 'user-1', department: '测试部门' };
  function checkData(data) {
    assert.ok(Number.isFinite(data.publishTime.getTime()), 'InvalidDate must never reach persistence');
    assert.ok(Number.isFinite(data.crawlTime.getTime()), 'crawlTime must be persisted');
    assert.ok(data.publishTime <= data.crawlTime);
  }
  const prisma = {
    user: { findUnique: async () => user, findFirst: async () => user },
    mediaLibrary: { findFirst: async () => ({ id: 'media-1' }), create: async () => assert.fail('unexpected media creation') },
    dataBatch: {
      create: async ({ data }) => { state.batches.push(clone(data)); return { ...data, id: 'batch-1' }; },
      update: async ({ data }) => { state.batches.push(clone(data)); return data; }
    },
    documentSyncLog: {
      findFirst: async () => null,
      create: async () => ({ id: 'log-1' }),
      update: async ({ data }) => {
        const columns = new Set(['totalRows', 'createdCount', 'updatedCount', 'skippedCount', 'invalidCount', 'pushedCount', 'failedCount', 'status', 'details', 'errorMessage', 'finishedAt']);
        for (const key of Object.keys(data)) assert.ok(columns.has(key), `unknown DocumentSyncLog column: ${key}`);
        return data;
      }
    },
    dataRecord: {
      findFirst: async ({ where }) => {
        state.lookups += 1;
        const record = state.records.find((item) => matches(item, where));
        const snapshot = record ? clone(record) : null;
        if (record && options.race) record.recordStatus = 'PUSHING';
        if (record && options.pluginSourceRace) Object.assign(record, clone(options.pluginSourceRace));
        return snapshot;
      },
      create: async ({ data }) => {
        checkData(data);
        const saved = { ...clone(data), id: `saved-${state.records.length + 1}`, pushItems: [] };
        state.records.push(saved);
        state.writes.push(clone(data));
        return clone(saved);
      },
      update: async () => assert.fail('unguarded content update'),
      updateMany: async ({ where, data }) => {
        const sourceOnly = Object.keys(data).every((key) => ['lastPluginClientId', 'lastPluginReceivedAt'].includes(key));
        if (sourceOnly) {
          assert.deepEqual(Object.keys(data).sort(), ['lastPluginClientId', 'lastPluginReceivedAt']);
          assert.equal(typeof where.id, 'string', 'source-only updates must target the matched record');
          assert.ok(data.lastPluginReceivedAt instanceof Date);
          assert.deepEqual(clone(where), {
            id: where.id,
            OR: [{ lastPluginReceivedAt: null }, { lastPluginReceivedAt: { lte: clone(data.lastPluginReceivedAt) } }]
          }, 'source-only updates must atomically preserve a newer receipt');
          state.sourceUpdates.push(clone({ where, data }));
        } else {
          assert.equal(where.recordStatus?.not, 'PUSHING');
          assert.ok(where.pushItems?.none, 'active push items must be checked at write time');
          state.guards.push(clone(where));
        }
        const record = state.records.find((item) => matches(item, where));
        if (!record) return { count: 0 };
        if (!sourceOnly) {
          checkData(data);
          assert.equal(data.textId, undefined, 'URL matches must not replace the stored textId');
        }
        Object.assign(record, clone(data));
        state.writes.push(clone(data));
        return { count: 1 };
      }
    }
  };
  const mocks = {
    '@/lib/prisma': { prisma },
    '@/lib/api-auth': { requireApiUser: async () => {
      clock += 5000;
      return { user, ...(options.pluginClientId === undefined ? {} : { pluginClientId: options.pluginClientId }) };
    } },
    '@prisma/client': { MediaRuleType: { DOMAIN: 'DOMAIN' } },
    'next/server': { NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, json: async () => body }) } },
    '@/lib/business-no': { generateBatchNo: () => 'batch-number' },
    '@/lib/daily-event-sync': {
      syncDailyCollectionEvents: async (events) => {
        state.events.push(...clone(events));
        return { created: events.length, updated: 0 };
      }
    },
    '@/lib/push-workflow': {
      pushExistingRecords: async (userId, ids) => {
        state.pushes.push(clone(ids));
        return { results: [{ inserted: ids.length, failed: 0, errors: [] }] };
      }
    },
    '@/lib/push-config': {
      CONFIG_KEYS: { TENCENT_DOC_SHEET_IDS: 'sheets', TENCENT_DOC_RANGE: 'range' },
      getConfig: async (key) => { clock += 5000; return key === 'sheets' ? 'sheet-1' : 'A1:Z200'; }
    },
    '@/lib/tencent-doc-api': {
      getTencentDocSheets: async () => ({ properties: [{ sheetId: 'sheet-1' }] }),
      getTencentDocSheetData: async () => {
        const rows = options.rows || [toRow()];
        const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
        return { gridData: { rows: [headers, ...rows.map((row) => headers.map((key) => row[key] ?? ''))]
          .map((values) => ({ values: values.map((text) => typeof text === 'object' ? { cellValue: text } : { cellValue: { text } }) })) } };
      }
    },
    exceljs: ExcelJS, crypto: require('node:crypto'), zod: require('zod')
  };
  const context = vm.createContext({
    Date: ClockDate, Buffer, File, URL, URLSearchParams, console,
    process: { env: { TENCENT_DOC_FILE_ID: 'offline-file' } },
    fetch: () => assert.fail('network access is forbidden')
  });
  const cache = new Map();
  function load(relative) {
    assert.ok(allowed.has(relative), `unmocked dependency: ${relative}`);
    if (cache.has(relative)) return cache.get(relative).exports;
    const filename = path.join(root, relative);
    if (!compiled.has(filename)) {
      compiled.set(filename, ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
      }).outputText);
    }
    const mod = { exports: {} };
    cache.set(relative, mod);
    const localRequire = (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      const resolved = id.startsWith('@/') ? `src/${id.slice(2)}.ts`
        : path.relative(root, path.resolve(path.dirname(filename), `${id}.ts`));
      return load(resolved);
    };
    const run = vm.runInContext(`(function(require,module,exports){${compiled.get(filename)}\n})`, context, { filename });
    run(localRequire, mod, mod.exports);
    return mod.exports;
  }
  const mapping = load('src/lib/mapping.ts');
  function payload(overrides = {}) { return { ...mapping.mapRawRecordToPushRecord(raw), ...overrides }; }
  function seed(overrides = {}) {
    const input = payload();
    const record = {
      ...input, id: 'stored-1', textId: 'LEGACY_ID', recordStatus: 'SUCCESS',
      publishTime: new Date('2026-07-01T00:00:00.000Z'), crawlTime: new Date(originalCrawlTime),
      tendency: raw.tendency, sourceName: raw.source, pushItems: [],
      lastPluginClientId: null, lastPluginReceivedAt: null, ...overrides
    };
    state.records.push(record);
    return record;
  }
  async function run(kind, recordsBody) {
    if (kind === 'records') {
      const response = await load('src/app/api/records/route.ts').POST({
        json: async () => recordsBody || { records: [payload({ crawlTime: undefined, tendency: raw.tendency, sourceName: raw.source })] }
      });
      return { status: response.status, ...await response.json() };
    }
    if (kind === 'tencent') return load('src/lib/tencent-document-sync.ts').runTencentDocumentSync('MANUAL');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('offline');
    const rows = options.rows || [toRow()];
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(headers.map((key) => row[key] ?? '')));
    const buffer = await workbook.xlsx.writeBuffer();
    const response = await load('src/app/api/import/excel/route.ts').POST({
      formData: async () => new Map([['file', new File([buffer], 'offline.xlsx')]])
    });
    return { status: response.status, ...await response.json() };
  }
  return { state, load, payload, seed, run };
}

for (const label of ['采集时间', '抓取时间', '爬取时间', 'crawlTime']) {
  test(`raw parser: ${label} respects timezone and stays in its source block`, () => {
    const { load } = harness();
    const parser = load('src/lib/raw-parser.ts');
    const first = toText(toRow({ [label]: '2026-07-01 09:00:00' }));
    const second = toText(toRow({ 链接: 'https://example.com/article?id=2', [label]: '2026-07-01T03:00:00+02:00' }));
    const records = parser.parseRawTextRecords(`${first}\n\n${second}`);
    assert.equal(records.length, 2);
    assert.equal(records[0].crawlTime, originalCrawlTime);
    assert.equal(records[1].crawlTime, originalCrawlTime);
    assert.equal(parser.extractRawBlocks(`${first}\n\n${second}`)[1], second);
    assert.equal(parser.parseRawTextRecords(toText(toRow()))[0].crawlTime, undefined);
    assert.equal(parser.parseRawTextRecords(toText(toRow({ [label]: 'bad-time' })))[0].crawlTime, 'bad-time');
  });
}

test('records: batch validation rejects invalid dates, objects, blanks, future times and publish > crawl before writes', async () => {
  for (const dirty of [
    { publishTime: 'bad-time' }, { publishTime: '2026-02-30 08:00:00' },
    { publishTime: '2099-01-01 08:00:00' }, { title: '  ' }, { text: '[object Object]' },
    { author: '[object Object]' }, { crawlTime: '' }, { crawlTime: 'bad-time' },
    { crawlTime: '2026-06-30T23:00:00.000Z' }
  ]) {
    const h = harness();
    const result = await h.run('records', { records: [h.payload(), h.payload({ textId: 'second', ...dirty })] });
    assert.equal(result.status, 400);
    assert.equal(result.code, 40002);
    assert.equal(h.state.batches.length, 0);
    assert.equal(h.state.lookups, 0);
    assert.equal(h.state.writes.length, 0);
  }
});

test('records: sourceText retains future-time business error', async () => {
  const h = harness();
  const result = await h.run('records', { sourceText: toText(toRow({ 时间: '2099-01-01 08:00:00' })) });
  assert.equal(result.status, 422);
  assert.equal(result.code, 40005);
  assert.equal(result.futureRows[0].index, 0);
  assert.equal(h.state.writes.length, 0);
});

test('records: sourceText, source row indexes and original crawl times survive deduplication', async () => {
  const first = toText(toRow({ 采集时间: '2026-07-01 09:00:00' }));
  const third = toText(toRow({ 链接: 'https://example.com/article?id=3', 来源: '第三行来源', 抓取时间: '2026-07-01 10:00:00' }));
  const h = harness();
  const result = await h.run('records', { sourceText: `${first}\n${first}\n${third}` });
  assert.equal(result.saved, 2);
  const saved = h.state.records[1];
  assert.equal(saved.sourceRowNo, 3);
  assert.equal(saved.sourceName, '第三行来源');
  assert.equal(saved.crawlTime.toISOString(), '2026-07-01T02:00:00.000Z');
  assert.equal(JSON.parse(saved.rawSourceText).sourceText, third);
  assert.equal(JSON.parse(saved.rawSourceText).crawlTime, '2026-07-01T02:00:00.000Z');
  assert.equal(h.state.events[1].rowNo, 3);
});

function assertPluginReceipt(data, clientId, time = receivedAt) {
  assert.equal(data.lastPluginClientId, clientId);
  assert.equal(data.lastPluginReceivedAt.toISOString(), time);
}

function assertDuplicateWithoutPush(h, result) {
  assert.equal(result.status, 200);
  assert.equal(result.duplicate, 1);
  assert.equal(result.saved, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.canPush, false);
  assert.deepEqual(Array.from(result.savedRecordIds), []);
  assert.equal(result.preview[0].textId, 'LEGACY_ID');
  assert.equal(h.state.events.length, 0);
  assert.equal(h.state.pushes.length, 0);
}

for (const input of ['records', 'sourceText']) {
  test(`records: plugin creation via ${input} persists trusted receipt with the business write`, async () => {
    const h = harness({ pluginClientId: 'plugin-trusted' });
    const body = input === 'sourceText'
      ? { sourceText: toText(toRow({ 采集时间: originalCrawlTime })) }
      : { records: [h.payload({ tendency: raw.tendency, sourceName: raw.source, crawlTime: originalCrawlTime })] };
    const result = await h.run('records', body);
    assert.equal(result.status, 200);
    assert.equal(result.saved, 1);
    assert.equal(h.state.records.length, 1);
    assert.equal(h.state.writes.length, 1);
    assert.equal(h.state.sourceUpdates.length, 0, 'creation must not need a second source-only write');
    assert.equal(h.state.guards.length, 0);
    assertPluginReceipt(h.state.writes[0], 'plugin-trusted');
    assertPluginReceipt(h.state.records[0], 'plugin-trusted');
    assert.equal(h.state.records[0].crawlTime.toISOString(), originalCrawlTime);
    assert.equal(h.state.events.length, 1);
    assert.deepEqual(Array.from(result.savedRecordIds), [h.state.records[0].id]);
  });
}

test('records: plugin content update retains legacy textId and marks source in the guarded write', async () => {
  const h = harness({ pluginClientId: 'plugin-trusted' });
  h.seed({ sourceName: '旧来源', lastPluginClientId: 'plugin-old', lastPluginReceivedAt: new Date(originalCrawlTime) });
  const result = await h.run('records');
  assert.equal(result.status, 200);
  assert.equal(result.updated, 1);
  assert.equal(result.saved, 1);
  assert.equal(h.state.records.length, 1);
  assert.equal(h.state.writes.length, 1);
  assert.equal(h.state.guards.length, 1);
  assert.equal(h.state.sourceUpdates.length, 0, 'content and source must be written together');
  assertPluginReceipt(h.state.writes[0], 'plugin-trusted');
  assertPluginReceipt(h.state.records[0], 'plugin-trusted');
  assert.equal(h.state.records[0].textId, 'LEGACY_ID');
  assert.equal(h.state.records[0].sourceName, raw.source);
  assert.equal(h.state.events.length, 1);
  assert.equal(h.state.events[0].record.textId, 'LEGACY_ID');
  assert.equal(result.preview[0].textId, 'LEGACY_ID');
  assert.deepEqual(Array.from(result.savedRecordIds), ['stored-1']);
});

for (const previousReceipt of [null, originalCrawlTime, receivedAt]) {
  test(`records: unchanged plugin row associates source only for receipt ${previousReceipt}`, async () => {
    const h = harness({ pluginClientId: 'plugin-trusted' });
    h.seed({ lastPluginClientId: previousReceipt ? 'plugin-old' : null,
      lastPluginReceivedAt: previousReceipt ? new Date(previousReceipt) : null });
    const before = clone(h.state.records[0]);
    const other = clone(h.seed({ id: 'stored-2', textId: 'OTHER_ID', url: 'https://example.com/other' }));
    const result = await h.run('records');
    assertDuplicateWithoutPush(h, result);
    assert.equal(h.state.sourceUpdates.length, 1);
    assert.equal(h.state.guards.length, 0);
    assert.equal(h.state.writes.length, 1);
    assert.deepEqual(h.state.writes[0], { lastPluginClientId: 'plugin-trusted', lastPluginReceivedAt: new Date(receivedAt) });
    assert.deepEqual(h.state.records[0], { ...before, ...h.state.writes[0] });
    assert.deepEqual(h.state.records[1], other, 'source association must not touch unrelated records');
  });
}

for (const scenario of ['created', 'updated', 'unchanged']) {
  test(`records: repeated plugin rows in one request are deduplicated before ${scenario} writes`, async () => {
    const h = harness({ pluginClientId: 'plugin-trusted' });
    if (scenario !== 'created') h.seed(scenario === 'updated' ? { sourceName: '旧来源' } : {});
    const record = h.payload({ tendency: raw.tendency, sourceName: raw.source });
    const result = await h.run('records', { records: [record, clone(record), clone(record)] });
    assert.equal(result.status, 200);
    assert.equal(result.total, 3);
    assert.equal(result.preview.length, 1);
    assert.equal(h.state.lookups, 1);
    assert.equal(h.state.records.length, 1);
    assert.equal(h.state.writes.length, 1);
    assert.equal(h.state.sourceUpdates.length, scenario === 'unchanged' ? 1 : 0);
    assert.equal(h.state.guards.length, scenario === 'updated' ? 1 : 0);
    assertPluginReceipt(h.state.records[0], 'plugin-trusted');
    if (scenario === 'unchanged') {
      assertDuplicateWithoutPush(h, result);
    } else {
      assert.equal(result.saved, 1);
      assert.equal(result.updated, scenario === 'updated' ? 1 : 0);
      assert.equal(result.duplicate, 0);
      assert.equal(result.savedRecordIds.length, 1);
      assert.equal(h.state.events.length, 1);
    }
  });
}

for (const race of [false, true]) {
  test(`records: unchanged plugin receipt cannot overwrite a newer ${race ? 'concurrent' : 'stored'} receipt`, async () => {
    const newer = { lastPluginClientId: 'plugin-newer', lastPluginReceivedAt: new Date('2026-09-01T01:02:04.456Z') };
    const h = harness({ pluginClientId: 'plugin-older-request', ...(race ? { pluginSourceRace: newer } : {}) });
    h.seed(race ? {} : newer);
    const before = clone(h.state.records[0]);
    const result = await h.run('records');
    assertDuplicateWithoutPush(h, result);
    assert.equal(h.state.sourceUpdates.length, 1);
    assertPluginReceipt(h.state.sourceUpdates[0].data, 'plugin-older-request');
    assert.equal(h.state.writes.length, 0);
    assert.equal(h.state.guards.length, 0);
    assert.deepEqual(h.state.records[0], { ...before, ...newer });
  });
}

test('records: ordinary Cookie creation does not write plugin source fields', async () => {
  const h = harness();
  const result = await h.run('records');
  assert.equal(result.saved, 1);
  assert.equal(h.state.sourceUpdates.length, 0);
  for (const data of [h.state.writes[0], h.state.records[0]]) {
    assert.equal(Object.hasOwn(data, 'lastPluginClientId'), false);
    assert.equal(Object.hasOwn(data, 'lastPluginReceivedAt'), false);
  }
});

for (const marked of [false, true]) {
  for (const changed of [false, true]) {
    test(`records: Cookie ${changed ? 'update' : 'duplicate'} neither marks nor clears ${marked ? 'marked' : 'unmarked'} rows`, async () => {
      const h = harness();
      h.seed({ ...(changed ? { sourceName: '旧来源' } : {}),
        ...(marked ? { lastPluginClientId: 'plugin-old', lastPluginReceivedAt: new Date(originalCrawlTime) } : {}) });
      const before = clone(h.state.records[0]);
      const result = await h.run('records');
      assert.equal(result.status, 200);
      assert.equal(h.state.sourceUpdates.length, 0);
      assert.equal(h.state.writes.length, changed ? 1 : 0);
      assert.equal(h.state.records[0].lastPluginClientId, before.lastPluginClientId);
      assert.deepEqual(h.state.records[0].lastPluginReceivedAt, before.lastPluginReceivedAt);
      for (const data of h.state.writes) {
        assert.equal(Object.hasOwn(data, 'lastPluginClientId'), false);
        assert.equal(Object.hasOwn(data, 'lastPluginReceivedAt'), false);
      }
      if (changed) {
        assert.equal(result.updated, 1);
        assert.equal(h.state.records[0].sourceName, raw.source);
      } else {
        assertDuplicateWithoutPush(h, result);
        assert.deepEqual(h.state.records[0], before);
      }
    });
  }
}

for (const pluginClientId of [undefined, 'plugin-trusted']) {
  for (const scenario of ['created', 'updated', 'unchanged']) {
    test(`records: ${pluginClientId ? 'plugin' : 'Cookie'} ${scenario} ignores JSON-forged plugin identity and receipt`, async () => {
      const h = harness({ pluginClientId });
      if (scenario !== 'created') h.seed({ lastPluginClientId: 'plugin-old', lastPluginReceivedAt: new Date(originalCrawlTime),
        ...(scenario === 'updated' ? { sourceName: '旧来源' } : {}) });
      const forged = { pluginClientId: 'plugin-forged-row', lastPluginClientId: 'plugin-forged-source', lastPluginReceivedAt: '2099-01-01T00:00:00.000Z' };
      const result = await h.run('records', {
        ...forged, pluginClientId: 'plugin-forged-envelope',
        records: [h.payload({ tendency: raw.tendency, sourceName: raw.source, ...forged })]
      });
      assert.equal(result.status, 200);
      assert.equal(h.state.records.length, 1);
      assert.equal(h.state.writes.length, scenario === 'unchanged' && !pluginClientId ? 0 : 1);
      if (pluginClientId) {
        assertPluginReceipt(h.state.records[0], pluginClientId);
        assertPluginReceipt(h.state.writes[0], pluginClientId);
      } else {
        assert.equal(h.state.sourceUpdates.length, 0);
        if (scenario === 'created') {
          assert.equal(Object.hasOwn(h.state.records[0], 'lastPluginClientId'), false);
          assert.equal(Object.hasOwn(h.state.records[0], 'lastPluginReceivedAt'), false);
        } else {
          assertPluginReceipt(h.state.records[0], 'plugin-old', originalCrawlTime);
        }
        for (const data of h.state.writes) {
          assert.equal(Object.hasOwn(data, 'lastPluginClientId'), false);
          assert.equal(Object.hasOwn(data, 'lastPluginReceivedAt'), false);
        }
      }
      if (scenario === 'unchanged') assertDuplicateWithoutPush(h, result);
      else assert.equal(result.saved, 1);
    });
  }
}

for (const marked of [false, true]) {
  for (const invalid of ['schema', 'future', 'tendency']) {
    test(`records: plugin ${invalid} rejection leaves ${marked ? 'marked' : 'unmarked'} rows untouched`, async () => {
      const h = harness({ pluginClientId: 'plugin-trusted' });
      h.seed(marked ? { lastPluginClientId: 'plugin-old', lastPluginReceivedAt: new Date(originalCrawlTime) } : {});
      const before = clone(h.state.records);
      const body = invalid === 'schema'
        ? { records: [h.payload({ tendency: raw.tendency, sourceName: raw.source }),
          h.payload({ textId: 'new-row', url: 'https://example.com/new' }), h.payload({ textId: 'invalid-row', publishTime: 'bad-time' })] }
        : { sourceText: toText(toRow(invalid === 'future' ? { 时间: '2099-01-01 08:00:00' } : { 倾向性: '' })) };
      const result = await h.run('records', body);
      assert.equal(result.status, invalid === 'schema' ? 400 : 422);
      assert.equal(result.code, { schema: 40002, future: 40005, tendency: 40004 }[invalid]);
      assert.deepEqual(h.state.records, before);
      assert.equal(h.state.writes.length, 0);
      assert.equal(h.state.sourceUpdates.length, 0);
      assert.equal(h.state.lookups, 0);
      assert.equal(h.state.events.length, 0);
      assert.equal(h.state.pushes.length, 0);
    });
  }

  for (const lock of [
    { name: 'PUSHING', recordStatus: 'PUSHING' },
    { name: 'SENDING item', pushItems: [{ status: 'SENDING', pushJob: { status: 'SENDING' } }] },
    { name: 'RETRYING item', pushItems: [{ status: 'RETRYING', pushJob: { status: 'RETRYING' } }] },
    { name: 'active parent job', pushItems: [{ status: 'FAILED', pushJob: { status: 'SENDING' } }] },
    { name: 'historical transient item', pushItems: [{ status: 'SENDING', pushJob: { status: 'FAILED' } }] },
    { name: 'race after lookup', race: true }
  ]) {
    test(`records: plugin ${lock.name} rejection preserves ${marked ? 'marked' : 'unmarked'} source`, async () => {
      const h = harness({ pluginClientId: 'plugin-trusted', race: lock.race });
      h.seed({ sourceName: '旧来源', ...(marked ? { lastPluginClientId: 'plugin-old', lastPluginReceivedAt: new Date(originalCrawlTime) } : {}),
        ...('recordStatus' in lock ? { recordStatus: lock.recordStatus } : {}),
        ...('pushItems' in lock ? { pushItems: lock.pushItems } : {}) });
      const before = clone(h.state.records[0]);
      const result = await h.run('records');
      assert.equal(result.status, 200);
      assert.equal(result.blocked, 1);
      assert.equal(result.saved, 0);
      assert.equal(result.updated, 0);
      assert.equal(result.canPush, false);
      assert.deepEqual(Array.from(result.savedRecordIds), []);
      assert.match(JSON.stringify(result.blockedRecords), /禁止覆盖在途内容/);
      assert.deepEqual(h.state.records[0], lock.race ? { ...before, recordStatus: 'PUSHING' } : before);
      assert.equal(h.state.writes.length, 0);
      assert.equal(h.state.sourceUpdates.length, 0);
      assert.equal(h.state.events.length, 0);
      assert.equal(h.state.pushes.length, 0);
    });
  }
}

for (const kind of ['records', 'excel', 'tencent']) {
  test(`${kind}: absent crawlTime uses function-entry receivedAt`, async () => {
    const h = harness();
    const result = await h.run(kind);
    assert.equal(result.saved ?? result.createdCount, 1);
    assert.equal(h.state.writes[0].crawlTime.toISOString(), receivedAt);
    assert.equal(h.state.events[0].record.crawlTime, receivedAt);
  });

  test(`${kind}: supplied crawlTime is persisted, not replaced`, async () => {
    const h = harness({ rows: [toRow({ 抓取时间: '2026-07-01T03:00:00+02:00' })] });
    await h.run(kind, { records: [h.payload({ crawlTime: originalCrawlTime })] });
    assert.equal(h.state.writes[0].crawlTime.toISOString(), originalCrawlTime);
  });

  test(`${kind}: sourceName-only update retains stored identity and reaches event sync`, async () => {
    const h = harness();
    h.seed({ sourceName: '旧来源' });
    const result = await h.run(kind);
    assert.equal(result.updated ?? result.updatedCount, 1);
    assert.equal(h.state.records[0].textId, 'LEGACY_ID');
    assert.equal(h.state.writes[0].sourceName, raw.source);
    assert.equal(h.state.writes[0].crawlTime.toISOString(), receivedAt);
    assert.equal(h.state.events[0].record.textId, 'LEGACY_ID');
    if (kind === 'records') {
      assert.equal(result.preview[0].textId, 'LEGACY_ID');
      assert.deepEqual(Array.from(result.savedRecordIds), ['stored-1']);
    } else {
      assert.deepEqual(h.state.pushes[0], ['stored-1']);
    }
  });

  test(`${kind}: crawlTime-only refresh is skipped without rewriting history or syncing events`, async () => {
    const h = harness();
    h.seed();
    const before = clone(h.state.records[0]);
    const result = await h.run(kind);
    assert.equal(result.duplicate ?? result.skipped ?? result.skippedCount, 1);
    assert.deepEqual(h.state.records[0], before);
    assert.equal(h.state.writes.length, 0);
    assert.equal(h.state.events.length, 0);
    assert.equal(h.state.pushes.length, 0);
    if (kind === 'records') assert.equal(result.preview[0].textId, 'LEGACY_ID');
  });

  for (const lock of [
    { name: 'PUSHING', recordStatus: 'PUSHING' },
    { name: 'SENDING item', pushItems: [{ status: 'SENDING', pushJob: { status: 'SENDING' } }] },
    { name: 'RETRYING item', pushItems: [{ status: 'RETRYING', pushJob: { status: 'RETRYING' } }] },
    { name: 'active parent job', pushItems: [{ status: 'FAILED', pushJob: { status: 'SENDING' } }] },
    { name: 'historical transient item', pushItems: [{ status: 'SENDING', pushJob: { status: 'FAILED' } }] },
    { name: 'race after lookup', race: true }
  ]) {
    test(`${kind}: ${lock.name} blocks content changes and event sync`, async () => {
      const h = harness({ race: lock.race });
      h.seed({ sourceName: '旧来源', ...('recordStatus' in lock ? { recordStatus: lock.recordStatus } : {}),
        ...('pushItems' in lock ? { pushItems: lock.pushItems } : {}) });
      const before = clone(h.state.records[0]);
      const result = await h.run(kind);
      assert.equal(h.state.writes.length, 0);
      assert.equal(h.state.events.length, 0);
      assert.equal(h.state.pushes.length, 0);
      assert.deepEqual(h.state.records[0], lock.race ? { ...before, recordStatus: 'PUSHING' } : before);
      assert.match(JSON.stringify(result.blockedRecords ?? result.invalidRows), /禁止覆盖在途内容/);
      if (kind === 'records') assert.equal(result.canPush, false);
    });
  }
}

for (const field of ['originType', 'publisherType', 'authorType']) {
  test(`tencent: changing only ${field} triggers an update`, async () => {
    const h = harness();
    const previous = { originType: 'wb', publisherType: 'MEDIA', authorType: 'BLUE_V' }[field];
    assert.notEqual(h.payload()[field], previous);
    h.seed({ [field]: previous });
    const result = await h.run('tencent');
    assert.equal(result.updatedCount, 1);
    assert.equal(h.state.events[0].record.textId, 'LEGACY_ID');
  });
}

for (const kind of ['excel', 'tencent']) {
  test(`${kind}: invalid rows keep business error shape and never save InvalidDate`, async () => {
    const h = harness({ rows: [
      toRow({ 时间: 'bad-time' }), toRow({ 时间: '2099-01-01 08:00:00' }),
      toRow({ 抓取时间: '2026-06-01 08:00:00' }), toRow({ 抓取时间: '[object Object]' }),
      toRow({ 简述: '[object Object]' }), toRow({ 链接: 'https://example.com/valid' })
    ] });
    const result = await h.run(kind);
    assert.equal(result.invalid ?? result.invalidCount, 5);
    assert.equal(h.state.writes.length, 1);
    assert.equal(result.invalidRows[0].rowNo, 2);
    assert.match(JSON.stringify(result.invalidRows[1]), /发布时间晚于当前时间/);
    assert.ok(kind === 'excel' ? Array.isArray(result.invalidRows[0].missing) : typeof result.invalidRows[0].reason === 'string');
  });
}

test('excel: date cells and formula dates use Beijing wall time regardless of host TZ', async () => {
  const h = harness({ rows: [toRow({
    时间: new Date('2026-07-01T08:00:00.000Z'),
    采集时间: { formula: 'A1', result: new Date('2026-07-01T09:00:00.000Z') }
  })] });
  const result = await h.run('excel');
  assert.equal(result.saved, 1);
  assert.equal(h.state.writes[0].publishTime.toISOString(), '2026-07-01T00:00:00.000Z');
  assert.equal(h.state.writes[0].crawlTime.toISOString(), originalCrawlTime);
});

for (const value of ['2026-07-01 08:00:00', new Date('2026-07-01T08:00:00.000Z')]) {
  test(`excel: 发布时间 header accepts ${typeof value === 'string' ? 'text' : 'date'} cells without 时间`, async () => {
    const row = toRow({ 发布时间: value });
    delete row.时间;
    const h = harness({ rows: [row] });
    const result = await h.run('excel');
    assert.equal(result.saved, 1);
    assert.equal(result.invalid, 0);
    assert.equal(h.state.writes[0].publishTime.toISOString(), '2026-07-01T00:00:00.000Z');
  });
}

test('excel: 发布时间 takes precedence over 时间 when both are supplied', async () => {
  const h = harness({ rows: [toRow({ 发布时间: '2026-07-02 09:30:00' })] });
  const result = await h.run('excel');
  assert.equal(result.saved, 1);
  assert.equal(h.state.writes[0].publishTime.toISOString(), '2026-07-02T01:30:00.000Z');
});

test('excel: empty 发布时间 permits the existing 时间 header', async () => {
  const h = harness({ rows: [toRow({ 发布时间: '' })] });
  const result = await h.run('excel');
  assert.equal(result.saved, 1);
  assert.equal(h.state.writes[0].publishTime.toISOString(), '2026-07-01T00:00:00.000Z');
});

for (const value of ['bad-time', '2099-01-01 08:00:00']) {
  test(`excel: invalid 发布时间 is rejected rather than replaced by 时间: ${value}`, async () => {
    const h = harness({ rows: [toRow({ 发布时间: value })] });
    const result = await h.run('excel');
    assert.equal(result.invalid, 1);
    assert.equal(h.state.writes.length, 0);
    assert.equal(h.state.pushes.length, 0);
    assert.equal(result.invalidRows[0].missing[0], value.startsWith('2099') ? '发布时间晚于当前时间' : '字段格式不合法');
    assert.ok(!result.invalidRows[0].missing.includes('时间'));
  });
}

test('excel: missing both time headers reports 发布时间', async () => {
  const row = toRow();
  delete row.时间;
  const h = harness({ rows: [row] });
  const result = await h.run('excel');
  assert.equal(result.invalid, 1);
  assert.equal(result.invalidRows[0].missing[0], '发布时间');
  assert.equal(h.state.writes.length, 0);
});

test('tencent: structured time cells retain the same Beijing interpretation', async () => {
  const h = harness({ rows: [toRow({
    时间: { time: { year: 2026, month: 7, day: 1, hour: 8 } },
    采集时间: { time: { year: 2026, month: 7, day: 1, hour: 9 } }
  })] });
  const result = await h.run('tencent');
  assert.equal(result.createdCount, 1);
  assert.equal(h.state.writes[0].publishTime.toISOString(), '2026-07-01T00:00:00.000Z');
  assert.equal(h.state.writes[0].crawlTime.toISOString(), originalCrawlTime);
});
