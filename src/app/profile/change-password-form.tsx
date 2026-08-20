'use client';

import { useState } from 'react';

export default function ChangePasswordForm() {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const oldPassword = String(formData.get('oldPassword') ?? '');
    const newPassword = String(formData.get('newPassword') ?? '');
    const confirmPassword = String(formData.get('confirmPassword') ?? '');

    if (newPassword !== confirmPassword) {
      setMessage('两次输入的新密码不一致');
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.message ?? '修改失败');
        return;
      }
      setMessage('密码已修改，下次登录请使用新密码');
      (event.target as HTMLFormElement).reset();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="grid" style={{ gap: 12 }} onSubmit={handleSubmit}>
      <input className="input" name="oldPassword" type="password" placeholder="原密码" required />
      <input className="input" name="newPassword" type="password" placeholder="新密码（至少 8 位）" required minLength={8} />
      <input className="input" name="confirmPassword" type="password" placeholder="确认新密码" required minLength={8} />
      <button className="button" type="submit" disabled={loading}>
        {loading ? '提交中...' : '确认修改'}
      </button>
      {message ? <p className="helper">{message}</p> : null}
    </form>
  );
}
