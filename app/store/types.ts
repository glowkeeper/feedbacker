export type App = {
  [section: string]: {
    title: string
    path: string
  }
}

export type Prompt = {
  promptId: string
  isDefault: boolean
  prompt: string
  created: string
}

export type Rubric = { 
  rubricId: string   
  created: string
  criteria: {
    [topCriteria: string]: { 
      [subCriteria: string]: {
        markLow: number
        markHigh: number
        comments: [
          {
            comment: string
            created: string
          }
        ]
      }
    }
  }
}

export type Mark = { 
  markId: string                 
  schemeTitle: string                     
  created: string                                          
  totalMarks: number            
  criteria: {
      [topCriteria: string]: { 
        [subCriteria: string]: {
          marksAvailable: number
          marks: number
          percent: number
          comment: string
        }
      }
  }
  total: number
  percent: number
  prompt: string
  lLM: string
  feedback: string
}

export type PromptsTable = {
  [promptsTableName: string]: {
    name: string
    key: string
    data: Prompt | object
  }
}

export type RubricTable = {
  [rubricTableName: string]: {
    name: string
    key: string
    data: Rubric | object
  }
}

export type MarksTable = {
  [marksTableName: string]: {    
    name: string
    key: string
    data: Mark | object
  }
}

export type Table = Prompt | Rubric | Mark

export type Tables = PromptsTable | RubricTable | MarksTable

export type DBase = PromptsTable & RubricTable & MarksTable



