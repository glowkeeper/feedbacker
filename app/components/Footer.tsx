import Link from 'next/link'

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
      <p className="footer-item">
        © 2025, <a href="https://huckle.studio" target="_blank" rel="noreferrer">Dr Steve Huckle</a>
      </p>

      <div className="grid grid-flow-row auto-rows-auto">
        <Link 
          href="/about"
        >
          about
        </Link>          
        <Link 
          href="/privacy"
        >
          privacy
        </Link> 
      </div>
      <div className="grid grid-flow-row auto-rows-auto">
        <Link 
          href="/terms"
        >
          terms of use
        </Link>  
        <Link 
          href="/contact"
        >
          contact
        </Link>   
      </div>   

      <div className="max-sm:hidden">
        <a href="https://github.com/glowkeeper/feedbacker" target="_blank" rel="noreferrer">
          <Image          
            className='footer'
            src={github as StaticImageData}
            alt="Feedbacker GitHub"
          />
        </a>
      </div>  
    </footer>
  )
}
