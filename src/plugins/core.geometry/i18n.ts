/**
 * 12-09 几何工具文案表（前缀 `geometry.*`）。
 *
 * 集成方在 `src/workbench/i18n/index.ts` 把 ZH / EN 展开进 `MESSAGES.zh_cn / en_us`；
 * 本切片不直接改 `i18n/index.ts`。
 */

export const ZH: Record<string, string> = {
  'geometry.tools.title': '几何工具',

  'geometry.section.inspector': '素材尺寸检查器',
  'geometry.section.planner': '覆盖层区域规划',
  'geometry.section.camera': '相机合成矩形',
  'geometry.section.baseResolution': '基准分辨率',
  'geometry.section.preview': '预览几何示意',
  'geometry.section.gizmo': 'Gizmo',

  'geometry.space.overlay': '覆盖层坐标系：裁切后素材像素 × 统一系数 × 缩放倍数',
  'geometry.space.camera': '相机坐标系：目标与源裁切均为 0–1 归一化，不乘系数、不读基准分辨率',
  'geometry.disclaimer': '几何示意，最终以游戏为准',

  'geometry.preview.fixedView': '固定预览视口 1920×1080',
  'geometry.preview.fixedFps': '固定预览帧率 60 帧',

  'geometry.inspector.sourceWidth': '素材原始宽（像素）',
  'geometry.inspector.sourceHeight': '素材原始高（像素）',
  'geometry.inspector.sourceUnknown': '素材原始像素未知：只做比例示意，不假设 16:9 / 1920×1080',
  'geometry.inspector.cropped': '裁切后像素',
  'geometry.inspector.baseSize': '基准尺寸（× 系数）',
  'geometry.inspector.finalSize': '最终显示尺寸（× 缩放倍数）',
  'geometry.inspector.windowFraction': '占窗口比例',
  'geometry.inspector.outOfWindow': '元素框超出窗口',
  'geometry.inspector.inWindow': '元素框在窗口内',
  'geometry.inspector.stretched': '非等比拉伸',
  'geometry.inspector.factor': '统一缩放系数 k',

  'geometry.planner.targetX': '目标 X（窗口归一化）',
  'geometry.planner.targetY': '目标 Y（窗口归一化）',
  'geometry.planner.targetWidth': '目标宽（窗口归一化）',
  'geometry.planner.targetHeight': '目标高（窗口归一化）',
  'geometry.planner.center': '建议中心',
  'geometry.planner.suggestedScale': '建议缩放倍数',
  'geometry.planner.anchor': '锚点（缩放不动点）',
  'geometry.planner.apply': '应用到选中覆盖层片段',

  'geometry.camera.destX': '目标 X',
  'geometry.camera.destY': '目标 Y',
  'geometry.camera.destW': '目标宽',
  'geometry.camera.destH': '目标高',
  'geometry.camera.sourceX': '源 X',
  'geometry.camera.sourceY': '源 Y',
  'geometry.camera.sourceW': '源宽',
  'geometry.camera.sourceH': '源高',
  'geometry.camera.stretched': '目标与源比例不一致：会拉伸',
  'geometry.camera.normalizedOnly': '相机矩形只写 0–1 归一化值，不写像素、不乘系数',

  'geometry.baseResolution.width': '基准宽（像素，正整数）',
  'geometry.baseResolution.height': '基准高（像素，正整数）',
  'geometry.baseResolution.explicit': '已显式声明',
  'geometry.baseResolution.defaultNote': '未声明：按缺省 1920×1080 处理',
  'geometry.baseResolution.apply': '写入基准分辨率',
  'geometry.baseResolution.reset': '清除声明（回退缺省）',
  'geometry.baseResolution.scopeNote': '只影响覆盖层缩放系数与示意；不影响相机矩形与字幕实际字体测量',

  'geometry.gizmo.handle.move': '移动',
  'geometry.gizmo.handle.uniformScale': '等比缩放',
  'geometry.gizmo.handle.stretchScale': '非等比缩放',
  'geometry.gizmo.handle.anchor': '锚点调整',
  'geometry.gizmo.noRotation': '无旋转手柄',
  'geometry.gizmo.multi': '多选：仅显示包围盒，不批量修改每个片段',
  'geometry.gizmo.releaseCommit': '松手一次提交，拖动中不写文档',

  'geometry.state.noSelection': '未选中片段：显示文档级基准分辨率与固定预览示意',
  'geometry.state.multi': '多选片段：Gizmo 只显示包围盒',
  'geometry.subtitle.approxBlock': '字幕文字块为近似示意，不声称等于游戏字体像素',

  'geometry.common.issue': '问题',
  'geometry.common.warning': '提示',
  'geometry.common.unknown': '未知',
}

export const EN: Record<string, string> = {
  'geometry.tools.title': 'Geometry Tools',

  'geometry.section.inspector': 'Asset Size Inspector',
  'geometry.section.planner': 'Overlay Region Planner',
  'geometry.section.camera': 'Camera Composite Rect',
  'geometry.section.baseResolution': 'Base Resolution',
  'geometry.section.preview': 'Geometry Sketch',
  'geometry.section.gizmo': 'Gizmo',

  'geometry.space.overlay': 'Overlay space: cropped asset pixels × scale factor × author scale',
  'geometry.space.camera': 'Camera space: dest and source are 0–1 normalized; no factor, no base resolution',
  'geometry.disclaimer': 'Geometry sketch only; the game is authoritative',

  'geometry.preview.fixedView': 'Fixed preview viewport 1920×1080',
  'geometry.preview.fixedFps': 'Fixed preview frame rate 60 fps',

  'geometry.inspector.sourceWidth': 'Source width (px)',
  'geometry.inspector.sourceHeight': 'Source height (px)',
  'geometry.inspector.sourceUnknown': 'Source pixels unknown: ratio sketch only; no 16:9 / 1920×1080 assumption',
  'geometry.inspector.cropped': 'Cropped pixels',
  'geometry.inspector.baseSize': 'Base size (× factor)',
  'geometry.inspector.finalSize': 'Final size (× author scale)',
  'geometry.inspector.windowFraction': 'Window fraction',
  'geometry.inspector.outOfWindow': 'Element box out of window',
  'geometry.inspector.inWindow': 'Element box inside window',
  'geometry.inspector.stretched': 'Non-uniform stretch',
  'geometry.inspector.factor': 'Unified scale factor k',

  'geometry.planner.targetX': 'Target X (normalized)',
  'geometry.planner.targetY': 'Target Y (normalized)',
  'geometry.planner.targetWidth': 'Target width (normalized)',
  'geometry.planner.targetHeight': 'Target height (normalized)',
  'geometry.planner.center': 'Suggested center',
  'geometry.planner.suggestedScale': 'Suggested scale',
  'geometry.planner.anchor': 'Anchor (scale pivot)',
  'geometry.planner.apply': 'Apply to selected overlay clip',

  'geometry.camera.destX': 'Dest X',
  'geometry.camera.destY': 'Dest Y',
  'geometry.camera.destW': 'Dest width',
  'geometry.camera.destH': 'Dest height',
  'geometry.camera.sourceX': 'Source X',
  'geometry.camera.sourceY': 'Source Y',
  'geometry.camera.sourceW': 'Source width',
  'geometry.camera.sourceH': 'Source height',
  'geometry.camera.stretched': 'Dest/source aspect mismatch: stretched',
  'geometry.camera.normalizedOnly': 'Camera rects write 0–1 normalized values only; no pixels, no factor',

  'geometry.baseResolution.width': 'Base width (px, positive integer)',
  'geometry.baseResolution.height': 'Base height (px, positive integer)',
  'geometry.baseResolution.explicit': 'Explicitly declared',
  'geometry.baseResolution.defaultNote': 'Not declared: defaults to 1920×1080',
  'geometry.baseResolution.apply': 'Write base resolution',
  'geometry.baseResolution.reset': 'Clear declaration (use default)',
  'geometry.baseResolution.scopeNote': 'Affects overlay factor and sketch only; not camera rects or real subtitle font measurement',

  'geometry.gizmo.handle.move': 'Move',
  'geometry.gizmo.handle.uniformScale': 'Uniform scale',
  'geometry.gizmo.handle.stretchScale': 'Stretch scale',
  'geometry.gizmo.handle.anchor': 'Anchor adjust',
  'geometry.gizmo.noRotation': 'No rotation handle',
  'geometry.gizmo.multi': 'Multi-selection: bounding box only, no batch edit',
  'geometry.gizmo.releaseCommit': 'One commit on release; nothing written while dragging',

  'geometry.state.noSelection': 'No clip selected: document-level base resolution and fixed preview sketch',
  'geometry.state.multi': 'Multiple clips selected: gizmo shows bounding box only',
  'geometry.subtitle.approxBlock': 'Subtitle block is an approximation; it is not game font pixel measurement',

  'geometry.common.issue': 'Issue',
  'geometry.common.warning': 'Warning',
  'geometry.common.unknown': 'Unknown',
}
