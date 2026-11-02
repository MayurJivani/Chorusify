import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { forgotPassword, resetPassword } from '../api/auth';
import { usePageTitle } from '../hooks/usePageTitle';

export function ForgotPasswordPage() {
  usePageTitle('Reset Password');

  const [params] = useSearchParams();
  const tokenFromUrl = params.get('token');

  if (tokenFromUrl) {
    return <ResetForm token={tokenFromUrl} />;
  }

  return <RequestForm />;
}

function RequestForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center gap-6 px-4 py-8">
      <motion.h1
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl font-extrabold gradient-text"
      >
        Reset password
      </motion.h1>

      {sent ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-slate-300">
            If an account exists with that email, you'll receive a reset link.
          </p>
          <Link to="/login" className="text-sm text-chorusify-accent hover:underline">
            Back to login
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
          <input
            type="email"
            placeholder="Your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-chorusify-accent/50"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-chorusify-accent py-3 text-sm font-semibold text-white transition-colors hover:bg-chorusify-accent/80 disabled:opacity-50"
          >
            {loading ? 'Sending...' : 'Send reset link'}
          </button>
          <Link to="/login" className="text-center text-xs text-slate-500 hover:text-slate-300">
            Back to login
          </Link>
        </form>
      )}
    </div>
  );
}

function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center gap-4 px-4 py-8">
        <p className="text-sm text-green-400">Password reset. You can now log in.</p>
        <Link
          to="/login"
          className="rounded-xl bg-chorusify-accent px-6 py-2.5 text-sm font-semibold text-white"
        >
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center gap-6 px-4 py-8">
      <motion.h1
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl font-extrabold gradient-text"
      >
        New password
      </motion.h1>

      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
        <input
          type="password"
          placeholder="New password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-chorusify-accent/50"
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-chorusify-accent/50"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-chorusify-accent py-3 text-sm font-semibold text-white transition-colors hover:bg-chorusify-accent/80 disabled:opacity-50"
        >
          {loading ? 'Resetting...' : 'Reset password'}
        </button>
      </form>
    </div>
  );
}
