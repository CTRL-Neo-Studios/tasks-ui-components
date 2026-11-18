import {parseDate, toCalendarDate} from '@internationalized/date'
import {completeTask, type Fields, type FieldValue, type Frequency, isOpen, type Task} from '@type32/tasks'
import {fromDateValue, toDateValue} from './dates'

/** Keys of a record to change, a key set to `undefined` to remove. */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined }

/** What the components report for a task. Apply one with `applyPatch`, which also stamps `updatedAt`. */
export type TaskPatch = Patch<Task>

/**
 * A task, list or view with `patch` applied and `updatedAt` set; keys set to `undefined` are removed, an empty
 * `values` too.
 */
export function applyPatch<T extends { updatedAt: string }>(record: T, patch: Patch<T>, updatedAt: string): T {
    const next: Record<string, unknown> = {...record, ...patch, updatedAt}
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
    if (next.values && Object.keys(next.values).length === 0) delete next.values
    return next as T
}

/** The keys that differ from `before` to `after`, those `after` lacks as `undefined`. */
export function diff(before: Task, after: Task): TaskPatch {
    const patch: TaskPatch = {}
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (key === 'updatedAt') continue
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) patch[key] = after[key]
    }
    return patch
}

/** The checkbox: an open task is completed (a repeating one moves to its next occurrence); a closed one reopens. */
export function toggleDone(task: Task, fields: Fields, now: string): TaskPatch {
    if (isOpen(task, fields)) return diff(task, completeTask(task, now))
    return {values: {...task.values, status: 'todo'}, completedAt: undefined}
}

/** A value of `values`, removed with `undefined`. */
export function withValue(task: Task, field: string, value: FieldValue | undefined): TaskPatch {
    const values = {...task.values}
    if (value === undefined || (Array.isArray(value) && value.length === 0)) delete values[field]
    else values[field] = value
    return {values}
}

/** Repeating needs an anchor: without `start` or `due` the rule and its exclusions go. */
function anchorGone(task: Task, keeps: 'start' | 'due'): TaskPatch {
    return task[keeps] === undefined ? {recurrence: undefined, excludedDates: undefined} : {}
}

/** The rule's dates have the anchor's form: when it changes (a date gets a time), its exclusions and `until` go. */
function anchorReformed(task: Task, before: string | undefined, after: string): TaskPatch {
    if (!task.recurrence || before === undefined || before.includes('T') === after.includes('T')) return {}
    const {until: _, ...recurrence} = task.recurrence
    return {recurrence, excludedDates: undefined}
}

/**
 * Do: the day the task starts (`start`), its time of day and its length kept (`end` moves by as many days). Cleared,
 * the task becomes a todo (`end`, `duration` go).
 */
export function withStart(task: Task, day: string | undefined): TaskPatch {
    if (day === undefined) return {start: undefined, end: undefined, duration: undefined, ...anchorGone(task, 'due')}
    if (task.start === undefined) return {start: day}
    const before = toDateValue(task.start)
    const target = parseDate(day)
    const days = target.compare(toCalendarDate(before))
    const start = fromDateValue('hour' in before ? before.set({year: target.year, month: target.month, day: target.day}) : target)
    return {
        start,
        ...(task.end !== undefined && {end: fromDateValue(toDateValue(task.end).add({days}))}),
        ...anchorReformed(task, task.start, start),
    }
}

/** Due: a date, or a date and time. */
export function withDue(task: Task, due: string | undefined): TaskPatch {
    if (due === undefined) return {due: undefined, ...anchorGone(task, 'start')}
    return {due, ...(task.start === undefined && anchorReformed(task, task.due, due))}
}

/** The plain repeats (every day, week, month, year), which replace any rule and its exclusions; `undefined` stops repeating. */
export function withRepeat(freq: Frequency | undefined): TaskPatch {
    return {recurrence: freq && {freq}, excludedDates: undefined}
}
