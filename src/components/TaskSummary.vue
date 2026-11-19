<script setup lang="ts">
/**
 * One task drawn as the list draws a row, to look at only: its checkbox (done or not), title, what describes it
 * (TaskMeta) and the start of its notes. Nothing in it acts.
 */
import {getLocalTimeZone, today as todayIn} from '@internationalized/date'
import {type Fields, isOpen, type List, resolveFields, type Task} from '@type32/tasks'
import {computed} from 'vue'
import {type TaskLabels, useLabels} from '../labels'
import TaskCheck from './TaskCheck.vue'
import TaskMeta from './TaskMeta.vue'

const props = withDefaults(defineProps<{
    task: Task
    /** Its document's fields; default the built-in ones. */
    fields?: Fields
    list?: List
    /** The viewer's; default the system's. */
    timeZone?: string
    locale?: string
    labels?: Partial<TaskLabels>
}>(), {fields: undefined, list: undefined, timeZone: undefined, locale: undefined, labels: undefined})

const labels = useLabels(() => props.labels)
const resolved = computed(() => props.fields ?? resolveFields({}))
const zone = computed(() => props.timeZone ?? getLocalTimeZone())
const today = computed(() => todayIn(zone.value))
</script>

<template>
  <div class="tk:flex tk:items-start tk:gap-3" data-task-summary>
    <TaskCheck :task="task" :fields="resolved" disabled />
    <div class="tk:flex tk:min-w-0 tk:flex-1 tk:flex-col tk:gap-1">
      <span class="tk:break-words" :class="isOpen(task, resolved) ? 'tk:text-default' : 'tk:text-muted tk:line-through'">
        {{ task.title || labels.newTask }}
      </span>
      <TaskMeta :task="task" :fields="resolved" :list="list" :today="today" :time-zone="zone" :locale="locale" />
      <p v-if="task.notes" class="tk:line-clamp-3 tk:whitespace-pre-wrap tk:text-sm tk:text-muted">{{ task.notes }}</p>
    </div>
  </div>
</template>
