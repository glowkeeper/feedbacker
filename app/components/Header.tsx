import { useState, useContext } from "react"

import { usePathname } from 'next/navigation'

import { Menu } from './Menu'

import { siteTitle } from "@/app/config"

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

export const Header = () => {
    
  const store = useContext(StoreContext)
  const path = usePathname()

  const home = 'home'

  const [title, setTitle] = useState<string>('')

  if (path === '/' && store?.state.title != home)
  {
    store?.dispatch({
      type: StoreAction.TitleSet,
      payload: home,
    }) 
    setTitle(home)
  } else if( store?.state.title !== title) {

    setTitle(store?.state.title as string)
  }

  return (
    <header className="grid grid-flow-col grid-cols-3 w-fulls">
      <div className="grid items-center justify-start">
        <p className="page-title">{title}</p>
      </div>        
      <div className="grid items-center justify-center">
        {path === '/' ? (
          <h1 className='site-title'>{siteTitle}</h1>
        ) : (            
          <p className='site-title'>{siteTitle}</p>//h1 probably taken by page title
        )}
      </div>
      <Menu />
    </header>
  )
}
