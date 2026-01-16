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


export type Base64File = {
  file: File
  base64: string
}



