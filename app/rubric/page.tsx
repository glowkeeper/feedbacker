'use client'

import { useContext, useEffect} from "react"

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

const RubricPage = () => {

  const store = useContext(StoreContext)

  const thisTitle = 'rubric'

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
      
      <p>Rubric coming soon...</p>
    </div>
  )
}

export default RubricPage
