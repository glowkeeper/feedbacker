'use client'

import { useContext, useEffect} from "react"

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { routes } from "@/app/config/config"
import { aboutText } from "@/app/config/text"

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

const AboutPage = () => {

  const store = useContext(StoreContext)

  const thisTitle = routes.about.route.title

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
      
      <Markdown remarkPlugins={[remarkGfm]}>{aboutText}</Markdown>

    </div> 
  )
}

export default AboutPage
