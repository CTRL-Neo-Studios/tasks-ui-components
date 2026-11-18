<script setup lang="ts">
/**
 * One task in the list: its checkbox, title and what describes it (repeat, list, star, priority, tags, Do, Due). Open,
 * it's the task's editor in a card.
 */
import type {CalendarDate} from '@internationalized/date'
import UIcon from '@nuxt/ui/components/Icon.vue'
import {type Fields, isComplete, isOpen, isOverdue, type List, priorityOf, type Task, type TaskDocument} from '@type32/tasks'
import {computed} from 'vue'
import {type TaskPatch, toggleDone} from '../changes'
import {formatTime} from '../dates'
import {PRIORITY_CLASS} from '../fieldText'
import {useLabels} from '../labels'
import TaskEditor from './TaskEditor.vue'

const props = defineProps<{
    task: Task
    depth: number
    open: boolean
    document: TaskDocument
    fields: Fields
    list?: List
    today: CalendarDate
    timeZone: string
    locale?: string
    weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
}>()
const emit = defineEmits<{ change: [patch: TaskPatch], create: [task: Task], open: [], close: [] }>()
defineSlots<{ notes?(props: { task: Task, text: string, update: (text: string) => void }): unknown }>()
const labels = useLabels(() => undefined)

const closed = computed(() => !isOpen(props.task, props.fields))
const done = computed(() => isComplete(props.task, props.fields))
const late = computed(() => isOverdue(props.task, props.fields, {timeZone: props.timeZone}))
const flame = computed(() => PRIORITY_CLASS[priorityOf(props.task, props.fields) ?? ''])
const tags = computed(() => {
    const v = props.task.values?.tags
    return Array.isArray(v) ? v.slice(0, 3) : []
})
</script>

<template>
  <div
    class="tk:flex tk:items-start tk:gap-3 tk:px-3"
    :class="open
      ? 'tk:my-1 tk:rounded-lg tk:border tk:border-default tk:bg-default tk:py-3 tk:shadow-sm'
      : 'tk:cursor-default tk:rounded-md tk:py-1.5 tk:hover:bg-elevated/60'"
    :style="{marginInlineStart: `${depth * 1.5}rem`}"
    @click="!open && emit('open')"
  >
    <button
      type="button"
      class="tk:mt-0.5 tk:flex tk:size-5 tk:shrink-0 tk:items-center tk:justify-center tk:rounded-full tk:border tk:transition-colors"
      :class="closed ? 'tk:border-primary tk:bg-primary tk:text-inverted' : 'tk:border-accented tk:hover:border-primary'"
      :aria-label="closed ? labels.reopen : labels.complete"
      :aria-pressed="closed"
      @click.stop="emit('change', toggleDone(task, fields, new Date().toISOString()))"
    >
      <UIcon v-if="closed" :name="done ? 'i-lucide-check' : 'i-lucide-x'" class="tk:size-3.5" />
    </button>
    <TaskEditor
      v-if="open"
      :task="task"
      :document="document"
      :fields="fields"
      :today="today"
      :time-zone="timeZone"
      :locale="locale"
      :week-starts-on="weekStartsOn"
      @change="emit('change', $event)"
      @create="emit('create', $event)"
      @close="emit('close')"
    >
      <template v-if="$slots.notes" #notes="scope">
        <slot name="notes" v-bind="scope" />
      </template>
    </TaskEditor>
    <template v-else>
      <span class="tk:min-w-0 tk:flex-1 tk:truncate" :class="closed ? 'tk:text-muted tk:line-through' : 'tk:text-default'">
        {{ task.title || labels.newTask }}
      </span>
      <span class="tk:flex tk:shrink-0 tk:items-center tk:gap-2 tk:text-sm tk:text-muted">
        <UIcon v-if="task.recurrence" name="i-lucide-repeat" class="tk:size-3.5" />
        <span v-if="list" class="tk:flex tk:items-center tk:gap-1.5">
          <span class="tk:size-2 tk:rounded-full tk:bg-accented" :style="list.color && {backgroundColor: list.color}" />
          {{ list.title }}
        </span>
        <span v-for="tag in tags" :key="tag">#{{ tag }}</span>
        <UIcon v-if="task.starred" name="i-lucide-star" class="tk:size-4 tk:text-warning" />
        <UIcon v-if="flame" name="i-lucide-flame" class="tk:size-4" :class="flame" />
        <span v-if="task.start" class="tk:rounded-md tk:border tk:border-default tk:px-1.5 tk:text-xs">
          {{ labels.do }} {{ formatTime(task.start, locale, today) }}
        </span>
        <span v-if="task.due" class="tk:rounded-md tk:border tk:px-1.5 tk:text-xs" :class="late ? 'tk:border-error/50 tk:text-error' : 'tk:border-default tk:text-default'">
          {{ formatTime(task.due, locale, today) }}
        </span>
      </span>
    </template>
  </div>
</template>
