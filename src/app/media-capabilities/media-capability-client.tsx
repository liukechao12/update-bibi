'use client';

import { useMemo, useState } from 'react';

type Capability = {
  id: string;
  sourceName: string;
  category: string;
  commentCollectable: boolean;
  forwardCollectable: boolean;
  praiseCollectable: boolean;
  remark: string;
  updatedAt: string;
};

type FormState = {
  sourceName: string;
  category: string;
  commentCollectable: boolean;
  forwardCollectable: boolean;
  praiseCollectable: boolean;
  remark: string;
};

const defaultFormState: FormState = {
  sourceName: '',
  category: '网媒',
  commentCollectable: false,
  forwardCollectable: false,
  praiseCollectable: false,
  remark: ''
};

const CATEGORY_OPTIONS = ['网媒', '社媒'];

type SearchParams = {
  keyword?: string;
  category?: string;
  page?: number | string;
  pageSize?: string | number;
};

function CollectTag({ collectable }: { collectable: boolean }) {
  return collectable
    ? <span className="badge">可采集</span>
    : <span className="badge" style={{ opacity: 0.55 }}>不可采集</span>;
}

export default function MediaCapabilityClient({ capabilities, searchParams, total, totalPages }: { capabilities: Capability[]; searchParams: SearchParams; total: number; totalPages: number }) {
  const [list, setList] = useState(capabilities);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState({ keyword: searchParams.keyword ?? '', category: searchParams.category ?? '' });
  const [page, setPage] = useState(Number(searchParams.page ?? 1));
  const [showForm, setShowForm] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>(defaultFormState);

  const filteredList = useMemo(() => {
    return list.filter((item) => {
      if (search.keyword) {
        const keyword = search.keyword.toLowerCase();
        if (![item.sourceName, item.remark].some((value) => value.toLowerCase().includes(keyword))) return false;
      }
      if (search.category && item.category !== search.category) return false;
      return true;
    });
  }, [list, search]);

  function resetForm(next: Capability | null = null) {
    if (!next) {
      setFormState(defaultFormState);
      setCurrentId(null);
      return;
    }
    setCurrentId(next.id);
    setFormState({
      sourceName: next.sourceName,
      category: next.category || '网媒',
      commentCollectable: next.commentCollectable,
      forwardCollectable: next.forwardCollectable,
      praiseCollectable: next.praiseCollectable,
      remark: next.remark
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const res = await fetch(currentId ? `/api/media-capabilities/${currentId}` : '/api/media-capabilities', {
      method: currentId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formState)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.message ?? '保存失败');
      return;
    }

    const saved = data.capability as Capability;
    setMessage(currentId ? '已更新' : '已新增');
    setShowForm(false);
    resetForm();
    if (currentId) {
      setList((current) => current.map((item) => (item.id === saved.id ? { ...saved, updatedAt: '刚刚' } : item)));
    } else {
      setList((current) => [{ ...saved, updatedAt: '刚刚' }, ...current]);
    }
  }

  async function handleDelete(id: string, sourceName: string) {
    if (!window.confirm(`确认删除媒体「${sourceName}」的采集能力配置？删除后该媒体按不在表内处理（默认推 null）。`)) return;
    const res = await fetch(`/api/media-capabilities/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.message ?? '删除失败');
      return;
    }
    setMessage('已删除');
    setList((current) => current.filter((item) => item.id !== id));
  }

  function pageHref(nextPage: number) {
    return `/media-capabilities?keyword=${encodeURIComponent(searchParams.keyword ?? '')}&category=${encodeURIComponent(searchParams.category ?? '')}&pageSize=${encodeURIComponent(String(searchParams.pageSize ?? ''))}&page=${nextPage}`;
  }

  return (
    <div className="grid">
      <div className="card" style={{ padding: 20 }}>
        <div className="header" style={{ marginBottom: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>媒体采集能力列表</h2>
          <button
            className="button"
            type="button"
            onClick={() => {
              const next = !showForm;
              setShowForm(next);
              if (!next) resetForm();
            }}
          >
            {showForm ? '取消新增' : '新增媒体'}
          </button>
        </div>

        <form className="grid grid-4" style={{ marginBottom: 16 }} method="GET" action="/media-capabilities">
          <input className="input" placeholder="关键字：媒体名称/备注" name="keyword" defaultValue={searchParams.keyword} />
          <select className="select" name="category" defaultValue={searchParams.category}>
            <option value="">全部分类</option>
            {CATEGORY_OPTIONS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          <select className="select" name="pageSize" defaultValue={searchParams.pageSize}>
            <option value="20">每页 20 条</option>
            <option value="50">每页 50 条</option>
            <option value="100">每页 100 条</option>
            <option value="200">每页 200 条</option>
            <option value="all">全部查看</option>
          </select>
          <input type="hidden" name="page" value="1" />
          <button className="button" type="submit">查询</button>
        </form>

        {message ? <p className="helper">{message}</p> : null}

        {showForm ? (
          <form className="card" style={{ padding: 16, marginBottom: 16 }} onSubmit={handleSubmit}>
            <div className="header" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{currentId ? '编辑媒体采集能力' : '新增媒体采集能力'}</h3>
              <button className="button secondary" type="button" onClick={() => { setShowForm(false); resetForm(); }}>
                取消
              </button>
            </div>
            <div className="grid grid-3">
              <input
                className="input"
                placeholder="媒体名称（与导入的来源一致）"
                value={formState.sourceName}
                onChange={(e) => setFormState((s) => ({ ...s, sourceName: e.target.value }))}
                required
              />
              <select className="select" value={formState.category} onChange={(e) => setFormState((s) => ({ ...s, category: e.target.value }))}>
                {CATEGORY_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
              <input className="input" placeholder="备注" value={formState.remark} onChange={(e) => setFormState((s) => ({ ...s, remark: e.target.value }))} />
            </div>
            <div className="stack" style={{ marginTop: 12, flexDirection: 'row', gap: 24 }}>
              <label className="stack" style={{ flexDirection: 'row', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={formState.commentCollectable}
                  onChange={(e) => setFormState((s) => ({ ...s, commentCollectable: e.target.checked }))}
                />
                <span>评论/回复数可采集</span>
              </label>
              <label className="stack" style={{ flexDirection: 'row', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={formState.forwardCollectable}
                  onChange={(e) => setFormState((s) => ({ ...s, forwardCollectable: e.target.checked }))}
                />
                <span>转发数可采集</span>
              </label>
              <label className="stack" style={{ flexDirection: 'row', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={formState.praiseCollectable}
                  onChange={(e) => setFormState((s) => ({ ...s, praiseCollectable: e.target.checked }))}
                />
                <span>点赞数可采集</span>
              </label>
            </div>
            <div className="stack" style={{ marginTop: 12 }}>
              <button className="button" type="submit">{currentId ? '保存修改' : '确认创建'}</button>
            </div>
          </form>
        ) : null}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>媒体名称</th>
                <th>分类</th>
                <th>评论/回复数</th>
                <th>转发数</th>
                <th>点赞数</th>
                <th>备注</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center' }}>暂无数据</td></tr>
              ) : (
                filteredList.map((item) => (
                  <tr key={item.id}>
                    <td>{item.sourceName}</td>
                    <td>{item.category || '-'}</td>
                    <td><CollectTag collectable={item.commentCollectable} /></td>
                    <td><CollectTag collectable={item.forwardCollectable} /></td>
                    <td><CollectTag collectable={item.praiseCollectable} /></td>
                    <td>{item.remark || '-'}</td>
                    <td>{item.updatedAt}</td>
                    <td>
                      <div className="stack">
                        <button className="button secondary" type="button" onClick={() => { resetForm(item); setShowForm(true); }}>
                          编辑
                        </button>
                        <button className="button secondary" type="button" onClick={() => handleDelete(item.id, item.sourceName)}>
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="stack" style={{ marginTop: 16, justifyContent: 'space-between' }}>
          <span className="helper">共 {total} 条 · 第 {page} / {totalPages} 页</span>
          <div className="stack">
            {page > 1 ? (
              <a className="button secondary" href={pageHref(page - 1)}>上一页</a>
            ) : (
              <a className="button secondary" href="#" aria-disabled style={{ pointerEvents: 'none', opacity: 0.5 }}>上一页</a>
            )}
            {page < totalPages ? (
              <a className="button secondary" href={pageHref(page + 1)}>下一页</a>
            ) : (
              <a className="button secondary" href="#" aria-disabled style={{ pointerEvents: 'none', opacity: 0.5 }}>下一页</a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
