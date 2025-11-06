'use client'

import { useContext, useEffect} from "react"

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

const PromptPage = () => {

  const store = useContext(StoreContext)

  const thisTitle = 'prompt'

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
      
      <p>Prompt coming soon...</p>
    </div>
  )
}

export default PromptPage
