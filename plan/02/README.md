# 02 模组字段目录

## 定位

回答一个问题：**模组到底声明了哪些字段、每个字段什么类型/形态/取值范围、声明本身合不合法。** 这是纯数据层，不改 UI、不定义编辑器文档。

## 交付物

02 交付一份可直接查询的字段目录：六段字段表、每个字段的完整声明元数据、声明自检和 `schema.get` 对账。字段目录是编辑器文档模型的唯一字段来源。

## 权威口径

- 权威载体是**主模组源码**：`common/src/main/java/com/immersivecinematics/immersive_cinematics/script/` 下的 `schema/`、`track/`、`rule/`、`path/`、`spi/`。
- **禁止**用 `scripts/export-schema.mjs` 组装 MC classpath 去导出快照；禁止为了导出而引入 `Vec3` / Mojang `Codec`。
- `schema.get` 是运行时对账数据，不是目录的生成源；离线快照只做缓存。
- wire 值一律小写（`value` / `animated` / `event`、`float` / `int` / `nullable_float`、`linear` / `angle` / `geometric` / `step`）；`ParamKind` / `CurveCapability` 用 Java 枚举原样大写名；`enumValues` 按源码原值。

## 完成标准

- 六段每个字段都有 `sourceRef`（类名 + 方法/行号），抽查 20 条与源码一致。
- 目录里没有 `Vec3`、没有 `export-schema.mjs`、没有从快照反推的字段。
- 编辑器代码里查字段只走目录；字段表只存在这一份。
- 离线快照带来源（游戏版本 / 模组版本 / 时间 / `catalogHash`），只读，不自动覆盖在线目录；多实例快照由 `snapshots.ts` 写入 `fixtures/__snapshots__/`，同名不覆盖。
