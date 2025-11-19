'use client'

import { useContext, useEffect} from "react"

import { routes } from '@/app/config'

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

const PromptAddPage = () => {

  const store = useContext(StoreContext)

  const thisTitle = routes.prompt.add.title

  useEffect(() => {
  
    if(store?.state.title != thisTitle) 
    {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      }) 
    }

  }, [store, thisTitle])

  return (

    <div className="pl-8 pr-8">   
      
      <p>Prompt add coming soon...</p>
    </div>
  )
}

export default PromptAddPage
