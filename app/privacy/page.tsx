'use client'

import { useContext, useEffect} from "react"

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { privacyText } from "@/app/config"

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
      
      <Markdown remarkPlugins={[remarkGfm]}>{privacyText}</Markdown>     
  
    </div>
  )
}

export default PrivacyPage
