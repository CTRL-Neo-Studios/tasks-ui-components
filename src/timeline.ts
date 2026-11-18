/*
 * The timeline's model: a document's tasks as an outline (subtasks under their parent) and, on a day axis, each task's
 * bars, moments, dues and its subtasks' stretch. Positions are days from the axis' first day, fractions for times.
 */
import {type CalendarDate, startOfMonth, startOfYear, toCalendarDate} from '@internationalized/date'
import {type Fields, isComplete, type Task, type TaskDocument, type View, viewTasks} from '@type32/tasks'
import {type CalendarItem, calendarItems, DAY_MINUTES, inViewer, weekStart} from './calendar'
import {dayOf} from './dates'

/** A day's width at each scale, in pixels. */
export const DAY_WIDTH = {day: 40, week: 16, month: 4} as const
export type Scale = keyof typeof DAY_WIDTH

/** The days the axis covers, `[from, to)`, in the viewer's zone. */
export interface Axis {
    from: CalendarDate
    to: CalendarDate
    timeZone: string
}

/**
 * An axis for `tasks`: from a month before the month of the earliest of their times (and today) to two months after
 * the latest's. A span's end set by its `duration` isn't counted; the margin is its room.
 */
export function timelineAxis(tasks: readonly Task[], timeZone: string, today: CalendarDate): Axis {
    let [first, last] = [today, today]
    for (const task of tasks) {
        for (const value of [task.start, task.end, task.due]) {
            if (value === undefined) continue
            const day = dayOf(value, task.timeZone, timeZone)
            if (day.compare(first) < 0) first = day
            if (day.compare(last) > 0) last = day
        }
    }
    return {from: startOfMonth(first).subtract({months: 1}), to: startOfMonth(last).add({months: 3}), timeZone}
}

/** One time of a task: `from` and `to` in days; a moment's and a todo's due are a point (a date's at its middle). */
export interface TimelineBar {
    item: CalendarItem
    from: number
    to: number
}

export interface TimelineRow {
    task: Task
    depth: number
    /** Has subtasks in the view, folded or not. */
    parent: boolean
    /** Each occurrence in the axis. */
    bars: TimelineBar[]
    /** The dues of its spans and moments (a todo's is its bar). */
    dues: number[]
    /** A parent without times of its own: what its subtasks cover. */
    summary?: { from: number, to: number }
    /** The first bar's length in days (the summary's for a parent without times); none for points. */
    length?: number
    /** `values.progress`; 100 for a completed task; a summary's, its subtasks' weighted by their length. */
    progress?: number
}

/**
 * The view's tasks as the timeline draws them: depth first, a subtask under its parent (one whose parent isn't in the
 * view is a root), the subtasks of a `folded` task left out. Every occurrence of a repeating task is on its row.
 */
export function timelineRows(doc: TaskDocument, view: View, fields: Fields, axis: Axis, folded: ReadonlySet<string> = new Set()): TimelineRow[] {
    const shown = viewTasks(doc, view, fields)
    const at = (day: CalendarDate, minutes: number) => day.compare(axis.from) + minutes / DAY_MINUTES
    const point = (value: string, task: Task) => {
        const v = inViewer(value, task.timeZone, axis.timeZone)
        return 'hour' in v ? at(toCalendarDate(v), v.hour * 60 + v.minute) : at(v, DAY_MINUTES / 2)
    }
    const bars = new Map<string, TimelineBar[]>()
    for (const item of calendarItems(doc, view, fields, axis)) {
        const bar = item.kind === 'span'
            ? {item, from: at(item.startDay, item.startMin), to: at(item.endDay, item.endMin)}
            : {item, from: point(item.anchor, item.task), to: point(item.anchor, item.task)}
        bars.set(item.task.id, [...bars.get(item.task.id) ?? [], bar])
    }

    const ids = new Set(shown.map(t => t.id))
    const children = new Map<string, Task[]>()
    const roots: Task[] = []
    for (const task of shown) {
        if (task.parentId === undefined || !ids.has(task.parentId)) roots.push(task)
        else children.set(task.parentId, [...children.get(task.parentId) ?? [], task])
    }

    // Each task's row, subtasks first (a summary is theirs).
    const rows = new Map<string, TimelineRow>()
    const build = (task: Task): TimelineRow => {
        const kids = (children.get(task.id) ?? []).map(build)
        const own = bars.get(task.id) ?? []
        const first = own[0]
        const row: TimelineRow = {
            task,
            depth: 0,
            parent: kids.length > 0,
            bars: own,
            dues: own.filter(b => b.item.kind !== 'due' && b.item.occurrence.due !== undefined).map(b => point(b.item.occurrence.due!, task)),
            ...(first && first.to > first.from && {length: first.to - first.from}),
        }
        const value = task.values?.progress
        const progress = typeof value === 'number' ? value : isComplete(task, fields) ? 100 : undefined
        if (progress !== undefined) row.progress = progress
        const covered = kids.map(k => (k.bars[0] ? {from: Math.min(...k.bars.map(b => b.from)), to: Math.max(...k.bars.map(b => b.to))} : k.summary))
            .filter(c => c !== undefined)
        if (own.length === 0 && covered.length > 0) {
            row.summary = {from: Math.min(...covered.map(c => c.from)), to: Math.max(...covered.map(c => c.to))}
            row.length = row.summary.to - row.summary.from
            const weighted = kids.filter(k => k.length !== undefined)
            const total = weighted.reduce((n, k) => n + k.length!, 0)
            if (progress === undefined && total > 0 && weighted.some(k => k.progress !== undefined)) {
                row.progress = weighted.reduce((n, k) => n + (k.progress ?? 0) * k.length!, 0) / total
            }
        }
        rows.set(task.id, row)
        return row
    }
    roots.forEach(build)

    const out: TimelineRow[] = []
    const push = (task: Task, depth: number) => {
        out.push({...rows.get(task.id)!, depth})
        if (!folded.has(task.id)) for (const child of children.get(task.id) ?? []) push(child, depth + 1)
    }
    roots.forEach(t => push(t, 0))
    return out
}

/** A cell of the axis' header: its first day, where it starts and how wide it is, in days. */
export interface Tick {
    day: CalendarDate
    at: number
    width: number
}

/**
 * The header's two rows: days under months at the day scale, weeks under months at the week scale, months under years
 * at the month scale. Cells are cut at the axis' ends.
 */
export function timelineTicks(axis: Axis, scale: Scale, weekStartsOn: number): { major: Tick[], minor: Tick[] } {
    const total = axis.to.compare(axis.from)
    const cut = (first: CalendarDate, next: (d: CalendarDate) => CalendarDate): Tick[] => {
        const ticks: Tick[] = []
        for (let day = first; day.compare(axis.to) < 0; day = next(day)) {
            const at = Math.max(0, day.compare(axis.from))
            ticks.push({day, at, width: Math.min(total, next(day).compare(axis.from)) - at})
        }
        return ticks
    }
    const months = (d: CalendarDate) => d.add({months: 1})
    if (scale === 'month') return {major: cut(startOfYear(axis.from), d => d.add({years: 1})), minor: cut(startOfMonth(axis.from), months)}
    return {
        major: cut(startOfMonth(axis.from), months),
        minor: scale === 'day' ? cut(axis.from, d => d.add({days: 1})) : cut(weekStart(axis.from, weekStartsOn), d => d.add({days: 7})),
    }
}

/**
 * A dependency's line, finish to start: out of the end of the one waited for (`x1`, `y1`), into the start of the one
 * waiting (`x2`, `y2`); around through the gap between rows when that starts before the other ends. In pixels.
 */
export function linkPath(x1: number, y1: number, x2: number, y2: number, rowHeight: number): string {
    const out = x1 + 8
    if (x2 - 8 >= out) return `M${x1} ${y1}H${out}V${y2}H${x2}`
    const between = y2 + (y2 > y1 ? -rowHeight / 2 : rowHeight / 2)
    return `M${x1} ${y1}H${out}V${between}H${x2 - 8}V${y2}H${x2}`
}
