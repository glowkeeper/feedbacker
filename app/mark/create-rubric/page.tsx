"use client";
import { useContext, useRef, useEffect, useState } from "react";

import { HotTable, HotTableRef } from "@handsontable/react-wrapper";

import { registerAllModules } from 'handsontable/registry';

import { StoreContext, StoreAction } from "@/app/store/store";

import { rubricStoreName } from "@/app/config"

const CreateRubric = () => {

  const rubricRef = useRef({} as HotTableRef);
  const [output, setOutput] = useState<string>('Click "Load" to load a prior rubric');
  const [isAutosave, setIsAutosave] = useState<boolean>(false);
  const [rubricName, setRubricName] = useState<string>("");
  const [rubrics, setRubrics] = useState<object>({})

  const store = useContext(StoreContext);
  
  registerAllModules();

  const thisTitle = "create rubric";

  useEffect(() => {
    if (store?.state.title != thisTitle) {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      });
    }
  }, [store])

  useEffect(() => {

    const doSetRubrics = (rubrics: object) => {
      
      setRubrics(rubrics)
    }

    if ( !Object.keys(rubrics).length ) {
    
      const theseRubrics = JSON.parse(localStorage.getItem(rubricStoreName) as string)
      if ( theseRubrics ) {
        doSetRubrics(theseRubrics)
      }
    }

  }, [rubrics])  

  const onSave = () => {
    const rubric = rubricRef?.current;    
    const data = (rubric as HotTableRef).hotInstance?.getData()
    let rubrics = JSON.parse(localStorage.getItem(rubricStoreName) as string)
    //console.log('rubrics', rubrics)
    if (rubrics) {

      rubrics = {...rubrics, [rubricName]: data}

    } else {

      rubrics = {
        [rubricName]: data
      }
    }

    localStorage.setItem(rubricStoreName, JSON.stringify(rubrics))
    setRubrics(rubrics)
  };

  const onAutoSave = (event: React.MouseEvent<HTMLInputElement, MouseEvent>) => {
    //console.log('auto event', event)
    const isChecked = (event.target as HTMLInputElement).checked;

    setIsAutosave(isChecked);

    if (isChecked) {
      setOutput('Changes will be autosaved');
    } else {
      setOutput('Changes will not be autosaved');
    }
  };

  const onLoad = (rubric: string) => {

    console.log('seelct', rubric)
    setRubricName(rubric)

    // let rubrics = JSON.parse(localStorage.getItem(rubricStoreName) as string)
    // if (rubrics) {


    // } else {

    // }
    
  };

  return (
    <div className="pl-8 pr-8">           
        
      <fieldset className="fieldset bg-base-100 border-base-300 rounded-box w-64 border p-4">
        <legend className="fieldset-legend">Save options</legend>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Rubric Name</legend>
          <input type="text" className="input" placeholder="name" value={rubricName ? rubricName : ""} onChange={e => setRubricName(e.target.value)}/>
        </fieldset>  
        
        <button disabled={rubricName === ""} className="btn my-2" onClick={() => onSave()}>
          Save as
        </button>  

        <label className="label">
          <input type="checkbox" className="checkbox" disabled={rubricName === ""} defaultChecked={isAutosave} onClick={(e) => onAutoSave(e)} />
          Autosave
        </label>
      </fieldset>

      <fieldset className="fieldset bg-base-100 border-base-300 rounded-box w-64 border p-4">
        <legend className="fieldset-legend">Load options</legend>
        <select defaultValue="Load a saved rubric" className="select" onChange={(e) => onLoad(e.target.value)}>
          <option disabled={true}>Load a saved rubric</option>
          {Object.keys(rubrics).map(rubricName => {
            return (<option key={rubricName} value={rubricName}>{rubricName}</option>)
          })}         
        </select>
      </fieldset>        
      
      <p>{output}</p>

      <HotTable
        themeName='ht-theme-main'
        startRows={10}
        startCols={5}
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
        ref={rubricRef}
        licenseKey={process.env.NEXT_PUBLIC_HANDSONTABLE_LICENSE_KEY}
      />
      
    </div>
  );
};

export default CreateRubric;