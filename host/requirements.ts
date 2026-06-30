// プラグインの外部依存 (要インストール物) の充足判定。
//
// 例: Wireshark (tshark) のような OS 側インストールが要るものは、 プラグインが
// requirement として宣言し detect() で利用可否を返す。 host はマウント時にこれを
// 走らせ、 未充足なら status='needs-setup' でマウントする (ルートは生やすが jobs は止める)。
// detect() の例外は握りつぶさず未充足扱いにし、 理由をログへ出す ([[feedback_no_error_swallow]])。

import type { MemoriaPlugin, PluginContext, PluginRequirement } from './types.js';

export interface UnmetRequirement {
  id: string;
  label: string;
  hint?: string;
}

export interface RequirementStatus {
  ok: boolean;
  unmet: UnmetRequirement[];
}

function msg(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

export async function detectRequirements(
  plugin: MemoriaPlugin,
  ctx: PluginContext,
): Promise<RequirementStatus> {
  const reqs: PluginRequirement[] = plugin.requirements ?? [];
  const unmet: UnmetRequirement[] = [];
  for (const r of reqs) {
    let ok = false;
    try {
      ok = await r.detect(ctx);
    } catch (e) {
      ctx.log(`requirement "${r.id}" 判定失敗 — 未充足扱い: ${msg(e)}`);
      ok = false;
    }
    if (!ok) unmet.push({ id: r.id, label: r.label, hint: r.hint });
  }
  return { ok: unmet.length === 0, unmet };
}

/** 未充足 requirement を 1 行の理由文にまとめる (manifest statusReason 用)。 */
export function summarizeUnmet(unmet: UnmetRequirement[]): string {
  return unmet
    .map((u) => (u.hint ? `${u.label} (${u.hint})` : u.label))
    .join(' / ');
}
