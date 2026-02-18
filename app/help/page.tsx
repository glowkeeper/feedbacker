'use client'

import { useContext, useEffect} from "react"
import Image, { StaticImageData } from 'next/image'
import Link from 'next/link'

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { routes } from "@/app/config/config"
import { siteTitle, helptext } from "@/app/config/text"

import rubricSubmission from "@/app/assets/images/rubricSubmissionExample.png"
import rubricLive from "@/app/assets/images/rubricLiveExample.png"

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

const HelpPage = () => {

  const store = useContext(StoreContext)

  const thisTitle = routes.help.route.title

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
          
      <Markdown remarkPlugins={[remarkGfm]}>{helptext}</Markdown>

      <h2>Examples</h2>

      <p>Below gives some examples of how you might use {siteTitle}</p>

      <h3>Workflow A: Submission-Based Assessment</h3>

      <p>Below is an example of a rubric complete with pre-written comments which {siteTitle} can use to generate structured feedback when analysing a student&apos;s submission.</p>

      <button 
          className="btn" 
          id="rubricSubmissionExample"
          onClick={() => (document.getElementById('modal_on_rubric_submission_example') as HTMLDialogElement).showModal()}        
        >
        Submission-based rubric 
      </button>

      <p>Get feedback from such a rubric and student submissions here:</p>
      <Link 
        href={routes.feedbackSubmission.route.path}
      >
        {routes.feedbackSubmission.route.title}
      </Link>

      <h3>Workflow B: Live or Performance-Based Assessment</h3>

      <p>Use an example similar to the rubric below when assessing presentations, vivas, or other live work.</p>

      <button 
          className="btn" 
          id="rubricLiveExample"
          onClick={() => (document.getElementById('modal_on_rubric_live_example') as HTMLDialogElement).showModal()}        
        >
        Live rubric 
      </button>

      <p>Get feedback from the live-assessed rubric here:</p>
      <Link 
        href={routes.feedbackLive.route.path}
      >
        {routes.feedbackLive.route.title}
      </Link>


      <dialog id="modal_on_rubric_submission_example" className="modal">
        <div className="modal-box w-12/12 max-w-8/12 bg-white text-black">
          <figure>
            <Image
              className='feedback-example'
              src={rubricSubmission as StaticImageData}
              alt="rubric submission-based example"
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

      <dialog id="modal_on_rubric_live_example" className="modal">
        <div className="modal-box w-12/12 max-w-8/12 bg-white text-black">
          <figure>
            <Image
              className='feedback-example'
              src={rubricLive as StaticImageData}
              alt="rubric live-based example"
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

export default HelpPage
