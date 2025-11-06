'use client'

import { useContext, useEffect} from "react"

import { siteTitle } from "@/app/config"

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

const ContactPage = () => {

  const store = useContext(StoreContext)

  const thisTitle = 'contact'

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
      
      <p>For information about {siteTitle}, please contact <a href="https://huckle.studio" target="_blank" rel="noreferrer">Dr Steve Huckle</a>.</p>
    </div>
  )
}

export default ContactPage
