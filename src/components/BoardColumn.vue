<script setup lang="ts">
/**
 * A column of the board: its header (title, count, menu), its cards (only those on screen drawn), and New task at
 * its foot. A card dropped on it reports where it came from and, while the board keeps its own order, which card it
 * went before (`drop`).
 */
import type {CalendarDate} from '@internationalized/date'
import UButton from '@nuxt/ui/components/Button.vue'
import type {DropdownMenuItem} from '@nuxt/ui/components/DropdownMenu.vue'
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import {useVirtualizer} from '@tanstack/vue-virtual'
import type {FieldOption, Fields, List, Task, TaskDocument} from '@type32/tasks'
import {computed, ref, useTemplateRef} from 'vue'
import type {TaskPatch} from '../changes'
import {useLabels} from '../labels'
import type {Group} from '../rows'
import TaskCard from './TaskCard.vue'

const props = defineProps<{
    group: Group
    document: TaskDocument
    fields: Fields
    /** A card's list, when its column doesn't already say it. */
    listOf: (task: Task) => List | undefined
    /** Cards keep the order they're dropped in (the view doesn't sort). */
    ordered: boolean
    menu?: DropdownMenuItem[][]
    renaming?: boolean
    today: CalendarDate
    timeZone: string
    locale?: string
    weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
}>()
const emit = defineEmits<{
    change: [id: string, patch: TaskPatch]
    create: [task: Task]
    createOption: [field: string, option: FieldOption]
    /** A card dropped here: `from` its column's key, `before` the card it now precedes (none: last). */
    drop: [id: string, from: string, before: string | undefined]
    /** New task typed at the foot. */
    add: [title: string]
    /** The header's new title; `undefined` cancels. */
    rename: [title: string | undefined]
}>()
defineSlots<{ notes?(props: { task: Task, text: string, update: (text: string) => void }): unknown }>()
const labels = useLabels(() => undefined)

const CARD = 'application/x-tasks-card'
const scroller = useTemplateRef<HTMLElement>('scroller')
const virtualizer = useVirtualizer(computed(() => ({
    count: props.group.tasks.length,
    getScrollElement: () => scroller.value,
    estimateSize: () => 72,
    getItemKey: (i: number) => props.group.tasks[i]!.id,
    overscan: 6,
})))
const measure = (el: unknown) => {
    if (el instanceof Element) virtualizer.value.measureElement(el)
}

const over = ref(false)
/** The card a drop would go before; `null` while nothing is dragged over, `undefined` for the end. */
const before = ref<string | undefined | null>(null)
function dragStart(event: DragEvent, task: Task) {
    event.dataTransfer?.setData(CARD, `${task.id}\u0000${props.group.key}`)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function dragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes(CARD)) return
    event.preventDefault()
    over.value = true
    if (!props.ordered) return
    // The first card drawn whose middle is below the pointer; past them, the first card not drawn yet, or the end.
    const cards = [...(scroller.value?.querySelectorAll<HTMLElement>('[data-card]') ?? [])]
    const hit = cards.find(el => {
        const box = el.getBoundingClientRect()
        return event.clientY < box.top + box.height / 2
    })
    const last = Math.max(-1, ...virtualizer.value.getVirtualItems().map(i => i.index))
    before.value = hit?.dataset.card ?? props.group.tasks[last + 1]?.id
}
function dragLeave(event: DragEvent) {
    if ((event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) return
    over.value = false
    before.value = null
}
function drop(event: DragEvent) {
    const data = event.dataTransfer?.getData(CARD)
    const target = before.value
    over.value = false
    before.value = null
    if (!data) return
    event.preventDefault()
    const [id, from] = data.split('\u0000') as [string, string]
    emit('drop', id, from, target ?? undefined)
}

const adding = ref(false)
const draft = ref('')
function add() {
    const title = draft.value.trim()
    draft.value = ''
    if (title) emit('add', title)
    else adding.value = false
}
const focus = (el: unknown) => (el as HTMLInputElement | null)?.focus()
function commitName(event: Event) {
    const title = (event.target as HTMLInputElement).value.trim()
    emit('rename', title && title !== props.group.label ? title : undefined)
}
</script>

<template>
  <div
    class="tk:flex tk:min-h-0 tk:w-72 tk:shrink-0 tk:flex-col tk:rounded-xl tk:bg-elevated/50"
    :class="over && 'tk:ring-2 tk:ring-primary/60'"
    :data-column="group.key"
    @dragover="dragOver"
    @dragleave="dragLeave"
    @drop="drop"
  >
    <div class="tk:group tk:flex tk:h-11 tk:shrink-0 tk:items-center tk:gap-2 tk:px-3 tk:text-sm">
      <span v-if="group.color" class="tk:size-2.5 tk:shrink-0 tk:rounded-full" :style="{backgroundColor: group.color}" />
      <input
        v-if="renaming"
        :ref="focus"
        :value="group.label"
        class="tk:min-w-0 tk:flex-1 tk:rounded-md tk:bg-default tk:px-1.5 tk:py-0.5 tk:font-semibold tk:outline-none"
        @keydown.enter="commitName"
        @keydown.esc="emit('rename', undefined)"
        @blur="commitName"
      >
      <span v-else class="tk:truncate tk:font-semibold tk:text-highlighted">{{ group.label }}</span>
      <span class="tk:shrink-0 tk:text-muted">{{ group.tasks.length }}</span>
      <span class="tk:grow" />
      <UDropdownMenu v-if="menu" :items="menu">
        <UTooltip :text="labels.more">
          <UButton icon="i-lucide-ellipsis" size="xs" variant="ghost" color="neutral" class="tk:invisible tk:group-hover:visible" :aria-label="labels.more" />
        </UTooltip>
      </UDropdownMenu>
    </div>
    <div ref="scroller" class="tk:min-h-0 tk:flex-1 tk:overflow-y-auto tk:px-2">
      <div class="tk:relative tk:w-full" :style="{height: `${virtualizer.getTotalSize()}px`}">
        <div
          v-for="item in virtualizer.getVirtualItems()"
          :key="String(item.key)"
          :ref="measure"
          :data-index="item.index"
          :data-card="group.tasks[item.index]!.id"
          class="tk:absolute tk:start-0 tk:top-0 tk:w-full tk:pb-2"
          :style="{transform: `translateY(${item.start}px)`}"
        >
          <div v-if="before === group.tasks[item.index]!.id" class="tk:absolute tk:inset-x-1 tk:-top-1 tk:h-0.5 tk:rounded-full tk:bg-primary" />
          <TaskCard
            :task="group.tasks[item.index]!"
            :document="document"
            :fields="fields"
            :list="listOf(group.tasks[item.index]!)"
            :today="today"
            :time-zone="timeZone"
            :locale="locale"
            :week-starts-on="weekStartsOn"
            draggable="true"
            :data-task="group.tasks[item.index]!.id"
            @dragstart="dragStart($event, group.tasks[item.index]!)"
            @change="emit('change', group.tasks[item.index]!.id, $event)"
            @create="emit('create', $event)"
            @create-option="(field: string, option: FieldOption) => emit('createOption', field, option)"
          >
            <template v-if="$slots.notes" #notes="scope">
              <slot name="notes" v-bind="scope" />
            </template>
          </TaskCard>
        </div>
      </div>
      <div v-if="over && ordered && before === undefined" class="tk:mx-1 tk:mb-2 tk:h-0.5 tk:rounded-full tk:bg-primary" />
    </div>
    <div class="tk:shrink-0 tk:p-2">
      <input
        v-if="adding"
        :ref="focus"
        v-model="draft"
        :placeholder="labels.newTask"
        class="tk:w-full tk:rounded-lg tk:border tk:border-default tk:bg-default tk:p-2 tk:text-sm tk:outline-none"
        data-task-new
        @keydown.enter="add"
        @keydown.esc="adding = false"
        @blur="adding = false"
      >
      <UButton v-else icon="i-lucide-plus" size="sm" variant="ghost" color="neutral" :label="labels.newTask" @click="adding = true" />
    </div>
  </div>
</template>
