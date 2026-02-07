"use client";
import { useContext, useEffect, useState } from "react";

import { HotTable } from "@handsontable/react-wrapper";

import { registerAllModules } from 'handsontable/registry';

import { StoreContext, StoreAction } from "@/app/store/store";

import { RubricStore } from "@/app/store/types";

import { rubricStoreName, defaultRubric } from "@/app/config/config"

const ShowRubrics = () => {

  const [rubrics, setRubrics] = useState<RubricStore>({})

  const store = useContext(StoreContext);
  
  registerAllModules();

  const thisTitle = "show rubrics";

  useEffect(() => {
    if (store?.state.title != thisTitle) {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      });
    }
  }, [store])

  useEffect(() => {

    const doSetRubrics = (rubrics: RubricStore) => {
      
      setRubrics(rubrics)
    }

    if ( !Object.keys(rubrics).length ) {
    
      const theseRubrics = JSON.parse(localStorage.getItem(rubricStoreName) as string)
      if ( theseRubrics ) {
        doSetRubrics(theseRubrics)
      }
    }

  }, [rubrics])    

  return (
    <div className="pl-8 pr-8">   

      <h3 className="my-4">Default rubric</h3>

      <HotTable
        themeName='ht-theme-main'
        data={defaultRubric}
        manualColumnResize={true}
        minRowHeights={40}
        manualRowResize={true}
        autoWrapRow={true}
        autoWrapCol={true}
        colHeaders={true}
        rowHeaders={true}
        type='text'
        allowInvalid={true}
        height='auto'
        contextMenu={true} 
        licenseKey={process.env.NEXT_PUBLIC_HANDSONTABLE_LICENSE_KEY}
      /> 

      <h3 className="my-4">Stored Rubrics</h3>

      {Object.keys(rubrics).map(rubric => {

        const thisData = (rubrics as RubricStore)?.[rubric]

        return (
          <div key={rubric}>
            <h4>{rubric}</h4>
            <HotTable
              themeName='ht-theme-main'
              data={thisData}
              manualColumnResize={true}
              minRowHeights={40}
              manualRowResize={true}
              autoWrapRow={true}
              autoWrapCol={true}
              colHeaders={true}
              rowHeaders={true}
              type='text'
              allowInvalid={true}
              height='auto'
              contextMenu={true} 
              licenseKey={process.env.NEXT_PUBLIC_HANDSONTABLE_LICENSE_KEY}
            /> 
          </div>

        )
      })}
      
    </div>
  );
};

export default ShowRubrics;