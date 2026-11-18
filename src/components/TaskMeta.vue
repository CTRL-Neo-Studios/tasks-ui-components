<script setup lang="ts">
/** What describes a task, small: repeat, its list, tags, star, priority, Do and Due (red when overdue). */
import type {CalendarDate} from '@internationalized/date'
import UIcon from '@nuxt/ui/components/Icon.vue'
import {type Fields, isOverdue, type List, priorityOf, type Task} from '@type32/tasks'
import {computed} from 'vue'
import {formatTime} from '../dates'
import {PRIORITY_CLASS} from '../fieldText'
import {useLabels} from '../labels'

const props = defineProps<{
    task: Task
    fields: Fields
    list?: List
    today: CalendarDate
    timeZone: string
    locale?: string
}>()
const labels = useLabels(() => undefined)
const late = computed(() => isOverdue(props.task, props.fields, {timeZone: props.timeZone}))
const flame = computed(() => PRIORITY_CLASS[priorityOf(props.task, props.fields) ?? ''])
const tags = computed(() => {
    const v = props.task.values?.tags
    return Array.isArray(v) ? v.slice(0, 3) : []
})
</script>

<template>
  <span class="tk:flex tk:flex-wrap tk:items-center tk:gap-2 tk:text-sm tk:text-muted">
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
