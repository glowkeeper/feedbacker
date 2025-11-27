import { useContext } from "react"
import Link from 'next/link'
import Image from 'next/image'

import { usePathname } from 'next/navigation'

import { Menu } from './Menu'

import { siteTitle } from "@/app/config"

import {
  StoreContext
} from '@/app/store/store'

export const Header = () => {
    
    const store = useContext(StoreContext)
    const path = usePathname()

    const title = path === '/' && store?.state.title !== 'home' ? 'home' : store?.state.title as string

  return (
    <header className="grid grid-flow-col grid-cols-3 w-fulls">
      <div className="grid items-center justify-start">        
        <h2 className="pl-8">{title}</h2>
      </div>        
      <div className="grid grid-cols-2 items-center gap-4">
        <Link   
          className='grid justify-end '                
          href="/"
        >                                       
          <Image
            width="50"
            height="50"
            src="/images/logo.svg"
            alt="Feedbacker Logo"
          />
        </Link>        
        {path === '/' ? (
            <Link  
              className='grid justify-start'                
              href="/"
            >              
              <h1 className='site-title'>{siteTitle}</h1>
            </Link>
        ) : (      
          <Link  
            className='grid justify-start'                
            href="/"
          >         
            <p className='site-title'>{siteTitle}</p>
          </Link>
        )}
      </div>
      <Menu />
    </header>
  )
}
