/**
 * 屏幕层键域：15 个 `ScreenLayer` 常量、所属空间与 `HudLayerRegistry` 的动态键规则。
 *
 * 规范层名的唯一来源是 `script/ScreenLayer.java:15-29` 的枚举声明（顺序即声明顺序），
 * 空间取自同一枚举的第二参数 `Space`（`ScreenLayer.java:32`：`HUD` / `WORLD` / `VIEW` / `POST`）。
 *
 * 动态键有两个来源，按原始字符串参与判定、不是枚举别名：
 * - `api/HudLayerRegistry.java:65` 的 `register(overlayId, category)` 注册的分类名（`:80` 的单参数重载
 *   把分类名定为 overlay 资源 ID 本身）；
 * - 未注册 overlay 的完整资源 ID（`modid:path`）。
 *
 * 值类型固定为 bool：`true` 显示 / `false` 隐藏；未声明的键一律隐藏（画面层接管是唯一模式）。
 */
export const SCREEN_LAYERS: readonly string[] = [
  'hud.hotbar',
  'hud.crosshair',
  'hud.health',
  'hud.experience',
  'hud.bossbar',
  'hud.chat',
  'hud.scoreboard',
  'hud.action_bar',
  'hud.title',
  'hud.subtitle',
  'hud.skip_prompt',
  'viewmodel',
  'view_bobbing',
  'screen_effects',
  'player_model',
]

export const SCREEN_LAYER_SPACE: Record<string, 'HUD' | 'WORLD' | 'VIEW' | 'POST'> = {
  'hud.hotbar': 'HUD',
  'hud.crosshair': 'HUD',
  'hud.health': 'HUD',
  'hud.experience': 'HUD',
  'hud.bossbar': 'HUD',
  'hud.chat': 'HUD',
  'hud.scoreboard': 'HUD',
  'hud.action_bar': 'HUD',
  'hud.title': 'HUD',
  'hud.subtitle': 'HUD',
  'hud.skip_prompt': 'HUD',
  viewmodel: 'WORLD',
  view_bobbing: 'VIEW',
  screen_effects: 'POST',
  player_model: 'WORLD',
}

export const SCREEN_LAYER_DYNAMIC = true

export const SCREEN_LAYER_VALUE_TYPE = 'bool'
