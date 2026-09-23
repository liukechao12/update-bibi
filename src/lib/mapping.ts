import crypto from 'crypto';
import { OriginType, ParsedRawRecord, PushRecord, PublisherType, AuthorType } from './types';
import { classifyAuthorType, classifyPublisherType, getDomainFromUrl } from './media-classification';

const originTypeMap: Record<string, OriginType> = {
  微博: 'wb',
  新浪微博: 'wb',
  微博热搜: 'wb',
  视频号: 'sph',
  微信视频号: 'sph',
  微信: 'wx',
  公众号: 'wx',
  小红书: 'xhs',
  抖音: 'dy',
  知乎: 'zh',
  知乎回答: 'zh',
  贴吧: 'tb',
  网站: 'media',
  新闻: 'media',
  媒体: 'media',
  其他: 'other',
  App: 'other',
  自媒体: 'other'
};

// 来源字段常带后缀或变体（如"手机新浪网""百度贴吧-孙笑川吧""腾讯网"），
// 精确匹配不到时按关键词包含匹配兜底。顺序从具体到一般，社交平台优先于媒体，
// 「视频号」必须放在「微信/公众号/weixin」之前匹配，否则包含「微信视频号」时优先算视频号 sph。
const originTypeKeywords: Array<{ keywords: string[]; originType: OriginType }> = [
  { keywords: ['微博', 'weibo'], originType: 'wb' },
  { keywords: ['小红书', 'xhslink', 'xiaohongshu'], originType: 'xhs' },
  { keywords: ['抖音', 'douyin'], originType: 'dy' },
  { keywords: ['知乎', 'zhihu'], originType: 'zh' },
  { keywords: ['贴吧', 'tieba'], originType: 'tb' },
  { keywords: ['视频号'], originType: 'sph' },
  { keywords: ['微信', '公众号', 'weixin'], originType: 'wx' },
  {
    keywords: [
      '新闻', '日报', '晚报', '时报', '快报', '周刊', '资讯', '财经', '经济', '观察',
      '法治', '法制', '新浪', '搜狐', '网易', '腾讯', '百度', '凤凰', '一点资讯', 'UC',
      '雪球', '格隆汇', '钛媒体', '每经', '财联社', '企查查', '界面', '澎湃', '虎嗅',
      '36氪', '东方财富', '证券', '金融界', '同花顺', '第一财经', '红星', '封面', '上游',
      '新黄河', '九派', '大皖', '红网', '齐鲁', '大众', '海报', '湖北', '南方', '北京',
      '新京报', '光明', '新华', '央视', '央广', '环球', '参考消息', '中国新闻', '国际在线',
      '中国网', '中国日报', '中国青年', '中国军网', '工人日报', '中国新闻社', '法治网',
      '中央广电总台', '新闻联播', '荣耀俱乐部'
    ],
    originType: 'media'
  }
];

const originDomainMap: Array<{ domains: string[]; originType: OriginType }> = [
  { domains: ['weibo.com', 'm.weibo.cn', 'weibo.cn', 't.cn'], originType: 'wb' },
  { domains: ['channels.weixin.qq.com'], originType: 'sph' },
  { domains: ['mp.weixin.qq.com'], originType: 'wx' },
  {
    domains: ['weixin.qq.com'],
    originType: 'wx'
  },
  { domains: ['xiaohongshu.com', 'xhslink.cn'], originType: 'xhs' },
  { domains: ['douyin.com', 'iesdouyin.com', 'v.douyin.com'], originType: 'dy' },
  { domains: ['zhihu.com'], originType: 'zh' },
  { domains: ['tieba.baidu.com'], originType: 'tb' },
  {
    domains: [
      'sina.com.cn', 'sina.cn', 'news.sina.cn', 'finance.sina.cn',
      'qq.com', 'new.qq.com', 'news.qq.com',
      'sohu.com', '163.com', 'ifeng.com', 'ishare.ifeng.com',
      'thepaper.cn', 'jiemian.com', 'yicai.com', 'ce.cn',
      'people.com.cn', 'xinhuanet.com', 'gmw.cn', 'chinadaily.com.cn',
      'cctv.com', 'cnr.cn', 'china.com.cn',
      'eastmoney.com', '10jqka.com.cn', 'cnstock.com', 'stockstar.com',
      'cls.cn', 'gelonghui.com', 'xueqiu.com', 'huxiu.com',
      '36kr.com', 'ithome.com', 'mydrivers.com', 'gamersky.com'
    ],
    originType: 'media'
  }
];

function normalizeUrlForOriginType(value?: string): string {
  const raw = value?.trim() ?? '';
  if (!raw) return '';
  // 视频号/微信分享经常带反引号、前后缀或缺失协议，先清洗再判定域名。
  const cleaned = raw.replace(/^[`'"]+|[`'"]+$/g, '').trim();
  if (!cleaned) return '';
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  return `https://${cleaned.replace(/^\/+/, '')}`;
}

export function normalizeOriginType(source?: string, url?: string): OriginType {
  // 1) 先判定域名（正常情况下最高优先级）
  const domain = getDomainFromUrl(normalizeUrlForOriginType(url));
  let matchedByDomain: OriginType | undefined;
  if (domain) {
    const matched = originDomainMap.find((item) =>
      item.domains.some((name) => domain === name || domain.endsWith(`.${name}`))
    );
    if (matched) matchedByDomain = matched.originType;
  }

  // 2) 再看来源字段是否明确声明了具体平台；如果有且比域名更具体，以来源声明为准。
  //    典型场景：导入的来源列手写「微信视频号」，但链接是通用 weixin.qq.com 非 channels 域名，
  //    此时应当强制按来源列判为 sph，而不是通用 wx。
  if (source) {
    const trimmed = source.trim();
    const exact = originTypeMap[trimmed];
    if (exact) return exact;

    for (const { keywords, originType } of originTypeKeywords) {
      if (keywords.some((keyword) => trimmed.includes(keyword))) return originType;
    }
  }

  // 3) 来源无有效信息时，再回退域名判定或兜底 other
  if (matchedByDomain) return matchedByDomain;
  return 'other';
}

export function normalizePublisherType(source?: string, originType?: OriginType, author?: string, url?: string): PublisherType {
  return classifyPublisherType({ source, originType, author, url });
}

export function normalizeAuthorType(options: {
  certType?: string;
  publisherType?: PublisherType;
  source?: string;
  author?: string;
  url?: string;
  originType?: OriginType;
}): AuthorType {
  return classifyAuthorType(options);
}

const BEIJING_OFFSET_MINUTES = 8 * 60;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function publishDateFromParts(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number, millisecond: number,
  zone?: string, weekday?: string
): Date {
  let offsetMinutes = BEIJING_OFFSET_MINUTES;
  if (zone === 'Z') {
    offsetMinutes = 0;
  } else if (zone) {
    const offset = zone.match(/^([+-])(\d{2}):?(\d{2})$/);
    if (!offset || Number(offset[2]) > 23 || Number(offset[3]) > 59) return new Date(NaN);
    offsetMinutes = (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '+' ? 1 : -1);
  }

  // 仅用 UTC 方法构造壁钟时间，并逐项回读，拒绝 Date 自动修正的溢出日期。
  // setUTCFullYear 避免 Date.UTC 将 00–99 年隐式解释为 1900–1999 年。
  const wallTime = new Date(0);
  wallTime.setUTCFullYear(year, month - 1, day);
  wallTime.setUTCHours(hour, minute, second, millisecond);
  if (
    year < 1 || year > 9999 ||
    wallTime.getUTCFullYear() !== year || wallTime.getUTCMonth() !== month - 1 ||
    wallTime.getUTCDate() !== day || wallTime.getUTCHours() !== hour ||
    wallTime.getUTCMinutes() !== minute || wallTime.getUTCSeconds() !== second ||
    (weekday !== undefined && WEEKDAY_NAMES[wallTime.getUTCDay()] !== weekday)
  ) return new Date(NaN);

  const date = new Date(wallTime.getTime() - offsetMinutes * 60_000);
  const beijingYear = new Date(date.getTime() + BEIJING_OFFSET_MINUTES * 60_000).getUTCFullYear();
  // 输出必须能表示为四位年份的北京时间。
  return beijingYear >= 1 && beijingYear <= 9999 ? date : new Date(NaN);
}

export function normalizePublishTime(value?: string): string {
  const date = normalizePublishTimeToDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + BEIJING_OFFSET_MINUTES * 60_000)
    .toISOString().slice(0, 19).replace('T', ' ');
}

export function normalizePublishTimeToDate(value?: string): Date {
  if (typeof value !== 'string' || !value.trim()) return new Date(NaN);
  const raw = value.trim();
  // 不使用宿主时区或宽松的 Date.parse；无时区日期/时间固定按 UTC+8 解释。
  const normalized = raw.replace(/^(\d{4})年(\d{1,2})月(\d{1,2})日 */, '$1-$2-$3 ').trim();
  const numeric = normalized.match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/);
  if (numeric) {
    return publishDateFromParts(
      Number(numeric[1]), Number(numeric[3]), Number(numeric[4]),
      Number(numeric[5] ?? 0), Number(numeric[6] ?? 0), Number(numeric[7] ?? 0),
      Number((numeric[8] ?? '').padEnd(3, '0').slice(0, 3)), numeric[9]
    );
  }

  // Excel 中的 Date.toString()，必须完整匹配并尊重 GMT offset，不能截掉时区。
  const jsDate = raw.match(/^([A-Za-z]{3}) ([A-Za-z]{3}) (\d{1,2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT([+-]\d{4})?(?: \([^()\r\n]+\))?$/);
  if (jsDate) {
    return publishDateFromParts(
      Number(jsDate[4]), MONTH_NAMES.indexOf(jsDate[2]) + 1, Number(jsDate[3]),
      Number(jsDate[5]), Number(jsDate[6]), Number(jsDate[7]), 0, jsDate[8] ?? 'Z', jsDate[1]
    );
  }

  // Date.toUTCString()：Mon, 27 Jul 2026 00:24:00 GMT。
  const utcDate = raw.match(/^([A-Za-z]{3}), (\d{1,2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/);
  if (utcDate) {
    return publishDateFromParts(
      Number(utcDate[4]), MONTH_NAMES.indexOf(utcDate[3]) + 1, Number(utcDate[2]),
      Number(utcDate[5]), Number(utcDate[6]), Number(utcDate[7]), 0, 'Z', utcDate[1]
    );
  }
  // 交由调用方 schema 拒绝脏数据；不抛异常，也不以当前时间伪造发布时间。
  return new Date(NaN);
}

export function isPublishTimeInFuture(value?: string, now = new Date()) {
  const publishTime = normalizePublishTimeToDate(value);
  return publishTime.getTime() > now.getTime();
}

// 只移除明确的营销追踪键；from/source/ref/scene 等含义不明确的参数必须保留。
const TRACKING_QUERY_KEYS = new Set(['spm', 'gclid', 'dclid', 'fbclid', 'msclkid']);

function normalizeContentQuery(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of Array.from(params.keys())) {
    if (/^utm_/i.test(key) || TRACKING_QUERY_KEYS.has(key.toLowerCase())) params.delete(key);
  }
  // 稳定按键排序，但保留重复键的值顺序（它可能影响路由/身份）。
  params.sort();
  return params.toString();
}

export function normalizeContentUrl(value?: string) {
  const raw = value?.trim() ?? '';
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.search = normalizeContentQuery(url.search);
    // hash 可能是 SPA 路由或内容标识，不能当作追踪信息一律删除。
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.toString();
  } catch {
    // 无协议或其他不能由 URL 解析的输入，也不能丢失 query/hash 中的身份信息。
    const hashIndex = raw.indexOf('#');
    const hash = hashIndex < 0 ? '' : raw.slice(hashIndex);
    const beforeHash = hashIndex < 0 ? raw : raw.slice(0, hashIndex);
    const queryIndex = beforeHash.indexOf('?');
    const path = (queryIndex < 0 ? beforeHash : beforeHash.slice(0, queryIndex)).replace(/\/$/, '').trim();
    const query = queryIndex < 0 ? '' : normalizeContentQuery(beforeHash.slice(queryIndex + 1));
    return `${path}${query ? `?${query}` : ''}${hash}`;
  }
}

export function buildTextId(input: {
  source?: string;
  link?: string;
  title?: string;
  time?: string;
}): string {
  const normalizedLink = normalizeContentUrl(input.link);
  const identity = normalizedLink || JSON.stringify({
    source: input.source ?? 'unknown',
    title: input.title ?? '',
    time: input.time ?? ''
  });
  const hash = crypto
    .createHash('sha1')
    .update(identity)
    .digest('hex')
    .slice(0, 24);
  return `${normalizeOriginType(input.source, input.link).toUpperCase()}_${hash}`;
}

export function mapRawRecordToPushRecord(raw: ParsedRawRecord): PushRecord {
  const title = raw.title?.trim() || '未命名标题';
  const text = raw.summary?.trim() || title;
  const originType = normalizeOriginType(raw.source, raw.link);
  const publisherType = normalizePublisherType(raw.source, originType, raw.author, raw.link);
  const authorType = normalizeAuthorType({
    certType: raw.certType,
    publisherType,
    source: raw.source,
    author: raw.author,
    url: raw.link,
    originType
  });

  return {
    textId: buildTextId({ source: raw.source, link: raw.link, title, time: raw.time }),
    title,
    text,
    publishTime: normalizePublishTime(raw.time),
    crawlTime: raw.crawlTime ?? new Date().toISOString(),
    author: raw.author?.trim() || '未知作者',
    originType,
    publisherType,
    authorType,
    url: normalizeContentUrl(raw.link),
    commentNum: raw.commentNum ?? 0,
    forwardNum: raw.forwardNum ?? null,
    praiseNum: raw.praiseNum ?? null,
    viewNum: raw.viewNum ?? null
  };
}

export function chunkRecords<T>(records: T[], size = 100): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < records.length; index += size) {
    chunks.push(records.slice(index, index + size));
  }
  return chunks;
}
