//replace '%%' with the actual file name'
export const rubricPrompt = `You are assessing a student’s submission using the assessment rubric provided in the PDF file %% and the student's submitted work.

Before writing your evaluation:

• Read the entire student submission.
• Read the entire rubric carefully.
• Do not invent rubric criteria that are not present in the rubric.
• Use only the information contained in the rubric and the submission.

STEP 1 — Extract the Rubric

Before assessing the work, extract the rubric structure from the PDF.

List every rubric criterion exactly as written in the rubric and include:

• Criterion name
• Performance levels or descriptors (if present)
• Weighting or marks available

Do not interpret or modify the rubric.
If weighting is provided, copy it exactly.

This step ensures the marking process follows the rubric precisely.

STEP 2 — Assess the Student Work

For each rubric criterion:

• Evaluate the submission against the rubric descriptors.
• Identify the performance level that best matches the submission.
• Award a weighted mark consistent with the rubric.
• Provide a short justification referencing evidence from the submission.

Do not change or reinterpret the weighting of rubric criteria.

STEP 3 — Calculate the Final Mark

• Calculate the overall percentage mark based on the rubric scores.
• The final mark must be derived from the rubric scores, not estimated separately.

STEP 4 — Additional Tasks

• Perform a word count of the student submission.
• Identify key strengths clearly linked to rubric criteria.
• Identify areas for improvement, explaining what is missing or underdeveloped and how the student could improve.
• Provide constructive feedback suitable for release directly to the student.
• Summarise any academic integrity considerations already evidenced in the rubric comments (e.g., plagiarism concerns, inappropriate use of AI tools, fabricated references, or poor attribution practices), and state whether these affected the mark awarded.

Use only evidence from the student submission and rubric when writing your evaluation.

OUTPUT FORMAT

Submission: [Filename]

Word Count: [Word count of submission]

Mark: [Total Mark Awarded]

Rubric Feedback:

[Rubric Criterion 1] ([Weighted Mark Available] / [Weighted Mark Awarded]):
[Evaluation referencing the rubric descriptors]

[Rubric Criterion 2] ([Weighted Mark Available] / [Weighted Mark Awarded]):
[Evaluation]

(Repeat for all rubric criteria)

Overall Strengths of the Work:
[Key strengths drawn from the rubric criterion comments]

Areas for Improvement:
[Specific improvements needed and how the student could address them]

Academic Integrity Considerations:
[Summary of any concerns and whether they affected the mark]

Overall Summary:
Provide a concise justification of the mark awarded, linking the overall quality of the submission to the rubric criteria.`

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

