const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const countFields = ['viewCount', 'forwardCount', 'replyCount', 'praiseCount'];
const excelFields = ['浏览数', '转载数', '回复数', '点赞数'];

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

// Only explicitly supplied mocks may be imported; database/network modules are never loaded.
function evaluate(source, fileName, mocks = {}) {
  const { outputText, diagnostics } = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    }
  });
  assert.equal(diagnostics.length, 0);
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected import: ${name}`);
      return mocks[name];
    }
  }, { filename: fileName });
  return module.exports;
}

// Extract pure function declarations, never evaluating importer setup or main().
const importerPath = 'scripts/import-event-excels.ts';
const importerSource = ts.createSourceFile(importerPath, readSource(importerPath), ts.ScriptTarget.Latest, true);
const pureNames = ['cellStr', 'toInt', 'toInteractionCount', 'toDate', 'getField', 'parseWorkbook', 'mapToEventRecord'];
const pureFunctions = pureNames.map((name) => {
  const declaration = importerSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing pure function: ${name}`);
  return declaration.getText(importerSource);
}).join('\n');
const importer = evaluate(`${pureFunctions}\nmodule.exports = { ${pureNames.join(', ')} };`, importerPath);
const counts = (record) => countFields.map((field) => record[field]);

function mapRaw(raw) {
  return importer.mapToEventRecord('测试分类', 'mock.xlsx', { rowNo: 2, raw });
}

test('Excel interaction conversion distinguishes missing, explicit zero and valid integers', () => {
  for (const value of [null, undefined, '', ' ', '\t\n', '—', '-', '无', 'abc', 'NaN', 'Infinity', '-1', '-0.5', '1.5', '2147483648', ',', '，', '0,', ',0', '1,2', '0x0', '1 2']) {
    assert.equal(importer.toInteractionCount(value), null, `invalid/missing: ${String(value)}`);
  }
  for (const value of ['0', ' 0 ', '0.0', '+0']) {
    assert.equal(importer.toInteractionCount(value), 0, `explicit zero: ${value}`);
  }
  for (const [value, expected] of [['12', 12], ['1,234', 1234], ['2，345', 2345], ['2147483647', 2147483647]]) {
    assert.equal(importer.toInteractionCount(value), expected);
  }
});

test('all four Excel interaction fields use nullable conversion without changing fans/sequence', () => {
  assert.deepEqual(counts(mapRaw({})), [null, null, null, null]);
  for (const [value, expected] of [['', null], [' ', null], ['0', 0], ['12', 12], ['abc', null], ['-1', null]]) {
    const raw = Object.fromEntries(excelFields.map((field) => [field, value]));
    assert.deepEqual(counts(mapRaw(raw)), Array(4).fill(expected));
  }
  assert.deepEqual(counts(mapRaw({ 阅读量: '0', 转发量: '2', 评论量: '', 点赞量: '-2' })), [0, 2, null, null]);
  const missing = mapRaw({});
  assert.equal(missing.seqNo, 0);
  assert.equal(missing.fansCount, 0);
  const populated = mapRaw({ 序号: '3', 粉丝数: '1,234' });
  assert.equal(populated.seqNo, 3);
  assert.equal(populated.fansCount, 1234);
  assert.equal(importer.toInt('abc'), 0);
});

test('mock workbook retains numeric zero cells and missing/invalid interaction values', () => {
  const headers = ['标题', ...excelFields];
  const values = ['测试', 0, null, 'not a number', -1];
  const workbook = {
    worksheets: [{
      rowCount: 2,
      getRow(rowNo) {
        return rowNo === 1
          ? { values: [undefined, ...headers] }
          : { actualCellCount: values.length, getCell: (column) => ({ value: values[column - 1] }) };
      }
    }]
  };
  const rows = importer.parseWorkbook(workbook);
  assert.equal(rows.length, 1);
  assert.deepEqual(counts(mapRaw(rows[0].raw)), [0, null, null, null]);
});

for (const existing of [null, { id: 'existing-event' }]) {
  test(`daily sync preserves null/zero on ${existing ? 'update' : 'create'} with mocked Prisma`, async () => {
    let written;
    let action;
    const write = (kind) => async (args) => {
      written = args.data;
      action = kind;
      if (existing) assert.equal(args.where.id, existing.id);
      return { id: existing?.id ?? 'new-event', ...args.data };
    };
    const daily = evaluate(readSource('src/lib/daily-event-sync.ts'), 'daily-event-sync.ts', {
      '@/lib/prisma': { prisma: { eventRecord: {
        findFirst: async () => existing,
        create: write('created'),
        update: write('updated')
      } } },
      '@/lib/mapping': { normalizePublishTimeToDate: () => null }
    });
    for (const values of [[null, null, null, null], [0, 0, 0, 0], [12, 23, 34, 45], [null, 0, 7, null]]) {
      const result = await daily.syncDailyCollectionEvent({
        record: {
          title: '测试事件', text: '测试正文', url: '', author: '测试作者',
          originType: '测试来源', authorType: '', publishTime: '',
          viewNum: values[0], forwardNum: values[1], commentNum: values[2], praiseNum: values[3]
        },
        rowNo: 2
      });
      assert.equal(action, existing ? 'updated' : 'created');
      assert.equal(result.action, action);
      assert.deepEqual(counts(written), values);
    }
  });
}

for (const values of [[null, null, null, null], [0, 0, 0, 0], [12, 23, 34, 45], [null, 0, 7, null]]) {
  test(`list and expanded details display interaction values ${JSON.stringify(values)}`, () => {
    const client = evaluate(readSource('src/app/event-records/event-records-client.tsx'), 'event-records-client.tsx', {
      react: {
        ...React,
        useState: (initial) => [Array.isArray(initial) ? ['mock-event'] : initial, () => {}]
      },
      'react/jsx-runtime': require('react/jsx-runtime')
    });
    const record = {
      id: 'mock-event', category: '测试分类', sourceFileName: 'mock.xlsx', seqNo: 1,
      source: '', author: '', fansCount: 0, authType: '', publishTime: '', title: '测试事件',
      link: '', summary: '', tendency: '', rowNo: 2, createdAt: '',
      ...Object.fromEntries(countFields.map((field, index) => [field, values[index]]))
    };
    const html = renderToStaticMarkup(client.default({ records: [record] }));
    const displayed = values.map((value) => value === null ? '—' : String(value));
    assert.ok(html.includes(`浏览 ${displayed[0]} · 转载 ${displayed[1]} · 回复 ${displayed[2]} · 点赞 ${displayed[3]}`));
    excelFields.forEach((label, index) => {
      assert.ok(html.includes(`<th>${label}</th><td>${displayed[index]}</td>`), `${label} detail`);
    });
  });
}
