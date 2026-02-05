import Image, { StaticImageData } from 'next/image'

import { siteTitle } from "@/app/config"

import bulb from "@/app/assets/images/bulb.svg"
import thumb from "@/app/assets/images/thumb.svg"
import watch from "@/app/assets/images/watch.svg"

const Home = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-8">

      <div className="card hover:sepia-5 hover:shadow-2xl">
        <div className="card-body">
          <div className='grid grid-cols-2'>
            <h2 className='grid content-end'>Feedback Smarter</h2> 
            <figure>
              <Image
                className='home'
                src={bulb as StaticImageData}
                alt="feedback smarter"
                priority={true}
              />
            </figure>   
          </div>
          <ul className='list'>
            <li className='list-row pl-0'>{siteTitle} blends your academic expertise with automation and AI</li>
            <li className='list-row pl-0'>Keeps feedback human-focused, not machine-generated</li>
            <li className='list-row pl-0'>Reduces repetitive work so your attention stays on pedagogy</li>
            <li className='list-row pl-0'>Helps you deliver feedback students can genuinely act on</li>
          </ul> 
        </div>
      </div>

      <div className="card hover:sepia-5 hover:shadow-2xl">
        <div className="card-body">
          <div className='grid grid-cols-2'>
            <h2 className='grid content-end'>Feedback Faster</h2>
            <figure>
              <Image
                className='home'
                src={watch as StaticImageData}
                alt="feedback faster"
                priority={true}
              />
            </figure>
          </div>
          <ul className='list'>
            <li className='list-row pl-0'>Automates the slow, repetitive parts of marking</li>
            <li className='list-row pl-0'>Helps you produce personalised feedback in less time</li>
            <li className='list-row pl-0'>Shortens turnaround without sacrificing quality</li>
            <li className='list-row pl-0'>Frees up time for teaching, discussion, and student connection</li>
          </ul>
        </div>
      </div>

      <div className="card hover:sepia-5 hover:shadow-2xl">
        <div className="card-body">
          <div className='grid grid-cols-2'>
            <h2 className='grid content-end'>Feedback Better</h2>
            <figure>
              <Image
                className='home'
                src={thumb as StaticImageData}
                alt="feedback better"
                priority={true}
              />
            </figure>
          </div>
          <ul className='list'>
            <li className='list-row pl-0'>Makes it clear how students are performing</li>
            <li className='list-row pl-0'>Highlights where improvement is needed</li>
            <li className='list-row pl-0'>Points students towards actionable next steps</li>
            <li className='list-row pl-0'>Combines your insight with smart automation for feedback that is more impactful</li>
          </ul>
        </div>
      </div>
    </div>
  )
}


export default Home
