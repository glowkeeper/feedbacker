import type { Menu, Routes } from '@/app/store/types'

export const siteTitle = "Feedbacker"

//replace '%%' with the actual file name'
export const rubricPrompt = `You are assessing a student’s submission using the assessment rubric provided in the PDF file %%.

Please:

+ Apply the rubric criteria explicitly when evaluating the work.
+ Award an overall percentage mark that is consistent with the rubric’s performance descriptors.
+ Perform a word count
+ Identify key strengths, clearly linked to specific rubric criteria.
+ Identify areas for improvement, explaining what is missing or underdeveloped and how the student could improve.
+ Provide actionable, constructive feedback suitable for release to the student.
+ Summarise any academic integrity considerations already evidenced in the rubric comments (e.g. concerns relating to plagiarism, inappropriate use of AI tools, fabricated or hallucinated references, or poor attribution practices), making clear whether these affected the mark awarded.
+ Conclude with a brief overall summary justifying the mark awarded.

Write in a professional, supportive academic tone.`

//replace '%%' with the actual file name'
export const rubricWithCommentsPrompt = `You are marking a student assessment.

The PDF file %% contains the assessment rubric, which you have already completed, including criterion-level judgements in the form of written comments entered directly into the rubric. The student’s original assessed material (e.g. written work, presentation, oral exam, or practical performance) is not available.

Based solely on the completed rubric and the comments you have provided, please:

+ Apply the rubric criteria explicitly, as evidenced in your completed rubric entries.
+ Award an overall percentage mark that is consistent with the rubric’s performance descriptors and your criterion-level judgements.
+ Identify key strengths, clearly linked to specific rubric criteria and your existing comments.
+ Identify areas for improvement, explaining what is missing or underdeveloped, as evidenced in the rubric comments, and how the student could improve.
+ Provide actionable, constructive feedback suitable for release to the student, synthesising (not repeating verbatim) the rubric comments.
+ Summarise any academic integrity considerations already evidenced in the rubric comments (e.g. concerns relating to plagiarism, inappropriate use of AI tools, fabricated or hallucinated references, or poor attribution practices), making clear whether these affected the mark awarded.
+ Conclude with a brief overall summary justifying the mark awarded.

Do not introduce new evaluative claims, allegations, or integrity concerns beyond what is supported by the rubric comments.

Write in a professional, supportive academic tone.`

export const routes: Routes = {
  feedback: {
    route: {
      title: "Feedback",
      path: "/feedback"
    }
  },
  feedbackRubric: {
    route: {
      title: "Rubric and Submissions",
      path: "/feedback/rubric-and-submissions"
    }
  },
  feedbackCommentedRubric: {
    route: {
      title: "Commented Rubrics",
      path: "/feedback/commented-rubric"
    }
  },
  mark: {
    route: {
      title: "Mark",
      path: "/mark"
    }
  },
  markWork: {
    route: {
      title: "Mark Work",
      path: "/mark/mark-work"
    }
  },
  markCreateRubric: {
    route: {
      title: "Create Rubrics",
      path: "/mark/create-rubric"
    }
  },
}

export const menuSections: Menu = {
  feedback: {
    title: "feedback",
    path: routes.feedback.route.path
  },
  mark: {
    title: "mark",
    path: routes.mark.route.path
  }
}

export const rubricStoreName = `${siteTitle}-rubrics`
export const markStoreName = `${siteTitle}-marks`

export const defaultRubric: string[][] = [
  ["", "", "", "", "", "Marks", "", "", ""],
  ["", "", "0 - 30", "31 - 40", "41 - 50", "51 - 60", "61 - 70", "71 - 80", "81 - 100"], 
  ["", 'First Criteria', '', '', '', '', '', '', ''], 
  ["", 'Second Criteria', '', '', '', '', '', '', ''], 
  ["Criteria", 'etc', '', '', '', '', '', '', ''],
  ["", 'etc', '', '', '', '', '', '', ''], 
  ["", 'etc', '', '', '', '', '', '', ''],  
]

