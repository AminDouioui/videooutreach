import { LoginForm } from '@/components/LoginForm';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">Video-Outreach</h1>
        <p className="mb-5 text-sm text-slate-500">Bitte melden Sie sich an.</p>
        <LoginForm />
      </div>
    </main>
  );
}
