"use client";

import { useContext, useEffect } from "react";

import { StoreContext, StoreAction } from "@/app/store/store";

const MarkWork = () => {

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
      Mark work coming soon
    </div>
  );
};

export default MarkWork;
