import type { App, DBase } from '@/app/store/types'

export const siteTitle = "Feedbacker"

export const defaultPrompt = "Acting as an second marker, elaborate on the first marker\'s remarks about each section of a student\'s coursework by turning the marker\'s comment on each section into constructive feedback. Do not mention the first marker in your feedback. The first marker\'s comments remarks are as follows: "

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

export const dB = {
    name: siteTitle,
    version: 1
}

export const dBase: DBase = {
  'prompts': {
    name: 'prompts',
    key: 'promptId',
    data: {}
  },
  'rubric': {
    name: 'rubric',
    key: 'rubricId', 
    data: {}
  },
  'marks': {
    name: 'marks',
    key: 'markId',
    data: {}
  }
}

