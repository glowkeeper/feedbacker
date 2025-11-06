import type { App } from '@/app/store/types'

export const siteTitle = "Feedbacker"

export const appSections: App = {
  data: {
    title: "data",
    path: "/data"
  },
  prompt: {
    title: "prompt",
    path: "/prompt"
  },
  rubric: {
    title: "rubric",
    path: "/rubric"
  },
  mark: {
    title: "mark",    
    path: "/mark"
  }
}