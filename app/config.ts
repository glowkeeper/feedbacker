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

export const aboutText = `## About ${siteTitle}

${siteTitle} is a human-centric assessment platform designed to support **scalable, high-quality marking in higher education**. It enables educators to apply a single, well-defined rubric across individual or multiple student submissions in one workflow, helping manage larger cohorts while preserving academic judgement, transparency, and consistency.

The [Office of Qualifications and Examinations Regulation (Ofqual)](https://www.gov.uk/government/organisations/ofqual) recognises that [artificial intelligence can enhance assessment quality](https://www.gov.uk/government/publications/ofquals-approach-to-regulating-the-use-of-artificial-intelligence-in-the-qualifications-sector), while also cautioning against risks such as bias, inaccuracy, and lack of transparency. ${siteTitle} is explicitly designed to align with this guidance by ensuring that AI **supports, rather than replaces**, human decision-making in assessment.

### Origins and Rationale

${siteTitle} was developed by [Dr Steve Huckle](https://huckle.studio), formerly a Lecturer at the [University of Sussex](https://www.sussex.ac.uk/) and now a Visiting Tutor at the [University of Roehampton](https://www.roehampton.ac.uk/). As Module Convenor for [Programming for 3D](https://www.sussex.ac.uk/ei/internal/coursesandmodules/informatics/modules/2023/85872) at Sussex, Dr Huckle provided detailed, constructive feedback that extended well beyond simple grading.

To make this level of feedback sustainable as cohort sizes increased, he developed the first prototype of ${siteTitle}. The system was designed to combine automation and AI with **full academic control over assessment criteria, rubric design, and evaluative judgement**.

Since that early version, ${siteTitle} has been **completely rebuilt from the ground up**, using a modern architecture with enhanced rubric capabilities, a re-engineered feedback mechanism, and support for **batch processing of multiple student submissions against a shared rubric**.

### Key Capabilities

+ **Rubric-driven assessment** Apply a single marking rubric consistently across individual or multiple student submissions

- **Batch marking and feedback**: Generate structured, criterion-referenced feedback for many student texts in a single workflow

+ **Human-in-the-loop design**: Academic staff retain full control over rubric design, assessment criteria, and final judgements

- **Scalable feedback generation**: Supports larger cohorts while maintaining depth, clarity, and pedagogical value in feedback

+ **Transparency and consistency**: Makes assessment criteria explicit and consistently applied across all submissions

- **Flexible deployment**: Open-licensed source code enables institutional hosting, adaptation, and integration

### Responsible Use of AI in Assessment

${siteTitle} is designed in accordance with sector expectations for the responsible use of AI in assessment. In line with Ofqual’s precautionary approach, AI within the platform functions strictly as an **assistive tool**, supporting educators in applying predefined assessment criteria efficiently and consistently.

Assessment design, rubric construction, and evaluative judgement remain the responsibility of academic staff at all times. While ${siteTitle} can process multiple student submissions against a shared rubric, it does not autonomously determine grades or remove human oversight. Instead, it reduces administrative burden and enhances the clarity, usefulness, and consistency of feedback provided to students.

By combining rubric-based assessment, batch processing capabilities, and human control, ${siteTitle} enables institutions to balance scalability with academic integrity, fairness, and transparency.

### Licensing and Deployment

The ${siteTitle} source code is released under a [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/), allowing institutions to remix, adapt, and deploy the platform — including for commercial use — provided appropriate attribution is given. The system can be self-hosted or adapted to meet institutional requirements, supporting long-term sustainability and governance.

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

