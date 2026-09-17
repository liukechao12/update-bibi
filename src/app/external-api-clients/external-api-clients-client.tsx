'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type ClientItem = {
  id: string;
  clientCode: string;
  clientName: string;
  department: string | null;
  status: 'ACTIVE' | 'DISABLED';
  allowAllEvents: boolean;
  rateLimitPerMinute: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  createdBy?: { displayName?: string | null; username?: string | null } | null;
  eventScopes: Array<{ id: string; eventCategory: string }>;
  _count?: { requestLogs: number };
};

type EventCategoryStat = {
  category: string;
  _count: { _all: number };
};

type UserItem = {
  id: string;
  displayName: string;
  username: string;
};

type EditForm = {
  clientName: string;
  department: string;
  allowAllEvents: boolean;
  rateLimitPerMinute: number;
  expiresAt: string;
  eventCategories: string[];
};

function maskTip(key: string) {
  if (!key) return '';
  if (key.length <= 10) return key;
  return `${key.slice(0, 6)}***${key.slice(-4)}`;
}

export default function ExternalApiClientsClient({ initialClients, eventCategories, users }: { initialClients: ClientItem[]; eventCategories: EventCategoryStat[]; users: UserItem[] }) {
  const [clients, setClients] = useState<ClientItem[]>(initialClients);
  const [message, setMessage] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState({
    clientCode: '',
    clientName: '',
    department: '',
    allowAllEvents: false,
    rateLimitPerMinute: 60,
    expiresAt: '',
    eventCategories: [] as string[]
  });
  const [editForm, setEditForm] = useState<EditForm>({
    clientName: '',
    department: '',
    allowAllEvents: false,
    rateLimitPerMinute: 60,
    expiresAt: '',
    eventCategories: []
  });

  const categoryOptions = useMemo(
    () => eventCategories.map((item) => ({ value: item.category, label: `${item.category}（${item._count._all}）` })),
    [eventCategories]
  );

  async function refresh() {
    const res = await fetch('/api/external-api-clients');
    const json = await res.json().catch(() => ({}));
    if (res.ok) setClients(json.clients ?? []);
  }

  async function createClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setApiKey('');
    const res = await fetch('/api/external-api-clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(json.message ?? '创建失败');
      return;
    }
    setApiKey(json.apiKey ?? '');
    setMessage('客户创建成功，请立即复制 API Key。系统不会再次展示完整明文 Key。');
    setForm({ clientCode: '', clientName: '', department: '', allowAllEvents: false, rateLimitPerMinute: 60, expiresAt: '', eventCategories: [] });
    await refresh();
  }

  async function toggleStatus(client: ClientItem) {
    const nextStatus = client.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    const res = await fetch(`/api/external-api-clients/${client.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(json.message ?? '更新失败');
      return;
    }
    setMessage(`已${nextStatus === 'ACTIVE' ? '启用' : '禁用'}客户 ${client.clientName}`);
    await refresh();
  }

  async function rotateKey(client: ClientItem) {
    const res = await fetch(`/api/external-api-clients/${client.id}`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(json.message ?? '重置 Key 失败');
      return;
    }
    setApiKey(json.apiKey ?? '');
    setMessage(`已重置 ${client.clientName} 的 API Key，请立即复制。旧 Key 已失效。`);
  }

  function toggleCategory(value: string) {
    setForm((prev) => ({
      ...prev,
      eventCategories: prev.eventCategories.includes(value)
        ? prev.eventCategories.filter((item) => item !== value)
        : [...prev.eventCategories, value]
    }));
  }

  function openEdit(client: ClientItem) {
    setEditingId(client.id);
    setEditForm({
      clientName: client.clientName,
      department: client.department ?? '',
      allowAllEvents: client.allowAllEvents,
      rateLimitPerMinute: client.rateLimitPerMinute,
      expiresAt: client.expiresAt ? new Date(client.expiresAt).toISOString().slice(0, 16) : '',
      eventCategories: client.eventScopes.map((item) => item.eventCategory)
    });
    setMessage('');
  }

  function toggleEditCategory(value: string) {
    setEditForm((prev) => ({
      ...prev,
      eventCategories: prev.eventCategories.includes(value)
        ? prev.eventCategories.filter((item) => item !== value)
        : [...prev.eventCategories, value]
    }));
  }

  async function saveEdit() {
    if (!editingId) return;
    const res = await fetch(`/api/external-api-clients/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(json.message ?? '保存失败');
      return;
    }
    setMessage('客户配置已更新');
    setEditingId('');
    await refresh();
  }

  return (
    <>
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div className="stack" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>新建客户</h2>
          <Link className="button secondary" href="/external-api-logs">查看调用日志</Link>
        </div>
        <form onSubmit={createClient}>
          <div className="grid grid-3">
            <input className="input" placeholder="客户编码，如 bilibili_uat" value={form.clientCode} onChange={(e) => setForm((s) => ({ ...s, clientCode: e.target.value }))} />
            <input className="input" placeholder="客户名称" value={form.clientName} onChange={(e) => setForm((s) => ({ ...s, clientName: e.target.value }))} />
            <input className="input" placeholder="部门/分类：填「媒体」或「社交媒体」" value={form.department} onChange={(e) => setForm((s) => ({ ...s, department: e.target.value }))} />
          </div>
          <div className="grid grid-3" style={{ marginTop: 12 }}>
            <input className="input" type="number" min={1} placeholder="每分钟限流" value={form.rateLimitPerMinute} onChange={(e) => setForm((s) => ({ ...s, rateLimitPerMinute: Number(e.target.value) || 60 }))} />
            <label className="helper" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={form.allowAllEvents} onChange={(e) => setForm((s) => ({ ...s, allowAllEvents: e.target.checked }))} />
              允许全部事件（建议先不要开启）
            </label>
            <input className="input" type="datetime-local" value={form.expiresAt} onChange={(e) => setForm((s) => ({ ...s, expiresAt: e.target.value }))} />
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="helper" style={{ marginBottom: 8 }}>授权事件项目</div>
            <div className="grid grid-3">
              {categoryOptions.map((item) => (
                <label key={item.value} className="helper" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={form.eventCategories.includes(item.value)} disabled={form.allowAllEvents} onChange={() => toggleCategory(item.value)} />
                  {item.label}
                </label>
              ))}
            </div>
          </div>
          <div className="stack" style={{ marginTop: 16 }}>
            <button className="button" type="submit">创建客户</button>
            {message ? <span className="helper">{message}</span> : null}
          </div>
          {apiKey ? (
            <div className="card" style={{ marginTop: 16, padding: 16, background: '#f8fafc' }}>
              <div className="helper">请立即复制 API Key（只展示这一次）：</div>
              <code style={{ display: 'block', marginTop: 8, wordBreak: 'break-all' }}>{apiKey}</code>
              <div className="helper" style={{ marginTop: 8 }}>脱敏预览：{maskTip(apiKey)}</div>
            </div>
          ) : null}
        </form>
      </div>

      {editingId ? (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <h2 className="section-title">编辑客户</h2>
          <div className="grid grid-3">
            <input className="input" placeholder="客户名称" value={editForm.clientName} onChange={(e) => setEditForm((s) => ({ ...s, clientName: e.target.value }))} />
            <input className="input" placeholder="部门/分类：填「媒体」或「社交媒体」" value={editForm.department} onChange={(e) => setEditForm((s) => ({ ...s, department: e.target.value }))} />
            <input className="input" type="number" min={1} value={editForm.rateLimitPerMinute} onChange={(e) => setEditForm((s) => ({ ...s, rateLimitPerMinute: Number(e.target.value) || 60 }))} />
          </div>
          <div className="grid grid-3" style={{ marginTop: 12 }}>
            <input className="input" type="datetime-local" value={editForm.expiresAt} onChange={(e) => setEditForm((s) => ({ ...s, expiresAt: e.target.value }))} />
            <label className="helper" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={editForm.allowAllEvents} onChange={(e) => setEditForm((s) => ({ ...s, allowAllEvents: e.target.checked }))} />
              允许全部事件
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="helper" style={{ marginBottom: 8 }}>授权事件项目</div>
            <div className="grid grid-3">
              {categoryOptions.map((item) => (
                <label key={item.value} className="helper" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={editForm.eventCategories.includes(item.value)} disabled={editForm.allowAllEvents} onChange={() => toggleEditCategory(item.value)} />
                  {item.label}
                </label>
              ))}
            </div>
          </div>
          <div className="stack" style={{ marginTop: 16 }}>
            <button className="button" type="button" onClick={saveEdit}>保存修改</button>
            <button className="button secondary" type="button" onClick={() => setEditingId('')}>取消</button>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ padding: 20 }}>
        <h2 className="section-title">客户列表</h2>
        <table className="table">
          <thead>
            <tr>
              <th>客户编码</th>
              <th>客户名称</th>
              <th>部门（媒体/社交）</th>
              <th>状态</th>
              <th>授权事件</th>
              <th>限流</th>
              <th>调用次数</th>
              <th>最近调用</th>
              <th>创建人</th>
              <th>Key说明</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id}>
                <td>{client.clientCode}</td>
                <td>{client.clientName}</td>
                <td>{client.department || '-'}</td>
                <td>{client.status === 'ACTIVE' ? '启用' : '禁用'}</td>
                <td>{client.allowAllEvents ? '全部事件' : (client.eventScopes.map((item) => item.eventCategory).join('、') || '-')}</td>
                <td>{client.rateLimitPerMinute}/分钟</td>
                <td>{client._count?.requestLogs ?? 0}</td>
                <td>{client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString() : '-'}</td>
                <td>{client.createdBy?.displayName ?? client.createdBy?.username ?? '-'}</td>
                <td>系统仅保存哈希，不展示明文</td>
                <td>
                  <div className="stack">
                    <button className="button secondary" type="button" onClick={() => openEdit(client)}>编辑</button>
                    <button className="button secondary" type="button" onClick={() => toggleStatus(client)}>{client.status === 'ACTIVE' ? '禁用' : '启用'}</button>
                    <button className="button secondary" type="button" onClick={() => rotateKey(client)}>重置 Key</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
