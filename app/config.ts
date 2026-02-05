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

export const aboutText = `${siteTitle} takes a human-centric approach to marking while using automation and AI to streamline the process.

The [Office of Qualifications and Examinations Regulation (Ofqual)](https://www.gov.uk/government/organisations/ofqual) recognises that [AI can enhance assessment quality](https://www.gov.uk/government/publications/ofquals-approach-to-regulating-the-use-of-artificial-intelligence-in-the-qualifications-sector). However, they also warn that AI can introduce bias, inaccuracies, and a lack of transparency—risks that must be carefully managed when assessment outcomes shape futures.

Accordingly, Ofqual advises a precautionary approach: AI can assist, but human judgement must remain central to marking design, development, and delivery.

[Dr Steve Huckle](https://huckle.studio) — formerly a Lecturer at the [University of Sussex](https://www.sussex.ac.uk/) and now a Visiting Tutor at the [University of Roehampton](https://www.roehampton.ac.uk/) — demonstrates that principle in practice. As Module Convenor for [Programming for 3D](https://www.sussex.ac.uk/ei/internal/coursesandmodules/informatics/modules/2023/85872) at Sussex, he provided rich, constructive feedback that went far beyond simple grading. To make this process more efficient, he built the first prototype of ${siteTitle}, combining automation and AI while maintaining full human control of assessment criteria and judgements.

Since that early version, ${siteTitle} has been **completely rebuilt from the ground up**. It has been **rewritten in a new programming language** with **more powerful rubrics** and a **robust, re-engineered feedback mechanism**. The result is a thoroughly modern tool that helps educators mark smarter, faster, and better—producing feedback that genuinely improves learning outcomes by helping students understand their performance and development needs.

This build of ${siteTitle} uses a free, rate-limited large language model (LLM) via [OpenRouter](https://openrouter.ai/), so feedback generation may take some time. If you would like ${siteTitle} to use a paid LLM and can provide funding, please contact [Dr Huckle](https://huckle.studio/).

Alternatively, you can clone the source code via the GitHub link in the footer and deploy your own build with a paid LLM. The ${siteTitle} source is released under a [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/), allowing you to remix, adapt, and use it—even commercially—so long as you credit [Dr Steve Huckle](https://huckle.studio/). Dr Huckle is also available to assist with new builds if required.

Navigating AI-enhanced marking means balancing technology with human insight — ${siteTitle} achieves that balance, helping you assess **smarter**, **faster**, and **better** than ever before.

To learn more about ${siteTitle}, please contact [Dr Steve Huckle](https://huckle.studio).`

export const contactText = `For information about ${siteTitle}, please contact [Dr Steve Huckle](https://huckle.studio).`

export const privacyText = `${siteTitle} does not collect or process any personally identifiable information. Although some *non-identifying* data is shared with AI engines to enable the generation of actionable assessment feedback, no personal data is stored, shared, or used beyond that purpose, ensuring full compliance with GDPR and all relevant data protection standards.`

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
  markCreate: {
    route: {
      title: "Mark Work",
      path: "/mark/mark-work"
    }
  },
  markList: {
    route: {
      title: "Show Marks",
      path: "/mark/mark-show-marks"
    }
  },
  markTemplates: {
    route: {
      title: "Create Templates",
      path: "/mark/mark-add-templates"
    }
  },
  markTemplatesList: {
    route: {
      title: "Show Templates",
      path: "/mark/mark-list-templates"
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
      title: "Show Rubrics",
      path: "/rubric/list-rubric"
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
  },
  rubrics: {
    title: "rubric",
    path: routes.rubric.route.path
  }
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

