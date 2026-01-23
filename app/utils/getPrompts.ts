import { rubricPrompt, rubricWithCommentsPrompt } from "../config"

export const getRubricPrompt = (rubricFileName: string, filename: string): string => {
    const thisPrompt = rubricPrompt.replace("%%", rubricFileName);
    const prompt = thisPrompt + ` The student's work is attached below as ${filename}.`
    //console.log('new prompt', prompt)
    return prompt
}

export const getCommentedRubricPrompt = (rubricFileName: string): string => {
    const prompt = rubricWithCommentsPrompt.replace("%%", rubricFileName);
    console.log('new prompt', prompt)
    return prompt
}

