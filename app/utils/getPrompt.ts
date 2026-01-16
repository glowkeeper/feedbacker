import { rubricPrompt } from "../config"

export const getPrompt = (filename: string): string => {
    const prompt = rubricPrompt + ` The student's work is attached below as ${filename}.`
    return prompt
}