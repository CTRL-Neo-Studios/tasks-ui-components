import {parseDate} from '@internationalized/date'
import {resolveFields, type Task, type TaskDocument, type View} from '@type32/tasks'
import {describe, expect, test} from 'vitest'
import {calendarItems, detachOccurrence, draftTask, layoutDay, layoutLanes, monthWeeks, shiftTask} from './calendar'
import {applyPatch} from './changes'

const at = '2026-11-18T10:00:00Z'
const task = (id: string, extra: Partial<Task> = {}): Task => ({id, title: id, updatedAt: at, ...extra})
const view: View = {id: 'v', title: 'V', type: 'calendar', updatedAt: at}
const items = (tasks: Task[], from: string, to: string, timeZone = 'Europe/Berlin') => {
    const doc: TaskDocument = {version: '1.1', tasks}
    return calendarItems(doc, view, resolveFields(doc), {from: parseDate(from), to: parseDate(to), timeZone})
}

describe('calendarItems', () => {
    test("a weekly Berlin meeting at the right hour in New York, across both changes of clocks", () => {
        const meeting = task('m', {start: '2026-10-19T10:00', duration: 'PT1H', timeZone: 'Europe/Berlin', recurrence: {freq: 'weekly'}})
        // Berlin leaves summer time on Oct 25, New York on Nov 1: six hours apart, then five, then six again.
        expect(items([meeting], '2026-10-19', '2026-11-03', 'America/New_York').map(i => `${i.startDay} ${i.startMin / 60}-${i.endMin / 60}`))
            .toEqual(['2026-10-19 4-5', '2026-10-26 5-6', '2026-11-02 4-5'])
    })

    test('kinds: a date span inclusive, a moment, a due; a timed span past midnight is drawn across days', () => {
        const all = items([
            task('trip', {start: '2026-11-20', end: '2026-11-24'}),
            task('launch', {start: '2026-11-18T09:00'}),
            task('report', {due: '2026-11-19'}),
            task('night', {start: '2026-11-18T22:00', end: '2026-11-19T02:00'}),
            task('loose'),
        ], '2026-11-16', '2026-11-30')
        expect(all.map(i => [i.task.id, i.kind, i.allDay, i.startDay.toString(), i.endDay.toString()])).toEqual([
            ['trip', 'span', true, '2026-11-20', '2026-11-24'],
            ['launch', 'moment', false, '2026-11-18', '2026-11-18'],
            ['report', 'due', true, '2026-11-19', '2026-11-19'],
            ['night', 'span', true, '2026-11-18', '2026-11-19'],
        ])
    })
})

test('overlapping spans share the column; one after them gets it whole', () => {
    const day = items([
        task('a', {start: '2026-11-18T09:00', end: '2026-11-18T11:00'}),
        task('b', {start: '2026-11-18T10:00', end: '2026-11-18T12:00'}),
        task('c', {start: '2026-11-18T10:30', end: '2026-11-18T10:45'}),
        task('d', {start: '2026-11-18T13:00', end: '2026-11-18T14:00'}),
    ], '2026-11-18', '2026-11-19')
    expect(layoutDay(day).map(p => [p.item.task.id, p.top / 60, p.height, Math.round(p.left), Math.round(p.width)])).toEqual([
        ['a', 9, 120, 0, 33],
        ['b', 10, 120, 33, 33],
        // 15 minutes, packed at the 30 it's drawn at.
        ['c', 10.5, 30, 67, 33],
        ['d', 13, 60, 0, 100],
    ])
})

test("a month's weeks start on the week's first day", () => {
    expect(monthWeeks(parseDate('2026-11-18'), 1)[0]![0]!.toString()).toBe('2026-10-26')
    expect(monthWeeks(parseDate('2026-11-18'), 0)[0]![0]!.toString()).toBe('2026-11-01')
    expect(monthWeeks(parseDate('2026-11-18'), 1).flat()).toHaveLength(42)
})

test("an all-day span over a week's end is cut at the row's edges, and lanes don't collide", () => {
    const all = items([task('trip', {start: '2026-11-20', end: '2026-11-24'}), task('fri', {start: '2026-11-20'}), task('sun', {start: '2026-11-22'})], '2026-11-16', '2026-11-30')
    const weeks = monthWeeks(parseDate('2026-11-18'), 1)
    const lanes = (row: number) => layoutLanes(all, weeks[row]!).map(l => [l.item.task.id, l.column, l.span, l.lane])
    expect(lanes(3)).toEqual([['trip', 4, 3, 0], ['fri', 4, 1, 1], ['sun', 6, 1, 1]])
    expect(lanes(4)).toEqual([['trip', 0, 2, 0]])
})

describe('drags', () => {
    test('moved a day, a date stays a date and a time keeps its time; stretched, the end or the duration grows', () => {
        expect(shiftTask(task('a', {start: '2026-11-20', end: '2026-11-21'}), {days: 2, minutes: 0, edge: 'start'})).toEqual({start: '2026-11-22', end: '2026-11-23'})
        expect(shiftTask(task('b', {start: '2026-11-20T09:00', end: '2026-11-20T10:00'}), {days: 1, minutes: 30, edge: 'start'}))
            .toEqual({start: '2026-11-21T09:30', end: '2026-11-21T10:30'})
        expect(shiftTask(task('c', {start: '2026-11-20T09:00', duration: 'PT1H'}), {days: 0, minutes: 45, edge: 'end'})).toEqual({duration: 'PT1H45M'})
        expect(shiftTask(task('d', {start: '2026-11-20', duration: 'P1D'}), {days: 2, minutes: 0, edge: 'end'})).toEqual({duration: 'P3D'})
        // Never before the start.
        expect(shiftTask(task('e', {start: '2026-11-20T09:00', end: '2026-11-20T10:00'}), {days: 0, minutes: -120, edge: 'end'})).toEqual({end: '2026-11-20T09:15'})
    })

    test('one occurrence moved: the series skips it, a task of its own holds it', () => {
        const weekly = task('w', {start: '2026-11-16T10:00', end: '2026-11-16T11:00', recurrence: {freq: 'weekly'}, values: {tags: ['team']}})
        const second = items([weekly], '2026-11-23', '2026-11-24')[0]!
        const {series, single} = detachOccurrence(weekly, second, {days: 1, minutes: 0, edge: 'start'}, at)
        expect(applyPatch(weekly, series, at).excludedDates).toEqual(['2026-11-23T10:00'])
        expect(single).toMatchObject({title: 'w', start: '2026-11-24T10:00', end: '2026-11-24T11:00', values: {tags: ['team']}})
        expect(single.recurrence).toBeUndefined()
        expect(single.id).not.toBe('w')
    })

    test('a drawn task: dates, or times', () => {
        expect(draftTask(parseDate('2026-11-20'), parseDate('2026-11-22'), undefined, at)).toMatchObject({start: '2026-11-20', end: '2026-11-22'})
        expect(draftTask(parseDate('2026-11-20'), parseDate('2026-11-20'), {start: 570, end: 630}, at)).toMatchObject({start: '2026-11-20T09:30', end: '2026-11-20T10:30'})
    })
})
