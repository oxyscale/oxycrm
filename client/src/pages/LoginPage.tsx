import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import * as api from '../services/api';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setUser } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [forgotMode, setForgotMode] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const { user } = await api.login(email, password);
      setUser(user);
      const next = searchParams.get('next') || '/';
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    setError(null);
    setForgotMessage(null);
    try {
      const { message } = await api.forgotPassword(email);
      setForgotMessage(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-6">
      <div className="w-full max-w-[420px]">
        {/* Tray bezel — matches the email card pattern */}
        <div className="bg-tray rounded-2xl p-1.5">
          <div className="bg-paper rounded-[14px] border border-hair-soft px-10 py-12 shadow-[0_30px_80px_-40px_rgba(11,13,14,0.18)]">
            {/* Wordmark */}
            <Link to="/login" className="block mb-8">
              <span className="font-sans font-semibold text-2xl tracking-[-0.035em] leading-none">
                <span className="text-ink">Oxy</span><span className="text-sky-ink">Scale</span>
              </span>
            </Link>

            <span className="text-sky-ink text-[10.5px] uppercase tracking-[0.24em] font-bold block mb-3">
              {forgotMode ? 'Reset password' : 'Sign in'}
            </span>
            <h1 className="text-ink text-[26px] font-medium tracking-tight leading-tight mb-2">
              {forgotMode ? 'Forgot your password?' : 'Welcome back.'}
            </h1>
            <p className="text-ink-muted text-sm leading-relaxed mb-8">
              {forgotMode
                ? 'Enter your email and we will send you a link to choose a new one.'
                : 'Sign in to the OxyScale dashboard.'}
            </p>

            <form onSubmit={forgotMode ? handleForgot : handleLogin} className="space-y-4">
              <div>
                <label className="text-ink-dim text-xs font-medium block mb-1.5">Email</label>
                <input
                  autoFocus
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@oxyscale.ai"
                  className="w-full bg-paper border border-hair rounded-lg px-4 py-2.5 text-ink text-sm placeholder-ink-faint focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all"
                  autoComplete="email"
                />
              </div>

              {!forgotMode && (
                <div>
                  <label className="text-ink-dim text-xs font-medium block mb-1.5">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-paper border border-hair rounded-lg px-4 py-2.5 text-ink text-sm placeholder-ink-faint focus:outline-none focus:border-[rgba(10,156,212,0.4)] transition-all"
                    autoComplete="current-password"
                  />
                </div>
              )}

              {error && (
                <div className="bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.22)] rounded-lg px-3 py-2 text-risk text-xs">
                  {error}
                </div>
              )}

              {forgotMessage && (
                <div className="bg-[rgba(94,197,230,0.08)] border border-sky-hair rounded-lg px-3 py-2 text-sky-ink text-xs">
                  {forgotMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !email || (!forgotMode && !password)}
                className="w-full bg-ink text-white font-medium text-sm rounded-full px-5 py-3 hover:bg-[#1a1d1f] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {forgotMode ? 'Send reset link' : 'Sign in'}
              </button>
            </form>

            <div className="mt-6 text-center">
              <button
                onClick={() => {
                  setForgotMode((m) => !m);
                  setError(null);
                  setForgotMessage(null);
                }}
                className="text-ink-dim hover:text-ink-muted text-xs transition-colors"
              >
                {forgotMode ? 'Back to sign in' : 'Forgot password?'}
              </button>
            </div>
          </div>
        </div>

        <p className="text-ink-faint text-[11px] text-center mt-6">
          OxyScale internal dashboard. Authorised users only.
        </p>
      </div>
    </div>
  );
}
