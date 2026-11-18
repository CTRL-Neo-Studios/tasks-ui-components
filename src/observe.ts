import {onBeforeUnmount, type Ref, watch} from 'vue'

/** Calls `fn` with the element's content box whenever it changes size, while it's mounted. */
export function useResizeObserver(target: Ref<Element | null | undefined>, fn: (box: DOMRectReadOnly) => void) {
    const observer = new ResizeObserver(([entry]) => entry && fn(entry.contentRect))
    watch(target, (el, old) => {
        if (old) observer.unobserve(old)
        if (el) observer.observe(el)
    }, {immediate: true})
    onBeforeUnmount(() => observer.disconnect())
}
