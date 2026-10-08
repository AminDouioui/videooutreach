'use client';

export function LogoutButton() {
  async function abmelden() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }
  return (
    <button onClick={abmelden} className="text-slate-600 hover:text-slate-900">
      Abmelden
    </button>
  );
}
