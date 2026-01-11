//import { useEffect } from 'react'

type FetchWithCallback = ({ url, fetchOptions, callback }: FetchProps) => Promise<void>
type FetchWithReturn = ({ url, fetchOptions }: FetchProps) => Promise<Choices[]>

interface FetchProps {
  url: string
  fetchOptions: RequestInit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback?: (data: any) => void
}

export interface Choices {
  message: {
    content: string
  }
}

export const fetchDataCallback: FetchWithCallback = async ({ url, fetchOptions, callback }) => {
  //console.log(url, fetchOptions, callback)
  await fetch(url, fetchOptions)
    .then(async (response: Response) => {
      if (!response.ok) {

        throw new Error('Network response was not ok')
      }
      const data = await response.json()
      if (callback) {
        callback(data)
      }
    })
    .catch((error) => console.error('Error fetching data:', error))
}

export const fetchData: FetchWithReturn = async ({ url, fetchOptions }) => {
  //console.log(url, fetchOptions)
  let data: Choices[] = []
  await fetch(url, fetchOptions)
    .then(async (response: Response) => {
      if (!response.ok) {
        //console.log('response', response)
        throw new Error('Network response was not ok')
      }
      const json = await response.json()
      data = json?.choices
    })
    .catch((error) => console.error('Error fetching data:', error))

  return data
}
