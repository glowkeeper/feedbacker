'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'

type SubMenuLinks = {
  title: string
  links: MenuLink[]
}

export type MenuLink = {
  title: string
  route: string
}

type MenuSections = {
  [key: string]: MenuLink[]
}

type MenuType = {
  [key: string]: MenuSections
}

export const Menu = () => {

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [menu, setMenu] = useState<MenuType>({})

  useEffect(() => {

    //console.log('in here')

    // const menu: MenuType = {}
    // Object.keys(siteSections as TopLevel).forEach((section) => {
    //   //console.log('section', section)

    //   const sectionTitle = siteSections[section].title

    //   menu[sectionTitle] = {}
       
    //   siteSections[section].siteSections.forEach((subSection) => {
    //     //console.log('sub section', subSection)

    //     menu[sectionTitle][subSection.title] = []
        
    //     Object.keys(subSection.content).forEach(item => {

    //       const path = subSection.path

    //       const thisLink: MenuLink = {
    //         title: subSection.content[item].title,
    //         route: `${path}/${subSection.content[item].endPoint}`
    //       }

    //       menu[sectionTitle][subSection.title].push(thisLink)
          
    //     })
    //   })

    // })

    setMenu(menu)

  }, [])

  const onHasClosed = () => {

    const timer = setTimeout(() => {
      setIsOpen(true)
    }, 300)

    return () => clearInterval(timer)      
  }

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
                    className="menu-item-home on-primary"
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
                >
                
                  <p className="menu-sections">{section}</p> 
                    
                  {Object.keys(menu[section]).map(thisSection => {

                    return (
                      <p
                        key={`${section} + ${thisSection} + ${index}`}
                        className="menu-item on-primary"
                        onClick={() => {
                          const subMenu: SubMenuLinks = {
                            title: thisSection,
                            links: menu[section][thisSection]
                          }  
                          setIsOpen(false)                    
                        }}
                      >
                        {thisSection}
                      </p>
                    )
                  })}
                </div>

              )})}
          </div>
        </nav>
      </>
  )
}

{/* <SubMenu title={thisSection} links={menu[section][thisSection]} onClose={onClose} />    */}