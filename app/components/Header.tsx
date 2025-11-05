'use client'

import React, { useState, useContext, useEffect} from "react"

import { usePathname } from 'next/navigation'

import { Menu } from './Menu'

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

export const Header = () => {
    
    const store = useContext(StoreContext)
    const path = usePathname()

    const [title, setTitle] = useState<string>('')

    useEffect(() => {
  
      if (path === '/' && store?.state.title != 'home')
      {
        store?.dispatch({
          type: StoreAction.TitleSet,
          payload: 'home',
        }) 
      }
  
    }, [path, store])
  
    useEffect(() => {
  
      setTitle(store?.state.title as string)
  
    }, [store?.state.title])

  return (
    <header>
        <div className="grid items-center justify-start">
          <p className="page-title">{title}</p>
        </div>        
        <div className="grid items-center justify-center">
          {path === '/' ? (
            <h1 className='site-title'>Feedbacker</h1>
          ) : (            
            <p className='site-title'>Feedbacker</p>//h1 probably taken by page title
          )}
        </div>
        <Menu />
    </header>
  )
}
