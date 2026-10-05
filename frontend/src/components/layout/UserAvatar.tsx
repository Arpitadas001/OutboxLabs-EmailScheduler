import { useAuth, logout } from '../../hooks/useAuth';

/**
 * UserAvatar — displays the logged-in user's avatar, name and email in the
 * top navigation bar, plus a Logout button.
 *
 * The avatar falls back to the first letter of the user's name if Google hasn't
 * provided a picture URL.
 */
export default function UserAvatar() {
  const { user, isLoading } = useAuth();

  if (isLoading || !user) {
    return (
      <div className="w-9 h-9 rounded-full bg-gray-700 animate-pulse" />
    );
  }

  return (
    <div className="flex items-center gap-3">
      {/* Avatar */}
      <div className="relative group">
        {user.picture ? (
          <img
            src={user.picture}
            alt={user.name}
            className="w-9 h-9 rounded-full ring-2 ring-indigo-500/30 object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center ring-2 ring-indigo-500/30">
            <span className="text-white text-sm font-semibold">
              {user.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Name + email */}
      <div className="hidden md:flex flex-col leading-tight">
        <span className="text-sm font-semibold text-gray-100">{user.name}</span>
        <span className="text-xs text-gray-400">{user.email}</span>
      </div>

      {/* Logout */}
      <button
        id="btn-logout"
        onClick={logout}
        className="ml-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-800 hover:bg-red-600/20 text-gray-400 hover:text-red-400 border border-gray-700 hover:border-red-500/50 transition-all duration-200"
      >
        Logout
      </button>
    </div>
  );
}
