import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import * as api from '../services/api';
import { useAuth } from '../hooks/useAuth';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setUser } = useAuth();
  const token = searchParams.get('token') || '';

  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 10) {
      setError('Password must be at least 10 characters');
      return;
    }
    if (pw !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { user } = await api.resetPassword(token, pw);
      setUser(user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-ink text-2xl font-medium tracking-tight mb-3">Reset link missing</h1>
          <p className="text-ink-muted text-sm mb-6">This page needs a reset token. Request a new link from the sign in page.</p>
          <Link to="/login" className="text-sky-ink hover:underline text-sm">Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-6">
      <div className="w-full max-w-[420px]">
        <div className="bg-tray rounded-2xl p-1.5">
          <div className="bg-paper rounded-[14px] border border-hair-soft px-10 py-12 shadow-[0_30px_80px_-40px_rgba(11,13,14,0.18)]">
            <Link to="/login" className="block mb-8">
              <span className="font-sans font-semibold text-2xl tracking-[-0.035em] leading-none">
                <span className="text-ink">Oxy</span><span className="text-sky-ink">Scale</span>
              </span>
            </Link>

            <span className="text-sky-ink text-[10.5px] uppercase tracking-[0.24em] font-bold block mb-3">
              Choose a new password
            </span>
            <h1 className="text-ink text-[26px] font-medium tracking-tight leading-tight mb-2">
              Set a new password.
            </h1>
            <p className="text-ink-muted text-sm leading-relaxed mb-8">
              At least 10 characters. Mix of letters, numbers and symbols recommended.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-ink-dim text-xs font-medium block mb-1.5">New password</label>
                <input
                  autoFocus
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  className="w-full bg-paper border border-hair rounded-lg px-4 py-2.5 text-ink text-sm placeholder-ink-faint focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all"
                  autoComplete="new-password"
                />
              </div>

              <div>
                <label className="text-ink-dim text-xs font-medium block mb-1.5">Confirm new password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full bg-paper border border-hair rounded-lg px-4 py-2.5 text-ink text-sm placeholder-ink-faint focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all"
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <div className="bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.22)] rounded-lg px-3 py-2 text-risk text-xs">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !pw || !confirm}
                className="w-full bg-ink text-white font-medium text-sm rounded-full px-5 py-3 hover:bg-[#1a1d1f] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Save new password
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
