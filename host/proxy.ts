// Basic 認証 + モバイル UA を付けてターゲットへ中継する汎用リバースプロキシ。
// 「設定画面で入れた ID/パスワードで接続し、 スマホ版ページをタブに表示」 を実現する中核。
//
// 使い方: あるベース URL (例 https://example.invalid/private-transit/) 配下を、
// プラグインの /proxy/<rest> にマッピングして中継する。 ページ内の相対 URL は
// iframe の URL 構造をミラーしているのでそのまま解決される。
// 認証情報が空のときは 401 を握りつぶさずそのまま返す (未設定が分かるように)。

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export interface ProxyTarget {
  /** 末尾スラッシュ付きのベース URL (例 "https://example.invalid/private-transit/")。 */
  baseUrl: string;
  /** Basic 認証 ID。 */
  user: string;
  /** Basic 認証パスワード。 */
  password: string;
}

export interface ProxyResult {
  status: number;
  headers: Record<string, string>;
  body: ArrayBuffer;
}

function basicAuthHeader(user: string, password: string): string {
  return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

/**
 * target.baseUrl 配下の relativePath (クエリ含む) を中継取得する。
 * @param relativePath 例 "endpoint.php?member=1&map=1" / "js/app.js"
 */
export async function proxyFetch(target: ProxyTarget, relativePath: string): Promise<ProxyResult> {
  const base = target.baseUrl.endsWith('/') ? target.baseUrl : `${target.baseUrl}/`;
  const url = new URL(relativePath.replace(/^\/+/, ''), base).toString();

  const headers: Record<string, string> = { 'user-agent': MOBILE_UA };
  if (target.user || target.password) {
    headers.authorization = basicAuthHeader(target.user, target.password);
  }

  const res = await fetch(url, { headers, redirect: 'manual' });
  const body = await res.arrayBuffer();

  // hop-by-hop / セキュリティ系ヘッダを除去して中継 (iframe 表示を阻害しないため)。
  // X-Frame-Options / CSP は iframe 埋め込みをブロックするので意図的に落とす。
  const out: Record<string, string> = {};
  const ct = res.headers.get('content-type');
  if (ct) out['content-type'] = ct;

  return { status: res.status, headers: out, body };
}

export { MOBILE_UA };
