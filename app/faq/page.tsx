'use client'

import { useContext, useEffect} from "react"

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { routes } from "@/app/config/config"
import { fAQText } from "@/app/config/text"

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

const FAQPage = () => {

  const store = useContext(StoreContext)

  const thisTitle = routes.faq.route.title

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
          
      <Markdown remarkPlugins={[remarkGfm]}>{fAQText}</Markdown>

    </div> 
  )
}

export default FAQPage
