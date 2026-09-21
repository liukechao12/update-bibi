import { prisma } from '@/lib/prisma';
import { notifyWeiboHotMatches } from '@/lib/wechat-notify';

export const WEIBO_HOT_KEYWORDS = ['B站', 'bilibili', '哔哩哔哩', '陈睿','猫耳'];

// 微博热搜侧边栏榜单（s.weibo.com/top/summary?cate= 代码）
export const WEIBO_HOT_CHANNELS = [
  { code: 'realtimehot', name: '热搜' },
  { code: 'entrank', name: '文娱' },
  { code: 'socialevent', name: '社会' },
  { code: 'tech', name: '科技' },
  { code: 'life', name: '生活' },
  { code: 'sport', name: '体育' },
  { code: 'game', name: 'ACG' }
] as const;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const SUMMARY_URL = 'https://s.weibo.com/top/summary';
const HOT_BAND_URL = 'https://weibo.com/ajax/statuses/hot_band';
const SEARCH_URL = 'https://s.weibo.com/weibo';

const MAX_TEXT = 191;
const MAX_CONTENT = 2000;
const CONTENT_DELAY_MS = 300;

// 热搜图标文件名前缀 → 标签文案
const LABEL_BY_FLAG: Record<string, string> = { '1': '新', '2': '热', '3': '沸' };

type HotRow = {
  rank: number;
  word: string;
  hotNum: number;
  labelName: string | null;
};

function cookie(): string | null {
  const value = process.env.WEIBO_COOKIE?.trim();
  return value ? value : null;
}

function matchKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  return WEIBO_HOT_KEYWORDS.filter((keyword) => lower.includes(keyword.toLowerCase()));
}

function clip(value: string | null | undefined, max = MAX_TEXT): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function stripTags(html: string) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[\u200b\u200e\u200f]/g, '')
    .trim();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseSummaryRows(html: string): HotRow[] {
  const rows: HotRow[] = [];
  const trBlocks = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  for (const block of trBlocks) {
    const td02 = block.match(/<td class="td-02[^"]*">([\s\S]*?)<\/td>/);
    if (!td02) continue;
    const anchor = td02[1].match(/<a[^>]*>([\s\S]*?)<\/a>/);
    const word = anchor ? stripTags(anchor[1]) : '';
    if (!word) continue;
    const rankMatch = block.match(/<td class="td-01[^"]*">\s*(\d+)\s*<\/td>/);
    const numMatch = td02[1].match(/<span>\s*([\d,]+)\s*<\/span>/);
    const flagMatch = block.match(/flags\/(\d+)_\d+\.png/);
    rows.push({
      rank: rankMatch ? Number(rankMatch[1]) - 1 : rows.length,
      word,
      hotNum: numMatch ? Number(numMatch[1].replace(/,/g, '')) : 0,
      labelName: flagMatch ? LABEL_BY_FLAG[flagMatch[1]] ?? null : null
    });
  }
  return rows;
}

async function fetchChannelRows(code: string): Promise<HotRow[]> {
  const cookieValue = cookie();
  const headers: Record<string, string> = { 'User-Agent': UA, Referer: 'https://s.weibo.com/top/summary' };
  if (cookieValue) headers.Cookie = cookieValue;
  const res = await fetch(`${SUMMARY_URL}?cate=${code}`, {
    headers,
    signal: AbortSignal.timeout(8000),
    redirect: 'manual'
  });
  if (!res.ok) throw new Error(`榜单 ${code} HTTP ${res.status}`);
  const html = await res.text();
  if (!html.includes('td-02')) throw new Error(`榜单 ${code} 返回内容异常（可能需要更新 Cookie）`);
  return parseSummaryRows(html);
}

// Cookie 失效或未配置时的降级：匿名 ajax 接口只拿热搜主榜
async function fetchMainBandRows(): Promise<HotRow[]> {
  const res = await fetch(HOT_BAND_URL, {
    headers: { 'User-Agent': UA, Referer: 'https://weibo.com/' },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`微博热点接口 HTTP ${res.status}`);
  const json = (await res.json()) as { ok?: number; data?: { band_list?: { rank?: number; realpos?: number; word?: string; num?: number; label_name?: string }[] } };
  if (json.ok !== 1 || !Array.isArray(json.data?.band_list)) throw new Error('微博热点接口返回格式异常');
  return json.data.band_list
    .map((item, index) => ({
      rank: item.rank ?? item.realpos ?? index,
      word: stripTags(item.word ?? ''),
      hotNum: typeof item.num === 'number' ? item.num : 0,
      labelName: clip(item.label_name)
    }))
    .filter((row) => row.word);
}

// 抓取热点话题下的微博正文（需 Cookie），取前 3 条正文拼接；网络错误抛给调用方做熔断
async function fetchTopicContent(word: string): Promise<string | null> {
  const cookieValue = cookie();
  if (!cookieValue) return null;
  const url = `${SEARCH_URL}?q=${encodeURIComponent(`#${word}#`)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://s.weibo.com/', Cookie: cookieValue },
    signal: AbortSignal.timeout(8000),
    redirect: 'manual'
  });
  if (!res.ok) throw new Error(`正文搜索 HTTP ${res.status}`);
  const html = await res.text();
  if (!html.includes('txt')) return null;
  const blocks = html.match(/<p[^>]*class="[^"]*txt[^"]*"[^>]*>[\s\S]*?<\/p>/g) ?? [];
  const texts = blocks
    .map((block) => stripTags(block.replace(/^<p[^>]*>/, '')))
    .filter((text) => text.length > 0)
    .slice(0, 3);
  if (texts.length === 0) return null;
  const joined = texts.join('\n---\n');
  return joined.length > MAX_CONTENT ? joined.slice(0, MAX_CONTENT) : joined;
}

let fetchRunning = false;

export function isWeiboHotFetchRunning() {
  return fetchRunning;
}

export type WeiboHotFetchResult = {
  skipped: boolean;
  reason?: string;
  batchAt: string | null;
  total: number;
  matched: number;
  channels: string[];
  contentChecked: boolean;
};

export async function runWeiboHotFetch(options?: { force?: boolean }): Promise<WeiboHotFetchResult> {
  if (fetchRunning) {
    return { skipped: true, reason: '上一轮抓取尚未结束', batchAt: null, total: 0, matched: 0, channels: [], contentChecked: false };
  }

  const latest = await prisma.weiboHotTopic.findFirst({
    orderBy: { batchAt: 'desc' },
    select: { batchAt: true }
  });
  // 60 秒内已有快照则跳过，避免定时任务与手动触发叠加
  if (!options?.force && latest && Date.now() - latest.batchAt.getTime() < 60_000) {
    return { skipped: true, reason: '60 秒内已抓取', batchAt: latest.batchAt.toISOString(), total: 0, matched: 0, channels: [], contentChecked: false };
  }

  fetchRunning = true;
  try {
    const batchAt = new Date();
    const hasCookie = Boolean(cookie());
    const channelResults: { channel: string; rows: HotRow[] }[] = [];

    if (hasCookie) {
      let channelFailures = 0;
      for (const channel of WEIBO_HOT_CHANNELS) {
        try {
          channelResults.push({ channel: channel.name, rows: await fetchChannelRows(channel.code) });
          channelFailures = 0;
        } catch (error) {
          channelFailures += 1;
          console.error(`[weibo-hot] 榜单 ${channel.name} 抓取失败:`, error instanceof Error ? error.message : error);
          // 连续两个榜单失败：多半是 Cookie 失效或 IP 被限流，直接放弃剩余榜单走降级
          if (channelFailures >= 2) break;
        }
        await sleep(200);
      }
    }
    if (channelResults.length === 0) {
      channelResults.push({ channel: '热搜', rows: await fetchMainBandRows() });
    }

    // 正文按词去重后抓取，控制请求量
    const contentMap = new Map<string, string>();
    let contentComplete = false;
    if (hasCookie) {
      const uniqueWords = [...new Set(channelResults.flatMap((item) => item.rows.map((row) => row.word)))];
      let contentFailures = 0;
      contentComplete = true;
      for (const word of uniqueWords) {
        try {
          const text = await fetchTopicContent(word);
          contentFailures = 0;
          if (text) contentMap.set(word, text);
        } catch (error) {
          contentFailures += 1;
          // 连续 5 次失败（超时/限流）：熔断，放弃剩余正文抓取，避免整轮拖几十分钟
          if (contentFailures >= 5) {
            contentComplete = false;
            console.error('[weibo-hot] 正文抓取连续失败，已熔断跳过剩余正文:', error instanceof Error ? error.message : error);
            break;
          }
        }
        await sleep(CONTENT_DELAY_MS);
      }
    }

    let matchedCount = 0;
    const rows = [];
    for (const { channel, rows: channelRows } of channelResults) {
      for (const row of channelRows) {
        const hits = new Set(matchKeywords(row.word));
        const content = contentMap.get(row.word) ?? null;
        if (content) {
          for (const keyword of matchKeywords(content)) hits.add(keyword);
        }
        const matched = hits.size > 0;
        if (matched) matchedCount += 1;
        rows.push({
          batchAt,
          channel,
          rank: row.rank,
          word: clip(row.word) ?? row.word,
          note: null,
          category: null,
          subjectQuerys: null,
          labelName: row.labelName,
          hotNum: row.hotNum,
          onboardTime: null,
          content: matched ? content : null,
          matched,
          matchedKeywords: matched ? clip([...hits].join(',')) : null
        });
      }
    }

    if (rows.length > 0) {
      await prisma.weiboHotTopic.createMany({ data: rows });
      try {
        const notifyResult = await notifyWeiboHotMatches(batchAt);
        if (notifyResult.sent > 0) console.log(`[weibo-hot] 微信模板消息已推送 ${notifyResult.sent} 条`);
      } catch (error) {
        console.error('[weibo-hot] 微信推送失败:', error instanceof Error ? error.message : error);
      }
    }

    return {
      skipped: false,
      batchAt: batchAt.toISOString(),
      total: rows.length,
      matched: matchedCount,
      channels: channelResults.map((item) => item.channel),
      contentChecked: contentComplete
    };
  } finally {
    fetchRunning = false;
  }
}
