/*
 * The calendar's model: a document's tasks as what a calendar draws in a range, where they go in a day's column and
 * in a week's rows, and the edits its drags make. Day and week packing follow the Nuxt UI calendar template's
 * (https://github.com/nuxt-ui-templates/calendar, MIT, © 2025 Nuxt UI Templates).
 */
import {
    CalendarDate,
    CalendarDateTime,
    getDayOfWeek,
    parseDate,
    parseDateTime,
    startOfMonth,
    toCalendarDate,
    toCalendarDateTime,
    toTimeZone,
    toZoned,
} from '@internationalized/date'
import {type Fields, type Occurrence, occurrences, type Task, type TaskDocument, type View, viewTasks} from '@type32/tasks'
import type {TaskPatch} from './changes'
import {fromDateValue, toDateValue} from './dates'

export const DAY_MINUTES = 24 * 60
/** What a drag snaps to, in minutes. */
export const SNAP_MINUTES = 15
/** The height a short task is drawn at, in minutes (a moment, a due, a 15-minute span), and packed at. */
export const MIN_MINUTES = 30

/** One time of a task in a calendar: a span, a moment (a start alone) or a due, in the viewer's days and minutes. */
export interface CalendarItem {
    key: string
    task: Task
    /** The occurrence, in the task's own wall clock (`occurrences`). */
    occurrence: Occurrence
    /** The occurrence's anchor (`start`, or `due` without one), in the form `excludedDates` takes. */
    anchor: string
    kind: 'span' | 'moment' | 'due'
    /** Has a time of day (else it's dates). */
    timed: boolean
    /** Drawn across days rather than in a day's hours: dates, and a timed span that crosses midnight. */
    allDay: boolean
    startDay: CalendarDate
    /** Inclusive. */
    endDay: CalendarDate
    /** Minutes into `startDay`; 0 for dates. */
    startMin: number
    /** Minutes into `endDay` (exclusive end); `DAY_MINUTES` for dates. */
    endMin: number
}

/** A task's local time as the viewer sees it: a date as it is, a time in the task's zone moved to the viewer's. */
export function inViewer(value: string, taskZone: string | undefined, viewZone: string): CalendarDate | CalendarDateTime {
    if (!value.includes('T')) return parseDate(value)
    const time = parseDateTime(value)
    return !taskZone || taskZone === viewZone ? time : toCalendarDateTime(toTimeZone(toZoned(time, taskZone), viewZone))
}

const minutesOf = (v: CalendarDateTime) => v.hour * 60 + v.minute

function item(task: Task, occurrence: Occurrence, kind: CalendarItem['kind'], from: string, to: string | undefined, zone: string): CalendarItem {
    const start = inViewer(from, task.timeZone, zone)
    const end = to === undefined ? start : inViewer(to, task.timeZone, zone)
    const base = {key: `${task.id}\u0000${occurrence.start ?? occurrence.due}`, task, occurrence, anchor: (occurrence.start ?? occurrence.due)!, kind}
    if (!('hour' in start) || !('hour' in end)) {
        return {...base, timed: false, allDay: true, startDay: toCalendarDate(start), endDay: toCalendarDate(end), startMin: 0, endMin: DAY_MINUTES}
    }
    // A span ending at midnight ends in the day before.
    const endsAtMidnight = kind === 'span' && minutesOf(end) === 0 && end.compare(start) > 0
    const endDay = toCalendarDate(end).subtract({days: endsAtMidnight ? 1 : 0})
    const startDay = toCalendarDate(start)
    return {
        ...base,
        timed: true,
        allDay: endDay.compare(startDay) > 0,
        startDay,
        endDay,
        startMin: minutesOf(start),
        endMin: endsAtMidnight ? DAY_MINUTES : minutesOf(end),
    }
}

/**
 * What a calendar draws of the view's tasks in the viewer's days `[from, to)`: each occurrence of a repeating task,
 * a span with its start and end, a moment at its start, a todo at its due (a due on a span isn't drawn apart).
 */
export function calendarItems(doc: TaskDocument, view: View, fields: Fields, range: { from: CalendarDate, to: CalendarDate, timeZone: string }): CalendarItem[] {
    const items: CalendarItem[] = []
    const window = {from: range.from.toString(), to: range.to.toString(), timeZone: range.timeZone}
    for (const task of viewTasks(doc, view, fields)) {
        for (const o of occurrences(task, window)) {
            if (o.start !== undefined) items.push(item(task, o, o.end === undefined ? 'moment' : 'span', o.start, o.end, range.timeZone))
            else if (o.due !== undefined) items.push(item(task, o, 'due', o.due, undefined, range.timeZone))
        }
    }
    return items.filter(i => i.endDay.compare(range.from) >= 0 && i.startDay.compare(range.to) < 0)
}

/** A timed item placed in its day's column: `top` and `height` in minutes, `left` and `width` in percent. */
export interface Placed {
    item: CalendarItem
    top: number
    height: number
    left: number
    width: number
}

/**
 * The timed items of one day in its column: items that overlap, one after another, form a cluster, and a cluster
 * splits into as few columns as it needs (Google Calendar's way). A short one is packed at the height it's drawn at.
 */
export function layoutDay(items: readonly CalendarItem[]): Placed[] {
    const sorted = items
        .map(item => ({item, start: item.startMin, end: Math.max(item.endMin, item.startMin + MIN_MINUTES)}))
        .sort((a, b) => a.start - b.start || b.end - a.end)
    const placed: Placed[] = []
    let cluster: typeof sorted = []
    let clusterEnd = -Infinity
    const flush = () => {
        const columns: number[] = []
        const at = cluster.map((c) => {
            let index = columns.findIndex(end => end <= c.start)
            if (index === -1) index = columns.length
            columns[index] = c.end
            return index
        })
        cluster.forEach((c, i) => placed.push({item: c.item, top: c.start, height: c.end - c.start, left: at[i]! / columns.length * 100, width: 100 / columns.length}))
    }
    for (const c of sorted) {
        if (cluster.length && c.start >= clusterEnd) {
            flush()
            cluster = []
            clusterEnd = -Infinity
        }
        cluster.push(c)
        clusterEnd = Math.max(clusterEnd, c.end)
    }
    if (cluster.length) flush()
    return placed
}

/** An item in a row of days: the column it starts in, how many it spans, its lane (a row of the row). */
export interface Laned {
    item: CalendarItem
    column: number
    span: number
    lane: number
}

/**
 * Items in a row of consecutive days, each in the first lane free over its days: longer ones first where they start
 * together, then by time. An item running past the row is cut at its edges (the next row draws the rest).
 */
export function layoutLanes(items: readonly CalendarItem[], days: readonly CalendarDate[]): Laned[] {
    const first = days[0]
    if (!first) return []
    const lanes: number[] = []
    return items
        .map(item => {
            const column = Math.max(0, item.startDay.compare(first))
            return {item, column, span: Math.min(days.length, item.endDay.compare(first) + 1) - column}
        })
        .filter(x => x.span > 0)
        .sort((a, b) => a.column - b.column || b.span - a.span || a.item.startMin - b.item.startMin)
        .map(x => {
            let lane = lanes.findIndex(end => end <= x.column)
            if (lane === -1) lane = lanes.length
            lanes[lane] = x.column + x.span
            return {...x, lane}
        })
}

/** The first day of `date`'s week, weeks starting on `weekStartsOn` (0 is Sunday). */
export function weekStart(date: CalendarDate, weekStartsOn: number): CalendarDate {
    // `en-US` counts from Sunday.
    return date.subtract({days: (getDayOfWeek(date, 'en-US') - weekStartsOn + 7) % 7})
}

/** A month as a calendar shows it: six weeks of seven days from the week its first day is in. */
export function monthWeeks(date: CalendarDate, weekStartsOn: number): CalendarDate[][] {
    const first = weekStart(startOfMonth(date), weekStartsOn)
    return Array.from({length: 6}, (_, w) => Array.from({length: 7}, (_, d) => first.add({days: w * 7 + d})))
}

/** How far a drag took a task: days, minutes (a time's), and whether it moved it whole or stretched its end. */
export interface Shift {
    days: number
    minutes: number
    edge: 'start' | 'end'
}

const DURATION = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/

/** A duration stretched by `days` and `minutes`: whole days for an all-day task, hours and minutes for a timed one. */
function stretch(duration: string, days: number, minutes: number, timed: boolean): string {
    const [, w = '0', d = '0', h = '0', m = '0', s = '0'] = DURATION.exec(duration) ?? []
    if (!timed) return `P${Math.max(1, Number(w) * 7 + Number(d) + days)}D`
    const total = Math.max(SNAP_MINUTES, (Number(w) * 7 + Number(d)) * DAY_MINUTES + Number(h) * 60 + Number(m) + Math.round(Number(s) / 60) + days * DAY_MINUTES + minutes)
    const hours = Math.floor(total / 60)
    return `PT${hours ? `${hours}H` : ''}${total % 60 ? `${total % 60}M` : ''}`
}

/** A local time moved: a date by days, a date-time by days and minutes; the form kept. */
function moved(value: string, days: number, minutes: number): string {
    return value.includes('T') ? fromDateValue(parseDateTime(value).add({days, minutes})) : parseDate(value).add({days}).toString()
}

/**
 * A drag's edit: `start` moves the whole task (its start, end, due, and the exclusions of its series, so they still
 * fall on the occurrences they skip); `end` stretches its end or its duration, never before its start. Each time keeps
 * its form: a date moves by days alone.
 */
export function shiftTask(task: Task, {days, minutes, edge}: Shift): TaskPatch {
    if (edge === 'start') {
        return {
            ...(task.start !== undefined && {start: moved(task.start, days, minutes)}),
            ...(task.end !== undefined && {end: moved(task.end, days, minutes)}),
            ...(task.due !== undefined && {due: moved(task.due, days, minutes)}),
            ...(task.excludedDates && {excludedDates: task.excludedDates.map(v => moved(v, days, minutes))}),
        }
    }
    if (task.start === undefined) return {}
    if (task.duration !== undefined) return {duration: stretch(task.duration, days, minutes, task.start.includes('T'))}
    if (task.end === undefined) return {}
    const end = moved(task.end, days, minutes)
    // Both are the same form; written alike (`fromDateValue`), their text orders as their times do.
    const before = end < fromDateValue(toDateValue(task.start))
    return {end: !before ? end : task.start.includes('T') ? moved(task.start, 0, SNAP_MINUTES) : task.start}
}

/**
 * One occurrence of a repeating task taken out of its series: the series skips it (`excludedDates`), and a task of its
 * own holds it, at its times with the drag's shift applied.
 */
export function detachOccurrence(task: Task, item: CalendarItem, shift: Shift, now: string): { series: TaskPatch, single: Task } {
    const {recurrence: _, excludedDates: __, ...rest} = task
    const {start, end, due} = item.occurrence
    const single: Task = {
        ...rest,
        id: crypto.randomUUID(),
        ...(start !== undefined && {start}),
        ...(end !== undefined && task.end !== undefined && {end}),
        ...(due !== undefined && {due}),
        updatedAt: now,
    }
    const patch = shiftTask(single, shift)
    return {
        series: {excludedDates: [...(task.excludedDates ?? []), item.anchor]},
        single: {...single, ...patch} as Task,
    }
}

/** A new task drawn on the calendar: from a day (and minute) to a day (and minute, exclusive); dates without minutes. */
export function draftTask(from: CalendarDate, to: CalendarDate, minutes?: { start: number, end: number }, now = new Date().toISOString()): Task {
    const time = (day: CalendarDate, m: number) => fromDateValue(new CalendarDateTime(day.year, day.month, day.day).add({minutes: m}))
    const base = {id: crypto.randomUUID(), title: '', updatedAt: now}
    if (!minutes) return {...base, start: from.toString(), ...(to.compare(from) > 0 && {end: to.toString()})}
    return {...base, start: time(from, minutes.start), end: time(to, minutes.end)}
}
