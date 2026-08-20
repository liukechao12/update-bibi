'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { labelOrValue, userStatusLabelMap } from '@/lib/labels';

type User = {
  id: string;
  username: string;
  displayName: string;
  department: string;
  status: string;
  roles: string[];
  roleNames: string[];
  recordsCount: number;
  pushJobsCount: number;
  createdAt: string;
};

type Role = {
  roleCode: string;
  roleName: string;
};

export default function UserList({ users, roles, keyword, status, roleCode }: { users: User[]; roles: Role[]; keyword: string; status: string; roleCode: string }) {
  const [list, setList] = useState(users);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [resetPassword, setResetPassword] = useState<{ id: string; password: string } | null>(null);
  const [editingUser, setEditingUser] = useState<{ id: string; displayName: string; department: string; roleCode: string; status: string } | null>(null);
  const [search, setSearch] = useState({ keyword, status, roleCode });

  const currentUsers = useMemo(() => list, [list]);

  function getRoleName(code: string) {
    return roles.find((role) => role.roleCode === code)?.roleName ?? code;
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      username: String(formData.get('username') ?? ''),
      password: String(formData.get('password') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
      department: String(formData.get('department') ?? ''),
      roleCode: String(formData.get('roleCode') ?? 'USER')
    };

    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.message ?? '创建失败');
      return;
    }

    setMessage('用户已创建');
    setShowForm(false);
    window.location.reload();
  }

  async function handleUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingUser) return;

    const formData = new FormData(event.currentTarget);
    const payload = {
      displayName: String(formData.get('displayName') ?? '').trim(),
      department: String(formData.get('department') ?? '').trim(),
      roleCode: String(formData.get('roleCode') ?? '').trim(),
      status: String(formData.get('status') ?? '').trim()
    };

    const res = await fetch(`/api/users/${editingUser.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.message ?? '更新失败');
      return;
    }

    setMessage('用户已更新');
    const updatedRoleName = getRoleName(payload.roleCode);
    setList((current) =>
      current.map((item) =>
        item.id === editingUser.id
          ? {
              ...item,
              displayName: payload.displayName,
              department: payload.department,
              status: payload.status,
              roles: payload.roleCode ? [payload.roleCode] : [],
              roleNames: payload.roleCode ? [updatedRoleName] : []
            }
          : item
      )
    );
    setEditingUser(null);
  }

  async function toggleStatus(user: User) {
    const method = user.status === 'ACTIVE' ? 'PATCH' : 'DELETE';
    const res = await fetch(`/api/users/${user.id}`, { method });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.message ?? '操作失败');
      return;
    }

    setList((current) =>
      current.map((item) =>
        item.id === user.id
          ? { ...item, status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }
          : item
      )
    );
  }

  async function handleResetPassword() {
    if (!resetPassword) return;
    const res = await fetch(`/api/users/${resetPassword.id}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: resetPassword.password })
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.message ?? '重置失败');
      return;
    }

    setMessage('密码已重置');
    setResetPassword(null);
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (search.keyword) params.set('keyword', search.keyword);
    if (search.status) params.set('status', search.status);
    if (search.roleCode) params.set('role', search.roleCode);
    window.location.href = `/users${params.toString() ? `?${params.toString()}` : ''}`;
  }

  return (
    <div className="grid">
      <div className="card" style={{ padding: 20 }}>
        <div className="header" style={{ marginBottom: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>用户列表</h2>
          <button className="button" onClick={() => setShowForm((value) => !value)}>
            {showForm ? '取消新增' : '新增用户'}
          </button>
        </div>

        <form className="grid grid-4" onSubmit={submitSearch} style={{ marginBottom: 16 }}>
          <input className="input" placeholder="关键字：用户名/显示名称/部门" value={search.keyword} onChange={(e) => setSearch((s) => ({ ...s, keyword: e.target.value }))} />
          <select className="select" value={search.status} onChange={(e) => setSearch((s) => ({ ...s, status: e.target.value }))}>
            <option value="">全部状态</option>
            <option value="ACTIVE">启用</option>
            <option value="DISABLED">禁用</option>
          </select>
          <select className="select" value={search.roleCode} onChange={(e) => setSearch((s) => ({ ...s, roleCode: e.target.value }))}>
            <option value="">全部角色</option>
            {roles.map((role) => (
              <option key={role.roleCode} value={role.roleCode}>{role.roleName}</option>
            ))}
          </select>
          <button className="button" type="submit">筛选</button>
        </form>

        {message ? <p className="helper">{message}</p> : null}

        {showForm ? (
          <form className="grid grid-3" style={{ marginBottom: 16 }} onSubmit={handleCreate}>
            <input className="input" name="username" placeholder="用户名" required />
            <input className="input" name="password" type="password" placeholder="密码" required />
            <input className="input" name="displayName" placeholder="显示名称" required />
            <input className="input" name="department" placeholder="部门/分类" />
            <select className="select" name="roleCode" defaultValue="USER">
              {roles.map((role) => (
                <option key={role.roleCode} value={role.roleCode}>{role.roleName}</option>
              ))}
            </select>
            <button className="button" type="submit">确认创建</button>
          </form>
        ) : null}

        {editingUser ? (
          <form className="card" style={{ padding: 16, marginBottom: 16 }} onSubmit={handleUpdate}>
            <div className="header" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>编辑用户</h3>
              <button className="button secondary" type="button" onClick={() => setEditingUser(null)}>
                取消编辑
              </button>
            </div>
            <div className="grid grid-4">
              <input className="input" name="displayName" placeholder="显示名称" defaultValue={editingUser.displayName} required />
              <input className="input" name="department" placeholder="部门/分类" defaultValue={editingUser.department} />
              <select className="select" name="roleCode" defaultValue={editingUser.roleCode}>
                {roles.map((role) => (
                  <option key={role.roleCode} value={role.roleCode}>{role.roleName}</option>
                ))}
              </select>
              <select className="select" name="status" defaultValue={editingUser.status}>
                <option value="ACTIVE">启用</option>
                <option value="DISABLED">禁用</option>
              </select>
            </div>
            <div className="stack" style={{ marginTop: 12 }}>
              <button className="button" type="submit">保存修改</button>
            </div>
          </form>
        ) : null}

        <table className="table">
          <thead>
            <tr>
              <th>用户名</th>
              <th>显示名称</th>
              <th>部门/分类</th>
              <th>状态</th>
              <th>角色</th>
              <th>录入数</th>
              <th>推送数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {currentUsers.map((user) => (
              <tr key={user.id}>
                <td>
                  <Link href={`/users/${user.id}`}>{user.username}</Link>
                </td>
                <td>{user.displayName}</td>
                <td>{user.department || '-'}</td>
                <td>{labelOrValue(userStatusLabelMap, user.status)}</td>
                <td>{user.roleNames.join('、') || '-'}</td>
                <td>{user.recordsCount}</td>
                <td>{user.pushJobsCount}</td>
                <td>
                  <div className="stack">
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => setEditingUser({
                        id: user.id,
                        displayName: user.displayName,
                        department: user.department,
                        roleCode: user.roles[0] ?? 'USER',
                        status: user.status
                      })}
                      disabled={user.username === 'admin'}
                    >
                      编辑
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => toggleStatus(user)}
                      disabled={user.username === 'admin'}
                    >
                      {user.status === 'ACTIVE' ? '禁用' : '启用'}
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => setResetPassword({ id: user.id, password: 'NewPass123!' })}
                      disabled={user.username === 'admin'}
                    >
                      重置密码
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {resetPassword ? (
          <div className="card" style={{ padding: 16, marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>确认重置密码</h3>
            <p className="helper">将把密码重置为：{resetPassword.password}</p>
            <div className="stack">
              <button className="button" type="button" onClick={handleResetPassword}>确认重置</button>
              <button className="button secondary" type="button" onClick={() => setResetPassword(null)}>取消</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
