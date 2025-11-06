import Link from 'next/link'
import Image from 'next/image'

export const Footer = () => {
  return (    
    <footer className="grid grid-flow-col auto-cols-auto items-center justify-center gap-16">  
      <div className="max-sm:hidden grid grid-flow-col cols-2 items-center justify-start gap-2">
        <p className="footer-item">Built using</p>
        <Link
          href="https://nextjs.org/"
        >
          <Image
            width="50"
            height="50"
            src="/images/nextLogo.png"
            alt="Next.JS"
          />        
        </Link>
      </div> 
      <p className="footer-item">
        © 2025, <a href="https://huckle.studio" target="_blank" rel="noreferrer">Dr Steve Huckle</a>
      </p>

      <div className="grid grid-flow-row auto-rows-auto items-start justify-center gap-2">
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
        <Link 
          href="/contact"
        >
          contact
        </Link>   
      </div>   

      <div className="max-sm:hidden">
        <a href="https://github.com/glowkeeper/feedbacker" target="_blank" rel="noreferrer">
          <Image
            width="50"
            height="50"
            src="/images/github-mark.png"
            alt="Feedbacker GitHub"
          />
        </a>
      </div>  
    </footer>
  )
}
