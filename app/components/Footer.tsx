import Link from 'next/link'
import Image from 'next/image'

export const Footer = () => {
  return (    
    <footer>  
      <div className="max-sm:hidden grid grid-flow-col cols-2 items-center justify-start gap-2">
        <p className="footer-item on-secondary">Built using</p>
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
        © 2025, Dr Steve Huckle
      </p>

      <div className="grid grid-flow-row auto-rows-auto items-start justify-center gap-2">
        <Link 
          href="/about/contact"
        >
          contact
        </Link>   
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
    </footer>
  )
}
