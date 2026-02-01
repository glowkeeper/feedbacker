"use client";
import { useContext, useRef, useEffect, useState } from "react";

import { HotTable, HotTableRef } from "@handsontable/react-wrapper";
import { registerAllModules } from 'handsontable/registry';

import { StoreContext, StoreAction } from "@/app/store/store";

import { rubricStoreName, defaultRubric } from "@/app/config"

import { saveToPDF, saveToCSV } from "@/app/utils/exportData"

type NewData = {
  rubricName: string
  data: string[][]
}

const initialNewData: NewData = {
  rubricName: "",
  data: [[]]
}

const CreateRubric = () => {

  const rubricRef = useRef({} as HotTableRef);
  const [saveOutput, setSaveOutput] = useState<string>('To save your rubric, you must give it a name');
  const [isAutosave, setIsAutosave] = useState<boolean>(false);
  const [rubricName, setRubricName] = useState<string>("");
  const [rubrics, setRubrics] = useState<object>({})
  const [data, setData] = useState<string[][]>(defaultRubric)
  const [newData, setNewData] = useState<NewData>(initialNewData)

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
    //console.log('rubrics', rubric, rubrics)
    if (rubrics) {

      rubrics = {...rubrics, [rubricName]: data}

    } else {

      rubrics = {
        [rubricName]: data
      }
    }

    localStorage.setItem(rubricStoreName, JSON.stringify(rubrics))
    setRubrics(rubrics)
    setSaveOutput(`Changes to ${rubricName} saved`)
  };

  const onCheckSave = (rubricName: string): boolean => {

    let hasPrior = false
    const rubrics = JSON.parse(localStorage.getItem(rubricStoreName) as string)
    const priorRubric = rubrics[rubricName]  
    //console.log('rubrics', rubric, rubrics)
    if (priorRubric) {  
      
      hasPrior = true

    }     
    return hasPrior
  };

  const onAutoSave = (event: React.MouseEvent<HTMLInputElement, MouseEvent>) => {
    //console.log('auto event', event)
    const isChecked = (event.target as HTMLInputElement).checked;

    setIsAutosave(isChecked);

    if (isChecked) {
      setSaveOutput(`Changes to ${rubricName} are autosaved`);
    } else {
      setSaveOutput(`Changes to ${rubricName} are not autosaved`);
    }
  };

  const onLoad = (rubricName: string) => {
    
    const rubrics = JSON.parse(localStorage.getItem(rubricStoreName) as string)
    const thisRubric = rubrics?.[rubricName]  
    const newData: NewData = {
      rubricName: rubricName,
      data: thisRubric 
    }
    setNewData(newData)

  };

  const onConfirmLoad = (doLoad: boolean) => {

    if(doLoad) {

      setRubricName(newData.rubricName)
      setData(newData.data)  

    } else {

      setNewData(initialNewData)
    }
    
  };

  return (
    <div className="pl-8 pr-8">   

      <div id='rubric'>
        <HotTable
          themeName='ht-theme-main'
          data={data}
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
        
      <div className="inline-flex">
        
        <fieldset className="fieldset bg-base-100 border-base-300 rounded-box border p-4">
          <legend className="fieldset-legend">Save options</legend>

          <fieldset className="fieldset">
            <legend className="fieldset-legend">Rubric Name</legend>
            <input type="text" className="input" placeholder="name" value={rubricName ? rubricName : ""} onChange={e => setRubricName(e.target.value)}/>
          </fieldset>  
          
          <button disabled={rubricName === ""} className="btn my-2" onClick={() => {
            const canSave = onCheckSave(rubricName)
            if ( canSave ) {
              (document.getElementById('modal_on_save') as HTMLDialogElement).showModal();
            } else {
              onSave();
            }
          }}>
            Save as
          </button>  

          <label className="label">
            <input type="checkbox" className="checkbox" disabled={rubricName === ""} defaultChecked={isAutosave} onClick={(e) => onAutoSave(e)} />
            Autosave
          </label>
        
          <p>{saveOutput}</p>
        </fieldset>
      </div>

      <div className="inline-flex ml-4">
        <fieldset className="fieldset bg-base-100 border-base-300 rounded-box border p-4">
          <legend className="fieldset-legend">Load options</legend>
          <select defaultValue="Load a saved rubric" className="select" onChange={(e) => {
            onLoad(e.target.value);
            (document.getElementById('modal_on_load') as HTMLDialogElement).showModal();
          }}
          >
            <option disabled={true}>Load a saved rubric</option>
            {Object.keys(rubrics).map(rubricName => {
              return (<option key={rubricName} value={rubricName}>{rubricName}</option>)
            })}         
          </select>
        </fieldset>    
      </div>

      <div className="inline-flex ml-4">
        <fieldset className="fieldset bg-base-100 border-base-300 rounded-box border p-4">
          <legend className="fieldset-legend">Export options</legend>
          <button className="btn my-2" disabled={rubricName === ""} onClick={() => {
            const thisRubric = document.getElementById('rubric') as HTMLElement
            saveToPDF( thisRubric, rubricName);
          }}>
            Export to PDF
          </button>  
          <button className="btn my-2" disabled={rubricName === ""} onClick={() => {
            const rubric = rubricRef?.current;    
            saveToCSV(rubric as HotTableRef, rubricName)
          }}>
            Export to CSV
          </button> 
        </fieldset>    
      </div>

      {/* Load dialogue */}
      <dialog id="modal_on_load" className="modal">
        <div className="modal-box bg-white text-black">
          <p>{`Loading ${newData.rubricName} will overwrite your current Rubric. Are you sure you want to continue?`}</p>
          <form method="dialog">
            <button
              className="btn bg-gray-300 text-black"
              onClick={() => onConfirmLoad(true)}
            >
              Yes
            </button>
            <button
              className="btn bg-gray-300 text-black"
              onClick={() => onConfirmLoad(false)}
            >
              Cancel
            </button>
          </form>
        </div>
      </dialog>

      {/* Save dialogue */}
      <dialog id="modal_on_save" className="modal">
        <div className="modal-box bg-white text-black">
          <p>{`Saving ${rubricName} will overwrite a saved Rubric. Are you sure you want to continue?`}</p>
          <form method="dialog">
            <button
              className="btn bg-gray-300 text-black"
              onClick={() => onSave()}
            >
              Yes
            </button>
            <button
              className="btn bg-gray-300 text-black"
            >
              Cancel
            </button>
          </form>
        </div>
      </dialog>
      
    </div>
  );
};

export default CreateRubric;