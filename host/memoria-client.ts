// Memoria 本体の「機能」を呼ぶクライアント。 現状は announce のみ。
// Memoria 側に POST /api/plugins/announce を生やしてあり、 そこから
// discord notifier の postAnnouncement (#announce) に流れる。

export interface MemoriaClient {
  /** Memoria の #announce チャンネルにテキストを投稿する。 */
  announce(text: string): Promise<void>;
}

export interface MemoriaClientConfig {
  /** Memoria 本体のベース URL (例 http://localhost:5180)。 */
  baseUrl: string;
  /** プラグイン API 用トークン (Memoria 側 plugins.api_token と一致させる)。 */
  token: string;
}

/**
 * in-process 用クライアント。 Memoria 本体に同居する場合は HTTP を介さず
 * announce 実装 (= announceToDiscord 等) を直接渡す。
 */
export function createInProcessMemoriaClient(
  announce: (text: string) => Promise<void>,
): MemoriaClient {
  return { announce };
}

export function createMemoriaClient(cfg: MemoriaClientConfig): MemoriaClient {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  return {
    async announce(text: string): Promise<void> {
      const res = await fetch(`${base}/api/plugins/announce`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-plugin-token': cfg.token,
        },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        // 失敗は握りつぶさず投げる ([[feedback_no_silent_fallback]])。
        throw new Error(`announce 失敗 ${res.status}: ${await res.text().catch(() => '')}`);
      }
    },
  };
}
