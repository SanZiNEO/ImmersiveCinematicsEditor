import type { DocCommand } from '../../../core/doc/commands.ts'
import type { JsonObject, ObjectKeyframe } from '../../../core/doc/types.ts'
import { stepFieldApplies, switchMissingAxes } from '../../../features/authoring/positionForm.ts'
import { framesInRange } from '../../../features/effects/easing.ts'
import type { ClipTiming } from '../../../features/effects/rows.ts'
import type { PropertyRow } from '../../../features/effects/types.ts'

type StepEdit = Extract<DocCommand, {
  kind: 'object.setValue' | 'object.addKeyframe' | 'object.setKeyframeValue' | 'object.removeKeyframe'
}>

interface StepTrack {
  initial: unknown
  frames: ObjectKeyframe[]
}

function isStepEdit(command: DocCommand): command is StepEdit {
  return command.kind === 'object.setValue' || command.kind === 'object.addKeyframe'
    || command.kind === 'object.setKeyframeValue' || command.kind === 'object.removeKeyframe'
}

function stepTrack(row: PropertyRow | undefined, timing: ClipTiming): StepTrack {
  return {
    initial: row?.hasValue ? row.value : row?.defaultValue,
    frames: row === undefined ? [] : framesInRange(row.keyframes, timing),
  }
}

function afterEdit(before: StepTrack, command: StepEdit, timing: ClipTiming): StepTrack {
  if (command.kind === 'object.setValue') return { ...before, initial: command.value }
  const frames = before.frames.filter((frame) => frame.time !== command.time)
  if (command.kind !== 'object.removeKeyframe') frames.push({ time: command.time, value: command.value })
  return { initial: before.initial, frames: framesInRange(frames, timing).sort((left, right) => left.time - right.time) }
}

// 与主模组一致：有关键帧时，首帧也决定首帧之前的有效值。
function initialValue(track: StepTrack): unknown {
  return track.frames.length === 0 ? track.initial : track.frames[0].value
}

function valueAt(track: StepTrack, time: number, inclusive = true): unknown {
  let value = initialValue(track)
  for (const frame of track.frames) {
    if (frame.time > time || (!inclusive && frame.time === time)) break
    value = frame.value
  }
  return value
}

/** Only switches introduced or changed by the edit need new alignment. A position-space edit can also activate existing base-only switches. */
export function positionSwitchAlignment(
  rows: readonly PropertyRow[], objects: JsonObject, timing: ClipTiming, command: DocCommand,
): ReadonlyMap<number, string[]> {
  const missingByTime = new Map<number, string[]>()
  if (!isStepEdit(command) || !stepFieldApplies(command.path, true)) return missingByTime
  const changed = rows.find((row) => row.path === command.path)
  if (changed === undefined) return missingByTime
  const changesSpace = command.path === 'position_space'
  const beforeSpace = stepTrack(rows.find((row) => row.path === 'position_space'), timing)
  const afterSpace = changesSpace ? afterEdit(beforeSpace, command, timing) : beforeSpace
  for (const row of rows) {
    const editsRow = row.path === command.path
    const baseOnly = changesSpace && stepFieldApplies(row.path, true) && !stepFieldApplies(row.path, false)
    if (!editsRow && !baseOnly) continue
    const before = stepTrack(row, timing)
    const after = editsRow ? afterEdit(before, command, timing) : before
    let previous = initialValue(after)
    for (const frame of after.frames) {
      const changes = previous !== frame.value
      previous = frame.value
      const time = frame.time
      if (!changes || time <= 0 || missingByTime.has(time)) continue
      const space = String(valueAt(afterSpace, time) ?? 'world')
      if (!stepFieldApplies(row.path, space === 'base')) continue
      const beforeValue = valueAt(before, time)
      if (beforeValue === frame.value && beforeValue !== valueAt(before, time, false)
        && stepFieldApplies(row.path, valueAt(beforeSpace, time) === 'base')) continue
      const missing = switchMissingAxes({ objects }, row.path, time, space)
      if (missing.length > 0) missingByTime.set(time, missing)
    }
  }
  return missingByTime
}
