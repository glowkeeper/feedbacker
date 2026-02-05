import { useState } from 'react'
import Link from 'next/link'

import { menuSections } from '@/app/config'

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
          className='grid cols-1'
        >
          <div 
            className="grid justify-end"
          >
            <button
              onClick={() => setIsOpen(false)}
            >
              X
            </button>
            <br />
          </div>

          <Link
            className="grid justify-start menu-item"
            href="/"
            onClick={() => setIsOpen(false)}
          >                                        
            {'home'}
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
