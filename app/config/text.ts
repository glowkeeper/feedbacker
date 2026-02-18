export const siteTitle = "Feedbacker"

export const headline = `Feedback that works as hard as you do.`

export const subHeading = `Quickly generate structured, rubric-aligned feedback while keeping your academic judgement central.`

export const trustCue = `Free to use · Designed for Higher Education · Built by a university lecturer.`

export const aboutText = `### Origins

${siteTitle} started as a personal solution to a very real problem: marking is one of the most time-consuming parts of academic life, and much of the repetitive work distracts from the parts of teaching that actually matter — the conversations, the pedagogy, the human connection with students. As Module Convenor for [Programming for 3D](https://www.sussex.ac.uk/ei/internal/coursesandmodules/informatics/modules/2023/85872) at the [University of Sussex](https://www.sussex.ac.uk/), [Dr Steve Huckle](https://huckle.studio) was providing detailed, constructive feedback that extended well beyond simple grading. As cohort sizes grew, he needed a way to make that level of feedback sustainable — so he built a tool to help. It worked. It genuinely helped give smarter, faster, and better feedback.decision-making in assessment.

### Revision

Since that early version at the University of Sussex, ${siteTitle} has been **completely rebuilt from the ground up**, using a modern architecture with enhanced rubric capabilities, a re-engineered feedback mechanism, and support for **batch processing of multiple student submissions against a shared rubric**.

The [Office of Qualifications and Examinations Regulation (Ofqual)](https://www.gov.uk/government/organisations/ofqual) recognises that [artificial intelligence can enhance assessment quality](https://www.gov.uk/government/publications/ofquals-approach-to-regulating-the-use-of-artificial-intelligence-in-the-qualifications-sector), while also cautioning against risks such as bias, inaccuracy, and lack of transparency. ${siteTitle} is explicitly designed to align with this guidance by ensuring that AI **supports, rather than replaces**, academic expertise. 

${siteTitle} is a human-centric assessment platform designed to support scalable, high-quality marking in higher education. It enables educators to apply a single, well-defined rubric across individual or multiple student submissions in one workflow — blending academic expertise with automation, keeping feedback human-focused rather than machine-generated. It automates the slow, repetitive parts of marking while helping educators produce personalised, actionable feedback in less time, without sacrificing quality. The goal is to free up time for teaching, discussion, and real student engagement, while making it clearer to students where they stand and what they need to do next.

The current public build of ${siteTitle} utilises a free, rate-limited large language model (LLM) accessed via [OpenRouter](https://openrouter.ai/). As a result, feedback generation — particularly when processing multiple submissions — may be subject to performance constraints. Institutions wishing to deploy ${siteTitle} with a paid or dedicated LLM provision for improved speed, throughput, or service guarantees are invited to contact [Dr Steve Huckle](https://huckle.studio) to discuss appropriate arrangements.

### Key Capabilities

- **Rubric-driven assessment**: Apply a single marking rubric consistently across individual or multiple student submissions.

+ **Batch marking and feedback**: Generate structured, criterion-referenced feedback for many student texts in a single workflow.

- **Human-in-the-loop design**: Academic staff retain full control over rubric design, assessment criteria, and final judgements.

+ **Scalable feedback generation**: Supports larger cohorts while maintaining depth, clarity, and pedagogical value in feedback.

- **Transparency and consistency**: Makes assessment criteria explicit and consistently applied across all submissions.

+ **Flexible deployment**: Open-licensed source code enables institutional hosting, adaptation, and integration.

### Responsible Use of AI in Assessment

${siteTitle} is designed in accordance with sector expectations for the responsible use of AI in assessment. In line with Ofqual’s precautionary approach, AI within the platform functions strictly as an **assistive tool**, supporting educators in applying predefined assessment criteria efficiently and consistently.

Assessment design, rubric construction, and evaluative judgement remain the responsibility of academic staff at all times. While ${siteTitle} can process multiple student submissions against a shared rubric, it does not autonomously determine grades or remove human oversight. Instead, it reduces administrative burden and enhances the clarity, usefulness, and consistency of feedback provided to students.

By combining rubric-based assessment, batch processing capabilities, and human control, ${siteTitle} enables institutions to balance scalability with academic integrity, fairness, and transparency.

### Licensing and Deployment

The ${siteTitle} source code is released under a [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/), allowing institutions to remix, adapt, and deploy the platform — including for commercial use — provided appropriate attribution is given. The system can be self-hosted or adapted to meet institutional requirements, supporting long-term sustainability and governance.

To learn more about ${siteTitle}, please contact [Dr Steve Huckle](https://huckle.studio).`

export const contactText = `## Need Support?
Feedbacker evolves in response to academic practice.

If you encounter technical issues, would like to suggest improvements, or just want more information about ${siteTitle}, please contact [Dr Steve Huckle](https://huckle.studio).`

export const privacyText = `${siteTitle} does not itself collect, determine, or process personally identifiable information as part of its core operation. Users of the platform may, however, upload assessment materials or student texts that contain personal data relating to identifiable individuals.

To generate assessment feedback, ${siteTitle} may transmit user-submitted content, or extracts thereof, to third-party artificial intelligence services. While these services state that submitted data is not stored, retained, or reused for model training, ${siteTitle} cannot control or guarantee the handling, security, or onward processing of any personal data once transmitted externally.

The platform also uses local storage within the user’s browser to store non-personal resources such as rubrics, marking templates, and generated feedback. These items remain private to the user’s device and are not shared with external services unless explicitly included in a user submission.

Accordingly, ${siteTitle} should be regarded as a tool that operates under the user’s direction. Responsibility for compliance with the UK General Data Protection Regulation (UK GDPR), the Data Protection Act 2018, and any applicable institutional data protection policies rests with the user and/or their institution, who act as the data controller in relation to any personal data submitted.

Users are strongly advised to anonymise student work prior to upload and to avoid submitting personally identifiable or special category data wherever possible. ${siteTitle} does not accept responsibility for the submission of personal data by users, nor for any consequences arising from such submission.`

export const privacyTextShort = `${siteTitle} does not collect or store any personally identifiable information by default. You may upload assessment materials, which could contain personal data, and some content may be sent to AI services to generate feedback. The platform also uses your browser’s local storage to keep non-personal items like rubrics, marking templates, and feedback private to your device. Please anonymise student work before upload, as you are responsible for GDPR compliance and the handling of any personal data you submit.`

export const privacyTextSuperShort = `${siteTitle} does not collect personal data by default. You are responsible for anonymising student work. Non-personal items like rubrics and feedback are stored only in your browser, and some content may be sent to AI services to generate feedback.`

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

export const helptext = `---

## Quick Summary

**Feedbacker generates structured, rubric-aligned feedback for student assessments**. Build your rubric in the tool, then follow one of two workflows: upload a completed rubric and student submission for written work, or add comments live during presentations and vivas. All generated feedback is editable before release. You remain responsible for academic standards and final judgement throughout.

---

## What is Feedbacker?

Feedbacker is a rubric-led feedback tool designed for higher education (but works in other settings, too).

It generates structured, criterion-aligned feedback based on the rubric you define. You remain fully responsible for academic standards, judgement, and final output.

---

## How Feedbacker Works

Feedbacker supports two common assessment workflows:

- **Workflow A:** Marking a submitted piece of work (e.g. essays, reports, dissertations)
- **Workflow B:** Marking live performance-based assessments (e.g. presentations, vivas, practical work)

Both workflows centre on the rubric you create — but they are prepared differently.

---

## Step 1: Create Your Rubric Within the Tool

You [create your rubric using the built-in spreadsheet-style editor](/rubric/create-rubric).

However, how you complete the rubric depends on your workflow.

---

## Workflow A: Submission-Based Assessment

Use this when marking written coursework or submitted assignments.

### Preparing the Rubric

For Workflow A, you should complete the rubric fully before marking. [See this example](#rubricSubmissionExample).

This means:

- Defining all assessment criteria  
- Defining grade boundaries or performance levels  
- Adding descriptive comments in each relevant row and column  

These pre-written rubric comments are what Feedbacker uses to generate structured feedback when analysing student submissions.

The more clearly defined your rubric comments are, the stronger and more specific the generated feedback will be. 

---

### Marking Process

1. Export the completed rubric as a PDF.  
2. Upload the rubric PDF when marking [here](/feedback/submission-based-assessment).  
3. Also upload the student submissions as PDFs.  
4. Select **Get Feedback**.

Feedbacker will produce:

- Criterion-aligned commentary  
- Structured explanation of performance  
- Clear areas for development  

All output is fully editable before release.

---

## Workflow B: Live or Performance-Based Assessment

Use this when assessing presentations, vivas, or other live work.

### Preparing the Rubric

For Workflow B, you define:

- Assessment criteria  
- Grade boundaries or performance levels  

However, you do **not** pre-fill comment cells. [See this example](#rubricLiveExample).

Comments and marks are added live during the assessment itself.

---

### Marking Process

1. Use the rubric inside the tool during the live session.  
2. Enter marks and add comments in real time.  
3. Once complete, export the commented rubric as a PDF.  
4. Re-upload the completed rubric PDF [here](/feedback/live-assessment) to generate structured feedback.

Feedbacker will use your recorded marks and live comments to produce structured, criterion-aligned student-facing feedback.

All generated output remains fully editable before release.

---

## Key Principles

- You define the rubric.  
- You determine the standards.  
- Workflow A uses pre-written rubric comments.  
- Workflow B uses live-added comments.  
- All generated feedback is reviewable and editable.  
- Feedbacker supports academic judgement — it does not replace it.

---

## Good Practice

To get the most from Feedbacker:

- Write clear and specific rubric criteria.  
- Avoid vague performance descriptors.  
- Review generated output before sharing with students.  
- Retain final records in accordance with institutional policy.

---`

export const fAQText = `## General

**What is Feedbacker?**
Feedbacker is a rubric-led feedback tool designed for higher education. It generates structured, criterion-aligned feedback based on the rubric you define.

**Does Feedbacker replace academic judgement?**
No. Feedbacker supports academic judgement — it does not replace it. You remain fully responsible for academic standards, the rubric you create, and all final output.

**Is the generated feedback editable?**
Yes. All generated feedback is fully editable before it is released to students.

---

## The Rubric

**How do I create a rubric in Feedbacker?**
You build your rubric using the built-in spreadsheet-style editor. You define the assessment criteria, grade boundaries or performance levels, and any descriptive comments.

**Does the rubric need to be completed before marking?**
It depends on your workflow. For submission-based assessments (Workflow A, described below), the rubric should be fully completed before marking begins. For live or performance-based assessments (Workflow B), you only define the criteria and grade boundaries in advance — comments are added during the assessment itself.

**Does the quality of my rubric affect the feedback?**
Yes. The more clearly defined your rubric criteria and comments are, the stronger and more specific the generated feedback will be.

---

## Workflows

**What workflows does Feedbacker support?**
Feedbacker supports two workflows:
- **Workflow A** — for submission-based assessments such as essays, reports, and dissertations
- **Workflow B** — for live or performance-based assessments such as presentations, vivas, and practical work

**How does Workflow A work?**

1. Complete your rubric fully, including descriptive comments for each criterion and grade level.
2. Export the rubric as a PDF.
3. Upload the rubric PDF and the student's submission PDF.
4. Select **Get Feedback**.

Feedbacker will produce criterion-aligned commentary, a structured explanation of performance, and clear areas for development.

**How does Workflow B work?**
1. Define your criteria and grade boundaries in the rubric, but leave comment cells blank.
2. During the live assessment, enter marks and add comments in real time using the rubric inside the tool.
3. Once complete, export the commented rubric as a PDF.
4. Re-upload the completed rubric PDF to generate structured feedback.

---

## Good Practice

**Any tips for getting the best results from Feedbacker?**
- Write clear and specific rubric criteria.
- Avoid vague performance descriptors.
- Review all generated output before sharing it with students.
- Retain final records in accordance with your institution's policy.

---

## Support

**How do I report a technical issue or suggest an improvement?**
Please contact us at [Insert contact email or link]. Feedbacker evolves in response to academic practice.`
