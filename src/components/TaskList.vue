<script setup lang="ts">
/**
 * A list view of a document: a new task typed at the top, the view's tasks in sections (`taskRows`), one open for
 * editing at a time, the lists in a column beside them. Only the rows on screen are drawn, so a long list scrolls as a
 * short one. Reports what the user does (`change`, `create`, `changeList`, `createList`); writes nothing.
 */
import {getLocalTimeZone, today as todayIn} from '@internationalized/date'
import UButton from '@nuxt/ui/components/Button.vue'
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import {useVirtualizer} from '@tanstack/vue-virtual'
import {isOpen, type List, resolveFields, type Task, type TaskDocument, type View} from '@type32/tasks'
import {computed, nextTick, ref, useTemplateRef} from 'vue'
import type {Patch, TaskPatch} from '../changes'
import {type TaskLabels, useLabels} from '../labels'
import {listAndNested, taskRows} from '../rows'
import TaskRow from './TaskRow.vue'

const props = withDefaults(defineProps<{
    document: TaskDocument
    view: View
    /** The viewer's IANA zone, which decides what's today. Default: the system's. */
    timeZone?: string
    locale?: string
    /** 0 is Sunday. */
    weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
    labels?: Partial<TaskLabels>
    /** The lists column; it hides itself where the list is narrow. */
    showLists?: boolean
}>(), {timeZone: undefined, locale: undefined, weekStartsOn: undefined, labels: undefined, showLists: true})
const emit = defineEmits<{
    change: [id: string, patch: TaskPatch]
    create: [task: Task]
    changeList: [id: string, patch: Patch<List>]
    createList: [list: List]
}>()
defineSlots<{ notes?(props: { task: Task, text: string, update: (text: string) => void }): unknown }>()
const labels = useLabels(() => props.labels)

const zone = computed(() => props.timeZone ?? getLocalTimeZone())
const today = computed(() => todayIn(zone.value))
const fields = computed(() => resolveFields(props.document))
const lists = computed(() => (props.document.lists ?? []).filter(l => !l.deletedAt))
const listById = computed(() => new Map((props.document.lists ?? []).map(l => [l.id, l])))
const listId = ref<string>()
const openId = ref<string>()

const rows = computed(() => taskRows(props.document, props.view, {
    fields: fields.value,
    labels: labels.value,
    today: today.value,
    timeZone: zone.value,
    listId: listId.value,
}))
// A row names its list unless the list it's under already says it.
const showListOnRows = computed(() => listId.value === undefined && props.view.groupBy !== 'listId')

const scroller = useTemplateRef<HTMLElement>('scroller')
const virtualizer = useVirtualizer(computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scroller.value,
    estimateSize: (i: number) => (rows.value[i]?.kind === 'section' ? 40 : 36),
    getItemKey: (i: number) => rows.value[i]!.key,
    overscan: 12,
})))
const measure = (el: unknown) => {
    if (el instanceof Element) virtualizer.value.measureElement(el)
}

const now = () => new Date().toISOString()
const newTitle = ref('')
function create(task: Task) {
    emit('create', task)
    void nextTick(() => (openId.value = task.id))
}
function createTyped() {
    const title = newTitle.value.trim()
    if (!title) return
    newTitle.value = ''
    emit('create', {id: crypto.randomUUID(), title, ...(listId.value !== undefined && {listId: listId.value}), updatedAt: now()})
}

// The lists column: each list with how many of its tasks (and its sublists') are still open.
const openCounts = computed(() => {
    const counts = new Map<string, number>()
    for (const task of props.document.tasks) {
        if (task.listId !== undefined && isOpen(task, fields.value)) counts.set(task.listId, (counts.get(task.listId) ?? 0) + 1)
    }
    return counts
})
const countOf = (id: string) => [...listAndNested(lists.value, id)].reduce((n, l) => n + (openCounts.value.get(l) ?? 0), 0)
/** Lists in their tree: each after its parent, indented by depth. */
const listTree = computed(() => {
    const ids = new Set(lists.value.map(l => l.id))
    const out: { list: List, depth: number }[] = []
    const add = (list: List, depth: number) => {
        out.push({list, depth})
        for (const child of lists.value) if (child.parentId === list.id) add(child, depth + 1)
    }
    // A list whose parent is deleted is at the top.
    for (const list of lists.value) if (list.parentId === undefined || !ids.has(list.parentId)) add(list, 0)
    return out
})
const focus = (el: unknown) => (el as HTMLInputElement | null)?.focus()
const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#64748b']
const naming = ref<string | 'new'>()
const nameDraft = ref('')
function startNaming(id: string | 'new', current = '') {
    naming.value = id
    nameDraft.value = current
}
function commitName() {
    const title = nameDraft.value.trim()
    const id = naming.value
    naming.value = undefined
    if (!title || id === undefined) return
    if (id !== 'new') return emit('changeList', id, {title})
    const list: List = {id: crypto.randomUUID(), title, color: COLORS[lists.value.length % COLORS.length], updatedAt: now()}
    emit('createList', list)
    listId.value = list.id
}
const listMenu = (list: List) => [
    [{label: labels.value.rename, icon: 'i-lucide-pencil', onSelect: () => startNaming(list.id, list.title)}],
    [{
        label: labels.value.color,
        icon: 'i-lucide-palette',
        children: COLORS.map(color => ({
            label: color,
            type: 'checkbox' as const,
            checked: list.color === color,
            onUpdateChecked: () => emit('changeList', list.id, {color}),
        })),
    }],
    [{
        label: labels.value.delete,
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => {
            if (listId.value === list.id) listId.value = undefined
            emit('changeList', list.id, {deletedAt: now()})
        },
    }],
]
</script>

<template>
  <div class="tk:@container tk:flex tk:h-full tk:min-h-0">
    <nav v-if="showLists" class="tk:hidden tk:w-52 tk:shrink-0 tk:flex-col tk:gap-0.5 tk:overflow-y-auto tk:border-e tk:border-default tk:p-2 tk:@2xl:flex">
      <button
        type="button"
        class="tk:flex tk:items-center tk:gap-2 tk:rounded-md tk:px-2 tk:py-1 tk:text-start tk:text-sm"
        :class="listId === undefined ? 'tk:bg-elevated tk:text-highlighted' : 'tk:text-default tk:hover:bg-elevated/60'"
        @click="listId = undefined"
      >
        <UIcon name="i-lucide-inbox" class="tk:size-4" />
        <span class="tk:flex-1">{{ labels.allTasks }}</span>
      </button>
      <div class="tk:px-2 tk:pt-3 tk:pb-1 tk:text-xs tk:font-semibold tk:uppercase tk:tracking-wide tk:text-muted">{{ labels.lists }}</div>
      <template v-for="{list, depth} in listTree" :key="list.id">
        <input
          v-if="naming === list.id"
          v-model="nameDraft"
          class="tk:rounded-md tk:bg-elevated tk:px-2 tk:py-1 tk:text-sm tk:outline-none"
          :style="{marginInlineStart: `${depth}rem`}"
          @keydown.enter="commitName"
          @keydown.esc="naming = undefined"
          @blur="commitName"
          :ref="focus"
        >
        <div
          v-else
          class="tk:group tk:flex tk:items-center tk:gap-2 tk:rounded-md tk:px-2 tk:py-1 tk:text-sm"
          :class="listId === list.id ? 'tk:bg-elevated tk:text-highlighted' : 'tk:text-default tk:hover:bg-elevated/60'"
          :style="{marginInlineStart: `${depth}rem`}"
          @click="listId = list.id"
        >
          <span class="tk:size-2.5 tk:shrink-0 tk:rounded-full tk:bg-accented" :style="list.color && {backgroundColor: list.color}" />
          <span class="tk:min-w-0 tk:flex-1 tk:truncate">{{ list.title }}</span>
          <span class="tk:text-xs tk:text-muted tk:group-hover:hidden">{{ countOf(list.id) || '' }}</span>
          <UDropdownMenu :items="listMenu(list)">
            <UButton icon="i-lucide-ellipsis" size="xs" variant="ghost" color="neutral" class="tk:hidden tk:group-hover:flex" :title="labels.more" @click.stop />
          </UDropdownMenu>
        </div>
      </template>
      <input
        v-if="naming === 'new'"
        v-model="nameDraft"
        :placeholder="labels.listName"
        class="tk:rounded-md tk:bg-elevated tk:px-2 tk:py-1 tk:text-sm tk:outline-none"
        @keydown.enter="commitName"
        @keydown.esc="naming = undefined"
        @blur="commitName"
        :ref="focus"
      >
      <UButton v-else icon="i-lucide-plus" size="sm" variant="ghost" color="neutral" :label="labels.newList" class="tk:justify-start" @click="startNaming('new')" />
    </nav>

    <div class="tk:flex tk:min-w-0 tk:flex-1 tk:flex-col">
      <div class="tk:flex tk:items-center tk:gap-3 tk:border-b tk:border-default tk:px-6 tk:py-2">
        <UIcon name="i-lucide-plus" class="tk:size-5 tk:text-muted" />
        <input
          v-model="newTitle"
          :placeholder="labels.newTask"
          class="tk:flex-1 tk:bg-transparent tk:py-1 tk:outline-none"
          data-task-new
          @keydown.enter="createTyped"
        >
      </div>
      <div ref="scroller" class="tk:min-h-0 tk:flex-1 tk:overflow-y-auto tk:px-3 tk:pb-6" @keydown.esc="openId = undefined">
        <div v-if="rows.length === 0" class="tk:py-16 tk:text-center tk:text-sm tk:text-muted">{{ labels.empty }}</div>
        <div v-else class="tk:relative tk:w-full" :style="{height: `${virtualizer.getTotalSize()}px`}">
          <div
            v-for="item in virtualizer.getVirtualItems()"
            :key="String(item.key)"
            :ref="measure"
            :data-index="item.index"
            class="tk:absolute tk:start-0 tk:top-0 tk:w-full"
            :style="{transform: `translateY(${item.start}px)`}"
          >
            <template v-for="row in [rows[item.index]!]" :key="row.key">
              <div v-if="row.kind === 'section'" class="tk:flex tk:items-center tk:gap-2 tk:px-3 tk:pt-5 tk:pb-1 tk:text-xs tk:font-semibold tk:uppercase tk:tracking-wide tk:text-muted">
                <span v-if="row.color" class="tk:size-2 tk:rounded-full" :style="{backgroundColor: row.color}" />
                {{ row.label }}
                <span class="tk:font-normal">{{ row.count }}</span>
              </div>
              <TaskRow
                v-else
                :task="row.task"
                :depth="row.depth"
                :open="openId === row.task.id"
                :document="document"
                :fields="fields"
                :list="showListOnRows && row.task.listId !== undefined ? listById.get(row.task.listId) : undefined"
                :today="today"
                :time-zone="zone"
                :locale="locale"
                :week-starts-on="weekStartsOn"
                :data-task="row.task.id"
                @open="openId = row.task.id"
                @close="openId = undefined"
                @change="emit('change', row.task.id, $event)"
                @create="create"
              >
                <template v-if="$slots.notes" #notes="scope">
                  <slot name="notes" v-bind="scope" />
                </template>
              </TaskRow>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
