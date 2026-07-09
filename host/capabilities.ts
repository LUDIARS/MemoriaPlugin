// プラグインが参照できる Memoria 本体の「機能」 (host capabilities)。
//
// 提供する機能:
//  - announce  … Discord #announce へ通知。
//  - latestGps … 最新 GPS 位置を参照 (本体 gps_locations より)。
//  - diary     … 日記出力: その日の記事生成にデータを寄稿する。
//  - trend     … 傾向出力: グラフ化用に系列値を集積する。
//  - llm       … 汎用 LLM 呼び出し (本体 server/llm.ts の 'plugin_llm' タスク経由)。
//
// capability は「プラグイン単位」 で発行する (diary/trend/llm が pluginId を自動付与する)。
// 本体 in-process マウント時に host (Memoria 本体) が db 直叩きの実装を注入する。

export interface GpsFix {
  lat: number;
  lon: number;
  /** 記録時刻 (UTC ISO)。 不明なら null。 */
  recordedAt: string | null;
}

export interface DiaryContribution {
  /** 対象日 YYYY-MM-DD (ローカル)。 省略時はホストが当日を補う。 */
  date?: string;
  /** 記事に織り込む短い要約文。 */
  summary: string;
  /** 任意の構造化データ (記事生成プロンプトに添える)。 */
  data?: unknown;
}

export interface TrendPoint {
  /** 系列名 (例 "bus_distance_m")。 同一系列でグラフ化される。 */
  series: string;
  value: number;
  /** 単位 (例 "m", "%")。 表示用。 */
  unit?: string;
  /** 記録時刻 ISO。 省略時はホストが now。 */
  at?: string;
}

/** プラグインに渡る host 機能アクセサ (1 プラグイン分)。 */
export interface HostCapabilities {
  /** Memoria の #announce チャンネルにテキストを投稿する。 */
  announce(text: string): Promise<void>;
  /** 最新 GPS 位置。 無ければ null。 */
  latestGps(): GpsFix | null;
  /** 日記出力: その日の記事生成にデータを寄稿する。 */
  diary(contribution: DiaryContribution): void;
  /** 傾向出力: グラフ化用に系列値を集積する。 */
  trend(point: TrendPoint): void;
  /** 汎用 LLM 呼び出し。 本体設定の 'plugin_llm' タスク (既定 provider/model) で実行する。 */
  llm(prompt: string): Promise<string>;
}

/**
 * in-process マウント時の機能実装。 host (Memoria 本体) が db を握って実装を注入する。
 * diary/trend/llm は pluginId 付きで本体ストアに書く / 本体 runLlm を呼ぶ実装が渡される。
 */
export interface CapabilityProviders {
  announce: (text: string) => Promise<void>;
  latestGps: () => GpsFix | null;
  recordDiary: (pluginId: string, contribution: DiaryContribution) => void;
  recordTrend: (pluginId: string, point: TrendPoint) => void;
  askLlm: (pluginId: string, prompt: string) => Promise<string>;
}

/** あるプラグイン用の HostCapabilities を providers から組む。 */
export function createCapabilities(pluginId: string, p: CapabilityProviders): HostCapabilities {
  return {
    announce: (text) => p.announce(text),
    latestGps: () => p.latestGps(),
    diary: (contribution) => p.recordDiary(pluginId, contribution),
    trend: (point) => p.recordTrend(pluginId, point),
    llm: (prompt) => p.askLlm(pluginId, prompt),
  };
}
