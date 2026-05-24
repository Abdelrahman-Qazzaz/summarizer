import { authLoginUrl } from "../config";
import { useAuth } from "../hooks/auth/useAuth";

function shortUserId(userId: string): string {
  if (userId.length <= 12) return userId;
  return `${userId.slice(0, 8)}…`;
}

export function SignInButton() {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return (
      <span className="authStatus" aria-live="polite">
        Checking session…
      </span>
    );
  }

  if (user) {
    return (
      <div className="authSignedIn">
        <span className="authStatus" title={user.userId}>
          Signed in · {shortUserId(user.userId)}
        </span>
        <button
          type="button"
          className="signInBtn"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <a className="signInBtn" href={authLoginUrl()}>
      Sign in
    </a>
  );
}
