export type Path = {
  title: string
  path: string
}

export type Menu = {
  [section: string]: Path
}

export type Routes = {
  [route: string]: {
    route: Path 
  }
}


export type Base64File = {
  file: File
  base64: string
}



