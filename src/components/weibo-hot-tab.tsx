'use client';

import { useCallback, useEffect, useState } from 'react';

type HotTopic = {
  id: string;
  channel: string;
  rank: number;
  word: string;
  note: string | null;
  category: string | null;
  subjectQuerys: string | null;
  labelName: string | null;
  hotNum: number;
  content: string | null;
  matched: boolean;
  matchedKeywords: string | null;
};

type LatestResponse = {
  batchAt: string | null;
  topics: HotTopic[];
  matchedCount: number;
  total: number;
  channels: string[];
  keywords: string[];
  contentChecked: boolean;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function Highlight({ text, keywords }: { text: string; keywords: string[] }) {
  if (!text || keywords.length === 0) return <>{text}</>;
  const regex = new RegExp(`(${keywords.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, index) =>
        keywords.some((keyword) => keyword.toLowerCase() === part.toLowerCase()) ? (
          <mark className="hot-keyword" key={index}>{part}</mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

export default function WeiboHotTab() {
  const [data, setData] = useState<LatestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [matchedOnly, setMatchedOnly] = useState(false);
  const [channel, setChannel] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async (onlyMatched: boolean, channelFilter: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (onlyMatched) params.set('matchedOnly', '1');
      if (channelFilter) params.set('channel', channelFilter);
      const query = params.toString();
      const res = await fetch(`/api/weibo-hot/latest${query ? `?${query}` : ''}`);
      const json = (await res.json()) as LatestResponse & { message?: string };
      if (!res.ok) {
        setMessage(json.message ?? '加载失败');
        return;
      }
      setData(json);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(matchedOnly, channel);
  }, [load, matchedOnly, channel]);

  async function handleFetchNow() {
    setFetching(true);
    setMessage('');
    try {
      const prevBatchAt = data?.batchAt ?? null;
      const res = await fetch('/api/weibo-hot/fetch', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.message ?? '抓取失败');
        return;
      }
      setMessage(json.alreadyRunning ? '已有一轮抓取在进行中，等待完成后自动刷新…' : '已在后台开始抓取，完成后自动刷新…');
      // 轮询等待新一轮抓取落库（最长 6 分钟）
      const deadline = Date.now() + 6 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const pollRes = await fetch('/api/weibo-hot/latest');
        if (!pollRes.ok) continue;
        const poll = (await pollRes.json()) as LatestResponse;
        if (poll.batchAt && poll.batchAt !== prevBatchAt) {
          setMessage(`抓取完成：共 ${poll.total} 条，命中关键词 ${poll.matchedCount} 条${poll.contentChecked ? '（已含正文匹配）' : ''}（${poll.channels.join('/')}）`);
          await load(matchedOnly, channel);
          return;
        }
      }
      setMessage('抓取时间较长仍在后台进行，请稍后手动切换筛选或刷新页面查看');
    } finally {
      setFetching(false);
    }
  }

  const keywords = data?.keywords ?? [];
  const topics = data?.topics ?? [];

  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="header" style={{ marginBottom: 12 }}>
        <h2 className="section-title" style={{ margin: 0 }}>微博热点（每 10 分钟自动抓取）</h2>
        <div className="stack" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <select
            className="select"
            style={{ width: 120 }}
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            aria-label="榜单筛选"
          >
            <option value="">全部榜单</option>
            {(data?.channels ?? []).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <label className="helper" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={matchedOnly}
              onChange={(e) => setMatchedOnly(e.target.checked)}
            />
            只看命中{data ? `（${data.matchedCount}）` : ''}
          </label>
          <button className="button" type="button" onClick={handleFetchNow} disabled={fetching}>
            {fetching ? '抓取中…' : '立即抓取'}
          </button>
        </div>
      </div>

      <p className="helper">
        关键词：{keywords.length > 0 ? keywords.join('、') : '-'}（标题/摘要/相关词{data?.contentChecked ? '/正文' : ''}任一命中即高亮）
        {data?.batchAt ? ` · 最近抓取：${formatTime(data.batchAt)} · 共 ${data.total} 条` : ''}
      </p>
      {message ? <p className="helper">{message}</p> : null}

      {loading ? (
        <p className="helper">加载中…</p>
      ) : topics.length === 0 ? (
        <p className="helper" style={{ textAlign: 'center', padding: 24 }}>
          {data?.batchAt ? '该筛选下暂无数据' : '暂无数据，点击「立即抓取」获取最新微博热点'}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>排名</th>
                <th style={{ width: 70 }}>榜单</th>
                <th style={{ width: 60 }}>标签</th>
                <th>热点标题</th>
                <th style={{ width: 110 }}>分类</th>
                <th style={{ width: 110 }}>热度</th>
                <th style={{ width: 150 }}>命中关键词</th>
              </tr>
            </thead>
            <tbody>
              {topics.map((topic) => (
                <tr key={topic.id} className={topic.matched ? 'hot-matched' : undefined}>
                  <td>{topic.rank + 1}</td>
                  <td>{topic.channel}</td>
                  <td>{topic.labelName ? <span className="badge hot-label">{topic.labelName}</span> : '-'}</td>
                  <td>
                    <a
                      href={`https://s.weibo.com/weibo?q=${encodeURIComponent(`#${topic.word}#`)}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontWeight: topic.matched ? 700 : undefined }}
                    >
                      <Highlight text={topic.word} keywords={keywords} />
                    </a>
                    {topic.note && topic.note !== topic.word ? (
                      <div className="helper" style={{ marginTop: 4 }}>
                        <Highlight text={topic.note} keywords={keywords} />
                      </div>
                    ) : null}
                    {topic.content ? (
                      <details style={{ marginTop: 6 }}>
                        <summary className="helper" style={{ cursor: 'pointer' }}>查看命中正文</summary>
                        <div className="hot-content">
                          <Highlight text={topic.content} keywords={keywords} />
                        </div>
                      </details>
                    ) : null}
                  </td>
                  <td>{topic.category ? <Highlight text={topic.category} keywords={keywords} /> : '-'}</td>
                  <td>{topic.hotNum.toLocaleString('zh-CN')}</td>
                  <td>
                    {topic.matchedKeywords ? (
                      <span className="badge hot-hit">{topic.matchedKeywords}</span>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
