'use client'

import { useContext, useEffect} from "react"

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { termsText } from "@/app/config/text"

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

const TermsPage = () => {

  const store = useContext(StoreContext)

  const thisTitle = 'terms of use'

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
      
      <Markdown remarkPlugins={[remarkGfm]}>{termsText}</Markdown>     
  
    </div>
  )
}

export default TermsPage
