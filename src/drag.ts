import {type CalendarDate, parseDate} from '@internationalized/date'
import {shallowRef} from 'vue'
import {type CalendarItem, DAY_MINUTES, type Shift, SNAP_MINUTES} from './calendar'

/** An hour's height in a day's column, in pixels. */
export const HOUR_PX = 48
/** How far a pointer travels before a press is a drag rather than a click. */
const THRESHOLD = 5

/** What a drag would do, drawn while it lasts: an item moved or stretched, or a task being drawn. */
export interface Preview {
    item?: CalendarItem
    days: number
    minutes: number
    edge: 'start' | 'end'
    /** A day column's width, to draw a block moved across days. */
    columnWidth: number
    draft?: { day: CalendarDate, start: number, end: number }
}

/** The day under a point: the topmost element there that has a `data-date`, so a row drawn late is found too. */
export function dayAt(x: number, y: number): CalendarDate | undefined {
    for (const el of document.elementsFromPoint(x, y)) {
        const iso = (el as HTMLElement).dataset?.date
        if (iso) return parseDate(iso)
    }
    return undefined
}

const snap = (minutes: number, round = Math.round) => round(minutes / SNAP_MINUTES) * SNAP_MINUTES

/**
 * A press followed to its release: `move` once it's travelled a few pixels (a drag, not a click), `end` with whether it
 * did.
 */
export function followPointer(event: PointerEvent, move: (e: PointerEvent) => void, end: (e: PointerEvent, moved: boolean) => void) {
    const [x0, y0] = [event.clientX, event.clientY]
    let moved = false
    const onMove = (e: PointerEvent) => {
        if (!moved && Math.hypot(e.clientX - x0, e.clientY - y0) < THRESHOLD) return
        moved = true
        move(e)
    }
    const onUp = (e: PointerEvent) => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        end(e, moved)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
}

/**
 * A calendar's pointer gestures. On an item: a click opens it, a drag moves it (or stretches its end) by days and, in a
 * day's hours, by minutes. On a day's empty hours: a drag draws a new task.
 */
export function useCalendarDrag(on: {
    open(item: CalendarItem, el: HTMLElement): void
    commit(item: CalendarItem, shift: Shift): void
    draw(day: CalendarDate, start: number, end: number): void
}) {
    const preview = shallowRef<Preview>()

    const follow = (event: PointerEvent, move: (e: PointerEvent) => void, end: (e: PointerEvent, moved: boolean) => void) =>
        followPointer(event, move, (e, moved) => {
            end(e, moved)
            preview.value = undefined
        })

    /** On an item: `time` in a day's hours (minutes count), `days` in a row of days. */
    function itemDown(event: PointerEvent, item: CalendarItem, edge: 'start' | 'end', grid: 'time' | 'days') {
        if (event.button !== 0) return
        event.stopPropagation()
        const el = (event.target as HTMLElement).closest<HTMLElement>('[data-item]')!
        const from = dayAt(event.clientX, event.clientY) ?? item.startDay
        const columnWidth = el.closest('[data-date]')?.getBoundingClientRect().width ?? 0
        const shift = (e: PointerEvent): Shift => ({
            days: (dayAt(e.clientX, e.clientY) ?? from).compare(from),
            minutes: grid === 'time' && item.timed ? snap((e.clientY - event.clientY) / HOUR_PX * 60) : 0,
            edge,
        })
        follow(event, (e) => (preview.value = {item, ...shift(e), columnWidth}), (e, moved) => {
            if (!moved) return on.open(item, el)
            const s = shift(e)
            if (s.days || s.minutes) on.commit(item, s)
        })
    }

    /** On a day's empty hours: a drag draws a task from where it started to where it is, in that day. */
    function gridDown(event: PointerEvent, day: CalendarDate) {
        if (event.button !== 0) return
        const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
        const at = (y: number, round = Math.round) => Math.min(DAY_MINUTES, Math.max(0, snap((y - box.top) / HOUR_PX * 60, round)))
        const start = at(event.clientY, Math.floor)
        const range = (y: number) => {
            const there = at(y)
            return there >= start ? {start, end: Math.max(there, start + SNAP_MINUTES)} : {start: there, end: start + SNAP_MINUTES}
        }
        follow(event, (e) => (preview.value = {days: 0, minutes: 0, edge: 'start', columnWidth: 0, draft: {day, ...range(e.clientY)}}), (e, moved) => {
            if (!moved) return
            const {start: from, end} = range(e.clientY)
            on.draw(day, from, end)
        })
    }

    return {preview, itemDown, gridDown}
}
