"use client";
import { useContext, useEffect, useState } from "react";

import { HotTable } from "@handsontable/react-wrapper";
import { HyperFormula } from 'hyperformula';

import { registerAllModules } from 'handsontable/registry';

import { StoreContext, StoreAction } from "@/app/store/store";

import { MarkStore } from "@/app/store/types";

import { markTemplateStoreName, defaultMark } from "@/app/config/config"

const ShowTemplates = () => {

  const [templates, setTemplates] = useState<MarkStore>({})

  const store = useContext(StoreContext);
  const formularEngine = {
    engine: HyperFormula,
    sheetName: 'Sheet1',
  }
  
  registerAllModules();

  const thisTitle = "show templates";

  useEffect(() => {
    if (store?.state.title != thisTitle) {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      });
    }
  }, [store])

  useEffect(() => {

    const doSetTemplates = (templates: MarkStore) => {
      
      setTemplates(templates)
    }

    if ( !Object.keys(templates).length ) {
    
      const theseTemplates = JSON.parse(localStorage.getItem(markTemplateStoreName) as string)
      if ( theseTemplates ) {
        doSetTemplates(theseTemplates)
      }
    }

  }, [templates])    

  return (
    <div className="pl-8 pr-8">   

      <h3 className="my-4">Default template</h3>

      <HotTable
        themeName='ht-theme-main'
        data={defaultMark}
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

      <h3 className="my-4">Stored Templates</h3>

      {Object.keys(templates).map(template => {

        const thisData = (templates as MarkStore)?.[template]

        return (
          <div key={template}>
            <h4>{template}</h4>
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
              formulas={formularEngine}
              licenseKey={process.env.NEXT_PUBLIC_HANDSONTABLE_LICENSE_KEY}
            /> 
          </div>

        )
      })}
      
    </div>
  );
};

export default ShowTemplates;