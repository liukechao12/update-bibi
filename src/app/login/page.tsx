'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [message, setMessage] = useState('');

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const username = String(formData.get('username') ?? '');
    const password = String(formData.get('password') ?? '');

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.message ?? '登录失败');
      return;
    }

    setMessage('登录成功，正在跳转...');
    window.location.href = '/';
  }

  return (
    <main className="container" style={{ maxWidth: 560 }}>
      <div className="card" style={{ padding: 28 }}>
        <span className="badge">登录</span>
        <h1 style={{ marginTop: 16 }}>进入数据同步推送平台</h1>
        <p className="helper">请输入真实账号密码登录。</p>

        <form className="grid" style={{ marginTop: 24 }} onSubmit={handleSubmit}>
          <input className="input" placeholder="用户名" name="username" />
          <input className="input" placeholder="密码" type="password" name="password" />
          <button className="button" type="submit">登录</button>
        </form>

        {message ? <p className="helper" style={{ marginTop: 16 }}>{message}</p> : null}
      </div>
    </main>
  );
}
