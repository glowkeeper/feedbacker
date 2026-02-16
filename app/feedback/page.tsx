"use client";

import { useContext, useEffect } from "react";
import Link from 'next/link'
import Image, { StaticImageData } from 'next/image'

import { StoreContext, StoreAction } from "@/app/store/store";

import { routes } from "@/app/config/config";

import rubric from "@/app/assets/images/rubric.svg"
import comment from "@/app/assets/images/comment.svg"

const FeedbackPage = () => {

  const store = useContext(StoreContext);

  const thisTitle = routes.feedback.route.title;

  useEffect(() => {
    if (store?.state.title != thisTitle) {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      });
    }
  }, [store, thisTitle])
  
  return (

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-8">  

      <div className="card hover:sepia-5 hover:shadow-2xl">
        <div className="card-body">
          <div className='grid grid-cols-2'>
            <h2 className='grid content-end'>Submission-Based Assessment</h2>
            <figure>
              <Image
                className='home'
                src={rubric as StaticImageData}
                alt="rubric"
                priority={true}
              />
            </figure>
          </div>
          <ul className='list'>
            <li className='list-row pl-0'>Use the link below to upload a comment complete rubric alongside student submissions</li>
            <li className='list-row pl-0'>
              <Link 
                href={routes.feedbackSubmission.route.path}
              >
                {routes.feedbackSubmission.route.title}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="card hover:sepia-5 hover:shadow-2xl">
        <div className="card-body">
          <div className='grid grid-cols-2'>
            <h2 className='grid content-end'>Live Assessment</h2>
            <figure>
              <Image
                className='home'
                src={comment as StaticImageData}
                alt="commented rubric"
                priority={true}
              />
            </figure>
          </div>
          <ul className='list'>
            <li className='list-row pl-0'>Use the link below to upload a live assessment in the form of written comments and marks entered into a rubric</li>
            <li className='list-row pl-0'>
              <Link 
                href={routes.feedbackLive.route.path}
              >
                {routes.feedbackLive.route.title}
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default FeedbackPage;
