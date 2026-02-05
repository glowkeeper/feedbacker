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

export const aboutText = `${siteTitle} is a human-centric assessment platform designed to support **scalable, high-quality marking in higher education**. It enables educators to apply a single, well-defined rubric across individual or multiple student submissions in one workflow, helping manage larger cohorts while preserving academic judgement, transparency, and consistency.

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

export const privacyText = `${siteTitle} does not itself collect, determine, or process personally identifiable information as part of its core operation. However, users of the platform may upload assessment materials or student texts which may contain personal data, including data relating to identifiable individuals.

In order to generate assessment feedback, ${siteTitle} may transmit user-submitted content, or extracts thereof, to third-party artificial intelligence services. While these services state that submitted data is not stored, retained, or reused for model training, ${siteTitle} does not control and cannot guarantee the handling, security, or onward processing of any personal data contained within such submissions once transmitted to external providers.

Accordingly, ${siteTitle} should be regarded as a tool that operates under the direction of the user. Responsibility for compliance with the UK General Data Protection Regulation (UK GDPR), the Data Protection Act 2018, and any applicable institutional data protection policies rests with the user and/or their institution, who act as the data controller in relation to any personal data submitted.

Users are strongly advised to anonymise student work prior to upload and to avoid submitting personally identifiable or special category data wherever possible. ${siteTitle} does not accept responsibility for the submission of personal data by users, nor for any consequences arising from such submission.`

export const termsText = `Users of ${siteTitle} acknowledge and agree that they are solely responsible for any content uploaded to, processed by, or generated through the platform.

${siteTitle} is designed as an assessment support tool and does not require the submission of personally identifiable information for its operation. However, users may upload student work or assessment materials that contain personal data. By using ${siteTitle}, users warrant that they have a lawful basis for processing any personal data submitted, including compliance with the UK General Data Protection Regulation (UK GDPR), the Data Protection Act 2018, and any applicable institutional or organisational policies.

Users further acknowledge that, in order to generate assessment feedback, submitted content may be transmitted to third-party artificial intelligence service providers. While such providers may state that submitted data is not retained or reused, ${siteTitle} does not control, monitor, or guarantee the handling, storage, or onward processing of submitted content once it has been transmitted to external services.

Users agree to take reasonable and proportionate steps to protect personal data, including anonymising student work where practicable and avoiding the submission of special category data or unnecessary personally identifiable information.

${siteTitle} and its developers accept no liability for:
- The submission of personal data by users;
- Any failure by users to obtain appropriate consent or establish a lawful basis for processing;
- The handling, storage, or processing of data by third-party service providers;
- Any loss, disclosure, or misuse of personal data arising from user-submitted content.

By using ${siteTitle}, users confirm that they understand and accept these responsibilities.`

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

