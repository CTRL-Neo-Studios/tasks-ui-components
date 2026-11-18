import {resolveFields, statusOf, type Task, type TaskDocument, validate} from '@type32/tasks'
import {expect, test} from 'vitest'
import {moveTask, moveToGroup, optionId, withOption} from './board'
import {applyPatch} from './changes'
import {NONE} from './rows'

const at = '2026-11-18T10:00:00Z'
const task = (id: string, extra: Partial<Task> = {}): Task => ({id, title: id, updatedAt: at, ...extra})
const move = (doc: TaskDocument, t: Task, groupBy: string, from: string, to: string) =>
    applyPatch(t, moveToGroup(t, groupBy, resolveFields(doc), from, to, at), at)

test('a card dropped on Done is done, with when; taken back, it is open again', () => {
    const doc: TaskDocument = {version: '1.1', tasks: []}
    const done = move(doc, task('a'), 'values.status', 'todo', 'done')
    expect(done).toEqual(task('a', {values: {status: 'done'}, completedAt: at}))
    expect(move(doc, done, 'values.status', 'done', 'doing')).toEqual(task('a', {values: {status: 'doing'}}))
})

test("a custom done status is kept, and any reader of the format knows it's done", () => {
    const added = withOption({version: '1.1', tasks: [task('a')]}, 'status', 'shipped', {title: 'Shipped', category: 'done'}, at)
    expect(added.fields).toEqual([{id: 'status', options: [{id: 'shipped', title: 'Shipped', category: 'done', updatedAt: at}]}])
    const doc = {...added, tasks: [move(added, task('a'), 'values.status', 'todo', 'shipped')]}
    expect(() => validate(doc)).not.toThrow()
    expect(doc.tasks[0]!.values).toEqual({status: 'shipped'})
    expect(statusOf(doc.tasks[0]!, resolveFields(doc))).toBe('done')
})

test('renaming a built-in status is an option of its own id with a title', () => {
    const doc = withOption({version: '1.1', tasks: []}, 'status', 'todo', {title: 'Backlog'}, at)
    expect(() => validate(doc)).not.toThrow()
    expect(resolveFields(doc).status!.options[0]).toMatchObject({id: 'todo', title: 'Backlog', category: 'todo'})
})

test('a multiSelect swaps the value of the column left; None clears it', () => {
    const doc: TaskDocument = {version: '1.1', tasks: []}
    const t = task('a', {values: {tags: ['home', 'work']}})
    expect(move(doc, t, 'values.tags', 'home', 'errands').values).toEqual({tags: ['work', 'errands']})
    expect(move(doc, t, 'values.tags', 'home', NONE).values).toEqual({tags: ['work']})
})

test('lists, stars', () => {
    const doc: TaskDocument = {version: '1.1', tasks: []}
    expect(move(doc, task('a', {listId: 'x'}), 'listId', 'x', NONE)).toEqual(task('a'))
    expect(move(doc, task('a'), 'starred', 'false', 'true').starred).toBe(true)
})

test('moveTask puts a task before another, or last', () => {
    const doc: TaskDocument = {version: '1.1', tasks: [task('a'), task('b'), task('c')]}
    expect(moveTask(doc, 'c', 'a').tasks.map(t => t.id)).toEqual(['c', 'a', 'b'])
    expect(moveTask(doc, 'a').tasks.map(t => t.id)).toEqual(['b', 'c', 'a'])
})

test('optionId', () => {
    expect(optionId('Waiting on client!', [])).toBe('waiting-on-client')
    expect(optionId('Done', ['done'])).toBe('done-2')
    expect(optionId('进行中', [])).toBe('进行中')
})
