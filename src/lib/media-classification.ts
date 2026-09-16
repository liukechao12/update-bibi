import type { AuthorType, OriginType, PublisherType } from '@/lib/types';

const MEDIA_SOURCE_EXACT = new Set([
  '人民日报',
  '新华社',
  '人民网',
  '新华网',
  '光明网',
  '央视新闻',
  '央视网',
  '央广网',
  '中国新闻网',
  '中国网',
  '中国日报',
  '中国日报网',
  '中国日报中文网',
  '环球网',
  '环球时报',
  '参考消息',
  '国际在线',
  '中国青年网',
  '中国军网',
  '澎湃新闻',
  '界面新闻',
  '第一财经',
  '上海证券报',
  '证券时报',
  '证券日报',
  '21世纪经济报道',
  '21财经',
  '经济观察报',
  '每日经济新闻',
  '每经网',
  '财联社',
  '财经网',
  '华夏时报',
  '时代周报',
  '中国新闻周刊',
  '凤凰网',
  '钛媒体',
  '虎嗅',
  '36氪',
  '亿邦动力',
  '品玩',
  '极客公园',
  '雷锋网',
  '创业邦',
  '猎云网',
  '投资界',
  '鞭牛士',
  '快科技',
  'IT之家',
  '游戏陀螺',
  'GAMELOOK',
  '游民星空',
  '游戏研究社',
  '东方财富网',
  '同花顺',
  '金融界',
  '证券之星',
  '腾讯自选股',
  '格隆汇',
  '雪球',
  '中国经济网',
  '中国青年报',
  '工人日报',
  '中工网',
  '经济参考报',
  '国际金融报',
  '南方日报',
  '南方周末',
  '湖北日报',
  '大众日报',
  '大众网',
  '海报新闻',
  '齐鲁晚报',
  '齐鲁壹点',
  '顶端新闻',
  '上观新闻',
  '东方网',
  '新京报',
  '北京日报',
  '北京日报网',
  '北京青年报',
  '京报网',
  '文汇报',
  '新华日报',
  '扬子晚报',
  '中国蓝新闻',
  '上游新闻',
  '大象新闻',
  '奔流新闻',
  '青岛新闻网',
  '东莞日报',
  '红网',
  '红星新闻',
  '大河报',
  '锦观新闻',
  '大皖新闻',
  '九派新闻',
  '江南都市报',
  '封面新闻',
  '蓝鲸新闻',
  '新黄河',
  '河北青年报',
  '上海法治报',
  '法治网',
  '中国新闻社',
  '中央广电总台',
  '央视社会与法',
  '新闻联播',
]);

const MEDIA_SOURCE_KEYWORDS = [
  '新闻', '日报', '晚报', '时报', '周刊', '快报', '观察', '经济', '财经', '法治', '法制', '网信',
  '人民网', '新华社', '新华', '央视', '央广', '中国网', '中国日报', '澎湃', '界面', '第一财经',
  '财联社', '每经', '钛媒体', '格隆汇', '金融界', '证券之星', '同花顺', '东方财富', '新京报',
  '光明网', '中国经济网', '中国青年网', '工人日报', '中国新闻社', '人民日报', '人民网'
];

const MEDIA_DOMAIN_EXACT = new Set([
  '24h.jrj.com.cn', 'api3.cls.cn', 'app.cqrb.cn', 'bianews.com', 'bjnews.com.cn', 'blxwnews.benliuxinwen.com',
  'c.m.163.com', 'cd.nbd.com.cn', 'ce.cn', 'cfi.cn', 'cn.chinadaily.com.cn', 'cnstock.com', 'donews.com',
  'dzrb.dzng.com', 'dzwww.com', 'eeo.com.cn', 'ent.sina.cn', 'finance.ce.cn', 'finance.eastmoney.com',
  'finance.jrj.com.cn', 'finance.sina.cn', 'gamelook.com.cn', 'gamersky.com', 'geekpark.net', 'gelonghui.com',
  'gu.qq.com', 'guancha.cn', 'hbqnbnews.com', 'hk.stockstar.com', 'huxiu.com', 'ifnews.com', 'ishare.ifeng.com',
  'ithome.com', 'jiemian.com', 'jingji.com.cn', 'k.sina.cn', 'legal.gmw.cn', 'legaldaily.com.cn', 'm.10jqka.com.cn',
  'm.21jingji.com', 'm.ebrun.com', 'm.gelonghui.com', 'm.gmw.cn', 'm.jrj.com.cn', 'm.mydrivers.com',
  'm.share.stockstar.com', 'm.thepaper.cn', 'm.uczzd.cn', 'mbd.baidu.com', 'nbd.com.cn', 'new.qq.com',
  'news.10jqka.com.cn', 'news.bjd.com.cn', 'news.cn', 'news.hubeidaily.net', 'news.k618.cn', 'news.mydrivers.com',
  'news.qcc.com', 'news.youth.cn', 'news.zol.com.cn', 'nfnews.com', 'nw.eastday.com', 'paper.people.com.cn',
  'ql1d.com', 'qlwb.com.cn', 'sghservices.shobserver.com', 'sh.people.com.cn', 'share.hntv.tv', 'shfzb.com.cn',
  'shobserver.cn', 'shobserver.com', 'society.people.com.cn', 'sohu.com', 'static.nfnews.com', 'stock.10jqka.com.cn',
  'stock.stockstar.com', 'szb.hnfazhi.com', 'tmtpost.com', 'topics.gmw.cn', 'topnews.cn', 'toutiao.com',
  'travel.sina.cn', 'vapp.grrb.com.cn', 'views.ce.cn', 'w.dzwww.com', 'workercn.cn', 'yicai.com',
  'yidianzixun.com', 'youxituoluo.com', 'yuanchuang.10jqka.com.cn', 'zc.dingxinwen.cn',
]);

const SOCIAL_DOMAIN_EXACT = new Set([
  'douyin.com', 'iesdouyin.com', 'weibo.com', 'zhihu.com', 'tieba.baidu.com', 'xiaohongshu.com', 'xhslink.cn',
  'mp.weixin.qq.com', 'channels.weixin.qq.com', 'weixin.qq.com', 'xueqiu.com', 'example.com',
]);

const CERT_TYPE_TO_AUTHOR_TYPE: Record<string, AuthorType> = {
  '蓝V': 'BLUE_V',
  '蓝v': 'BLUE_V',
  '橙V': 'SELF_MEDIA',
  '橙v': 'SELF_MEDIA',
  '自媒体': 'SELF_MEDIA',
  '媒体号': 'SELF_MEDIA',
  '普通用户': 'PERSONAL',
  '个人': 'PERSONAL',
};

function normalize(value: string) {
  return value.trim();
}

function matchesKeyword(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}

export function getDomainFromUrl(url?: string | null) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isMediaSource(source?: string | null) {
  if (!source) return false;
  const trimmed = normalize(source);
  if (MEDIA_SOURCE_EXACT.has(trimmed)) return true;
  const base = trimmed.replace(/[-–—].*$/, '').trim();
  if (MEDIA_SOURCE_EXACT.has(base)) return true;
  return matchesKeyword(trimmed, MEDIA_SOURCE_KEYWORDS);
}

export function isMediaAccount(author?: string | null) {
  if (!author) return false;
  return matchesKeyword(normalize(author), MEDIA_SOURCE_KEYWORDS);
}

export function classifyPublisherType(options: {
  source?: string | null;
  author?: string | null;
  url?: string | null;
  originType?: OriginType | null;
}): PublisherType {
  const domain = getDomainFromUrl(options.url);
  const source = options.source?.trim() ?? '';
  const author = options.author?.trim() ?? '';

  if (options.originType === 'media') return 'MEDIA';
  if (isMediaSource(source)) return 'MEDIA';
  if (domain && MEDIA_DOMAIN_EXACT.has(domain) && !SOCIAL_DOMAIN_EXACT.has(domain)) return 'MEDIA';
  if (isMediaAccount(author)) return 'MEDIA';
  return 'SOCIAL';
}

export function classifyAuthorType(options: {
  certType?: string | null;
  publisherType?: PublisherType;
  source?: string | null;
  author?: string | null;
  url?: string | null;
  originType?: OriginType | null;
}): AuthorType {
  const certType = options.certType?.trim() ?? '';
  if (certType && CERT_TYPE_TO_AUTHOR_TYPE[certType]) {
    return CERT_TYPE_TO_AUTHOR_TYPE[certType];
  }

  if (options.publisherType === 'MEDIA') return 'BLUE_V';

  const source = options.source?.trim() ?? '';
  const author = options.author?.trim() ?? '';
  const domain = getDomainFromUrl(options.url);

  if (options.originType === 'xhs') return 'PERSONAL';
  if (domain && MEDIA_DOMAIN_EXACT.has(domain) && !SOCIAL_DOMAIN_EXACT.has(domain)) return 'BLUE_V';
  if (isMediaSource(source) || isMediaAccount(author)) return 'BLUE_V';
  if (source.includes('微信') || source.includes('视频号')) return 'SELF_MEDIA';
  return 'PERSONAL';
}
