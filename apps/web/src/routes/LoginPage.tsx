import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { LoginForm } from '../features/auth/LoginForm';
import { usePageTitle } from '../hooks/usePageTitle';

export function LoginPage() {
  usePageTitle('Log In');

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass w-full max-w-sm rounded-2xl p-8 flex flex-col gap-6"
      >
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-chorusify-gradient text-xl shadow-lg shadow-chorusify-accent/30">
            🎵
          </span>
          <h1 className="text-2xl font-extrabold text-white">Welcome back</h1>
          <p className="text-sm text-slate-400">Log in to keep your streak alive</p>
        </div>

        <LoginForm />

        <div className="flex flex-col items-center gap-2">
          <Link to="/forgot-password" className="text-xs text-slate-500 hover:text-slate-300">
            Forgot password?
          </Link>
          <p className="text-sm text-slate-400">
            No account?{' '}
            <Link to="/register" className="font-medium text-chorusify-accent2 hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
