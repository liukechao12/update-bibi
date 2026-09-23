'use strict';

// Allowlisted imports keep persistence and network boundaries offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const jsxRuntime = require('react/jsx-runtime');
const { renderToStaticMarkup } = require('react-dom/server');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const authFile = 'src/lib/api-auth.ts';
const pageFile = 'src/app/plugin-records/page.tsx';
const viewFile = 'src/app/plugin-records/plugin-records-view.tsx';
const allowedFiles = new Set([authFile, pageFile, viewFile, 'src/lib/mapping.ts', 'src/lib/time.ts', 'src/lib/labels.ts']);
const compiled = new Map();
const clone = (value) => structuredClone(value); // Normalize objects from the VM realm, retaining Dates/null.
const forbidden = (name) => () => { throw new Error(`Offline test forbids ${name}`); };

function evaluate(file, mocks = {}, globals = {}) {
  assert.ok(allowedFiles.has(file), `Source is not allowlisted: ${file}`);
  const filename = path.join(root, file);
  if (!compiled.has(file)) {
    const { outputText, diagnostics } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
      }
    });
    assert.equal(diagnostics.length, 0, `Transpile diagnostics in ${file}`);
    compiled.set(file, outputText);
  }
  const module = { exports: {} };
  vm.runInNewContext(compiled.get(file), {
    module, exports: module.exports, Date, URL, URLSearchParams,
    fetch: forbidden('fetch'),
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), `Offline test forbids unmocked import: ${name}`);
      return mocks[name];
    },
    ...globals
  }, { filename, timeout: 5000 });
  return module.exports;
}

const labels = evaluate('src/lib/labels.ts');
const time = evaluate('src/lib/time.ts');
const mapping = evaluate('src/lib/mapping.ts', {
  crypto,
  './media-classification': {
    classifyAuthorType: forbidden('unused author classification'),
    classifyPublisherType: forbidden('unused publisher classification'),
    getDomainFromUrl: forbidden('unused domain classification')
  }
});
const viewModule = evaluate(viewFile, { '@/lib/labels': labels, 'react/jsx-runtime': jsxRuntime });
const View = viewModule.default;
const statuses = ['DRAFT', 'VALIDATED', 'PENDING_PUSH', 'PUSHING', 'SUCCESS', 'FAILED', 'RETRYING', 'DUPLICATE'];
const RecordStatus = Object.fromEntries(statuses.map((status) => [status, status]));
const emptyFilters = () => ({ keyword: '', clientId: '', status: '', startDate: '', endDate: '' });
const now = Date.parse('2026-09-20T08:00:00.000Z');
class FixedDate extends Date { static now() { return now; } }

function cookieUser() {
  return { id: 'cookie-user', username: 'cookie', displayName: 'Cookie administrator', department: 'Cookie部门',
    accountType: 'social', roles: ['SUPER_ADMIN'], sessionId: 'cookie-session' };
}
function apiClient(overrides = {}) {
  return { id: 'trusted-plugin-id', clientCode: 'plugin_collector', clientName: '采集插件', status: 'ACTIVE',
    expiresAt: null, createdById: 'plugin-owner', department: '插件部门', apiKeyHash: 'hash:valid-key', ...overrides };
}
function owner(overrides = {}) {
  return { id: 'plugin-owner', username: 'collector', displayName: '采集员', department: '用户部门',
    accountType: 'media', currentSessionId: 'owner-session', status: 'ACTIVE',
    roles: [{ role: { roleCode: 'OPERATOR' } }, { role: { roleCode: 'REVIEWER' } }],
    passwordHash: 'never-return-password', ...overrides };
}
function authHarness(options = {}) {
  const calls = [];
  const client = Object.hasOwn(options, 'client') ? options.client : apiClient();
  const user = Object.hasOwn(options, 'user') ? options.user : owner();
  const session = Object.hasOwn(options, 'session') ? options.session : cookieUser();
  const auth = evaluate(authFile, {
    '@/lib/prisma': { prisma: {
      externalApiClient: { async findUnique(args) {
        calls.push(['client', clone(args)]);
        return args.where.apiKeyHash === 'hash:valid-key' ? client : null;
      } },
      user: { async findUnique(args) { calls.push(['user', clone(args)]); return user; } }
    } },
    '@/lib/session': { async getCurrentUser() { calls.push(['session']); return session; } },
    '@/lib/external-api': { hashApiKey(key) { calls.push(['hash', key]); return `hash:${key}`; } },
    'next/server': { NextResponse: { json(body, init) {
      return { status: init?.status ?? 200, json: async () => clone(body) };
    } } }
  }, { Date: FixedDate });
  return { ...auth, calls, session };
}
const request = (headers) => ({ headers: new Headers(headers) });
async function assertPluginRejected(harness, headers, userLookups = 0) {
  const result = await harness.requireApiUser(request(headers));
  assert.deepEqual(Object.keys(result), ['error']);
  assert.equal(result.error.status, 401);
  assert.deepEqual(await result.error.json(), { code: 40101, message: '插件凭证无效或已停用' });
  assert.equal(harness.calls.filter(([name]) => name === 'session').length, 0, 'invalid plugin keys must not fall back to Cookie');
  assert.equal(harness.calls.filter(([name]) => name === 'user').length, userLookups);
  return result;
}

for (const [name, headers] of [
  ['Bearer', { authorization: 'Bearer valid-key' }],
  ['case-insensitive/trimmed Bearer', { authorization: '  bEaReR   valid-key  ' }],
  ['x-api-key', { 'x-api-key': '  valid-key  ' }]
]) {
  test(`requireApiUser: ${name} returns trusted plugin identity before Cookie`, async () => {
    const harness = authHarness();
    const result = await harness.requireApiUser(request({ ...headers, 'x-plugin-client-id': 'forged-id', cookie: 'session=other-user' }));
    assert.deepEqual(clone(result), {
      pluginClientId: 'trusted-plugin-id',
      user: { id: 'plugin-owner', username: 'collector', displayName: '采集员', department: '插件部门',
        accountType: 'media', roles: ['OPERATOR', 'REVIEWER'], sessionId: 'owner-session' }
    });
    assert.deepEqual(harness.calls, [
      ['hash', 'valid-key'], ['client', { where: { apiKeyHash: 'hash:valid-key' } }],
      ['user', { where: { id: 'plugin-owner' }, include: { roles: { include: { role: true } } } }]
    ]);
    assert.doesNotMatch(JSON.stringify(result), /forged-id|cookie-user|passwordHash|apiKeyHash/);
  });
}

for (const [department, expected] of [[null, '用户部门'], ['', ''], ['独立插件部门', '独立插件部门']]) {
  test(`requireApiUser: plugin department ${JSON.stringify(department)} uses nullish fallback`, async () => {
    const harness = authHarness({ client: apiClient({ department }) });
    assert.equal((await harness.requireApiUser(request({ 'x-api-key': 'valid-key' }))).user.department, expected);
  });
}

for (const [name, client] of [
  ['non-plugin client', apiClient({ clientCode: 'external_customer' })],
  ['plugin text without required prefix', apiClient({ clientCode: 'not_plugin_collector' })],
  ['disabled key', apiClient({ status: 'DISABLED' })],
  ['expired key', apiClient({ expiresAt: new Date(now - 1) })],
  ['deleted/unknown key', null]
]) {
  for (const header of ['authorization', 'x-api-key']) {
    test(`requireApiUser: ${name} (${header}) rejects without Cookie fallback`, async () => {
      await assertPluginRejected(authHarness({ client }), { [header]: header === 'authorization' ? 'Bearer valid-key' : 'valid-key' });
    });
  }
}

for (const header of ['authorization', 'x-api-key']) {
  test(`requireApiUser: invalid ${header} rejects even with a valid Cookie`, async () => {
    await assertPluginRejected(authHarness(), { [header]: header === 'authorization' ? 'Bearer bad-key' : 'bad-key', cookie: 'session=valid' });
  });
}

for (const [name, user] of [['disabled owner', owner({ status: 'DISABLED' })], ['deleted owner', null]]) {
  test(`requireApiUser: ${name} rejects a valid plugin key without Cookie fallback`, async () => {
    await assertPluginRejected(authHarness({ user }), { authorization: 'Bearer valid-key' }, 1);
  });
}

for (const expiresAt of [new Date(now), new Date(now + 1)]) {
  test(`requireApiUser: expiry ${expiresAt.getTime() === now ? 'at' : 'after'} fixed now remains valid`, async () => {
    const harness = authHarness({ client: apiClient({ expiresAt }) });
    assert.equal((await harness.requireApiUser(request({ 'x-api-key': 'valid-key' }))).pluginClientId, 'trusted-plugin-id');
  });
}

test('requireApiUser: Bearer takes precedence over x-api-key and Cookie', async () => {
  const harness = authHarness();
  assert.equal((await harness.requireApiUser(request({ authorization: 'Bearer valid-key', 'x-api-key': 'bad-key' }))).pluginClientId, 'trusted-plugin-id');
  assert.deepEqual(harness.calls[0], ['hash', 'valid-key']);
  assert.equal(harness.calls.length, 3);
});

test('requireApiUser: invalid Bearer cannot fall back to valid x-api-key or Cookie', async () => {
  const harness = authHarness();
  await assertPluginRejected(harness, { authorization: 'Bearer bad-key', 'x-api-key': 'valid-key' });
  assert.deepEqual(harness.calls, [['hash', 'bad-key'], ['client', { where: { apiKeyHash: 'hash:bad-key' } }]]);
});

for (const [name, input] of [
  ['no Request', undefined], ['no key headers', request({ cookie: 'session=valid' })],
  ['blank key headers', request({ authorization: '   ', 'x-api-key': '   ' })]
]) {
  test(`requireApiUser: ${name} preserves Cookie user without a plugin marker`, async () => {
    const harness = authHarness();
    const result = await harness.requireApiUser(input);
    assert.strictEqual(result.user, harness.session);
    assert.deepEqual(Object.keys(result), ['user']);
    assert.equal(Object.hasOwn(result, 'pluginClientId'), false);
    assert.deepEqual(harness.calls, [['session']]);
  });
}

test('requireApiUser: missing Cookie user returns ordinary unauthenticated response', async () => {
  const harness = authHarness({ session: null });
  const result = await harness.requireApiUser();
  assert.equal(result.error.status, 401);
  assert.deepEqual(await result.error.json(), { code: 40100, message: '未登录' });
  assert.deepEqual(harness.calls, [['session']]);
});

function storedRecord(overrides = {}) {
  return { id: 'record-1', textId: 'TEXT_1', title: '插件标题', text: '插件正文', url: 'https://example.invalid/article/1',
    author: '作者', sourceName: '来源', originType: 'wx', publishTime: new Date('2026-09-19T23:15:30Z'),
    recordStatus: 'PENDING_PUSH', lastPluginReceivedAt: new Date('2026-09-20T00:15:30Z'),
    lastPluginClient: { clientName: '采集插件', clientCode: 'plugin_collector', department: '插件部门' },
    pushItems: [], ...overrides };
}
function pushItem(overrides = {}) {
  return { status: 'FAILED', errorMessage: '客户拒绝：缺少字段', vendorResponseCode: 'E_FIELD', pushType: 'UPDATE',
    pushJob: { jobNo: 'JOB_1', createdAt: new Date('2026-09-18T16:30:00Z'), httpStatus: 422 }, ...overrides };
}
function pageHarness(options = {}) {
  const calls = [];
  let authorized = false;
  const logQuery = (name, args) => {
    assert.equal(authorized, true, `${name} ran before requireAdmin resolved`);
    calls.push({ name, args: clone(args) });
  };
  // Query arguments are asserted separately from the selected mock response.
  const records = options.records ?? [];
  const clients = options.clients ?? [{ id: 'trusted-plugin-id', clientName: '采集插件', clientCode: 'plugin_collector' }];
  const pageModule = evaluate(pageFile, {
    '@prisma/client': { RecordStatus },
    '@/lib/prisma': { prisma: {
      externalApiClient: { async findMany(args) { logQuery('clients', args); return clients; } },
      dataRecord: {
        async count(args) { logQuery('count', args); return options.total ?? records.length; },
        async findMany(args) { logQuery('records', args); return records; }
      }
    } },
    '@/lib/guards': { async requireAdmin() {
      calls.push({ name: 'guard:start' });
      if (options.guard) await options.guard();
      authorized = true;
      calls.push({ name: 'guard:done' });
      return cookieUser();
    } },
    '@/lib/mapping': mapping, '@/lib/time': time,
    './plugin-records-view': viewModule, 'react/jsx-runtime': jsxRuntime
  });
  return {
    calls,
    async run(params = {}) {
      const element = await pageModule.default({ searchParams: Promise.resolve(params) });
      assert.equal(React.isValidElement(element), true);
      assert.strictEqual(element.type, View);
      return { element, props: clone(element.props) };
    }
  };
}
function query(harness, name) {
  const found = harness.calls.filter((call) => call.name === name);
  assert.equal(found.length, 1, `Expected exactly one ${name} query`);
  return found[0].args;
}
function assertNoRecordQueries(harness) {
  assert.equal(harness.calls.some((call) => ['count', 'records'].includes(call.name)), false);
}

test('server page: awaits the administrator guard before every database query', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const harness = pageHarness({ guard: () => gate });
  const pending = harness.run();
  await Promise.resolve();
  assert.deepEqual(harness.calls, [{ name: 'guard:start' }]);
  release();
  await pending;
  assert.deepEqual(harness.calls.map(({ name }) => name), ['guard:start', 'guard:done', 'clients', 'count', 'records']);
});

test('server page: denied administrator guard prevents even client/count lookups', async () => {
  const denied = new Error('administrator required');
  const harness = pageHarness({ guard: async () => { throw denied; } });
  await assert.rejects(harness.run(), (error) => error === denied);
  assert.deepEqual(harness.calls, [{ name: 'guard:start' }]);
});

test('server page: only explicit non-null plugin receipt provenance, never department inference', async () => {
  const harness = pageHarness();
  const { props } = await harness.run({ department: '插件部门', createdById: 'forged-user', sourceName: 'plugin' });
  assert.deepEqual(query(harness, 'count'), { where: { lastPluginReceivedAt: { not: null } } });
  assert.deepEqual(query(harness, 'records').where, { lastPluginReceivedAt: { not: null } });
  assert.deepEqual(props.filters, emptyFilters());
  assert.deepEqual({ total: props.total, page: props.page, totalPages: props.totalPages, records: props.records, errors: props.errors },
    { total: 0, page: 1, totalPages: 1, records: [], errors: [] });
  assert.deepEqual(query(harness, 'clients'), {
    where: { clientCode: { startsWith: 'plugin_' } },
    select: { id: true, clientName: true, clientCode: true }, orderBy: { clientName: 'asc' }
  });
});

for (const status of statuses) {
  test(`server page: ${status} filters current recordStatus, not historical push status`, async () => {
    const harness = pageHarness();
    const { props } = await harness.run({ status: ` ${status} ` });
    assert.deepEqual(query(harness, 'records').where, { lastPluginReceivedAt: { not: null }, recordStatus: status });
    assert.deepEqual(query(harness, 'count').where, query(harness, 'records').where);
    assert.equal(props.filters.status, status);
    assert.deepEqual(props.errors, []);
  });
}

test('server page: trimmed keyword/client/status compose as scalar filters without operator injection', async () => {
  const keyword = `标题%' OR 1=1 -- <script>&`;
  const clientId = 'deleted-plugin-id';
  const harness = pageHarness();
  const { props } = await harness.run({ keyword: ` ${keyword} `, clientId: ` ${clientId} `, status: ' FAILED ' });
  const expected = {
    lastPluginReceivedAt: { not: null }, lastPluginClientId: clientId, recordStatus: 'FAILED',
    OR: ['textId', 'title', 'author', 'url'].map((field) => ({ [field]: { contains: keyword } }))
  };
  assert.deepEqual(query(harness, 'count').where, expected);
  assert.deepEqual(query(harness, 'records').where, expected);
  assert.deepEqual(props.filters, { ...emptyFilters(), keyword, clientId, status: 'FAILED' });
});

for (const [name, params, expected] of [
  ['same Beijing date', { startDate: '2026-09-20', endDate: '2026-09-20' },
    { gte: '2026-09-19T16:00:00.000Z', lt: '2026-09-20T16:00:00.000Z' }],
  ['start only', { startDate: '2026-09-20' }, { gte: '2026-09-19T16:00:00.000Z' }],
  ['end only', { endDate: '2026-09-20' }, { lt: '2026-09-20T16:00:00.000Z' }],
  ['leap day', { startDate: '2024-02-29', endDate: '2024-02-29' },
    { gte: '2024-02-28T16:00:00.000Z', lt: '2024-02-29T16:00:00.000Z' }],
  ['year boundary', { startDate: '2026-12-31', endDate: '2027-01-01' },
    { gte: '2026-12-30T16:00:00.000Z', lt: '2027-01-01T16:00:00.000Z' }],
  ['US DST date still uses UTC+8', { startDate: '2026-03-08', endDate: '2026-03-08' },
    { gte: '2026-03-07T16:00:00.000Z', lt: '2026-03-08T16:00:00.000Z' }]
]) {
  test(`server page: ${name} uses a Beijing half-open receipt-time interval`, async () => {
    const harness = pageHarness();
    const { props } = await harness.run(params);
    const dateWhere = { not: null, ...Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, new Date(value)])) };
    assert.deepEqual(query(harness, 'count').where, { lastPluginReceivedAt: dateWhere });
    assert.deepEqual(query(harness, 'records').where, { lastPluginReceivedAt: dateWhere });
    assert.deepEqual(props.errors, []);
    if (dateWhere.gte && dateWhere.lt && params.startDate === params.endDate) {
      assert.equal(dateWhere.lt - dateWhere.gte, 86400000);
    }
  });
}

for (const [name, params, error] of [
  ['impossible February day', { startDate: '2026-02-30' }, '开始日期无效。'],
  ['non-leap February 29', { endDate: '2026-02-29' }, '结束日期无效。'],
  ['month overflow', { startDate: '2026-13-01' }, '开始日期无效。'],
  ['day overflow', { endDate: '2026-04-31' }, '结束日期无效。'],
  ['non-padded date', { startDate: '2026-9-2' }, '开始日期无效。'],
  ['timestamp instead of date', { endDate: '2026-09-20T00:00:00Z' }, '结束日期无效。'],
  ['malicious date', { startDate: '<script>alert(1)</script>' }, '开始日期无效。'],
  ['reverse range', { startDate: '2026-09-21', endDate: '2026-09-20' }, '开始日期不能晚于结束日期。'],
  ...['ALL', 'NOT_A_STATUS', 'success', 'toString', 'constructor', '__proto__'].map((status) =>
    [`invalid status ${status}`, { status }, '请选择有效的推送状态。'])
]) {
  test(`server page: ${name} displays validation errors without querying records/count`, async () => {
    const harness = pageHarness({ records: [storedRecord()], total: 99 });
    const { props } = await harness.run({ ...params, page: '99' });
    assert.deepEqual(props.errors, [error]);
    assertNoRecordQueries(harness);
    assert.deepEqual(props.records, []);
    assert.equal(props.total, 0);
    assert.equal(props.page, 1);
    assert.equal(props.totalPages, 1);
    query(harness, 'clients');
  });
}

test('server page: multiple invalid filters accumulate errors without querying records', async () => {
  const harness = pageHarness();
  const { props } = await harness.run({ status: 'bad', startDate: '2026-02-30', endDate: 'garbage' });
  assert.deepEqual(props.errors, ['请选择有效的推送状态。', '开始日期无效。', '结束日期无效。']);
  assertNoRecordQueries(harness);
});

test('server page: repeated malicious array parameters are ignored rather than coerced or concatenated', async () => {
  const harness = pageHarness({ total: 61 });
  const params = Object.fromEntries(['keyword', 'clientId', 'status', 'startDate', 'endDate', 'page'].map((key) =>
    [key, ['<script>alert(1)</script>', '__proto__', 'FAILED', '99999']]));
  const { props } = await harness.run(params);
  assert.deepEqual(props.filters, emptyFilters());
  assert.deepEqual(props.errors, []);
  assert.equal(props.page, 1);
  assert.deepEqual(query(harness, 'records').where, { lastPluginReceivedAt: { not: null } });
  assert.equal(query(harness, 'records').skip, 0);
});

test('server page: array dates/status do not erase independent valid scalar filters', async () => {
  const harness = pageHarness();
  const { props } = await harness.run({ keyword: ' useful ', clientId: ['a', 'b'], status: ['FAILED'], startDate: ['bad'], endDate: '2026-09-20', page: ['2'] });
  assert.deepEqual(props.filters, { ...emptyFilters(), keyword: 'useful', endDate: '2026-09-20' });
  const where = query(harness, 'records').where;
  assert.equal(Object.hasOwn(where, 'lastPluginClientId'), false);
  assert.equal(Object.hasOwn(where, 'recordStatus'), false);
  assert.deepEqual(where.lastPluginReceivedAt, { not: null, lt: new Date('2026-09-20T16:00:00Z') });
});

for (const [input, expectedPage] of [
  [undefined, 1], ['', 1], ['NaN', 1], ['garbage', 1], ['2.5', 1], ['0', 1], ['-7', 1],
  ['Infinity', 1], ['1e309', 1], ['9007199254740992', 1], [' 2 ', 2], ['99999', 4], ['9007199254740991', 4]
]) {
  test(`server page: page=${JSON.stringify(input)} clamps safely and cannot change pageSize=20`, async () => {
    const harness = pageHarness({ total: 61 });
    const { props } = await harness.run({ page: input, pageSize: '1000000', take: '999', skip: '-100' });
    assert.equal(props.page, expectedPage);
    assert.equal(props.totalPages, 4);
    const args = query(harness, 'records');
    assert.equal(args.take, 20);
    assert.equal(args.skip, (expectedPage - 1) * 20);
    assert.deepEqual(args.orderBy, [{ lastPluginReceivedAt: 'desc' }, { id: 'desc' }]);
  });
}

for (const [total, expectedPages] of [[0, 1], [20, 1], [21, 2], [40, 2]]) {
  test(`server page: total=${total} has ${expectedPages} pages and clamps beyond the end`, async () => {
    const harness = pageHarness({ total });
    const { props } = await harness.run({ page: '999' });
    assert.equal(props.totalPages, expectedPages);
    assert.equal(props.page, expectedPages);
    assert.equal(query(harness, 'records').skip, (expectedPages - 1) * 20);
  });
}

test('server page: deterministic latest push item uses take=1 and minimal nested selects without secrets', async () => {
  const harness = pageHarness();
  await harness.run();
  assert.deepEqual(query(harness, 'records').select, {
    id: true, textId: true, title: true, text: true, url: true, author: true,
    sourceName: true, originType: true, publishTime: true, recordStatus: true, lastPluginReceivedAt: true,
    lastPluginClient: { select: { clientName: true, clientCode: true, department: true } },
    pushItems: {
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
      select: { status: true, errorMessage: true, vendorResponseCode: true, pushType: true,
        pushJob: { select: { jobNo: true, createdAt: true, httpStatus: true } } }
    }
  });
  assert.doesNotMatch(JSON.stringify(harness.calls), /apiKey|password|secret|token|requestBody|responseBody/i);
});

for (const recordStatus of ['PENDING_PUSH', 'FAILED', 'RETRYING']) {
  test(`server page: current ${recordStatus} survives historical SUCCESS and formats safe view props`, async () => {
    const record = storedRecord({ recordStatus, pushItems: [pushItem({ status: 'SUCCESS', errorMessage: null, vendorResponseCode: null,
      secret: 'push-secret', pushJob: { jobNo: 'JOB_OLD', createdAt: new Date('2026-09-18T16:30:00Z'), httpStatus: 200, requestBody: 'job-secret' } })],
      secret: 'record-secret' });
    const harness = pageHarness({ records: [record] });
    const { props, element } = await harness.run();
    assert.equal(props.records[0].recordStatus, recordStatus);
    assert.deepEqual(props.records[0].lastPush, {
      status: 'SUCCESS', errorMessage: null, vendorResponseCode: null, pushType: 'UPDATE',
      jobNo: 'JOB_OLD', httpStatus: 200, createdAt: '2026/09/19 00:30:00'
    });
    assert.deepEqual(props.records[0], {
      id: 'record-1', textId: 'TEXT_1', title: '插件标题', text: '插件正文', url: 'https://example.invalid/article/1',
      author: '作者', sourceName: '来源', originType: 'wx', publishTime: '2026/09/20 07:15:30', recordStatus,
      receivedAt: '2026/09/20 08:15:30', client: record.lastPluginClient, lastPush: props.records[0].lastPush
    });
    assert.doesNotMatch(JSON.stringify(props), /record-secret|push-secret|job-secret|requestBody/);
    const cells = firstRowCells(renderToStaticMarkup(element));
    assert.ok(cells[3].includes(recordStatus === 'FAILED' ? '推送失败' : labels.recordStatusLabelMap[recordStatus]));
    assert.ok(!cells[3].includes('推送成功'));
  });
}

test('server page: no push items stays null and deleted client retains the provenance record', async () => {
  const harness = pageHarness({ records: [storedRecord({ lastPluginClient: null, pushItems: [], recordStatus: 'SUCCESS' })] });
  const { props, element } = await harness.run();
  assert.equal(props.records.length, 1);
  assert.equal(props.records[0].client, null);
  assert.equal(props.records[0].lastPush, null);
  assert.equal(props.records[0].recordStatus, 'SUCCESS');
  const html = renderToStaticMarkup(element);
  assert.match(html, /插件已删除/);
  assert.match(html, /来源标记保留/);
  assert.match(html, /暂无推送明细/);
  assert.match(firstRowCells(html)[3], /推送成功/);
});

function displayRecord(overrides = {}) {
  return { id: 'record-1', textId: 'TEXT_1', title: '插件标题', text: '第一行\n第二行', url: 'https://example.invalid/article/1',
    author: '作者', sourceName: '来源', originType: 'wx', publishTime: '2026/09/20 07:15:30',
    recordStatus: 'PENDING_PUSH', receivedAt: '2026/09/20 08:15:30',
    client: { clientName: '采集插件', clientCode: 'plugin_collector', department: '插件部门' }, lastPush: null, ...overrides };
}
function displayPush(overrides = {}) {
  return { status: 'FAILED', errorMessage: '客户拒绝：缺少字段', vendorResponseCode: 'E_FIELD', pushType: 'UPDATE',
    jobNo: 'JOB_1', httpStatus: 422, createdAt: '2026/09/19 00:30:00', ...overrides };
}
function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(View, {
    filters: emptyFilters(), clients: [], records: [displayRecord()], total: 1, page: 1, totalPages: 1, errors: [], ...overrides
  }));
}
function firstRowCells(html) {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  assert.ok(body, 'rendered table body is required');
  const row = body[1].match(/<tr>([\s\S]*?)<\/tr>/);
  assert.ok(row, 'rendered table row is required');
  return [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
}
const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[character]);
function links(html) {
  const entities = { '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&#x27;': "'", '&#39;': "'" };
  return [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((match) => ({
    href: match[1].replace(/&(?:amp|quot|lt|gt|#x27|#39);/g, (entity) => entities[entity]), label: match[2]
  }));
}

for (const [status, label] of [
  ['DRAFT', '草稿'], ['VALIDATED', '已校验'], ['PENDING_PUSH', '待推送'], ['PUSHING', '推送中'],
  ['SUCCESS', '推送成功'], ['FAILED', '推送失败'], ['RETRYING', '重试中'], ['DUPLICATE', '重复']
]) {
  test(`view SSR: current ${status} displays ${label} in its own status cell`, () => {
    const cells = firstRowCells(render({ records: [displayRecord({ recordStatus: status })] }));
    assert.ok(cells[3].includes(`>${label}</strong>`));
    assert.match(cells[4], /暂无推送明细/);
  });
}

for (const [status, label] of [['PENDING', '待发送'], ['SENDING', '发送中'], ['SUCCESS', '成功'], ['FAILED', '失败'], ['RETRYING', '重试中']]) {
  test(`view SSR: latest ${status} displays its own push status without replacing the current status`, () => {
    const cells = firstRowCells(render({ records: [displayRecord({ lastPush: displayPush({ status }) })] }));
    assert.match(cells[3], /待推送/);
    assert.ok(cells[4].includes(`更新 · ${label}`));
    if (status === 'FAILED') assert.match(cells[4], /客户拒绝：缺少字段/);
    else assert.doesNotMatch(cells[4], /客户拒绝：缺少字段/);
  });
}

test('view SSR: failed receipt displays reason, job number, actual HTTP status and vendor error code', () => {
  const cells = firstRowCells(render({ records: [displayRecord({ recordStatus: 'FAILED', lastPush: displayPush() })] }));
  assert.match(cells[3], /推送失败/);
  for (const text of ['更新 · 失败', '客户拒绝：缺少字段', '任务号：JOB_1', 'HTTP 状态码：422', '客户错误码：E_FIELD']) {
    assert.ok(cells[4].includes(text), text);
  }
});

for (const errorMessage of [null, '']) {
  test(`view SSR: missing failure reason ${JSON.stringify(errorMessage)} and null receipt use explicit placeholders`, () => {
    const html = render({ records: [displayRecord({ sourceName: null, client: null,
      lastPush: displayPush({ pushType: 'CREATE', errorMessage, httpStatus: null, vendorResponseCode: null }) })] });
    for (const text of ['新增 · 失败', '暂无详细失败原因', 'HTTP 状态码：暂无回执', '客户错误码：—', '来源未填写', '插件已删除']) {
      assert.ok(html.includes(text), text);
    }
  });
}

test('view SSR: all untrusted record, client, failure, filter and validation text is React-escaped', () => {
  const payload = (name) => `<script>alert("${name}")</script>&'`;
  const fields = ['title', 'textId', 'text', 'author', 'sourceName'];
  const record = displayRecord({
    ...Object.fromEntries(fields.map((field) => [field, payload(field)])),
    client: { clientName: payload('clientName'), clientCode: payload('clientCode'), department: payload('department') },
    lastPush: displayPush({ errorMessage: payload('errorMessage'), jobNo: payload('jobNo'), vendorResponseCode: payload('vendorResponseCode') })
  });
  const html = render({ records: [record], errors: [payload('validation')],
    filters: { ...emptyFilters(), keyword: payload('keyword'), clientId: payload('clientId') },
    clients: [{ id: payload('clientId'), clientName: payload('optionName'), clientCode: payload('optionCode') }] });
  for (const field of [...fields, 'clientName', 'clientCode', 'department', 'errorMessage', 'jobNo', 'vendorResponseCode',
    'validation', 'keyword', 'clientId', 'optionName', 'optionCode']) {
    assert.ok(html.includes(escapeHtml(payload(field))), `escaped ${field}`);
    assert.ok(!html.includes(payload(field)), `no raw ${field}`);
  }
  assert.doesNotMatch(html, /<script\b|<img\b/i);
  const detail = links(html).find((link) => link.label === '查看数据记录');
  const url = new URL(detail.href, 'https://offline.invalid');
  assert.equal(url.searchParams.get('keyword'), record.textId);
  assert.equal(url.searchParams.get('status'), 'ALL');
});

for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', ' javascript:alert(1)',
  'javascript&#58;alert(1)', 'data:text/html,<script>alert(1)</script>', '//evil.invalid', '/relative/path', '']) {
  test(`view SSR: invalid original URL ${JSON.stringify(url)} never becomes an href`, () => {
    const html = render({ records: [displayRecord({ url })] });
    assert.match(html, /原文链接无效/);
    assert.doesNotMatch(html, /打开原文/);
    assert.equal(links(html).some((link) => link.href === url), false);
    assert.doesNotMatch(html, /href="(?:javascript:|data:|java\nscript:)/i);
  });
}

for (const url of ['https://example.invalid/article?a=1&b=2', 'http://example.invalid/article', 'HTTPS://example.invalid/article']) {
  test(`view SSR: valid original URL ${url} has a protected external link`, () => {
    const html = render({ records: [displayRecord({ url })] });
    assert.ok(html.includes(`href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">打开原文</a>`));
    assert.doesNotMatch(html, /原文链接无效/);
  });
}

test('view SSR: quote injection in an HTTPS URL remains inside the escaped href', () => {
  const url = 'https://example.invalid/" onclick="alert(1)<script>&';
  const html = render({ records: [displayRecord({ url })] });
  assert.ok(html.includes(`href="${escapeHtml(url)}"`));
  assert.doesNotMatch(html, /" onclick="|<script\b/);
});

test('view SSR: empty results show provenance guidance, interface logs and disabled pagination', () => {
  const html = render({ records: [], total: 0 });
  for (const text of ['暂无符合条件的插件记录。', '共 0 条', '每页 20 条 · 第 1 / 1 页',
    '历史记录未做来源推断', '不能代替当前状态', '失败或超时不等于客户一定未收到']) assert.ok(html.includes(text), text);
  assert.ok(links(html).some((link) => link.href === '/external-api-logs?path=%2Fapi%2Fplugin%2Frecords'));
  assert.match(html, /<button[^>]*disabled=""[^>]*>上一页<\/button>/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>下一页<\/button>/);
  assert.doesNotMatch(html, /role="alert"/);
});

test('view SSR: validation errors show an alert and a different empty-state instruction', () => {
  const html = render({ records: [], total: 0, errors: ['开始日期无效。', '请选择有效的推送状态。'] });
  assert.match(html, /role="alert"[^>]*>开始日期无效。 请选择有效的推送状态。<\/p>/);
  assert.match(html, /请修正筛选条件后重试。/);
  assert.doesNotMatch(html, /暂无符合条件的插件记录。/);
});

test('view SSR: previous/next/refresh links preserve every filter with safe query encoding', () => {
  const filters = { keyword: '标题 & + ? # = / <script>', clientId: 'plugin&id=2', status: 'FAILED', startDate: '2026-09-01', endDate: '2026-09-20' };
  const html = render({ filters, page: 2, totalPages: 4, total: 61,
    clients: [{ id: filters.clientId, clientName: '采集插件', clientCode: 'plugin_collector' }] });
  const renderedLinks = links(html);
  for (const [label, expectedPage] of [['上一页', '1'], ['下一页', '3'], ['刷新状态', '2']]) {
    const link = renderedLinks.find((item) => item.label === label);
    assert.ok(link, label);
    const url = new URL(link.href, 'https://offline.invalid');
    assert.equal(url.pathname, '/plugin-records');
    assert.deepEqual(Object.fromEntries(url.searchParams), { ...filters, page: expectedPage });
    assert.equal([...url.searchParams].length, 6, 'special characters must not inject additional query parameters');
  }
  for (const name of ['keyword', 'clientId', 'status', 'startDate', 'endDate']) assert.ok(html.includes(`name="${name}"`));
  assert.ok(html.includes(`value="${escapeHtml(filters.keyword)}"`));
  assert.match(html, /value="FAILED" selected=""/);
  const form = html.match(/<form\b[^>]*>/)?.[0];
  assert.ok(form);
  assert.match(form, /method="GET"/);
  assert.match(form, /action="\/plugin-records"/);
  assert.equal(renderedLinks.find((link) => link.label === '重置').href, '/plugin-records');
  assert.doesNotMatch(html, /name="page"/);
});

for (const [page, disabled, enabled, target] of [[1, '上一页', '下一页', '2'], [3, '下一页', '上一页', '2']]) {
  test(`view SSR: page ${page} disables ${disabled} and omits empty filters from links`, () => {
    const html = render({ page, totalPages: 3, total: 41 });
    assert.ok(html.includes(`disabled="">${disabled}</button>`));
    assert.equal(links(html).some((link) => link.label === disabled), false);
    assert.equal(links(html).find((link) => link.label === enabled).href, `/plugin-records?page=${target}`);
    assert.equal(links(html).find((link) => link.label === '刷新状态').href, `/plugin-records?page=${page}`);
  });
}
