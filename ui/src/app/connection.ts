/**
 * The session token: the proxy prints the app's address with it in the URL
 * fragment (`#token=…`), which browsers never send to a server. The app
 * takes it from there, removes it from the address bar, and keeps it for this
 * tab only (sessionStorage), so a reload still works and closing the tab
 * forgets it.
 */

const KEY = "feedbacker-session";

export function takeToken(location: Location, history: History, storage: Storage | null): string | null {
  const fromFragment = new URLSearchParams(location.hash.slice(1)).get("token");
  if (fromFragment) {
    try {
      storage?.setItem(KEY, fromFragment);
    } catch {
      // Storage can be unavailable (e.g. a private window): the token then lasts until reload.
    }
    history.replaceState(null, "", location.pathname + location.search);
    return fromFragment;
  }
  try {
    return storage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}
