'use client'

import { useContext, useEffect} from "react"
import Link from 'next/link'

import { routes } from "@/app/config/config"
import { siteTitle } from "@/app/config/text"

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

      <h3>Support <a href="https://huckle.studio" target="_blank" rel="noreferrer">Dr Steve Huckle</a>&apos;s open source work on {siteTitle}.</h3> 

      <Link
        className="btn bg-accent text-surface p-8"
        target="_blank"
        href='https://www.paypal.com/ncp/payment/R5Y64CQKMWWUW'
      >                                        
        Sponsor Dr Steve Huckle via PayPal
      </Link>    

      <br />  

      <Link
        className="btn bg-accent text-surface p-8 my-4"
        target="_blank"
        href='https://github.com/sponsors/glowkeeper'
      >                                        
        Sponsor Dr Steve Huckle on GitHub Sponsors (requires a GitHub account)
      </Link>

    </div> 
  )
}

export default SponsorPage
