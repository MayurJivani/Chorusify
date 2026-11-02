import { useEffect, useState } from 'react';
import { VinylSpinner } from '../features/easter-eggs/VinylSpinner';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useSession } from '../hooks/useSession';
import { getProfile, updateDisplayName, changePassword, type ProfileData } from '../api/profile';
import { usePageTitle } from '../hooks/usePageTitle';

export function ProfilePage() {
  usePageTitle('Profile');

  const { user, loading, refreshUser } = useSession();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileData | null>(null);

  const userId = user?.id;
  useEffect(() => {
    if (!loading && !userId) {
      navigate('/login');
      return;
    }
    if (userId)
      getProfile()
        .then(setProfile)
        .catch(() => {});
  }, [userId, loading, navigate]);

  if (loading || !user || !profile) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <VinylSpinner text="Loading profile…" />
      </div>
    );
  }

  const memberSince = new Date(profile.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col gap-6 px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-3"
      >
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-chorusify-accent/25 text-2xl font-bold text-white">
          {profile.displayName.charAt(0).toUpperCase()}
        </span>
        <h1 className="text-2xl font-extrabold gradient-text">{profile.displayName}</h1>
        <p className="text-xs text-slate-500">{profile.email}</p>
      </motion.div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Rating" value={String(profile.rating)} />
        <StatCard label="Duels" value={String(profile.ratedDuels)} />
        <StatCard label="Member since" value={memberSince} small />
      </div>

      <DisplayNameForm
        currentName={profile.displayName}
        onUpdated={(name) => {
          setProfile({ ...profile, displayName: name });
          void refreshUser();
        }}
      />

      <ChangePasswordForm />
    </div>
  );
}

function StatCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <span className={`font-bold text-white ${small ? 'text-xs' : 'text-lg'}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
    </div>
  );
}

function DisplayNameForm({
  currentName,
  onUpdated,
}: {
  currentName: string;
  onUpdated: (name: string) => void;
}) {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === currentName) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await updateDisplayName(name.trim());
      onUpdated(res.displayName);
      setMsg('Display name updated');
    } catch (err: unknown) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="glass rounded-2xl p-5 flex flex-col gap-3">
      <h2 className="text-sm font-bold text-white">Display Name</h2>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-chorusify-accent/50"
        />
        <button
          type="submit"
          disabled={saving || !name.trim() || name.trim() === currentName}
          className="shrink-0 rounded-xl bg-chorusify-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-chorusify-accent/80 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </form>
      {msg && <p className="text-xs text-slate-400">{msg}</p>}
    </section>
  );
}

function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [isError, setIsError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    setIsError(false);

    if (newPwd !== confirm) {
      setMsg('Passwords do not match');
      setIsError(true);
      return;
    }

    setSaving(true);
    try {
      await changePassword(current, newPwd);
      setMsg('Password changed successfully');
      setCurrent('');
      setNewPwd('');
      setConfirm('');
    } catch (err: unknown) {
      setMsg((err as Error).message);
      setIsError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="glass rounded-2xl p-5 flex flex-col gap-3">
      <h2 className="text-sm font-bold text-white">Change Password</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="password"
          placeholder="Current password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-chorusify-accent/50"
        />
        <input
          type="password"
          placeholder="New password (min 8 chars)"
          value={newPwd}
          onChange={(e) => setNewPwd(e.target.value)}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-chorusify-accent/50"
        />
        <input
          type="password"
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-chorusify-accent/50"
        />
        <button
          type="submit"
          disabled={saving || !current || !newPwd || !confirm}
          className="rounded-xl bg-chorusify-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-chorusify-accent/80 disabled:opacity-50"
        >
          {saving ? 'Changing...' : 'Change Password'}
        </button>
      </form>
      {msg && <p className={`text-xs ${isError ? 'text-red-400' : 'text-green-400'}`}>{msg}</p>}
    </section>
  );
}
