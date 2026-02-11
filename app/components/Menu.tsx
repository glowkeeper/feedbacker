import { useState } from 'react'
import Link from 'next/link'

import { routes } from "@/app/config/config"
import Image, { StaticImageData } from 'next/image'

import menuLogoBlack from "@/app/assets/images/logoBlack.svg"

import { menuSections } from '@/app/config/config'

type Menu = {
  [key: string]: {
    title: string
    route: string
  }
}

export const Menu = () => {

  const [isOpen, setIsOpen] = useState<boolean>(false)
  //const [menu, setMenu] = useState<MenuType>({})

  const menu: Menu = {}
  Object.keys(menuSections).forEach((section) => {
    //console.log('section', section)

    const sectionTitle = menuSections[section].title
    const sectionPath = menuSections[section].path

    menu[sectionTitle] = {
      title: menuSections[section].title,
      route: sectionPath
    }

  })
  
  return (
    <>        

      <div 
        id='menu-burger'
        className="grid justify-end"
      >
        <button
          id='menu-burger'
          onClick={() => setIsOpen(true)}
        >
          <p id="menu-burger">≡</p>
        </button>
      </div>

      {/* the menu - slides in and out via css */}
      <nav
        id='menu-nav'
        className={isOpen ? "open" : "close"}
      >
        <div
          className='grid grid-cols-1'
        >
          <div 
            className="grid justify-start my-2"
          >
            <Link                 
              href="/"
            >                                       
              <Image
                className="menu"
                src={menuLogoBlack as StaticImageData}
                alt="Feedbacker Logo"
              />
            </Link>
          </div>
          <div 
            className="grid justify-end my-2"
          >
            <button
              id='menu-close'
              className='menu-item'
              onClick={() => setIsOpen(false)}
            >
              X
            </button>
          </div>
          <Link
            className="grid justify-start menu-item"
            href="/"
            onClick={() => setIsOpen(false)}
          >                                        
            {routes.home.route.title}
          </Link>
        
          {Object.keys(menu).map((section, index) => {              

            return (

                <Link
                  key={index}
                  className="grid justify-start menu-item"
                  href={menu[section].route}
                  onClick={() => setIsOpen(false)}
                >                                        
                  {menu[section].title}
                </Link>

          )})}
        </div>
      </nav>
    </>
  )
}
