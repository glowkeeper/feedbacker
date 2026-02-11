'use client'

import { useContext, useEffect} from "react"

import { routes } from "@/app/config/config"

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

const HelpPage = () => {

  const store = useContext(StoreContext)

  const thisTitle = routes.help.route.title

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
      
      Help coming soon...

    </div> 
  )
}

export default HelpPage
