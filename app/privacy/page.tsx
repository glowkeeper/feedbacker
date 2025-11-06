'use client'

import { useContext, useEffect} from "react"

import { siteTitle } from "@/app/config"

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

const PrivacyPage = () => {

  const store = useContext(StoreContext)

  const thisTitle = 'privacy'

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

    <>   
      
      <p>{siteTitle} is a tool that takes a human-centric approach to marking, utilising automation and AI to streamline the feedback process. {siteTitle} processes no personal data, nor does it share any personal data with those engines (or anyone else)when providing you with access to AI that helps deliver actionable assessment feedback.</p>   
  
    </>
  )
}

export default PrivacyPage
