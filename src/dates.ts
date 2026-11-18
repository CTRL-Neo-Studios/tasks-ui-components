import {
    type CalendarDate,
    type CalendarDateTime,
    DateFormatter,
    parseDate,
    parseDateTime,
    toCalendarDate,
    toTimeZone,
    toZoned,
} from '@internationalized/date'

/** A task's local time (`2026-11-18`, `2026-11-18T09:30`) as a date or a date-time. */
export function toDateValue(value: string): CalendarDate | CalendarDateTime {
    return value.includes('T') ? parseDateTime(value) : parseDate(value)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Back to the format's text: `2026-11-18`, or `2026-11-18T09:30` (seconds only when there are some). */
export function fromDateValue(value: CalendarDate | CalendarDateTime): string {
    if (!('hour' in value)) return value.toString()
    return value.second || value.millisecond
        ? value.toString()
        : `${value.toString().slice(0, 10)}T${pad(value.hour)}:${pad(value.minute)}`
}

/**
 * The day a task's time falls on for someone in `viewZone`: a date is its own day; a date-time in the task's
 * `timeZone` is moved to the viewer's; a floating one is the same wall clock everywhere.
 */
export function dayOf(value: string, taskZone: string | undefined, viewZone: string): CalendarDate {
    if (!value.includes('T')) return parseDate(value)
    const time = parseDateTime(value)
    if (!taskZone || taskZone === viewZone) return toCalendarDate(time)
    return toCalendarDate(toTimeZone(toZoned(time, taskZone), viewZone))
}

const formatters = new Map<string, DateFormatter>()

/** `Nov 18`, `Nov 18, 2027`, `Nov 18, 9:30 AM` in `locale`: the year only when it isn't `today`'s. */
export function formatTime(value: string, locale: string | undefined, today: CalendarDate): string {
    const time = toDateValue(value)
    const withYear = time.year !== today.year
    const withTime = 'hour' in time
    const key = `${locale}|${withYear}|${withTime}`
    let format = formatters.get(key)
    if (!format) {
        format = new DateFormatter(locale ?? new Intl.DateTimeFormat().resolvedOptions().locale, {
            month: 'short',
            day: 'numeric',
            ...(withYear && {year: 'numeric'}),
            ...(withTime && {hour: 'numeric', minute: '2-digit'}),
            // The value is a wall clock: read and written as UTC, it stays the one written.
            timeZone: 'UTC',
        })
        formatters.set(key, format)
    }
    return format.format(time.toDate('UTC'))
}
