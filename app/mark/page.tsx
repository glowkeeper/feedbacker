"use client";

import { useContext, useEffect } from "react";
import Link from 'next/link'
import Image, { StaticImageData } from 'next/image'

import { StoreContext, StoreAction } from "@/app/store/store";

import { routes } from "@/app/config/config";

import document from "@/app/assets/images/document.svg"
import list from "@/app/assets/images/list.svg"
//import tick from "@/app/assets/images/tick.svg"
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

    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-8">        

      <div className="card hover:sepia-5 hover:shadow-2xl">
        <div className="card-body">
          <div className='grid grid-cols-2'>
            <h2 className='grid content-end'>Create Marks</h2>
            <figure>
              <Image
                className='home'
                src={plus as StaticImageData}
                alt="tick"
                priority={true}
              />
            </figure>
          </div>
          <ul className='list'>
            <li className='list-row pl-0'>Use the link below to to mark something</li>
            <li className='list-row pl-0'>
              <Link 
                href={routes.markCreate.route.path}
              >
                {routes.markCreate.route.title}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="card hover:sepia-5 hover:shadow-2xl">
        <div className="card-body">
          <div className='grid grid-cols-2'>
            <h2 className='grid content-end'>List Marks</h2>
            <figure>
              <Image
                className='home'
                src={list as StaticImageData}
                alt="tick"
                priority={true}
              />
            </figure>
          </div>
          <ul className='list'>
            <li className='list-row pl-0'>Use the link below to to show marks</li>
            <li className='list-row pl-0'>
              <Link 
                href={routes.markList.route.path}
              >
                {routes.markList.route.title}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="card hover:sepia-5 hover:shadow-2xl">
        <div className="card-body">
          <div className='grid grid-cols-2'>
            <h2 className='grid content-end'>Create Templates</h2>
            <figure>
              <Image
                className='home'
                src={document as StaticImageData}
                alt="tick"
                priority={true}
              />
            </figure>
          </div>
          <ul className='list'>
            <li className='list-row pl-0'>Use the link below to create mark templates</li>
            <li className='list-row pl-0'>
              <Link 
                href={routes.markTemplates.route.path}
              >
                {routes.markTemplates.route.title}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="card hover:sepia-5 hover:shadow-2xl">
        <div className="card-body">
          <div className='grid grid-cols-2'>
            <h2 className='grid content-end'>Show Templates</h2>
            <figure>
              <Image
                className='home'
                src={list as StaticImageData}
                alt="tick"
                priority={true}
              />
            </figure>
          </div>
          <ul className='list'>
            <li className='list-row pl-0'>Use the link below to show mark templates</li>
            <li className='list-row pl-0'>
              <Link 
                href={routes.markTemplatesList.route.path}
              >
                {routes.markTemplatesList.route.title}
              </Link>
            </li>
          </ul>
        </div>
      </div>


    </div>
  );
};

export default MarkPage;
