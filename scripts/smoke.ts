// 一過性スモーク: 同梱 plugins/ を loader で読み込めるか (import が通るか) だけを確認する。
// ポートも DB も開かない。 本体 in-process マウントの前段 = 「動的 import で default export が
// MemoriaPlugin 形か」 を検証する軽量チェック。 同梱プラグインが無ければ 0 件で OK。
import { join } from 'node:path';
import { loadPlugins } from '../host/loader.js';

const bundledDir = join(process.cwd(), 'plugins');
const loaded = await loadPlugins([bundledDir]);

console.log(`loaded ${loaded.length} plugin(s) from ${bundledDir}:`);
for (const { plugin, dir } of loaded) {
  console.log(`  ${plugin.icon} ${plugin.id} — ${plugin.name} (${dir})`);
}
process.exit(0);
