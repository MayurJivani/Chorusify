import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useSession } from '../hooks/useSession';
import { createMultiplayerRoom } from '../api/multiplayer';
import {
  getFriends,
  getPendingRequests,
  searchUsers,
  sendFriendRequestToUser,
  respondToRequest,
  removeFriend,
  getMessages,
  sendMessageToFriend,
  type FriendView,
  type PendingRequest,
  type MessageView,
  type UserSearchResult,
} from '../api/friends';
import { usePageTitle } from '../hooks/usePageTitle';

/**
 * What an invite from chat races over when nobody has said otherwise.
 *
 * A broad, always-populated category: the host can switch to any artist or category from the
 * lobby, so this only has to be a reasonable room to land in, not the right one.
 */
const INVITE_DEFAULT_CATEGORY = 'now-worldwide';

export function FriendsPage() {
  usePageTitle('Friends');

  const { user } = useSession();
  const [friends, setFriends] = useState<FriendView[]>([]);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [chatWith, setChatWith] = useState<FriendView | null>(null);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    getFriends()
      .then(setFriends)
      .catch(() => {});
    getPendingRequests()
      .then(setPending)
      .catch(() => {});
  }, [userId]);

  if (!user) {
    return (
      <div className="flex min-h-full items-center justify-center px-4">
        <p className="text-slate-400">Log in to add friends and chat.</p>
      </div>
    );
  }

  /*
   * Search by name rather than asking for an email.
   *
   * Adding someone used to require knowing their email address, which is a thing you often do
   * not have for someone you play with. Display names are not unique, so this shows the matches
   * and lets the sender recognise the right person instead of guessing on their behalf.
   */
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (query.trim().length < 2) {
      setError('Type at least two characters');
      return;
    }
    setSearching(true);
    try {
      setResults(await searchUsers(query));
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const handleAdd = async (target: UserSearchResult) => {
    setError('');
    setSuccess('');
    try {
      const result = await sendFriendRequestToUser(target.id);
      setSuccess(`Request sent to ${result.addressee}`);
      setResults((prev) =>
        prev.map((r) => (r.id === target.id ? { ...r, relationship: 'pending' } : r)),
      );
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  };

  const handleRespond = async (friendshipId: number, accept: boolean) => {
    await respondToRequest(friendshipId, accept);
    setPending((p) => p.filter((r) => r.friendshipId !== friendshipId));
    if (accept) getFriends().then(setFriends);
  };

  const handleRemove = async (friendshipId: number) => {
    await removeFriend(friendshipId);
    setFriends((f) => f.filter((fr) => fr.friendshipId !== friendshipId));
  };

  if (chatWith) {
    return (
      <ChatView
        friend={chatWith}
        userId={user.id}
        onBack={() => {
          setChatWith(null);
          getFriends().then(setFriends);
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col gap-6 px-4 py-6">
      <motion.h1
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl font-extrabold gradient-text"
      >
        Friends
      </motion.h1>

      {/* Find someone by username */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          placeholder="Search by username"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={40}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-chorusify-accent/50"
        />
        <button
          type="submit"
          disabled={searching}
          className="shrink-0 rounded-xl bg-chorusify-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-chorusify-accent/80 disabled:opacity-50"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((person) => (
            <li
              key={person.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{person.displayName}</p>
                {/* Rating disambiguates two people with the same display name. */}
                <p className="truncate text-xs text-slate-500">
                  {person.ratedDuels > 0 ? `${person.rating} rating` : 'No rated duels yet'}
                </p>
              </div>
              {person.relationship === 'accepted' ? (
                <span className="shrink-0 text-xs text-slate-500">Already friends</span>
              ) : person.relationship === 'pending' ? (
                <span className="shrink-0 text-xs text-slate-500">Request pending</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleAdd(person)}
                  className="btn-secondary shrink-0 !py-1.5 !text-xs"
                >
                  Add
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {results.length === 0 && query.trim().length >= 2 && !searching && !error && (
        <p className="text-sm text-slate-500">No players found with that name.</p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-green-400">{success}</p>}

      {/* Pending requests */}
      {pending.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Pending requests
          </h2>
          {pending.map((r) => (
            <div
              key={r.friendshipId}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3"
            >
              <span className="text-sm font-medium text-white">{r.displayName}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => handleRespond(r.friendshipId, true)}
                  className="rounded-lg bg-green-600/80 px-3 py-1 text-xs font-semibold text-white"
                >
                  Accept
                </button>
                <button
                  onClick={() => handleRespond(r.friendshipId, false)}
                  className="rounded-lg bg-red-600/60 px-3 py-1 text-xs font-semibold text-white"
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Friends list */}
      {friends.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Your friends
          </h2>
          {friends.map((f) => (
            <div
              key={f.friendshipId}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-white">{f.displayName}</span>
                <span className="text-[11px] text-slate-500">{f.rating} rating</span>
              </div>
              <div className="flex items-center gap-2">
                {f.unreadCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-chorusify-accent px-1.5 text-[10px] font-bold text-white">
                    {f.unreadCount}
                  </span>
                )}
                <button
                  onClick={() => setChatWith(f)}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/5"
                >
                  Chat
                </button>
                <button
                  onClick={() => handleRemove(f.friendshipId)}
                  className="rounded-lg px-2 py-1.5 text-xs text-slate-500 transition-colors hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : (
        <p className="text-center text-sm text-slate-500">
          No friends yet. Add someone by their email above.
        </p>
      )}
    </div>
  );
}

function ChatView({
  friend,
  userId,
  onBack,
}: {
  friend: FriendView;
  userId: string;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getMessages(friend.userId).then(setMessages);
    const interval = setInterval(() => {
      getMessages(friend.userId).then(setMessages);
    }, 5000);
    return () => clearInterval(interval);
  }, [friend.userId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const msg = await sendMessageToFriend(friend.userId, text.trim());
      setMessages((prev) => [...prev, { ...msg, senderName: 'You', read: true }]);
      setText('');
    } finally {
      setSending(false);
    }
  };

  /*
   * Creates the room, then sends its code.
   *
   * This used to send `{ type, id: 0 }` — a placeholder that pointed at nothing, so the message
   * arrived saying "Join my game!" with no game behind it. The room has to exist before the
   * invite is worth sending.
   *
   * The source is a default rather than a prompt: the host can switch artist or category from
   * the lobby, so asking first only puts a decision between "invite Sam" and Sam being invited.
   */
  const handleInvite = async () => {
    setSending(true);
    setInviteError('');
    try {
      const { code } = await createMultiplayerRoom(
        { categoryId: INVITE_DEFAULT_CATEGORY },
        'search',
        'speed',
        false,
        true,
      );
      const msg = await sendMessageToFriend(friend.userId, `Come play - room ${code}`, {
        type: 'multiplayer',
        id: code,
      });
      setMessages((prev) => [...prev, { ...msg, senderName: 'You', read: true }]);
      navigate(`/room/${code}`, { state: { autoJoin: true, hostName: '' } });
    } catch (err: unknown) {
      setInviteError((err as Error).message || 'Could not create the room.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/5"
        >
          Back
        </button>
        <h2 className="text-lg font-bold text-white">{friend.displayName}</h2>
      </div>

      {/*
        No "invite to duel" any more: duels are live matchmaking now, so there is no duel to
        link someone to - you queue and are paired. Inviting to a room is the thing that still
        makes sense between two people who already know each other.
      */}
      <div className="mb-4 flex flex-col gap-1.5">
        <button
          onClick={() => void handleInvite()}
          disabled={sending}
          className="self-start rounded-lg border border-chorusify-accent/30 px-3 py-1.5 text-xs font-medium text-chorusify-accent transition-colors hover:bg-chorusify-accent/10 disabled:opacity-50"
        >
          {sending ? 'Creating room…' : '🎮 Invite to a game'}
        </button>
        {inviteError && <p className="text-xs text-chorusify-danger">{inviteError}</p>}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <div className="flex flex-col gap-2">
          {messages.length === 0 && (
            <p className="text-center text-sm text-slate-500">No messages yet. Say hi!</p>
          )}
          {messages.map((msg) => {
            const isMine = msg.senderId === userId;
            return (
              <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                    isMine ? 'bg-chorusify-accent/20 text-white' : 'bg-white/5 text-slate-200'
                  }`}
                >
                  {msg.invite && (
                    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-chorusify-accent">
                      Game invite
                    </span>
                  )}
                  <p>{msg.body}</p>
                  {/* An invite you cannot act on is just a sentence. */}
                  {msg.invite?.type === 'multiplayer' && msg.invite.id ? (
                    <Link
                      to={`/room/${msg.invite.id}`}
                      className="mt-1.5 inline-block rounded-lg border border-chorusify-accent2/40 bg-chorusify-accent2/10 px-2.5 py-1 text-[11px] font-semibold text-chorusify-accent2 transition-colors hover:bg-chorusify-accent2/20"
                    >
                      Join room {String(msg.invite.id)} →
                    </Link>
                  ) : null}
                  <span className="mt-1 block text-[10px] text-slate-500">
                    {new Date(msg.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="mt-3 flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-chorusify-accent/50"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="shrink-0 rounded-xl bg-chorusify-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-chorusify-accent/80 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
