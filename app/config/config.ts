import type { Menu, Routes } from '@/app/store/types'
import { siteTitle } from './text'

export const routes: Routes = {
  about: {
    route: {
      title: "About",
      path: "/about"
    }
  },
  contact: {
    route: {
      title: "Contact",
      path: "/contact"
    }
  },
  faq: {
    route: {
      title: "FAQ",
      path: "/faq"
    }
  },
  feedback: {
    route: {
      title: "Feedback",
      path: "/feedback"
    }
  },
  feedbackSubmission: {
    route: {
      title: "Submission-Based Assessment",
      path: "/feedback/submission-based-assessment"
    }
  },
  feedbackLive: {
    route: {
      title: "Live Assessment",
      path: "/feedback/live-assessment"
    }
  },
  help: {
    route: {
      title: "Help",
      path: "/help"
    }
  },
  home: {
    route: {
      title: "Home",
      path: "/"
    }
  },
  mark: {
    route: {
      title: "Mark",
      path: "/mark"
    }
  },
  markCreate: {
    route: {
      title: "Mark",
      path: "/mark/mark-work"
    }
  },
  markList: {
    route: {
      title: "List Marks",
      path: "/mark/mark-show-marks"
    }
  },
  markTemplates: {
    route: {
      title: "Create Marking Templates",
      path: "/mark/mark-add-templates"
    }
  },
  markTemplatesList: {
    route: {
      title: "List Marking Templates",
      path: "/mark/mark-list-templates"
    }
  },
  privacy: {
    route: {
      title: "Privacy",
      path: "/privacy"
    }
  },
  rubric: {
    route: {
      title: "Rubric",
      path: "/rubric"
    }
  },
  rubricCreate: {
    route: {
      title: "Create Rubrics",
      path: "/rubric/create-rubric"
    }
  },
  rubricList: {
    route: {
      title: "List Rubrics",
      path: "/rubric/list-rubric"
    }
  },
  sponsor: {
    route: {
      title: "Sponsor",
      path: "/sponsor"
    }
  },
  terms: {
    route: {
      title: "Terms of Use",
      path: "/terms"
    }
  },
}

export const menuSections: Menu = {
  feedback: {
    title: routes.feedback.route.title,
    path: routes.feedback.route.path
  },
  mark: {
    title: routes.mark.route.title,
    path: routes.mark.route.path
  },
  rubric: {
    title: routes.rubric.route.title,
    path: routes.rubric.route.path
  },
  help: {
    title: routes.help.route.title,
    path: routes.help.route.path
  },
  faq: {
    title: routes.faq.route.title,
    path: routes.faq.route.path
  },
}

export const rubricStoreName = `${siteTitle}-rubrics`
export const markTemplateStoreName = `${siteTitle}-mark-templates`
export const markStoreName = `${siteTitle}-marks`

export const defaultRubric: string[][] = [
  ["", "", "Nothing Submitted", "Inadequate", "Fail", "Satisfactory", "Good", "Very Good", "Excellent", "Exemplary"],
  ["Criteria", "Weighting", "0", "1 - 30", "31 - 40", "41 - 50", "51 - 60", "61 - 70", "71 - 80", "81 - 100"],
  ['First Criteria', '20%', '', '', '', '', '', '', '', ''], 
  ['Second Criteria', '20%', '', '', '', '', '', '', '', ''],  
  ['Third Criteria', '20%', '', '', '', '', '', '', '', ''], 
  ['Fourth Criteria', '20%', '', '', '', '', '', '', '', ''], 
  ['Fifth Criteria', '20%', '', '', '', '', '', '', '', ''], 
]

export const defaultMark: string[][] = [
  ["", "", "Nothing Submitted", "Inadequate", "Fail", "Satisfactory", "Good", "Very Good", "Excellent", "Exemplary", ""],
  ["Criteria", "Weighting", "0", "1 - 30", "31 - 40", "41 - 50", "51 - 60", "61 - 70", "71 - 80", "81 - 100", "Total"],
  ['First Criteria', '20%', '', '', '', '', '', '', '', '', ''], 
  ['Second Criteria', '20%', '', '', '', '', '', '', '', '', ''],  
  ['Third Criteria', '20%', '', '', '', '', '', '', '', '', ''], 
  ['Fourth Criteria', '20%', '', '', '', '', '', '', '', '', ''], 
  ['Fifth Criteria', '20%', '', '', '', '', '', '', '', '', ''], 
  ['', '', '', '', '', '', '', '', '', '', '=SUM(K2:K7)']
]

