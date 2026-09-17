'use client';

import { useMemo, useState } from 'react';

type MediaLibrary = {
  id: string;
  name: string;
  domain: string;
  authorName: string;
  originType: string;
  publisherType: string;
  authorType: string;
  priority: number;
  status: string;
  remark: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
};

type User = {
  id: string;
  name: string;
  username: string;
};

type LabelMaps = {
  originTypeLabelMap: Record<string, string>;
  publisherTypeLabelMap: Record<string, string>;
  authorTypeLabelMap: Record<string, string>;
  mediaRuleStatusLabelMap: Record<string, string>;
};

type FormState = {
  name: string;
  domain: string;
  authorName: string;
  originType: string;
  publisherType: string;
  authorType: string;
  priority: string;
  status: string;
  remark: string;
};

const defaultFormState: FormState = {
  name: '',
  domain: '',
  authorName: '',
  originType: 'media',
  publisherType: 'MEDIA',
  authorType: '',
  priority: '0',
  status: 'ACTIVE',
  remark: ''
};

type SearchParams = {
  keyword?: string;
  originType?: string;
  publisherType?: string;
  status?: string;
  page?: number | string;
  pageSize?: string | number;
};

export default function MediaLibraryClient({ mediaLibraries, users, labelMaps, searchParams, total, totalPages }: { mediaLibraries: MediaLibrary[]; users: User[]; labelMaps: LabelMaps; searchParams: SearchParams; total: number; totalPages: number }) {
  const [list, setList] = useState(mediaLibraries);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState({ keyword: searchParams.keyword, originType: searchParams.originType, publisherType: searchParams.publisherType, status: searchParams.status });
  const [page, setPage] = useState(Number(searchParams.page ?? 1));
  const [pageSize, setPageSize] = useState(searchParams.pageSize);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MediaLibrary | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>(defaultFormState);

  const filteredList = useMemo(() => {
    return list.filter((item) => {
      if (search.keyword) {
        const keyword = search.keyword.toLowerCase();
        const hit = [item.name, item.domain, item.authorName, item.remark].some((value) => value.toLowerCase().includes(keyword));
        if (!hit) return false;
      }
      if (search.originType && item.originType !== search.originType) return false;
      if (search.publisherType && item.publisherType !== search.publisherType) return false;
      if (search.status && item.status !== search.status) return false;
      return true;
    });
  }, [list, search]);

  function resetForm(nextEditing: MediaLibrary | null = null) {
    if (!nextEditing) {
      setFormState(defaultFormState);
      setEditing(null);
      setCurrentId(null);
      return;
    }

    setEditing(nextEditing);
    setCurrentId(nextEditing.id);
    setFormState({
      name: nextEditing.name,
      domain: nextEditing.domain,
      authorName: nextEditing.authorName,
      originType: nextEditing.originType,
      publisherType: nextEditing.publisherType,
      authorType: nextEditing.authorType,
      priority: String(nextEditing.priority),
      status: nextEditing.status,
      remark: nextEditing.remark
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = { ...formState, priority: Number(formState.priority || 0) };

    const res = await fetch(currentId ? `/api/media-libraries/${currentId}` : '/api/media-libraries', {
      method: currentId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.message ?? '保存失败');
      return;
    }

    const saved = data.mediaLibrary as MediaLibrary;
    setMessage(currentId ? '媒体库已更新' : '媒体库已创建');
    setShowForm(false);
    resetForm();
    if (currentId) {
      setList((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    } else {
      setList((current) => [saved, ...current]);
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/media-libraries/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.message ?? '删除失败');
      return;
    }
    setMessage('媒体库已删除');
    setList((current) => current.filter((item) => item.id !== id));
  }

  return (
    <div className="grid">
      <div className="card" style={{ padding: 20 }}>
        <div className="header" style={{ marginBottom: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>媒体库列表</h2>
          <button
            className="button"
            type="button"
            onClick={() => {
              const next = !showForm;
              setShowForm(next);
              if (!next) resetForm();
            }}
          >
            {showForm ? '取消新增' : '新增媒体库'}
          </button>
        </div>

        <form className="grid grid-4" style={{ marginBottom: 16 }} method="GET" action="/media-libraries">
          <input className="input" placeholder="关键字：名称/域名/作者/备注" name="keyword" defaultValue={searchParams.keyword} />
          <select className="select" name="originType" defaultValue={searchParams.originType}>
            <option value="">全部来源类型</option>
            {Object.entries(labelMaps.originTypeLabelMap).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select className="select" name="publisherType" defaultValue={searchParams.publisherType}>
            <option value="">全部发布类型</option>
            {Object.entries(labelMaps.publisherTypeLabelMap).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select className="select" name="status" defaultValue={searchParams.status}>
            <option value="">全部状态</option>
            {Object.entries(labelMaps.mediaRuleStatusLabelMap).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
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
              <h3 style={{ margin: 0 }}>{editing ? '编辑媒体库' : '新增媒体库'}</h3>
              <button className="button secondary" type="button" onClick={() => { setShowForm(false); resetForm(); }}>
                取消
              </button>
            </div>
            <div className="grid grid-3">
              <input className="input" placeholder="名称" value={formState.name} onChange={(e) => setFormState((s) => ({ ...s, name: e.target.value }))} required />
              <input className="input" placeholder="域名" value={formState.domain} onChange={(e) => setFormState((s) => ({ ...s, domain: e.target.value }))} />
              <input className="input" placeholder="作者名称" value={formState.authorName} onChange={(e) => setFormState((s) => ({ ...s, authorName: e.target.value }))} />
              <select className="select" value={formState.originType} onChange={(e) => setFormState((s) => ({ ...s, originType: e.target.value }))}>
                {Object.entries(labelMaps.originTypeLabelMap).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select className="select" value={formState.publisherType} onChange={(e) => setFormState((s) => ({ ...s, publisherType: e.target.value }))}>
                {Object.entries(labelMaps.publisherTypeLabelMap).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select className="select" value={formState.authorType} onChange={(e) => setFormState((s) => ({ ...s, authorType: e.target.value }))}>
                <option value="">作者类型（可选）</option>
                {Object.entries(labelMaps.authorTypeLabelMap).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input className="input" type="number" placeholder="优先级" value={formState.priority} onChange={(e) => setFormState((s) => ({ ...s, priority: e.target.value }))} />
              <select className="select" value={formState.status} onChange={(e) => setFormState((s) => ({ ...s, status: e.target.value }))}>
                {Object.entries(labelMaps.mediaRuleStatusLabelMap).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input className="input" value={users.find((u) => u.id === editing?.createdById)?.name ?? '当前登录用户'} disabled />
              <input className="input" placeholder="备注" value={formState.remark} onChange={(e) => setFormState((s) => ({ ...s, remark: e.target.value }))} />
            </div>
            <div className="stack" style={{ marginTop: 12 }}>
              <button className="button" type="submit">{editing ? '保存修改' : '确认创建'}</button>
            </div>
          </form>
        ) : null}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>域名</th>
                <th>作者名称</th>
                <th>来源类型</th>
                <th>发布类型</th>
                <th>作者类型</th>
                <th>优先级</th>
                <th>状态</th>
                <th>创建人</th>
                <th>时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign: 'center' }}>暂无数据</td></tr>
              ) : (
                filteredList.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.domain || '-'}</td>
                    <td>{item.authorName || '-'}</td>
                    <td>{labelMaps.originTypeLabelMap[item.originType] ?? item.originType}</td>
                    <td>{labelMaps.publisherTypeLabelMap[item.publisherType] ?? item.publisherType}</td>
                    <td>{labelMaps.authorTypeLabelMap[item.authorType] ?? item.authorType}</td>
                    <td>{item.priority}</td>
                    <td>{labelMaps.mediaRuleStatusLabelMap[item.status] ?? item.status}</td>
                    <td>{item.createdByName}</td>
                    <td>{item.createdAt}</td>
                    <td>
                      <div className="stack">
                        <button className="button secondary" type="button" onClick={() => { resetForm(item); setShowForm(true); }}>
                          编辑
                        </button>
                        <button className="button secondary" type="button" onClick={() => handleDelete(item.id)}>
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
              <a className="button secondary" href={`/media-libraries?keyword=${encodeURIComponent(searchParams.keyword ?? '')}&originType=${encodeURIComponent(searchParams.originType ?? '')}&publisherType=${encodeURIComponent(searchParams.publisherType ?? '')}&status=${encodeURIComponent(searchParams.status ?? '')}&pageSize=${encodeURIComponent(String(searchParams.pageSize ?? ''))}&page=${page - 1}`}>上一页</a>
            ) : (
              <a className="button secondary" href="#" aria-disabled style={{ pointerEvents: 'none', opacity: 0.5 }}>上一页</a>
            )}
            {page < totalPages ? (
              <a className="button secondary" href={`/media-libraries?keyword=${encodeURIComponent(searchParams.keyword ?? '')}&originType=${encodeURIComponent(searchParams.originType ?? '')}&publisherType=${encodeURIComponent(searchParams.publisherType ?? '')}&status=${encodeURIComponent(searchParams.status ?? '')}&pageSize=${encodeURIComponent(String(searchParams.pageSize ?? ''))}&page=${page + 1}`}>下一页</a>
            ) : (
              <a className="button secondary" href="#" aria-disabled style={{ pointerEvents: 'none', opacity: 0.5 }}>下一页</a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
