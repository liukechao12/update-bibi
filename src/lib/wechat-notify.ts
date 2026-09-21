import { prisma } from '@/lib/prisma';

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const SEND_URL = 'https://api.weixin.qq.com/cgi-bin/message/template/send';
// 同一热点超过 2 小时没有再推送过（大概率下榜又回来），按"重新上榜"再推一次
const REPUSH_GAP_MS = 2 * 60 * 60 * 1000;

type WechatConfig = {
  appid: string;
  secret: string;
  templateId: string;
  openids: string[];
};

let tokenCache: { token: string; expiresAt: number } | null = null;

function loadConfig(): WechatConfig | null {
  const appid = process.env.WECHAT_MP_APPID?.trim();
  const secret = process.env.WECHAT_MP_SECRET?.trim();
  const templateId = process.env.WECHAT_MP_TEMPLATE_ID?.trim();
  const openids = (process.env.WECHAT_MP_OPENIDS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!appid || !secret || !templateId || openids.length === 0) return null;
  return { appid, secret, templateId, openids };
}

export function isWechatNotifyEnabled() {
  return loadConfig() !== null;
}

async function accessToken(cfg: WechatConfig) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch(
    `${TOKEN_URL}?grant_type=client_credential&appid=${encodeURIComponent(cfg.appid)}&secret=${encodeURIComponent(cfg.secret)}`,
    { signal: AbortSignal.timeout(8000) }
  );
  const json = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
  if (!json.access_token) throw new Error(`微信 access_token 获取失败: ${json.errcode} ${json.errmsg}`);
  tokenCache = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 7200) * 1000 };
  return tokenCache.token;
}

type TemplateData = Record<string, { value: string; color?: string }>;

async function sendTemplate(cfg: WechatConfig, touser: string, data: TemplateData, url: string) {
  const token = await accessToken(cfg);
  const res = await fetch(`${SEND_URL}?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ touser, template_id: cfg.templateId, url, data }),
    signal: AbortSignal.timeout(8000)
  });
  const json = (await res.json()) as { errcode?: number; errmsg?: string };
  if (json.errcode !== 0) throw new Error(`模板消息发送失败: ${json.errcode} ${json.errmsg}`);
}

function formatBeijingMinute(date: Date) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function formatDuration(firstSeenAt: Date, now: Date) {
  const minutes = Math.max(0, Math.floor((now.getTime() - firstSeenAt.getTime()) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}天${hours}时${mins}分钟`;
  if (hours > 0) return `${hours}时${mins}分钟`;
  return `${mins}分钟`;
}

// 抓取入库后调用：对本批次命中的热点做「首次命中 / 排名变化 / 重新上榜」判断并推送模板消息
export async function notifyWeiboHotMatches(batchAt: Date) {
  const cfg = loadConfig();
  if (!cfg) return { sent: 0, enabled: false };

  const topics = await prisma.weiboHotTopic.findMany({ where: { batchAt, matched: true } });
  if (topics.length === 0) return { sent: 0, enabled: true };

  const states = await prisma.weiboHotNotify.findMany({
    where: { OR: topics.map((topic) => ({ word: topic.word, channel: topic.channel })) }
  });
  const stateMap = new Map(states.map((state) => [`${state.channel}||${state.word}`, state]));

  const now = new Date();
  let sent = 0;

  for (const topic of topics) {
    const state = stateMap.get(`${topic.channel}||${topic.word}`);

    let firstSeenAt = state?.firstSeenAt ?? topic.batchAt;
    if (!state) {
      const first = await prisma.weiboHotTopic.aggregate({
        where: { word: topic.word, channel: topic.channel },
        _min: { batchAt: true }
      });
      firstSeenAt = first._min.batchAt ?? topic.batchAt;
    }

    let firstLine: string;
    let trend: string;
    if (!state) {
      firstLine = '微博热点命中提醒';
      trend = `新命中关键词：${topic.matchedKeywords ?? ''}`;
    } else if (now.getTime() - state.lastPushedAt.getTime() > REPUSH_GAP_MS) {
      firstLine = '微博热点重新上榜';
      trend = `下榜后重新上榜，当前第${topic.rank + 1}名`;
    } else if (state.lastPushedRank === topic.rank) {
      continue; // 排名没变化，不重复推送
    } else {
      firstLine = '微博热点排名变化';
      trend = `第${state.lastPushedRank + 1}名 → 第${topic.rank + 1}名（${topic.rank < state.lastPushedRank ? '上升' : '下降'}）`;
    }

    const listName = topic.channel === '热搜' ? '微博热搜榜' : `微博${topic.channel}榜`;
    const url = `https://s.weibo.com/weibo?q=${encodeURIComponent(`#${topic.word}#`)}`;
    const data: TemplateData = {
      first: { value: firstLine },
      keyword: { value: `#${topic.word}#` },
      channel: { value: listName },
      rank: { value: `第${topic.rank + 1}名` },
      trend: { value: trend },
      onboard: { value: formatBeijingMinute(firstSeenAt) },
      duration: { value: formatDuration(firstSeenAt, now) },
      link: { value: url },
      remark: { value: '点击消息也可直接打开链接' }
    };

    let sentForTopic = 0;
    for (const openid of cfg.openids) {
      try {
        await sendTemplate(cfg, openid, data, url);
        sentForTopic += 1;
      } catch (error) {
        console.error(`[wechat-notify] 推送失败 openid=${openid.slice(0, 6)}***:`, error instanceof Error ? error.message : error);
      }
    }
    // 至少发给一个人成功才记录状态，全部失败则下轮重试
    if (sentForTopic === 0) continue;
    sent += sentForTopic;

    await prisma.weiboHotNotify.upsert({
      where: { word_channel: { word: topic.word, channel: topic.channel } },
      create: { word: topic.word, channel: topic.channel, firstSeenAt, lastPushedRank: topic.rank, lastPushedAt: now },
      update: { lastPushedRank: topic.rank, lastPushedAt: now }
    });
  }

  return { sent, enabled: true };
}
