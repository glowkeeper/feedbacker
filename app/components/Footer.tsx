import Link from 'next/link'

import { routes } from "@/app/config/config"
import { siteTitle } from "@/app/config/text"

import Image, { StaticImageData } from 'next/image'

import nextLogo from "@/app/assets/images/nextLogo.png"
import github from "@/app/assets/images/GitHub_Invertocat_White.svg"

export const Footer = () => {
  return (    
    <footer className="grid grid-flow-col auto-cols-auto items-center justify-center gap-16">  
      <div className="max-sm:hidden grid grid-flow-col items-center cols-2 gap-2">
        <p className="footer-item">Built using</p>
        <Link
          href="https://nextjs.org/"
        >
          <Image
            className='footer'
            src={nextLogo as StaticImageData}
            alt="Next.JS"
          />        
        </Link>
      </div> 
      <p className="footer-item p-2">
        © 2025, <a href="https://huckle.studio" target="_blank" rel="noreferrer">Dr Steve Huckle</a>
      </p>

      <div className="grid grid-flow-row auto-rows-auto gap-2">
        <Link 
          href={routes.about.route.path}
        >
          {routes.about.route.title}
        </Link>          
        <Link 
          href={routes.privacy.route.path}
        >
          {routes.privacy.route.title}
        </Link> 
      </div>
      <div className="grid grid-flow-row auto-rows-auto gap-2">
        <Link 
          href={routes.terms.route.path}
        >
          {routes.terms.route.title}
        </Link>  
        <Link 
          href={routes.contact.route.path}
        >
          {routes.contact.route.title}
        </Link>         
        <Link 
          href={routes.sponsor.route.path}
        >
          {routes.sponsor.route.title}
        </Link>   
      </div>   

      <div className="max-sm:hidden">
        <a href="https://github.com/glowkeeper/feedbacker" target="_blank" rel="noreferrer">
          <Image          
            className='footer'
            src={github as StaticImageData}
            alt={`${siteTitle} GitHub`}
          />
        </a>
      </div>  
    </footer>
  )
}

//<iframe src="https://github.com/sponsors/glowkeeper/card" title="Sponsor glowkeeper" height="225" width="600" style="border: 0;"></iframe>