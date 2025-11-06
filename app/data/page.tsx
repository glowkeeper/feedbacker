'use client'

import { useContext, useEffect} from "react"

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

const DataPage = () => {

  const store = useContext(StoreContext)

  const thisTitle = 'data'

  useEffect(() => {
  
    if(store?.state.title != thisTitle) 
    {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      }) 
    }

  }, [store])

  return (

    <div className="pl-8 pr-8">   
      
      <p>Data coming soon...</p>
    </div>
  )
}

export default DataPage
