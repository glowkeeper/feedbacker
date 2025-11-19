export type Path = {
  title: string
  path: string
}

export type Menu = {
  [section: string]: Path
}

export type Routes = {
  [topLevelRoute: string]: {
    route: Path
    [subLevelRoute: string]: Path    
  }
  }

export type Prompt = {
  id: number
  isDefault: boolean
  prompt: string
  created: string
}

export type Rubric = { 
  id: number
  rubricTitle: string                                   
  marksAvailable: number     
  created: string  
  criteria: {
    [criteriaHeading: string]: {                                         
      marksAvailable: number 
      subCriteria: {
        [criteria: string]: {
          marksAvailable: number          
          comments: {
            [upperBoundPercent: number]: {
              comment: string
              created: string
            }
          }
        }
      }
    }
  }
}

export type Mark = { 
  id: number                 
  rubricId: string    
  rubricTitle: string                                    
  marksAvailable: number         
  criteria: {
      [criteriaHeading: string]: {                                         
        marksAvailable: number 
        subCriteria: {
          [criteria: string]: {
            marksAvailable: number
            mark: number
            comment: string
          }
        }
      }
  }
  mark: number
  percent: number
  prompt: string
  lLM: string
  feedback: string                     
  created: string     
}

export type Table = Prompt | Rubric | Mark | object

export type DBase = {
  [tableName: string]: {
    name: string
    key: string
    data: Table
  }
}


