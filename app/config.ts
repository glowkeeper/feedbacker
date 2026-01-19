import type { Menu, Routes } from '@/app/store/types'

export const siteTitle = "Feedbacker"

export const rubricFilename = "rubric.pdf"

// export const defaultPrompt = "You are marker marking a student's work. Using the rubric below, use the comments against that rubric to provide constructive feedback to the student."
export const rubricPrompt = `You are assessing a student’s submission using the assessment rubric provided in the PDF file ${rubricFilename}.

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

export const rubricWithCommentsPrompt = `You are marking a student assessment.

The PDF file ${rubricFilename} contains the assessment rubric, which you have already completed, including criterion-level judgements and written comments entered directly into the rubric. The student’s original assessed material (e.g. written work, presentation, oral exam, or practical performance) is not available.

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

