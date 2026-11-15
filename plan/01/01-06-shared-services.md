# 01-06 共享服务正确性

## 目标

把 5 个共享服务抽到 `editor.shared` 后，把服务本身的几处正确性问题一并收掉：资源扩展名、脚本路径校验、新建冲突、截断提示、scriptRoot 诊断、stage 空值。

## 改动

1. 资源扩展名与运行时媒体能力对账：图片补 `jpg/jpeg/webp`、音频补 `mp3/flac`，新增 `kind=video`（`mp4/mkv/mov/webm`），扩展名以 `media/video/VideoFiles`、`media/audio/*`、`overlay/ImageLayer` 实际支持为准。
2. `script.save` 要求 `.json`，否则 `error`。
3. `script.new` 返回唯一临时名（`untitled-<n>.json`）或前端保存前查重。
4. `resource.list` 返回 `truncated:boolean` 与 `total`，前端显示「还有更多」。
5. `hello_ack` 增加 `scriptRoot`（绝对路径仅诊断，不参与请求）。
6. `registry.stage` 保持空，前端显示「无候选」而非「加载中」。

## 验收标准

- `resource.list{kind:"video"}` 返回 MP4/MKV；`kind:"image"` 返回 png/gif/jpg/webp。
- `script.save{path:"a.txt"}` → `error`。
- `script.new` 多次新建得到不同路径。
- 资源目录超限返回截断标记，不静默。
- `hello_ack` 含 `scriptRoot`。
- `stage` → 空列表，前端显示「无候选」。
