import type { Menu, Routes, DBase } from '@/app/store/types'

export const siteTitle = "Feedbacker"

export const defaultPrompt = "You are marker marking a student's work. Using the rubric belowed, use the comments against that rubric to provide constructive feedback to the student."

export const routes: Routes = {
  data: {
    route: {
      title: "data",
      path: "/data"
    },
    add: {
      title: "add data",
      path: "/data/add"
    },
    list: {
      title: "list data",
      path: "/data/list"
    }
  },
  prompt: {
    route: {
      title: "prompt",
      path: "/prompt"
    }
  },
  rubric: {
    route: {
      title: "rubric",
      path: "/rubric"
    },
    add: {
      title: "add rubric",
      path: "/rubric/add"
    },
    list: {
      title: "list rubric",
      path: "/rubric/list"
    }
  },
  mark: {
    route: {
      title: "mark",    
      path: "/mark"
    },
    add: {
      title: "add mark",
      path: "/mark/add"
    },
    list: {
      title: "list marks",
      path: "/mark/list"
    }
  }
}

export const menuSections: Menu = {
  data: {
    title: routes.data.route.title,
    path: routes.data.route.path
  },
  prompt: {
    title: routes.prompt.route.title,
    path: routes.prompt.route.path
  },
  rubric: {
    title: routes.rubric.route.title,
    path: routes.rubric.route.path
  },
  mark: {
    title: routes.mark.route.title,    
    path: routes.mark.route.path
  }
}

export const dB = {
    name: siteTitle,
    version: 1
}

export const dBase: DBase = {
  'prompts': {
    name: 'prompts',
    key: 'id',
    data: {}
  },
  'rubric': {
    name: 'rubric',
    key: 'id', 
    data: {}
  },
  'marks': {
    name: 'marks',
    key: 'id',
    data: {}
  }
}

