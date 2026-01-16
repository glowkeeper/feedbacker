"use client";

import { useContext, useEffect } from "react";
import Link from 'next/link'

import { StoreContext, StoreAction } from "@/app/store/store";

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
    <div className="pl-8 pr-8">
      <div className="grid grid-flow-row auto-row-auto items-start gap-2">
        <Link 
          href="/mark/rubric-and-submissions"
        >
          Rubric and Student Submission(s)
        </Link>          
        <Link 
          href="/mark/commented-rubric"
        >
          Commented Rubric
        </Link>  
      </div>
    </div>
  );
};

export default MarkPage;
