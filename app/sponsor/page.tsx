'use client'

import { useContext, useEffect} from "react"

import { routes } from "@/app/config/config"

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

const SponsorPage = () => {

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
      
        <iframe 
          src="https://github.com/sponsors/glowkeeper/card"
          title="Sponsor glowkeeper" 
          height="auto" 
          width="30%" 
          style={{
            border: 0
          }}>            
        </iframe>

    </div> 
  )
}

export default SponsorPage
