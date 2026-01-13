import { useContext } from "react"
import Link from 'next/link'
import Image, { StaticImageData } from 'next/image'

import { usePathname } from 'next/navigation'

import { Menu } from './Menu'

import { siteTitle } from "@/app/config"

import siteLogo from "@/app/assets/images/logo.svg"

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
      <div className="grid grid-cols-2 gap-1 md:gap-4">
        <Link   
          className='grid items-center justify-start md:justify-end'                
          href="/"
        >                                       
          <Image
            className="header"
            src={siteLogo as StaticImageData}
            alt="Feedbacker Logo"
          />
        </Link>        
        {path === '/' ? (
            <Link  
              className='grid items-center justify-start'                
              href="/"
            >              
              <h1 className='site-title'>{siteTitle}</h1>
            </Link>
        ) : (      
          <Link  
            className='grid items-center justify-start'                
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
