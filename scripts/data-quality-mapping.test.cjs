'use strict';

// 直接复跑：node /Users/xuhao/数据同步程序/scripts/data-quality-mapping.test.cjs
// 仅加载纯映射函数，无数据库、网络访问或文件写入。
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!process.argv.includes('--tz-child')) {
  const timezones = ['UTC', 'Asia/Shanghai', 'America/New_York', 'Asia/Kolkata', 'Pacific/Kiritimati'];
  let baseline;
  for (const timezone of timezones) {
    const result = spawnSync(process.execPath, [__filename, '--tz-child'], {
      env: { ...process.env, TZ: timezone },
      encoding: 'utf8',
      timeout: 30_000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `TZ=${timezone}\n${result.stdout}\n${result.stderr}`);
    const snapshot = JSON.parse(result.stdout);
    if (baseline) assert.deepEqual(snapshot, baseline, `TZ=${timezone} 的映射结果不一致`);
    baseline = snapshot;
    console.log(`PASS TZ=${timezone}: ${snapshot.tests} cases`);
  }
  console.log('PASS: all timezone snapshots are identical; no database accessed.');
} else {
  require('ts-node').register({
    project: path.resolve(__dirname, '../tsconfig.json'),
    transpileOnly: true,
    compilerOptions: { module: 'commonjs', moduleResolution: 'node' }
  });
  const {
    normalizePublishTime,
    normalizePublishTimeToDate,
    isPublishTimeInFuture,
    normalizeContentUrl,
    buildTextId,
    mapRawRecordToPushRecord
  } = require(path.resolve(__dirname, '../src/lib/mapping.ts'));

  let tests = 0;
  const snapshot = { dates: [], urls: [], ids: [] };
  function test(name, run) {
    try {
      run();
      tests += 1;
    } catch (error) {
      error.message = `${name} (TZ=${process.env.TZ}): ${error.message}`;
      throw error;
    }
  }

  const dateCases = [
    ['2026-07-27', '2026-07-27 00:00:00', '2026-07-26T16:00:00.000Z'],
    ['2026-7-2', '2026-07-02 00:00:00', '2026-07-01T16:00:00.000Z'],
    ['2026/7/27', '2026-07-27 00:00:00', '2026-07-26T16:00:00.000Z'],
    ['2026.7.27', '2026-07-27 00:00:00', '2026-07-26T16:00:00.000Z'],
    ['2026年7月27日', '2026-07-27 00:00:00', '2026-07-26T16:00:00.000Z'],
    ['2026-07-27 08:24:00', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['2026-7-27 8:24', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['2026/7/27 8:24:05', '2026-07-27 08:24:05', '2026-07-27T00:24:05.000Z'],
    ['2026.7.27 08:24:00.125', '2026-07-27 08:24:00', '2026-07-27T00:24:00.125Z'],
    ['2026年7月27日08:24:00', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['2026年7月27日 08:24', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['  2026-07-27 08:24:00  ', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['2026-07-27T08:24:00', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['2026-07-27T08:24', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['2026-07-27T00:24:00Z', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['2026-07-27T08:24:00Z', '2026-07-27 16:24:00', '2026-07-27T08:24:00.000Z'],
    ['2026-07-27T00:24:00.123Z', '2026-07-27 08:24:00', '2026-07-27T00:24:00.123Z'],
    ['2026-07-27T00:24:00.123456789Z', '2026-07-27 08:24:00', '2026-07-27T00:24:00.123Z'],
    ['2026-07-27T08:24:00+08:00', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['2026-07-27T08:24:00.1+0800', '2026-07-27 08:24:00', '2026-07-27T00:24:00.100Z'],
    ['2026-07-27T08:24+08:00', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['2026-07-27T05:54:00+05:30', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['2026-07-26T20:24:00-04:00', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['2026-12-31T20:00:00Z', '2027-01-01 04:00:00', '2026-12-31T20:00:00.000Z'],
    ['2026-01-01T00:30:00+14:00', '2025-12-31 18:30:00', '2025-12-31T10:30:00.000Z'],
    ['2024-02-29 23:59:59', '2024-02-29 23:59:59', '2024-02-29T15:59:59.000Z'],
    ['2000-02-29', '2000-02-29 00:00:00', '2000-02-28T16:00:00.000Z'],
    ['0099-01-01 08:00:00', '0099-01-01 08:00:00', '0099-01-01T00:00:00.000Z'],
    ['0001-01-01', '0001-01-01 00:00:00', '0000-12-31T16:00:00.000Z'],
    ['9999-12-31 23:59:59', '9999-12-31 23:59:59', '9999-12-31T15:59:59.000Z'],
    // 北京夏令时历史不能改变约定：无时区数据固定 UTC+8。
    ['1990-07-01 08:00:00', '1990-07-01 08:00:00', '1990-07-01T00:00:00.000Z'],
    // 美国 DST 跳过或重复的壁钟时间也必须按北京时间解析。
    ['2026-03-08 02:30:00', '2026-03-08 02:30:00', '2026-03-07T18:30:00.000Z'],
    ['2026-11-01 01:30:00', '2026-11-01 01:30:00', '2026-10-31T17:30:00.000Z'],
    ['Mon Jul 27 2026 08:24:00 GMT+0800 (China Standard Time)', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['Mon Jul 27 2026 00:24:00 GMT+0000 (Coordinated Universal Time)', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['Sun Jul 26 2026 20:24:00 GMT-0400 (Eastern Daylight Time)', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['Mon Jul 27 2026 05:54:00 GMT+0530', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['Mon Jul 27 2026 00:24:00 GMT', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z'],
    ['Mon, 27 Jul 2026 00:24:00 GMT', '2026-07-27 08:24:00', '2026-07-27T00:24:00.000Z']
  ];
  for (const [input, expected, iso] of dateCases) {
    test(`date ${input}`, () => {
      assert.equal(normalizePublishTime(input), expected);
      assert.equal(normalizePublishTimeToDate(input).toISOString(), iso);
      assert.equal(normalizePublishTime(expected), expected);
      assert.equal(normalizePublishTimeToDate(expected).getTime(), Math.floor(Date.parse(iso) / 1000) * 1000);
      snapshot.dates.push([expected, iso]);
    });
  }

  for (const iso of ['2026-07-27T00:24:00.000Z', '2026-01-27T00:24:00.000Z']) {
    test(`native Date strings ${iso}`, () => {
      const date = new Date(iso);
      for (const input of [date.toString(), date.toUTCString(), date.toISOString()]) {
        assert.equal(normalizePublishTimeToDate(input).getTime(), date.getTime());
        assert.equal(normalizePublishTime(input), iso.replace('T00:24:00.000Z', ' 08:24:00'));
        snapshot.dates.push([normalizePublishTime(input), normalizePublishTimeToDate(input).toISOString()]);
      }
    });
  }

  const invalidDates = [
    undefined, null, '', '   ', 'Invalid Date', 'not-a-date', 0, 20260727, {},
    '0000-01-01', '10000-01-01', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32',
    '2026-02-29', '2024-02-30', '2026-04-31', '1900-02-29', '2100-02-29',
    '2026-07-27 24:00:00', '2026-07-27 25:24:00', '2026-07-27 08:60:00',
    '2026-07-27 08:24:60', '2026-07-27T24:00:00Z', '2026-02-30T00:00:00Z',
    '2026-02-30T08:24:00+08:00', '2026/13/27 08:24:00', '2026年2月30日08:24:00',
    '2026-07-27T08:24:00+24:00', '2026-07-27T08:24:00+08:60',
    '2026-07-27T08:24:00+8:00', '2026-07-27T08:24:00+08', '2026-07-27T08:24:00ZZ',
    '2026-07-27T08:24:00Zgarbage', '2026-07-27T08:24:00+08:00 garbage',
    '2026-07-27 08:24:00 trailing', '2026-07-27 trailing', '2026-07-27T', '2026-07-27Z',
    '2026-07-27T08:24:00.', '2026-07-27T08:24:00.abcZ', '2026-07-27 08:24:00\ngarbage',
    '2026-07/27', '2026-07', '07/27/2026', '2026-07-27 8:4:00',
    'Mon Foo 27 2026 08:24:00 GMT+0800', 'Foo Jul 27 2026 08:24:00 GMT+0800',
    'Tue Jul 27 2026 08:24:00 GMT+0800', 'Mon Jul 27 2026 08:24:00',
    'Mon Jul 27 2026 08:24:00 GMT+0800 (China Standard Time) trailing',
    'Mon Jul 27 2026 08:24:00 GMT+2500', 'Mon Jul 27 2026 08:24:00 GMT+0860',
    'Mon Jul 27 2026 24:24:00 GMT+0800', 'Mon Feb 30 2026 08:24:00 GMT+0800',
    'Mon, 30 Feb 2026 00:24:00 GMT', 'Mon, 27 Jul 2026 00:24:00 GMT trailing',
    '9999-12-31T23:59:59Z', '0001-01-01T00:00:00+14:00'
  ];
  for (const input of invalidDates) {
    test(`invalid date ${String(input)}`, () => {
      assert.equal(normalizePublishTime(input), '');
      const date = normalizePublishTimeToDate(input);
      assert.ok(date instanceof Date);
      assert.ok(Number.isNaN(date.getTime()));
      assert.equal(isPublishTimeInFuture(input, new Date('2026-01-01T00:00:00Z')), false);
    });
  }

  test('future comparison uses the actual instant', () => {
    const now = new Date('2026-07-27T00:24:00Z');
    for (const input of ['2026-07-27 08:24:00', '2026-07-27T00:24:00Z', '2026-07-27T08:24:00+08:00']) {
      assert.equal(isPublishTimeInFuture(input, now), false);
    }
    assert.equal(isPublishTimeInFuture('2026-07-27 08:24:01', now), true);
    assert.equal(isPublishTimeInFuture('2026-07-27T00:24:00.001Z', now), true);
  });

  const urlCases = [
    [undefined, ''], ['', ''], ['   ', ''],
    [' https://www.EXAMPLE.com/news/item/ ', 'https://example.com/news/item'],
    ['https://www.EXAMPLE.com', 'https://example.com/'],
    ['https://www.EXAMPLE.com:443/news/item', 'https://example.com/news/item'],
    ['http://www.EXAMPLE.com:80/news/item/', 'http://example.com/news/item'],
    ['https://example.com/item?b=2&a=1', 'https://example.com/item?a=1&b=2'],
    ['https://example.com/item/?UTM_Source=ad&utm_medium=x&spm=1&fbclid=2&gclid=3&dclid=4&msclkid=5', 'https://example.com/item'],
    ['https://example.com/item?source=feed&ref=x&from=share&scene=21&unknown=ok&spm=ad', 'https://example.com/item?from=share&ref=x&scene=21&source=feed&unknown=ok'],
    ['https://example.com/item?sn=a%2Bb&token=x%3Dy%26z&empty=', 'https://example.com/item?empty=&sn=a%2Bb&token=x%3Dy%26z'],
    ['https://example.com/item?b=2&a=first&a=second&b=3', 'https://example.com/item?a=first&a=second&b=2&b=3'],
    ['https://example.com/item?utm_source=a&utm_source=b&id=42', 'https://example.com/item?id=42'],
    ['https://example.com/item#section', 'https://example.com/item#section'],
    ['https://www.EXAMPLE.com/app/#/article/42?mid=1&utm_source=route', 'https://example.com/app#/article/42?mid=1&utm_source=route'],
    ['https://example.com/app/?b=2&utm_source=ad&a=1#!/article/42', 'https://example.com/app?a=1&b=2#!/article/42'],
    ['example.com/item/', 'example.com/item'],
    ['example.com/item/?b=2&utm_source=ad&a=1#/article/42', 'example.com/item?a=1&b=2#/article/42'],
    ['/app/?z=2&a=1#route?mid=42', '/app?a=1&z=2#route?mid=42'],
    ['example.com/item#route/', 'example.com/item#route/']
  ];
  for (const [input, expected] of urlCases) {
    test(`url ${input}`, () => {
      assert.equal(normalizeContentUrl(input), expected);
      assert.equal(normalizeContentUrl(expected), expected);
      snapshot.urls.push(expected);
    });
  }

  const wx = 'https://mp.weixin.qq.com/s?__biz=MzA%3D%3D&mid=100&idx=1&sn=abc';
  function wxId(link) {
    return buildTextId({ source: '微信', link });
  }
  test('WeChat /s preserves identity, access and unknown parameters', () => {
    const link = `${wx}&scene=21&from=share&key=k&pass_ticket=t%2B1&foo=bar&utm_source=ad&spm=x#rd`;
    const normalized = normalizeContentUrl(link);
    const url = new URL(normalized);
    assert.equal(normalized, 'https://mp.weixin.qq.com/s?__biz=MzA%3D%3D&foo=bar&from=share&idx=1&key=k&mid=100&pass_ticket=t%2B1&scene=21&sn=abc#rd');
    assert.equal(url.searchParams.get('__biz'), 'MzA==');
    assert.equal(url.searchParams.get('pass_ticket'), 't+1');
    assert.equal(url.hash, '#rd');
    snapshot.urls.push(normalized);
  });
  test('different WeChat identity parameters produce different textIds', () => {
    const original = wxId(wx);
    for (const link of [wx.replace('mid=100', 'mid=101'), wx.replace('idx=1', 'idx=2'), wx.replace('sn=abc', 'sn=def'), wx.replace('MzA', 'MzB')]) {
      assert.notEqual(wxId(link), original);
      snapshot.ids.push(wxId(link));
    }
  });
  test('WeChat query order and tracking do not affect textId', () => {
    const reordered = 'https://mp.weixin.qq.com/s?sn=abc&idx=1&mid=100&__biz=MzA%3D%3D';
    assert.equal(wxId(wx), wxId(reordered));
    assert.equal(wxId(wx), wxId(`${reordered}&utm_source=ad&spm=x`));
    const entries = [...new URL(wx).searchParams.entries()];
    function permutations(items) {
      return items.length ? items.flatMap((item, index) => permutations(items.filter((_, i) => i !== index)).map((rest) => [item, ...rest])) : [[]];
    }
    for (const permutation of permutations(entries)) {
      assert.equal(wxId(`https://mp.weixin.qq.com/s?${new URLSearchParams(permutation)}`), wxId(wx));
    }
    snapshot.ids.push(wxId(wx));
  });
  test('unknown parameters and hash routes stay part of identity', () => {
    assert.notEqual(wxId(`${wx}&unknown=one`), wxId(`${wx}&unknown=two`));
    assert.notEqual(wxId(`${wx}#/article/1`), wxId(`${wx}#/article/2`));
    assert.notEqual(wxId('https://example.com/app#/1'), wxId('https://example.com/app#/2'));
    assert.notEqual(wxId('example.com/app?mid=1'), wxId('example.com/app?mid=2'));
  });

  for (const [input, normalized, prefix] of [
    [' https://www.EXAMPLE.com/news/item/ ', 'https://example.com/news/item', 'OTHER'],
    ['https://www.EXAMPLE.com', 'https://example.com/', 'OTHER'],
    ['https://example.com/item%20one', 'https://example.com/item%20one', 'OTHER'],
    ['http://www.EXAMPLE.com:80/a/', 'http://example.com/a', 'OTHER'],
    ['https://mp.weixin.qq.com/s/short-id', 'https://mp.weixin.qq.com/s/short-id', 'WX'],
    ['example.com/news/item/', 'example.com/news/item', 'OTHER']
  ]) {
    test(`existing no-query textId ${input}`, () => {
      const expected = `${prefix}_${crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 24)}`;
      assert.equal(buildTextId({ link: input }), expected);
      snapshot.ids.push(expected);
    });
  }

  test('mapped crawlTime prefers raw value without rewriting it', () => {
    for (const crawlTime of ['2026-07-28T01:02:03.456Z', '2026-07-28T09:02:03+08:00', '', 'invalid-crawl-time']) {
      const mapped = mapRawRecordToPushRecord({ source: '微信', link: wx, title: ' title ', time: '2026-07-27T00:24:00Z', crawlTime });
      assert.equal(mapped.crawlTime, crawlTime);
      assert.equal(mapped.publishTime, '2026-07-27 08:24:00');
      assert.equal(mapped.textId, wxId(wx));
      assert.equal(mapped.url, normalizeContentUrl(wx));
      assert.equal(mapped.title, 'title');
    }
  });
  test('missing crawlTime uses mapping time, not publishTime', () => {
    const before = Date.now();
    const mapped = mapRawRecordToPushRecord({ time: '2000-01-01' });
    const after = Date.now();
    const crawlTime = Date.parse(mapped.crawlTime);
    assert.ok(crawlTime >= before && crawlTime <= after);
    assert.match(mapped.crawlTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(mapped.publishTime, '2000-01-01 00:00:00');
  });
  test('invalid or missing publishTime does not abort batch mapping or invent a date', () => {
    const raw = [{ time: '2026-07-27' }, { time: '2026-02-30' }, {}, { time: 'garbage' }];
    const mapped = raw.map(mapRawRecordToPushRecord);
    assert.deepEqual(mapped.map((record) => record.publishTime), ['2026-07-27 00:00:00', '', '', '']);
    for (const record of mapped.slice(1)) assert.ok(Number.isNaN(normalizePublishTimeToDate(record.publishTime).getTime()));
  });

  console.log(JSON.stringify({ tests, ...snapshot }));
}
