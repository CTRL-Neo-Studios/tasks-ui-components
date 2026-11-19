<script setup lang="ts">
/** A task on the board: its checkbox, title and what describes it; a click opens its editor beside it. */
import type {CalendarDate} from '@internationalized/date'
import UPopover from '@nuxt/ui/components/Popover.vue'
import {type FieldOption, type Fields, isOpen, type List, type Task, type TaskDocument} from '@type32/tasks'
import {ref} from 'vue'
import type {TaskPatch} from '../changes'
import {useLabels} from '../labels'
import TaskCheck from './TaskCheck.vue'
import TaskEditor from './TaskEditor.vue'
import TaskMeta from './TaskMeta.vue'

defineProps<{
    task: Task
    document: TaskDocument
    fields: Fields
    list?: List
    today: CalendarDate
    timeZone: string
    locale?: string
    weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
}>()
const emit = defineEmits<{ change: [patch: TaskPatch], create: [task: Task], createOption: [field: string, option: FieldOption] }>()
defineSlots<{ notes?(props: { task: Task, text: string, update: (text: string) => void }): unknown }>()
const labels = useLabels(() => undefined)
const open = ref(false)
// `draggable`, `@dragstart` and data attributes are the card's, not the popover's.
defineOptions({inheritAttrs: false})
</script>

<template>
  <UPopover v-model:open="open" :content="{side: 'right', align: 'start', sideOffset: 8}">
    <div
      v-bind="$attrs"
      class="tk:flex tk:cursor-default tk:flex-col tk:gap-1.5 tk:rounded-lg tk:border tk:border-default tk:bg-default tk:p-2.5 tk:shadow-xs tk:hover:border-accented"
      :class="open && 'tk:ring-2 tk:ring-primary'"
    >
      <div class="tk:flex tk:items-start tk:gap-2">
        <TaskCheck :task="task" :fields="fields" @change="emit('change', $event)" />
        <span class="tk:line-clamp-3 tk:min-w-0 tk:flex-1 tk:text-sm" :class="isOpen(task, fields) ? 'tk:text-highlighted' : 'tk:text-muted tk:line-through'">
          {{ task.title || labels.newTask }}
        </span>
      </div>
      <TaskMeta class="tk:ps-7 tk:text-xs" :task="task" :fields="fields" :list="list" :today="today" :time-zone="timeZone" :locale="locale" />
    </div>
    <template #content>
      <div class="tk:w-md tk:max-w-[90vw] tk:p-3">
        <TaskEditor
          :task="task"
          :document="document"
          :fields="fields"
          :today="today"
          :time-zone="timeZone"
          :locale="locale"
          :week-starts-on="weekStartsOn"
          @change="emit('change', $event)"
          @create="emit('create', $event)"
          @create-option="(field: string, option: FieldOption) => emit('createOption', field, option)"
          @close="open = false"
        >
          <template v-if="$slots.notes" #notes="scope">
            <slot name="notes" v-bind="scope" />
          </template>
        </TaskEditor>
      </div>
    </template>
  </UPopover>
</template>
