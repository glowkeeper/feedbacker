export const siteTitle = process.env.NEXT_PUBLIC_TITLE as string

export const headline = `Feedback that works as hard as you do.`

export const subHeading = `Quickly generate structured, rubric-aligned feedback while keeping your academic judgement central.`

export const trustCue = `Free to use · Designed for Higher Education · Built by a university lecturer.`

export const aboutText = `**${siteTitle}** is an AI-assisted feedback tool designed to help educators provide high-quality, actionable feedback efficiently, without replacing human judgement. It supports formative assessment in higher education, helping staff manage workload while keeping feedback personalised, pedagogically grounded, and meaningful for students.  

---

## Origins

${siteTitle} began as a personal solution to a common challenge: providing detailed, constructive feedback is time-intensive, and repetitive marking work can distract from the parts of teaching that really matter — pedagogy, conversations, and human connection with students. Dr [Steve Huckle](https://huckle.studio), as Module Convenor for [Programming for 3D](https://www.sussex.ac.uk/ei/internal/coursesandmodules/informatics/modules/2023/85872) at the [University of Sussex](https://www.sussex.ac.uk/), developed an early version to maintain high-quality feedback at scale. The tool worked, and it genuinely helped.

---

## Why ${siteTitle} Exists

As class sizes grow and assessment workloads increase, maintaining consistent, actionable feedback becomes challenging. ${siteTitle} helps educators scale thoughtful feedback while keeping academic expertise central. The platform combines human judgement with automation to streamline the repetitive aspects of marking, enabling personalised, actionable feedback more efficiently without compromising quality. Its aim is to free up time for teaching, discussion, and student engagement, while giving students a clearer understanding of their progress and next steps.

---

## Responsible AI

${siteTitle} generates draft feedback only. Educators remain fully in control, reviewing and editing all outputs. The system does **not** automate grading decisions, and all feedback is clearly attributable to the educator. This approach aligns with sector guidance in UK higher education, ensuring AI supports — rather than replaces — academic expertise.

---

## Key Capabilities

- **Rubric-driven assessment:** Apply a single marking rubric consistently across individual or multiple student submissions.  
- **Batch feedback generation:** Generate structured, criterion-referenced feedback for multiple submissions in one workflow.  
- **Human-in-the-loop design:** Educators retain full control over rubric design, assessment criteria, and final judgements.  
- **Scalable feedback:** Supports larger cohorts while maintaining clarity, pedagogical depth, and consistency.  
- **Transparency and consistency:** Makes assessment criteria explicit and consistently applied.  
- **Flexible deployment:** Open-licensed source code allows institutional hosting, adaptation, and integration.  

---

## Feedback Smarter, Faster, Better

> ${siteTitle} helps educators provide high-quality feedback efficiently, keeping human judgement central.

### Smarter
- Combines academic expertise with AI-assisted drafting
- Ensures feedback is pedagogically meaningful and actionable
- Maintains consistency across cohorts

### Faster
- Automates repetitive aspects of marking
- Reduces turnaround time for student feedback
- Frees up time for teaching and discussion

### Better
- Highlights student strengths and areas for improvement
- Points students toward clear next steps
- Supports formative, rubric-driven feedback workflows

---

## Collaboration and Educational Context

${siteTitle} is developed as part of ongoing exploration into responsible uses of AI in higher education assessment and feedback practices. The project welcomes discussion, experimentation, and collaboration with educators, learning technologists, and institutions interested in piloting or studying AI-assisted feedback workflows.

---

## Getting Started in Your Context

${siteTitle} can be used directly via the public deployment, or self-hosted by institutions. Self-hosting allows full control over data and AI configuration, making it suitable for pilot projects, module-specific trials, or integration with local assessment workflows. Educators remain fully responsible for reviewing and approving all outputs, ensuring alignment with institutional policies and pedagogical objectives.`

export const contactText = `## Need Support?
${siteTitle} evolves in response to academic practice.

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

**${siteTitle} generates structured, rubric-aligned feedback for student assessments**. Build your rubric in the tool, then follow one of two workflows: upload a completed rubric and student submission for written work, or add comments live during presentations and vivas. All generated feedback is editable before release. You remain responsible for academic standards and final judgement throughout.

---

## What is it?

${siteTitle} is a rubric-led feedback tool designed for higher education (but works in other settings, too).

It generates structured, criterion-aligned feedback based on the rubric you define. You remain fully responsible for academic standards, judgement, and final output.

---

## How it Works

${siteTitle} supports two common assessment workflows:

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

These pre-written rubric comments are what ${siteTitle} uses to generate structured feedback when analysing student submissions.

The more clearly defined your rubric comments are, the stronger and more specific the generated feedback will be. 

---

### Marking Process

1. Export the completed rubric as a PDF.  
2. Upload the rubric PDF when marking [here](/feedback/submission-based-assessment).  
3. Also upload the student submissions as PDFs.  
4. Select **Get Feedback**.

${siteTitle} will produce:

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

${siteTitle} will use your recorded marks and live comments to produce structured, criterion-aligned student-facing feedback.

All generated output remains fully editable before release.

---

## Key Principles

- You define the rubric.  
- You determine the standards.  
- Workflow A uses pre-written rubric comments.  
- Workflow B uses live-added comments.  
- All generated feedback is reviewable and editable.  
- ${siteTitle} supports academic judgement — it does not replace it.

---

## Good Practice

To get the most from ${siteTitle}:

- Write clear and specific rubric criteria.  
- Avoid vague performance descriptors.  
- Review generated output before sharing with students.  
- Retain final records in accordance with institutional policy.

---`

export const fAQText = `## General

**What is it?**
${siteTitle} is a rubric-led feedback tool designed for higher education (but works in other settings, too). It generates structured, criterion-aligned feedback based on the rubric you define.

**Does it replace academic judgement?**
No. ${siteTitle} supports academic judgement — it does not replace it. You remain fully responsible for academic standards, the rubric you create, and all final output.

**Is the generated feedback editable?**
Yes. All generated feedback is fully editable before it is released to students.

---

## The Rubric

**How do I create a rubric?**
You build your rubric using the built-in spreadsheet-style editor. You define the assessment criteria, grade boundaries or performance levels, and any descriptive comments.

**Does the rubric need to be completed before marking?**
It depends on your workflow. For submission-based assessments (Workflow A, described below), the rubric should be fully completed before marking begins. For live or performance-based assessments (Workflow B), you only define the criteria and grade boundaries in advance — comments are added during the assessment itself.

**Does the quality of my rubric affect the feedback?**
Yes. The more clearly defined your rubric criteria and comments are, the stronger and more specific the generated feedback will be.

---

## Workflows

**What workflows are supported?**
${siteTitle} supports two workflows:
- **Workflow A** — for submission-based assessments such as essays, reports, and dissertations
- **Workflow B** — for live or performance-based assessments such as presentations, vivas, and practical work

**How does Workflow A work?**

1. Complete your rubric fully, including descriptive comments for each criterion and grade level.
2. Export the rubric as a PDF.
3. Upload the rubric PDF and the student's submission PDF.
4. Select **Get Feedback**.

${siteTitle} will produce criterion-aligned commentary, a structured explanation of performance, and clear areas for development.

**How does Workflow B work?**
1. Define your criteria and grade boundaries in the rubric, but leave comment cells blank.
2. During the live assessment, enter marks and add comments in real time using the rubric inside the tool.
3. Once complete, export the commented rubric as a PDF.
4. Re-upload the completed rubric PDF to generate structured feedback.

---

## Good Practice

**Any tips for getting the best results from ${siteTitle}?**
- Write clear and specific rubric criteria.
- Avoid vague performance descriptors.
- Review all generated output before sharing it with students.
- Retain final records in accordance with your institution's policy.

---

## Support

**How do I report a technical issue or suggest an improvement?**
Please contact us at [Insert contact email or link]. ${siteTitle} evolves in response to academic practice.`
