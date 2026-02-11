"use client";
import { useContext, useEffect, useState } from "react";

import { HotTable } from "@handsontable/react-wrapper";
import { HyperFormula } from 'hyperformula';

import { registerAllModules } from 'handsontable/registry';

import { routes } from "@/app/config/config";

import { StoreContext, StoreAction } from "@/app/store/store";
import { MarkStore } from "@/app/store/types";

import { markStoreName } from "@/app/config/config"

const ShowMarks = () => {

  const [marks, setMarks] = useState<MarkStore>({})

  const store = useContext(StoreContext);
    const formularEngine = {
      engine: HyperFormula,
      sheetName: 'Sheet1',
    }
  
  registerAllModules();

  const thisTitle = routes.markList.route.title;

  useEffect(() => {
    if (store?.state.title != thisTitle) {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      });
    }
  }, [store, thisTitle])

  useEffect(() => {

    const doSetMarks = (marks: MarkStore) => {
      
      setMarks(marks)
    }

    if ( !Object.keys(marks).length ) {
    
      const theseMarks = JSON.parse(localStorage.getItem(markStoreName) as string)
      if ( theseMarks ) {
        doSetMarks(theseMarks)
      }
    }

  }, [marks])  

  return (
    <div className="pl-8 pr-8">   
    
      <h3 className="my-4">Stored Marks</h3>

      {Object.keys(marks).map(mark => {

        const thisData = (marks as MarkStore)?.[mark]

        return (
          <div key={mark}>
            <h4>{mark}</h4>
            <HotTable
              key={mark}
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
              formulas={formularEngine}
              licenseKey={process.env.NEXT_PUBLIC_HANDSONTABLE_LICENSE_KEY}
            /> 
          </div>    
        )
      })}
      
    </div>
  );
};

export default ShowMarks;