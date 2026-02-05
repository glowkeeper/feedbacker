"use client";

import { useContext, useEffect } from "react";
import Link from 'next/link'
import Image, { StaticImageData } from 'next/image'

import { StoreContext, StoreAction } from "@/app/store/store";

import { routes } from "@/app/config";

import list from "@/app/assets/images/list.svg"
import plus from "@/app/assets/images/plus-circled.svg"

const MarkPage = () => {

  const store = useContext(StoreContext);

  const thisTitle = "rubrics";

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

      <div className="card hover:sepia-5 hover:shadow-2xl">
        <div className="card-body">
          <div className='grid grid-cols-2'>
            <h2 className='grid content-end'>Create Rubric</h2>
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
            <li className='list-row pl-0'>Use the link below to create rubrics</li>
            <li className='list-row pl-0'>
              <Link 
                href={routes.rubricCreate.route.path}
              >
                {routes.rubricCreate.route.title}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="card hover:sepia-5 hover:shadow-2xl">
        <div className="card-body">
          <div className='grid grid-cols-2'>
            <h2 className='grid content-end'>Show Rubrics</h2>
            <figure>
              <Image
                className='home'
                src={list as StaticImageData}
                alt="list rubrics"
                priority={true}
              />
            </figure>
          </div>
          <ul className='list'>
            <li className='list-row pl-0'>Use the link below to show/edit created rubrics</li>
            <li className='list-row pl-0'>
              <Link 
                href={routes.rubricList.route.path}
              >
                {routes.rubricList.route.title}
              </Link>
            </li>
          </ul>
        </div>
      </div>

    </div>
  );
};

export default MarkPage;
