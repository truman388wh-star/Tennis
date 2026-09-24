// Privacy network guard.
//
// The app only ever needs its own static files (HTML, JS, CSS, MediaPipe WASM,
// pose model). This guard blocks every programmatic request to any other
// origin before it leaves the browser: fetch, XMLHttpRequest, sendBeacon and
// WebSocket. It exists because @mediapipe/tasks-vision ships a usage logger
// that POSTs task/platform/latency statistics to
// https://odml.pa.googleapis.com/v1/log every 60 s; with the guard that
// request is rejected locally and MediaPipe's logger disables itself.
//
// The production build additionally sets a Content-Security-Policy with
// connect-src 'self' (see vite.config.ts), which the browser enforces even
// for code that bypasses these wrappers.

export interface BlockedRequest {
  api: 'fetch' | 'xhr' | 'beacon' | 'websocket';
  url: string;
  t: number;
}

/** True for URLs the app may load: same origin, or local blob:/data: URLs. */
export function isAllowedUrl(url: string | URL, origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(String(url), origin);
  } catch {
    return false;
  }
  if (parsed.protocol === 'blob:' || parsed.protocol === 'data:') return true;
  return parsed.origin === origin;
}

export interface NetworkGuard {
  readonly blocked: readonly BlockedRequest[];
}

export function installNetworkGuard(win: Window & typeof globalThis = window): NetworkGuard {
  const existing = (win as unknown as { __privacyGuard?: NetworkGuard }).__privacyGuard;
  if (existing) return existing;

  const origin = win.location.origin;
  const blocked: BlockedRequest[] = [];
  const record = (api: BlockedRequest['api'], url: string) => {
    blocked.push({ api, url, t: Date.now() });
    if (blocked.length > 50) blocked.shift();
    console.info(`[privacy] blocked ${api} request to ${new URL(url, origin).origin}`);
  };

  const originalFetch = win.fetch.bind(win);
  win.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!isAllowedUrl(url, origin)) {
      record('fetch', url);
      return Promise.reject(new TypeError('Blocked by privacy guard: external request'));
    }
    return originalFetch(input, init);
  };

  const originalOpen = win.XMLHttpRequest.prototype.open;
  win.XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    if (!isAllowedUrl(url, origin)) {
      record('xhr', String(url));
      throw new TypeError('Blocked by privacy guard: external request');
    }
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof originalOpen;

  if (typeof win.navigator.sendBeacon === 'function') {
    const originalBeacon = win.navigator.sendBeacon.bind(win.navigator);
    win.navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      if (!isAllowedUrl(url, origin)) {
        record('beacon', String(url));
        return false;
      }
      return originalBeacon(url, data);
    };
  }

  const OriginalWebSocket = win.WebSocket;
  if (OriginalWebSocket) {
    const Guarded = function (url: string | URL, protocols?: string | string[]) {
      record('websocket', String(url));
      throw new TypeError('Blocked by privacy guard: WebSockets are not used by this app');
      return new OriginalWebSocket(url, protocols);
    } as unknown as typeof WebSocket;
    Guarded.prototype = OriginalWebSocket.prototype;
    win.WebSocket = Guarded;
  }

  const guard: NetworkGuard = { blocked };
  (win as unknown as { __privacyGuard: NetworkGuard }).__privacyGuard = guard;
  return guard;
}
