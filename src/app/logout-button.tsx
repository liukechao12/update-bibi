'use client';

export default function LogoutButton() {
  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <button className="button secondary" onClick={handleLogout}>
      退出登录
    </button>
  );
}
