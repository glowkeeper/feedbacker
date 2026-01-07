"use client";

import { useContext, useEffect } from "react";
import Link from 'next/link'

import { StoreContext, StoreAction } from "@/app/store/store";

const RubricPage = () => {
  const store = useContext(StoreContext);

  const thisTitle = "rubric";

  useEffect(() => {
    if (store?.state.title != thisTitle) {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      });
    }
  }, [store])

  return (
    <div className="bg-surface pl-8 pr-8">
      <p>Rubric Templates</p>     
      <Link
          href="/rubric/templates/acs"
        >
          ACS Template 
        </Link> 
    </div>
  );
};

export default RubricPage;
