import { useCallback, useEffect, useState } from 'react';
import { getAdminUsers, updateAdminUser } from '../../api/admin';
import type { AdminUser } from '../../types/api';

export function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pageSize = 50;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAdminUsers(search || undefined, pageSize, page * pageSize);
      setUsers(res.users);
      setTotal(res.total);
    } catch {
      setError('Could not load users.');
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doSearch = () => {
    setPage(0);
    setSearch(query);
  };

  const toggleHost = async (user: AdminUser) => {
    setError(null);
    setNotice(null);
    try {
      const { user: updated } = await updateAdminUser(user.id, {
        role: user.role === 'event_host' ? 'user' : 'event_host',
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setNotice(
        `${updated.displayName} ${updated.role === 'event_host' ? 'can now host events' : 'can no longer host events'}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user.');
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {notice}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          doSearch();
        }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-white/20"
        />
        <button type="submit" className="btn-secondary shrink-0 !py-2 text-sm">
          Search
        </button>
      </form>

      <p className="text-xs text-slate-500">
        {total} {total === 1 ? 'user' : 'users'}
        {search ? ` matching "${search}"` : ''}
        {totalPages > 1 ? ` · page ${page + 1} of ${totalPages}` : ''}
      </p>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-slate-400">No users found.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((user) => (
            <li
              key={user.id}
              className="flex flex-col gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  {user.displayName}
                  {user.isAdmin && (
                    <span className="ml-2 rounded-full bg-chorusify-accent/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-chorusify-accent">
                      admin
                    </span>
                  )}
                  {user.role === 'event_host' && (
                    <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-200">
                      event host
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-slate-500">{user.email}</p>
                <p className="text-[11px] text-slate-600">
                  Rating {user.rating} · {user.ratedDuels} duels · joined{' '}
                  {new Date(user.createdAt).toLocaleDateString()}
                  {user.lastLoginAt && (
                    <> · last seen {new Date(user.lastLoginAt).toLocaleDateString()}</>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void toggleHost(user)}
                  disabled={user.isAdmin}
                  className={`btn-ghost !py-1 text-xs ${
                    user.role === 'event_host'
                      ? 'text-red-300 hover:text-red-200'
                      : 'text-emerald-300 hover:text-emerald-200'
                  }`}
                >
                  {user.role === 'event_host' ? 'Revoke hosting' : 'Make event host'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="btn-ghost !py-1 text-xs disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-slate-500">
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="btn-ghost !py-1 text-xs disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
