/**
 * 共通レート制限ユーティリティ (#34)
 *
 * デフォルトは in-memory store だが、Store インターフェースを差し替えることで
 * 将来 Redis 等の外部ストアに移行できる。
 *
 * 【既知の制約】
 * Vercel の serverless 関数はリクエストごとにインスタンスが分断され得るため、
 * in-memory store はプロセス間で状態を共有しない。本番で確実なグローバル
 * レート制限が必要な場合は RateLimitStore を Redis 実装に差し替えること。
 * (billing-routes.ts / support-routes.ts の既存 in-memory Map も同じ制約を持つ)
 */

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  /**
   * key のカウンターをインクリメントし、現在のウィンドウの状態を返す。
   * ウィンドウが切れていれば count=1 の新しいウィンドウを開始する。
   */
  increment(key: string, windowMs: number): RateLimitEntry;
}

/**
 * in-memory な RateLimitStore を生成する。
 * プロセス内でのみ状態を共有する (テスト間汚染を防ぐため呼び出しごとに新規 Map を持つ)。
 */
export function createInMemoryRateLimitStore(): RateLimitStore {
  const map = new Map<string, RateLimitEntry>();
  return {
    increment(key: string, windowMs: number): RateLimitEntry {
      const now = Date.now();
      const existing = map.get(key);
      if (!existing || now > existing.resetAt) {
        const fresh: RateLimitEntry = { count: 1, resetAt: now + windowMs };
        map.set(key, fresh);
        return fresh;
      }
      existing.count += 1;
      return existing;
    },
  };
}

export interface RateLimiter {
  /**
   * key のリクエストを許可するかどうかを判定する (呼び出しごとに 1 回分消費する)。
   * @returns true = 許可 / false = 上限超過
   */
  check(key: string): boolean;
}

/**
 * RateLimitStore + 上限値からレート制限器を作る。
 *
 * @param store    カウンターの保持先 (in-memory / Redis 等)
 * @param limit    ウィンドウ内の最大リクエスト数
 * @param windowMs ウィンドウ長 (ミリ秒)
 */
export function createRateLimiter(
  store: RateLimitStore,
  limit: number,
  windowMs: number,
): RateLimiter {
  return {
    check(key: string): boolean {
      const entry = store.increment(key, windowMs);
      return entry.count <= limit;
    },
  };
}
