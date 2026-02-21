"use client";
import Link from 'next/link'

import Image, { StaticImageData } from 'next/image'

import { routes } from "@/app/config/config"
import { siteTitle, headline, subHeading, createRubric, trustCue } from "@/app/config/text"

import bulb from "@/app/assets/images/bulb.svg"
import thumb from "@/app/assets/images/thumb.svg"
import watch from "@/app/assets/images/watch.svg"
import question from "@/app/assets/images/question.svg"
import academia from "@/app/assets/images/academicHat.svg"
import standards from "@/app/assets/images/standards.svg"
import view from "@/app/assets/images/view.svg"
import transparent from "@/app/assets/images/transparent.svg"
import trophy from "@/app/assets/images/trophy.svg"

import feedbackExample from "@/app/assets/images/feedbackExampleMerged.png"

const Home = () => {

  return (
    <div className="pl-8 pr-8">  

      {/* Hero section */}

      <div className="grid grid-cols-1 md:grid-cols-3 my-4">  

        <div className="grid md:col-span-2">  

          <h2>{headline}</h2>
          <h3>{subHeading}</h3>
          <h3>{createRubric}</h3>
        </div>        

        
        <div className="grid grid-cols-1">

          <div className="grid justify-end">
            <Link href={routes.rubricCreate.route.path}>
              <button 
                className="btn"         
              >
                Create your rubric
              </button>
            </Link>
          </div>

          <div className="grid justify-end">
            <Link href={routes.feedback.route.path}>
              <button 
                className="btn"         
              >
                Generate Feedback
              </button>
            </Link>
          </div>

          <div className="grid justify-end">
            <Link href={routes.help.route.path}>
              <button 
                className="btn"         
              >
                Help
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* Core Benefits  */}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-8">        

        <div className="card hover:sepia-5 hover:shadow-2xl">
          <div className="card-body">
            <div className='grid grid-cols-2'>
              <h2 className='grid content-end'>Feedback Smarter</h2> 
              <figure className="grid justify-end">
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
              <li className='list-row pl-0'>Works with your existing marking workflow - bases feedback on rubrics you create here or prepare using your preferred tools</li>
              <li className='list-row pl-0'>Reduces repetitive work so your attention stays on pedagogy</li>
              <li className='list-row pl-0'>Helps you deliver feedback students can genuinely act on</li>
            </ul> 
          </div>
        </div>

        <div className="card hover:sepia-5 hover:shadow-2xl">
          <div className="card-body">
            <div className='grid grid-cols-2'>
              <h2 className='grid content-end'>Feedback Faster</h2>
              <figure className="grid justify-end">
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
              <figure className="grid justify-end">
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

      {/* Credibility → Authority → Accountability */}

      <h3>{trustCue}</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-8">        

        <div className="card hover:sepia-5 hover:shadow-2xl">
          <div className="card-body">
            <div className='grid grid-cols-2'>
              <h2 className='grid content-end'>Built By and For Academics </h2>
              <figure className="grid justify-end">
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
              <li className='list-row pl-0'>Designed for higher education (but works in other settings, too)</li>
              <li className='list-row pl-0'>Developed and refined within real university teaching contexts</li>
              <li className='list-row pl-0'>Designed to support — not replace — academic judgement and disciplinary standards</li>
            </ul>
          </div>
        </div>

        <div className="card hover:sepia-5 hover:shadow-2xl">
          <div className="card-body">
            <div className='grid grid-cols-2'>
              <h2 className='grid content-end'>You Define the Standards</h2>
              <figure className="grid justify-end">
                <Image
                  className='home'
                  src={standards as StaticImageData}
                  alt="standards"
                  priority={true}
                />
              </figure>
            </div>
            <ul className='list'>
              <li className='list-row pl-0'>{siteTitle} works with rubrics you create inside the tool or design externally using your usual workflow</li>
              <li className='list-row pl-0'>Ensures comments are grounded in your criteria and expectations</li>
              <li className='list-row pl-0'>Adjust weightings, emphasis, and academic tone as you see fit</li>
              <li className='list-row pl-0'>Use automation to apply your standards consistently — not replace them</li>
            </ul>
          </div>
        </div>

         <div className="card hover:sepia-5 hover:shadow-2xl">
          <div className="card-body">
            <div className='grid grid-cols-2'>
              <h2 className='grid content-end'>Transparent and Reviewable</h2> 
              <figure className="grid justify-end">
                <Image
                  className='home'
                  src={transparent as StaticImageData}
                  alt="transparent"
                  priority={true}
                />
              </figure>   
            </div>

            <ul className='list'>
              <li className='list-row pl-0'>{siteTitle} ensures feedback aligns with each rubric criterion</li>
              <li className='list-row pl-0'>Review and edit all generated comments before release</li>
              <li className='list-row pl-0'>Maintain clarity for students and for moderation processes</li>
              <li className='list-row pl-0'>Keep assessment decisions open, defensible, and documented</li>
            </ul> 
          </div>
        </div>
      </div>

      {/* CTA */}

      <h3>Ready to make marking more consistent and less time-consuming? Try {siteTitle} with your own rubric and see how it supports your assessment process.</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-8">        
        
        <div className="card hover:sepia-5 hover:shadow-2xl">
          <div className="card-body">
            <div className='grid grid-cols-2'>
              <h2 className='grid content-end'>How it Works</h2> 
              <figure className="grid justify-end">
                <Image
                  className='home'
                  src={question as StaticImageData}
                  alt="how it works"
                  priority={true}
                />
              </figure>   
            </div>
            <ul className='list'>
              <li className='list-row pl-0'>{siteTitle} streamlines the marking workflow:</li>
              <li className='list-row pl-0'>1. Create or upload your rubric</li>
              <li className='list-row pl-0'>2. Upload student work(s)</li>
              <li className='list-row pl-0'>3. Quickly generate structured feedback you can edit</li>
            </ul> 

            <div className="grid justify-start">
              <Link href={routes.help.route.path}>
                <button 
                  className="btn"         
                >
                  Help
                </button>
              </Link>
            </div>
          </div>

        </div>        
        
        <div className="card hover:sepia-5 hover:shadow-2xl">
          <div className="card-body">
            <div className='grid grid-cols-2'>
              <h2 className='grid content-end'>What it Looks Like</h2> 
              <figure className="grid justify-end">
                <Image
                  className='home'
                  src={view as StaticImageData}
                  alt="how it works"
                  priority={true}
                />
              </figure>   
            </div>

            <div>
              
              <ul className='list'>
                <li className='list-row pl-0'>{siteTitle} aligns to your rubric&apos;s criteria</li>
                <li className='list-row pl-0'>Key strengths and areas for improvement highlighted</li>
                <li className='list-row pl-0'>Submissions summarised</li>
                <li className='list-row pl-0'>Editable before release</li>
              </ul> 

              <div className="grid justify-start" >
                <button 
                    className="btn" 
                    onClick={() => (document.getElementById('modal_on_example') as HTMLDialogElement).showModal()}        
                  >
                  See Example Feedback
                </button>
              </div>

            </div>

            
          </div>
        </div>

        <div className="card hover:sepia-5 hover:shadow-2xl">
          <div className="card-body">
            <div className='grid grid-cols-2'>
              <h2 className='grid content-end'>Try it Now</h2>
              <figure className="grid justify-end">
                <Image
                  className='home'
                  src={trophy as StaticImageData}
                  alt="academia"
                  priority={true}
                />
              </figure>
            </div>

            <div>
              
              <ul className='list'>
                <li className='list-row pl-0'>Create a rubric here or upload one you already use</li>
              </ul>

              <div className="grid justify-start">
                <Link href={routes.rubric.route.path}>
                  <button 
                    className="btn"         
                  >
                    Create your rubric
                  </button>
                </Link>
              </div>

              <ul className='list'>
                <li className='list-row pl-0'>See how structured, criterion-aligned feedback looks in practice</li>
              </ul>

              <div className="grid justify-start" >
                <Link href={routes.feedback.route.path}>
                  <button 
                    className="btn"         
                  >
                    Start Generating Feedback
                  </button>
                </Link>
              </div>             

            </div>            
          </div>
        </div>        
      </div>

      <dialog id="modal_on_example" className="modal">
        <div className="modal-box w-12/12 max-w-8/12 bg-white text-black">
          <figure>
            <Image
              className='feedback-example'
              src={feedbackExample as StaticImageData}
              alt={`${siteTitle} example`}
              priority={true}
            />
          </figure>
          <form method="dialog">
            <button
              className="btn bg-gray-300 text-black"
            >
              Close
            </button>
          </form>
        </div>
      </dialog>
    </div>
  )
}


export default Home
