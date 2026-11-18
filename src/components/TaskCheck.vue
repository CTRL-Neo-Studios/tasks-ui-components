<script setup lang="ts">
/** A task's round checkbox: completes it (a repeating one moves on), or reopens a done or cancelled one. */
import UIcon from '@nuxt/ui/components/Icon.vue'
import {type Fields, isComplete, isOpen, type Task} from '@type32/tasks'
import {computed} from 'vue'
import {type TaskPatch, toggleDone} from '../changes'
import {useLabels} from '../labels'

const props = defineProps<{ task: Task, fields: Fields }>()
const emit = defineEmits<{ change: [patch: TaskPatch] }>()
const labels = useLabels(() => undefined)
const closed = computed(() => !isOpen(props.task, props.fields))
</script>

<template>
  <button
    type="button"
    class="tk:mt-0.5 tk:flex tk:size-5 tk:shrink-0 tk:items-center tk:justify-center tk:rounded-full tk:border tk:transition-colors"
    :class="closed ? 'tk:border-primary tk:bg-primary tk:text-inverted' : 'tk:border-accented tk:hover:border-primary'"
    :aria-label="closed ? labels.reopen : labels.complete"
    :aria-pressed="closed"
    @click.stop="emit('change', toggleDone(task, fields, new Date().toISOString()))"
  >
    <UIcon v-if="closed" :name="isComplete(task, fields) ? 'i-lucide-check' : 'i-lucide-x'" class="tk:size-3.5" />
  </button>
</template>
