import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { RegisterForm } from '../features/auth/RegisterForm';
import { usePageTitle } from '../hooks/usePageTitle';

export function RegisterPage() {
  usePageTitle('Create Account');

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
          <h1 className="text-2xl font-extrabold text-white">Create an account</h1>
          <p className="text-sm text-slate-400">Your streak and stats carry over automatically</p>
        </div>

        <RegisterForm />

        <p className="text-center text-xs text-slate-500">
          By creating an account, you agree to our{' '}
          <Link to="/terms" className="font-medium text-chorusify-accent2 hover:underline">
            Terms
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className="font-medium text-chorusify-accent2 hover:underline">
            Privacy Policy
          </Link>
          .
        </p>

        <p className="text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-chorusify-accent2 hover:underline">
            Log in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
