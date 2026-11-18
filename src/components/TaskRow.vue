<script setup lang="ts">
/** One task in the list: its checkbox, title and what describes it. Open, it's the task's editor in a card. */
import type {CalendarDate} from '@internationalized/date'
import {type Fields, isOpen, type List, type Task, type TaskDocument} from '@type32/tasks'
import type {TaskPatch} from '../changes'
import {useLabels} from '../labels'
import TaskCheck from './TaskCheck.vue'
import TaskEditor from './TaskEditor.vue'
import TaskMeta from './TaskMeta.vue'

defineProps<{
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
    <TaskCheck :task="task" :fields="fields" @change="emit('change', $event)" />
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
      <span class="tk:min-w-0 tk:flex-1 tk:truncate" :class="isOpen(task, fields) ? 'tk:text-default' : 'tk:text-muted tk:line-through'">
        {{ task.title || labels.newTask }}
      </span>
      <TaskMeta class="tk:shrink-0 tk:flex-nowrap" :task="task" :fields="fields" :list="list" :today="today" :time-zone="timeZone" :locale="locale" />
    </template>
  </div>
</template>
