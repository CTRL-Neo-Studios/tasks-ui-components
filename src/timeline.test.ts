import {parseDate} from '@internationalized/date'
import {resolveFields, type Task, type TaskDocument, type View} from '@type32/tasks'
import {describe, expect, test} from 'vitest'
import {linkPath, presetOf, scaleOf, timelineAxis, timelineRows, timelineTicks, viewZoom} from './timeline'

const at = '2026-11-18T10:00:00Z'
const task = (id: string, extra: Partial<Task> = {}): Task => ({id, title: id, updatedAt: at, ...extra})
const view: View = {id: 'v', title: 'V', type: 'timeline', updatedAt: at}
const axis = {from: parseDate('2026-11-01'), to: parseDate('2027-01-01'), timeZone: 'Europe/Berlin'}
const rows = (tasks: Task[], folded?: Set<string>) => {
    const doc: TaskDocument = {version: '1.1', tasks}
    return timelineRows(doc, view, resolveFields(doc), axis, folded)
}

describe('timelineRows', () => {
    const plan = [
        task('launch'),
        task('design', {parentId: 'launch', start: '2026-11-02', end: '2026-11-05', values: {progress: 50}}),
        task('build', {parentId: 'launch', start: '2026-11-06T09:00', end: '2026-11-06T15:00', due: '2026-11-07', values: {status: 'done'}}),
        task('ship', {start: '2026-11-10'}),
        task('report', {due: '2026-11-12T18:00'}),
    ]

    test('an outline with its subtasks under it; a parent without times covers theirs, its progress theirs by length', () => {
        const [launch, design, build, ship, report] = rows(plan)
        expect([launch, design, build, ship, report].map(r => [r!.task.id, r!.depth, r!.parent])).toEqual([
            ['launch', 0, true], ['design', 1, false], ['build', 1, false], ['ship', 0, false], ['report', 0, false],
        ])
        // Dates are whole days, the end's included: Nov 2 to the end of Nov 5.
        expect(design!.bars.map(b => [b.from, b.to])).toEqual([[1, 5]])
        expect(design!.length).toBe(4)
        expect(build!.bars[0]!.to - build!.bars[0]!.from).toBeCloseTo(0.25)
        expect(build!.progress).toBe(100)
        // A date due is due by the end of its day; it's apart from the bar, which ends at `end`.
        expect(build!.dues).toEqual([7])
        expect(launch!.summary).toEqual({from: 1, to: 5.625})
        expect(launch!.progress).toBeCloseTo((50 * 4 + 100 * 0.25) / 4.25)
        // A date alone is its whole day; a time alone a nominal hour (before a due), with no length.
        expect(ship!.bars.map(b => [b.from, b.to])).toEqual([[9, 10]])
        expect(ship!.length).toBe(1)
        expect(report!.bars.map(b => [b.from, b.to, b.nominal])).toEqual([[11 + 17 / 24, 11 + 18 / 24, true]])
        expect(report!.length).toBeUndefined()
    })

    test('a Do and a Due make one bar, Do to the end of Due; a time alone an hour from it', () => {
        const [both, call] = rows([task('both', {start: '2026-11-19', due: '2026-11-20'}), task('call', {start: '2026-11-03T15:00'})])
        expect(both!.bars.map(b => [b.from, b.to])).toEqual([[18, 20]])
        expect(both!.length).toBe(2)
        expect(both!.dues).toEqual([])
        const [trip] = rows([task('trip', {start: '2026-11-17', end: '2026-11-18', due: '2026-11-18'})])
        expect(trip!.dues).toEqual([])
        expect(call!.bars.map(b => [b.from, b.to, b.nominal])).toEqual([[2 + 15 / 24, 2 + 16 / 24, true]])
    })

    test("a folded task's subtasks aren't rows; its summary stays", () => {
        const out = rows(plan, new Set(['launch']))
        expect(out.map(r => r.task.id)).toEqual(['launch', 'ship', 'report'])
        expect(out[0]!.summary).toEqual({from: 1, to: 5.625})
    })
})

test('timelineAxis: a month before the earliest time, to two months after the latest', () => {
    const a = timelineAxis([task('a', {start: '2026-11-20', due: '2027-02-03'})], 'UTC', parseDate('2026-11-18'))
    expect([a.from.toString(), a.to.toString()]).toEqual(['2026-10-01', '2027-05-01'])
})

describe('timelineTicks', () => {
    test('weeks under months, the first week cut at the axis', () => {
        const {major, minor} = timelineTicks(axis, 16, 1)
        expect(major.map(t => [t.day.toString(), t.at, t.width])).toEqual([['2026-11-01', 0, 30], ['2026-12-01', 30, 31]])
        // Nov 1 2026 is a Sunday: its week began on Monday Oct 26.
        expect(minor.slice(0, 2).map(t => [t.day.toString(), t.at, t.width])).toEqual([['2026-10-26', 0, 1], ['2026-11-02', 1, 7]])
        expect(minor.at(-1)!.at + minor.at(-1)!.width).toBe(61)
    })

    test('months under years', () => {
        const {major, minor} = timelineTicks(axis, 4, 1)
        expect(major.map(t => [t.day.toString(), t.at, t.width])).toEqual([['2026-01-01', 0, 61]])
        expect(minor.map(t => t.width)).toEqual([30, 31])
    })

    test('hours under days when close, only those on screen', () => {
        // 960 px a day: a 40 px hour, so every hour; days 3 to 4.5 of the axis on screen.
        const {major, minor} = timelineTicks(axis, 960, 1, [3, 4.5])
        expect(major.map(t => t.day.toString())).toEqual(['2026-11-04', '2026-11-05'])
        expect(minor).toHaveLength(36)
        expect([minor[0]!.hour, minor[0]!.at, minor.at(-1)!.hour]).toEqual([0, 3, 11])
        // 320 px a day: hours by three (40 px each).
        expect(timelineTicks(axis, 320, 1, [0, 1]).minor.map(t => t.hour)).toEqual([0, 3, 6, 9, 12, 15, 18, 21])
    })
})

test('zoom: a view\'s, the scale beside it, the preset it\'s at', () => {
    expect(viewZoom({...view, zoom: 5000})).toBe(1440)
    expect(viewZoom({...view, scale: 'month'})).toBe(4)
    expect(viewZoom(view)).toBe(16)
    expect([scaleOf(960), scaleOf(16), scaleOf(3)]).toEqual(['day', 'week', 'month'])
    expect([presetOf(50), presetOf(30), presetOf(900)]).toEqual(['days', undefined, 'hours'])
})

test("linkPath: straight on when the next starts after, around between the rows when it doesn't", () => {
    expect(linkPath(100, 18, 140, 54, 36)).toBe('M100 18H108V54H140')
    expect(linkPath(100, 18, 90, 54, 36)).toBe('M100 18H108V36H82V54H90')
})
