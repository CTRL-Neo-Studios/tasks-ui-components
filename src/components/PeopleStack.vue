<script setup lang="ts">
/** A task's assignees as overlapping initials circles, the first `max`, then `+n`; each named on hover. */
import {computed} from 'vue'
import {type Person, textOn} from '../people'

const props = withDefaults(defineProps<{ people: Person[], max?: number, size?: number }>(), {max: 3, size: 20})
const shown = computed(() => props.people.slice(0, props.max))
const more = computed(() => props.people.length - shown.value.length)
const circle = computed(() => ({width: `${props.size}px`, height: `${props.size}px`, fontSize: `${Math.round(props.size * 0.45)}px`}))
</script>

<template>
  <span v-if="people.length" class="tk:flex tk:shrink-0 tk:-space-x-1.5" data-people>
    <span
      v-for="person in shown"
      :key="person.id"
      class="tk:flex tk:items-center tk:justify-center tk:rounded-full tk:font-semibold tk:ring-2 tk:ring-default"
      :style="{...circle, backgroundColor: person.color ?? 'var(--ui-bg-accented)', color: person.color ? textOn(person.color) : 'var(--ui-text-highlighted)'}"
      :title="person.name"
    >{{ person.initials }}</span>
    <span
      v-if="more > 0"
      class="tk:flex tk:items-center tk:justify-center tk:rounded-full tk:bg-elevated tk:font-semibold tk:text-muted tk:ring-2 tk:ring-default"
      :style="circle"
    >+{{ more }}</span>
  </span>
</template>
