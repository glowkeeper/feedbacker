import type { Menu, Routes } from '@/app/store/types'

export const siteTitle = "Feedbacker"

export const rubricFilename = "rubric.pdf"
export const studentWorkFilename = "student.pdf"

// export const defaultPrompt = "You are marker marking a student's work. Using the rubric below, use the comments against that rubric to provide constructive feedback to the student."
export const rubricPrompt = `You are marking a student's work, using the pdf file ${rubricFilename} as the assessment rubric. The students work is the pdf file ${studentWorkFilename}. Please use the rubric to provide an overall mark and actionable feedback to the student.`
export const rubricWithCommentsPrompt = `You are a second marker marking a student's work. The pdf file ${rubricFilename} are the first marker's remarks on the student's work, which they have entered directly into the assessment rubric. Please use those remarks to provide an overall mark and actionable feedback to the student.`

export const routes: Routes = {
  mark: {
    route: {
      title: "mark",
      path: "/mark"
    }
  }
}

export const menuSections: Menu = {
  mark: {
    title: routes.mark.route.title,
    path: routes.mark.route.path
  }
}

