'use client';

import { Fragment, useState } from 'react';

type EventRecordItem = {
  id: string;
  category: string;
  sourceFileName: string;
  seqNo: number;
  source: string;
  author: string;
  fansCount: number;
  authType: string;
  publishTime: string;
  title: string;
  link: string;
  summary: string;
  viewCount: number | null;
  forwardCount: number | null;
  replyCount: number | null;
  praiseCount: number | null;
  tendency: string;
  rowNo: number;
  createdAt: string;
};

const categoryColors: Record<string, { bg: string; color: string }> = {
  '华为竹知了事件': { bg: '#e8f0ff', color: '#2f6fed' },
  '叠纸敖尹上线事件': { bg: '#f3edff', color: '#7a5cff' },
  '小红书上市投诉事件': { bg: '#fdeaea', color: '#d14343' },
  '雷军过早事件': { bg: '#eaf7ef', color: '#0f9d58' }
};

const tendencyColors: Record<string, { bg: string; color: string }> = {
  负面: { bg: '#fdeaea', color: '#d14343' },
  中性: { bg: '#eef2ff', color: '#4f6ef7' },
  正面: { bg: '#eaf7ef', color: '#0f9d58' }
};

function badgeStyle(key: string, map: Record<string, { bg: string; color: string }>) {
  const tone = map[key] ?? { bg: '#f1f4f9', color: '#6b7a90' };
  return {
    background: tone.bg,
    color: tone.color,
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    whiteSpace: 'nowrap' as const,
    lineHeight: 1,
    minHeight: 28
  };
}

export default function EventRecordsTableClient({ records }: { records: EventRecordItem[] }) {
  const [openRows, setOpenRows] = useState<string[]>([]);
  const [rawCache, setRawCache] = useState<Record<string, Record<string, string> | null>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function toggleRow(id: string) {
    const willOpen = !openRows.includes(id);
    setOpenRows((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    if (willOpen && rawCache[id] === undefined) {
      setLoadingId(id);
      try {
        const res = await fetch(`/api/event-records/${id}`);
        const data = await res.json().catch(() => null);
        if (res.ok && data?.rawData && typeof data.rawData === 'object') {
          setRawCache((prev) => ({ ...prev, [id]: data.rawData as Record<string, string> }));
        } else {
          setRawCache((prev) => ({ ...prev, [id]: null }));
        }
      } catch {
        setRawCache((prev) => ({ ...prev, [id]: null }));
      } finally {
        setLoadingId(null);
      }
    }
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table" style={{ minWidth: 1400, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 40 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 60 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 160 }} />
          <col style={{ width: 300 }} />
          <col style={{ width: 160 }} />
          <col style={{ width: 170 }} />
          <col style={{ width: 110 }} />
        </colgroup>
        <thead>
          <tr>
            <th></th>
            <th>分类</th>
            <th>序号</th>
            <th>来源</th>
            <th>作者</th>
            <th>时间</th>
            <th>标题</th>
            <th>互动数据</th>
            <th>倾向性</th>
            <th>粉丝数</th>
          </tr>
        </thead>
        <tbody>
          {records.length === 0 ? (
            <tr>
              <td colSpan={10} style={{ textAlign: 'center' }}>暂无数据</td>
            </tr>
          ) : (
            records.map((record) => {
              const open = openRows.includes(record.id);
              const rawData = rawCache[record.id] ?? null;
              const rawEntries = rawData ? Object.entries(rawData).filter(([, value]) => value !== '') : [];
              const isLoadingRaw = loadingId === record.id;

              return (
                <Fragment key={record.id}>
                  <tr>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="link-button" onClick={() => toggleRow(record.id)}>
                        {open ? '▼' : '▶'}
                      </button>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={badgeStyle(record.category, categoryColors)}>{record.category}</span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{record.seqNo}</td>
                    <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.source || '-'}</td>
                    <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.author || '-'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{record.publishTime || '-'}</td>
                    <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.title || '-'}</td>
                    <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      浏览 {record.viewCount ?? '—'} · 转载 {record.forwardCount ?? '—'} · 回复 {record.replyCount ?? '—'} · 点赞 {record.praiseCount ?? '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {record.tendency ? <span style={badgeStyle(record.tendency, tendencyColors)}>{record.tendency}</span> : '-'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{record.fansCount}</td>
                  </tr>

                  {open ? (
                    <tr>
                      <td colSpan={10} style={{ background: '#f8fafc', padding: 20 }}>
                        <div className="grid grid-2" style={{ gap: 20 }}>
                          <div>
                            <h3 style={{ margin: '0 0 8px' }}>详细信息</h3>
                            <table className="table">
                              <tbody>
                                <tr>
                                  <th>分类</th>
                                  <td>{record.category}</td>
                                </tr>
                                <tr>
                                  <th>来源文件</th>
                                  <td>{record.sourceFileName}</td>
                                </tr>
                                <tr>
                                  <th>Excel 行号</th>
                                  <td>{record.rowNo}</td>
                                </tr>
                                <tr>
                                  <th>序号</th>
                                  <td>{record.seqNo}</td>
                                </tr>
                                <tr>
                                  <th>来源</th>
                                  <td>{record.source || '-'}</td>
                                </tr>
                                <tr>
                                  <th>作者</th>
                                  <td>{record.author || '-'}</td>
                                </tr>
                                <tr>
                                  <th>粉丝数</th>
                                  <td>{record.fansCount}</td>
                                </tr>
                                <tr>
                                  <th>认证类型</th>
                                  <td>{record.authType || '-'}</td>
                                </tr>
                                <tr>
                                  <th>时间</th>
                                  <td>{record.publishTime || '-'}</td>
                                </tr>
                                <tr>
                                  <th>链接</th>
                                  <td>{record.link ? <a href={record.link} target="_blank" rel="noreferrer">{record.link}</a> : '-'}</td>
                                </tr>
                                <tr>
                                  <th>浏览数</th>
                                  <td>{record.viewCount ?? '—'}</td>
                                </tr>
                                <tr>
                                  <th>转载数</th>
                                  <td>{record.forwardCount ?? '—'}</td>
                                </tr>
                                <tr>
                                  <th>回复数</th>
                                  <td>{record.replyCount ?? '—'}</td>
                                </tr>
                                <tr>
                                  <th>点赞数</th>
                                  <td>{record.praiseCount ?? '—'}</td>
                                </tr>
                                <tr>
                                  <th>倾向性</th>
                                  <td>{record.tendency || '-'}</td>
                                </tr>
                                <tr>
                                  <th>导入时间</th>
                                  <td>{record.createdAt}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                          <div>
                            <h3 style={{ margin: '0 0 8px' }}>标题与摘要</h3>
                            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, maxHeight: 260, overflow: 'auto' }}>
                              <p style={{ margin: '0 0 12px', fontWeight: 600, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{record.title || '-'}</p>
                              {record.summary ? <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.8, color: 'var(--muted)' }}>{record.summary}</p> : null}
                            </div>
                            <h3 style={{ margin: '12px 0 8px' }}>原始字段</h3>
                            {isLoadingRaw ? (
                              <p className="helper">原始字段加载中...</p>
                            ) : rawEntries.length > 0 ? (
                              <pre style={{ whiteSpace: 'pre-wrap', margin: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, maxHeight: 240, overflow: 'auto', fontSize: 12, lineHeight: 1.6 }}>
                                {rawEntries.map(([key, value]) => `${key}: ${value}`).join('\n')}
                              </pre>
                            ) : (
                              <p className="helper">暂无原始字段</p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
