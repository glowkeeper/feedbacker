import Image, { StaticImageData } from 'next/image'

import { siteTitle, headline, subHeading } from "@/app/config/text"

import bulb from "@/app/assets/images/bulb.svg"
import thumb from "@/app/assets/images/thumb.svg"
import watch from "@/app/assets/images/watch.svg"
import question from "@/app/assets/images/question.svg"
import academia from "@/app/assets/images/academicHat.svg"
import standards from "@/app/assets/images/standards.svg"

const Home = () => {
  return (
    <div className="pl-8 pr-8">  

      <h2>{headline}</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-4">        

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
              <li className='list-row pl-0'>Bases feedback on the rubrics you create</li>
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
              <li className='list-row pl-0'>{siteTitle} automates the slow, repetitive parts of marking</li>
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
              <li className='list-row pl-0'>{siteTitle} makes it clear how students are performing</li>
              <li className='list-row pl-0'>Highlights where improvement is needed</li>
              <li className='list-row pl-0'>Points students towards actionable next steps</li>
              <li className='list-row pl-0'>Combines your insight with smart automation for feedback that is more impactful</li>
            </ul>
          </div>
        </div>
      </div>

       <h3>{subHeading}</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-4">        

        <div className="card hover:sepia-5 hover:shadow-2xl">
          <div className="card-body">
            <div className='grid grid-cols-2'>
              <h2 className='grid content-end'>How it Works</h2> 
              <figure>
                <Image
                  className='home'
                  src={question as StaticImageData}
                  alt="how it works"
                  priority={true}
                />
              </figure>   
            </div>
            <ul className='list'>
              <li className='list-row pl-0'>{siteTitle} aligns with existing workflows:</li>
              <li className='list-row pl-0'>1. Select your rubric</li>
              <li className='list-row pl-0'>2. Upload student work</li>
              <li className='list-row pl-0'>3. Generate structured feedback you can edit</li>
            </ul> 
          </div>
        </div>

        <div className="card hover:sepia-5 hover:shadow-2xl">
          <div className="card-body">
            <div className='grid grid-cols-2'>
              <h2 className='grid content-end'>Built By and For Academics </h2>
              <figure>
                <Image
                  className='home'
                  src={academia as StaticImageData}
                  alt="academia"
                  priority={true}
                />
              </figure>
            </div>

            <ul className='list'>
              <li className='list-row pl-0'>{siteTitle} is built by a university lecturer</li>
              <li className='list-row pl-0'>Designed for higher education</li>
              <li className='list-row pl-0'>Developed and refined within real university teaching contexts</li>
              <li className='list-row pl-0'>Designed to support — not replace — academic judgement and disciplinary standards</li>
            </ul>
          </div>
        </div>

        <div className="card hover:sepia-5 hover:shadow-2xl">
          <div className="card-body">
            <div className='grid grid-cols-2'>
              <h2 className='grid content-end'>You Define the Standards</h2>
              <figure>
                <Image
                  className='home'
                  src={standards as StaticImageData}
                  alt="standards"
                  priority={true}
                />
              </figure>
            </div>
            <ul className='list'>
              <li className='list-row pl-0'>{siteTitle} enables you to create and control the rubric that shapes every piece of feedback</li>
              <li className='list-row pl-0'>Ensures comments are grounded in your criteria and expectations</li>
              <li className='list-row pl-0'>Adjust weightings, emphasis, and academic tone as you see fit</li>
              <li className='list-row pl-0'>Use automation to apply your standards consistently — not replace them</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}


export default Home
