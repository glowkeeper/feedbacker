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

    <div className="pl-8 pr-8">   
      
      <p>{siteTitle} does not collect or process any personally identifiable information.</p>
      <p>Some non-identifying data will be shared with AI engines solely to support the generation of actionable assessment feedback.</p>
      <p>No personal data is stored, shared, or used beyond this purpose, ensuring full compliance with GDPR and all relevant data protection standards.</p>  
  
    </div>
  )
}

export default PrivacyPage
