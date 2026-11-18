import {parseDate} from '@internationalized/date'
import {resolveFields, type Task, type TaskDocument, type View} from '@type32/tasks'
import {describe, expect, test} from 'vitest'
import {applyPatch, toggleDone, withDue, withStart} from './changes'
import {defaultLabels} from './labels'
import {type Row, taskRows} from './rows'

const at = '2026-11-18T10:00:00Z'
const task = (id: string, extra: Partial<Task> = {}): Task => ({id, title: id, updatedAt: at, ...extra})
const view = (extra: Partial<View> = {}): View => ({id: 'v', title: 'V', type: 'list', updatedAt: at, ...extra})

function rows(doc: TaskDocument, v: View, timeZone = 'Europe/Berlin'): string[] {
    const options = {fields: resolveFields(doc), labels: defaultLabels, today: parseDate('2026-11-18'), timeZone}
    return taskRows(doc, v, options).map((r: Row) => (r.kind === 'section' ? `# ${r.label}` : `${'  '.repeat(r.depth)}${r.task.id}`))
}

describe('taskRows', () => {
    test('by date: overdue in Today, Upcoming by day, Anytime, Done with cancelled; a subtask under its parent', () => {
        const doc: TaskDocument = {
            version: '1.1',
            tasks: [
                task('later', {due: '2026-11-25'}),
                task('soon', {start: '2026-11-19'}),
                task('overdue', {due: '2026-11-10'}),
                task('free'),
                task('sub', {parentId: 'free', due: '2026-11-18'}),
                task('shipped', {values: {status: 'done'}}),
                task('dropped', {values: {status: 'cancelled'}}),
            ],
        }
        expect(rows(doc, view())).toEqual(['# Today', 'overdue', '# Upcoming', 'soon', 'later', '# Anytime', 'free', '  sub', '# Done', 'shipped', 'dropped'])
    })

    test("a zoned time is on the viewer's day", () => {
        // 01:00 in Tokyo on the 19th is still the 18th in Berlin.
        const doc: TaskDocument = {version: '1.1', tasks: [task('call', {due: '2026-11-19T01:00', timeZone: 'Asia/Tokyo'})]}
        expect(rows(doc, view())).toEqual(['# Today', 'call'])
        expect(rows(doc, view(), 'Asia/Tokyo')).toEqual(['# Upcoming', 'call'])
    })

    test("by a multiSelect: a task in each of its values' groups, open values after the options, then none", () => {
        const doc: TaskDocument = {
            version: '1.1',
            fields: [{id: 'tags', options: [{id: 'work', title: 'Work', updatedAt: at}]}],
            tasks: [task('a', {values: {tags: ['home', 'work']}}), task('b')],
        }
        expect(rows(doc, view({groupBy: 'values.tags'}))).toEqual(['# Work', 'a', '# home', 'a', '# None', 'b'])
    })

    test('by status: no status is to do', () => {
        const doc: TaskDocument = {version: '1.1', tasks: [task('a'), task('b', {values: {status: 'doing'}})]}
        expect(rows(doc, view({groupBy: 'values.status'}))).toEqual(['# To do', 'a', '# In progress', 'b'])
    })
})

describe('changes', () => {
    test('a span moved to another day keeps its time and length', () => {
        const t = task('m', {start: '2026-11-18T09:30', end: '2026-11-20T10:00'})
        expect(withStart(t, '2026-11-25')).toEqual({start: '2026-11-25T09:30', end: '2026-11-27T10:00'})
    })

    test('clearing Do makes a todo, and a rule anchored on it goes', () => {
        const t = task('m', {start: '2026-11-18', duration: 'P1D', recurrence: {freq: 'weekly'}, excludedDates: ['2026-11-25']})
        const next = applyPatch(t, withStart(t, undefined), at)
        expect(next).toEqual({id: 'm', title: 'm', updatedAt: at})
    })

    test("a time added to a repeating todo's due drops what had the date's form", () => {
        const t = task('m', {due: '2026-11-18', recurrence: {freq: 'daily', until: '2026-12-01'}, excludedDates: ['2026-11-19']})
        expect(applyPatch(t, withDue(t, '2026-11-18T09:00'), at)).toEqual(task('m', {due: '2026-11-18T09:00', recurrence: {freq: 'daily'}}))
    })

    test('the checkbox moves a weekly task to next week, and reopens a done one', () => {
        const fields = resolveFields({})
        const weekly = task('w', {due: '2026-11-18', recurrence: {freq: 'weekly'}})
        expect(applyPatch(weekly, toggleDone(weekly, fields, at), at).due).toBe('2026-11-25')
        const done = task('d', {values: {status: 'done'}, completedAt: at})
        expect(applyPatch(done, toggleDone(done, fields, at), at)).toEqual(task('d', {values: {status: 'todo'}}))
    })
})
