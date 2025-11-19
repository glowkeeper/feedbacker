'use client'

import { useState, useContext, useEffect} from "react"
import Link from 'next/link'
import { IDBPDatabase } from 'idb'

import { addData, getAllData } from '@/app/utils/dbase'
import type { Prompt } from '@/app/store/types'
import { defaultPrompt, routes, dBase } from '@/app/config'

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

const PromptPage = () => {

  const store = useContext(StoreContext)

  const thisTitle = routes.prompt.route.title

  const [prompts, setPrompts] = useState<Prompt[]>([])
  
      useEffect(() => {
  
          const getPrompts = async () => {

              const db = store?.state.db as IDBPDatabase

              if ( db ) {

                const storedPrompts = await getAllData(db, dBase.prompts.name) 
                
                console.log('prompts', storedPrompts)
                const thisPrompts = []
                
                if ( storedPrompts.length ) {
    
                    storedPrompts.forEach(prompt => {
                        
                        if (prompt.isDefault ) {
                            thisPrompts.unshift(prompt)
                        } else {
                            thisPrompts.push(prompt)
                        }
                    })

                } else {        
                  
                    const promptsData: Prompt = {
                        id: 1,
                        isDefault: true, 
                        prompt: defaultPrompt,
                        created: Date.now().toString()
                    }
                    await addData(db,  dBase.prompts.name, promptsData)
                    thisPrompts.push(promptsData)
                }             
    
                setPrompts(thisPrompts)  

              }                  
          }
  
          getPrompts()
  
      }, [store?.state.db])    

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

      {prompts.map((prompt, index) => {

        return (

          <div
            key={index}
          >      
            {prompt.prompt}
            <Link
              className="menu-item"
              href={routes.prompt.add.path}
            >                                        
              {routes.prompt.add.title}
            </Link>

            <Link
              className="menu-item"
              href={routes.prompt.edit.path}
            >                                        
              {routes.prompt.edit.title}
            </Link>
          </div>
      )})}
    </div>
  )
}

export default PromptPage
