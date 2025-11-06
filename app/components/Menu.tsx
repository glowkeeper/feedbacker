import { useState } from 'react'
import Link from 'next/link'

import { appSections } from '@/app/config'

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
  Object.keys(appSections).forEach((section) => {
    //console.log('section', section)

    const sectionTitle = appSections[section].title
    const sectionPath = appSections[section].path

    menu[sectionTitle] = {
      title: appSections[section].title,
      route: sectionPath
    }

  })
  
  const onHasLinked = () => {
    
    const timer = setTimeout(() => {
      setIsOpen(false)
    }, 300)

    return () => clearInterval(timer)      
  }

  return (
    <>        

      <div 
        id='menu-burger'
        className="grid justify-end"
      >
        <button
          onClick={() => {
            setIsOpen(true)
          }}
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
          className="grid justify-end"
        >
          <button
            onClick={() => {
              setIsOpen(false)
            }}
          >
            X
          </button>
          <br />
        </div>

        <div
          className='grid grid-flow-row justify-start'
        >
          <div
            className='grid grid-flow-col cols-1 justify-start'
          >
            <Link
              className="menu-item"
              href="/"
              onClick={() => {
                setIsOpen(false)
                onHasLinked()
              }}
            >                                        
              {'home'}
            </Link>
          </div>
          
          {Object.keys(menu).map((section, index) => {              

            return (
              <div
                key={index}
                className='grid grid-flow-col cols-1 justify-start'
              >
                <Link
                  key={index}
                  className="menu-item"
                  href={menu[section].route}
                  onClick={() => {
                    setIsOpen(false)
                    onHasLinked()
                  }}
                >                                        
                  {menu[section].title}
                </Link>
              </div>

            )})}
        </div>
      </nav>
    </>
  )
}
