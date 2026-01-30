"use client";

import { useContext, useEffect } from "react";
import Link from 'next/link'
import Image, { StaticImageData } from 'next/image'

import { StoreContext, StoreAction } from "@/app/store/store";

import { routes } from "@/app/config";

import tick from "@/app/assets/images/tick.svg"
import plus from "@/app/assets/images/plus-circled.svg"

const MarkPage = () => {

  const store = useContext(StoreContext);

  const thisTitle = "mark";

  useEffect(() => {
    if (store?.state.title != thisTitle) {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      });
    }
  }, [store])
  
  return (

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-8">  

      <div className="card card-border bg-surface hover:glass hover:shadow-xl">
        <div className="card-body">
          <div className='grid grid-cols-2'>
            <h2 className='grid content-end'>Mark Work</h2>
            <figure>
              <Image
                className='home'
                src={tick as StaticImageData}
                alt="tick"
                priority={true}
              />
            </figure>
          </div>
          <ul className='list'>
            <li className='list-row pl-0'>Use the link below to to mark something</li>
            <li className='list-row pl-0'>
              <Link 
                href={routes.markWork.route.path}
              >
                {routes.markWork.route.title}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="card card-border bg-surface hover:glass hover:shadow-xl">
        <div className="card-body">
          <div className='grid grid-cols-2'>
            <h2 className='grid content-end'>Rubric</h2>
            <figure>
              <Image
                className='home'
                src={plus as StaticImageData}
                alt="commented rubric"
                priority={true}
              />
            </figure>
          </div>
          <ul className='list'>
            <li className='list-row pl-0'>Use the link below to create a rubric</li>
            <li className='list-row pl-0'>
              <Link 
                href={routes.markCreateRubric.route.path}
              >
                {routes.markCreateRubric.route.title}
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default MarkPage;
