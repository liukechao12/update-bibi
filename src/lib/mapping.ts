import crypto from 'crypto';
import { OriginType, ParsedRawRecord, PushRecord, PublisherType, AuthorType } from './types';
import { classifyAuthorType, classifyPublisherType, getDomainFromUrl } from './media-classification';

const originTypeMap: Record<string, OriginType> = {
  微博: 'wb',
  新浪微博: 'wb',
  微博热搜: 'wb',
  微信: 'wx',
  公众号: 'wx',
  视频号: 'sph',
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
// 精确匹配不到时按关键词包含匹配兜底。顺序从具体到一般，社交平台优先于媒体。
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
  { domains: ['mp.weixin.qq.com', 'weixin.qq.com'], originType: 'wx' },
  { domains: ['channels.weixin.qq.com'], originType: 'sph' },
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

export function normalizeOriginType(source?: string, url?: string): OriginType {
  const domain = getDomainFromUrl(url);
  if (domain) {
    const matched = originDomainMap.find((item) =>
      item.domains.some((name) => domain === name || domain.endsWith(`.${name}`))
    );
    if (matched) return matched.originType;
  }
  if (!source) return 'other';

  const trimmed = source.trim();
  const exact = originTypeMap[trimmed];
  if (exact) return exact;

  for (const { keywords, originType } of originTypeKeywords) {
    if (keywords.some((keyword) => trimmed.includes(keyword))) return originType;
  }

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

export function normalizePublishTime(value?: string): string {
  if (!value) return new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Excel 读出的 Date toString 格式：Mon Jul 27 2026 08:24:00 GMT+0800 (China Standard Time)
  const jsDateMatch = value.match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  if (jsDateMatch) {
    const monthMap: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
    };
    const month = monthMap[jsDateMatch[1]] ?? '01';
    return `${jsDateMatch[3]}-${month}-${jsDateMatch[2]} ${jsDateMatch[4]}:${jsDateMatch[5]}:${jsDateMatch[6]}`;
  }

  // ISO 格式：2026-07-27T08:24:00.000Z
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]} ${isoMatch[4]}:${isoMatch[5]}:${isoMatch[6]}`;
  }

  const normalized = value.replace(/[./]/g, '-').replace('年', '-').replace('月', '-').replace('日', '');
  if (normalized.includes(':') && normalized.length >= 16) {
    const parts = normalized.split(' ');
    if (parts.length === 2) {
      const datePart = parts[0].split('-').map((part) => part.padStart(2, '0')).join('-');
      return `${datePart} ${parts[1].slice(0, 8)}`;
    }
  }
  return normalized;
}

export function normalizePublishTimeToDate(value?: string): Date {
  const normalized = normalizePublishTime(value);
  const localMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const date = localMatch
    ? new Date(Number(localMatch[1]), Number(localMatch[2]) - 1, Number(localMatch[3]), Number(localMatch[4]), Number(localMatch[5]), Number(localMatch[6] ?? 0))
    : new Date(normalized.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }
  return date;
}

export function isPublishTimeInFuture(value?: string, now = new Date()) {
  const publishTime = normalizePublishTimeToDate(value);
  return publishTime.getTime() > now.getTime();
}

export function normalizeContentUrl(value?: string) {
  const raw = value?.trim() ?? '';
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.toString();
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/\/$/, '').trim();
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
    crawlTime: new Date().toISOString(),
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
