import {resolveFields, type TaskDocument} from '@type32/tasks'
import {expect, test} from 'vitest'
import {assigneesOf, initials, taskColor, textOn} from './people'

const at = '2026-11-19T10:00:00Z'

test('a task\'s colour, its list\'s, or none; text that reads on it', () => {
    const lists = [{id: 'home', title: 'Home', color: '#22c55e', updatedAt: at}]
    expect(taskColor({id: 'a', title: 'A', color: '#ef4444', listId: 'home', updatedAt: at}, lists)).toBe('#ef4444')
    expect(taskColor({id: 'b', title: 'B', listId: 'home', updatedAt: at}, new Map(lists.map(l => [l.id, l])))).toBe('#22c55e')
    expect(taskColor({id: 'c', title: 'C', updatedAt: at}, lists)).toBeUndefined()
    expect([textOn('#fde68a'), textOn('#1e3a8a'), textOn('var(--ui-primary)')]).toEqual(['#111', '#fff', '#fff'])
})

test('assignees by their options, initials from names', () => {
    const doc: TaskDocument = {
        version: '1.2',
        fields: [{id: 'assignees', options: [{id: 'ada', title: 'Ada Lovelace', color: '#a855f7', updatedAt: at}]}],
        tasks: [{id: 't', title: 'T', values: {assignees: ['ada']}, updatedAt: at}],
    }
    expect(assigneesOf(doc.tasks[0]!, resolveFields(doc))).toEqual([{id: 'ada', name: 'Ada Lovelace', initials: 'AL', color: '#a855f7'}])
    expect([initials('grace'), initials('  Linus  Torvalds Jr '), initials('张三')]).toEqual(['GR', 'LT', '张三'])
})
