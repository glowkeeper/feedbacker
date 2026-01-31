"use client";
import { useContext, useRef, useEffect, useState } from "react";

import { HotTable, HotTableRef } from "@handsontable/react-wrapper";

import { registerAllModules } from 'handsontable/registry';

import { StoreContext, StoreAction } from "@/app/store/store";

import { rubricStoreName, markStoreName, defaultRubric } from "@/app/config"

type NewRubricData = {
  rubricName: string
  data: string[][]
}

const initialNewRubricData = {
  rubricName: "",
  data: [[]]
}

const CreateMark = () => {

  const markRef = useRef({} as HotTableRef);
  const [saveOutput, setSaveOutput] = useState<string>('To save your mark, you must give it a name');
  const [isAutosave, setIsAutosave] = useState<boolean>(false);
  const [markName, setMarkName] = useState<string>("");
  const [rubrics, setRubrics] = useState<object>({})
  const [data, setData] = useState<string[][]>(defaultRubric)
  const [newRubricData, setNewRubricData] = useState<NewRubricData>(initialNewRubricData)

  const store = useContext(StoreContext);
  
  registerAllModules();

  const thisTitle = "mark work";

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
    const mark = markRef?.current;    
    const data = (mark as HotTableRef).hotInstance?.getData()
    let marks = JSON.parse(localStorage.getItem(markStoreName) as string)
    //console.log('marks', mark, marks)
    if (marks) {

      marks = {...marks, [markName]: data}

    } else {

      marks = {
        [markName]: data
      }
    }

    localStorage.setItem(markStoreName, JSON.stringify(marks))
    setSaveOutput(`Changes to ${markName} saved`)
  };

  const onCheckSave = (markName: string): boolean => {

    let hasPrior = false
    const marks = JSON.parse(localStorage.getItem(markStoreName) as string)
    const priorRubric = marks[markName]  
    //console.log('marks', mark, marks)
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
      setSaveOutput(`Changes to ${markName} are autosaved`);
    } else {
      setSaveOutput(`Changes to ${markName} are not autosaved`);
    }
  };

  const onLoad = (rubricName: string) => {
    
    const rubrics = JSON.parse(localStorage.getItem(rubricStoreName) as string)
    const thisRubric = rubrics[rubricName]  
    const newRubricData: NewRubricData = {
      rubricName: rubricName,
      data: thisRubric 
    }
    setNewRubricData(newRubricData)

  };

  const onConfirmLoad = (doLoad: boolean) => {

    if(doLoad) {

      setMarkName(newRubricData.rubricName)
      setData(newRubricData.data)  

    } else {

      setNewRubricData(initialNewRubricData)
    }
    
  };

  return (
    <div className="pl-8 pr-8">           
        
      <fieldset className="fieldset bg-base-100 border-base-300 rounded-box w-64 border p-4">
        <legend className="fieldset-legend">Save options</legend>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Mark Name</legend>
          <input type="text" className="input" placeholder="name" value={markName ? markName : ""} onChange={e => setMarkName(e.target.value)}/>
        </fieldset>  
        
        <button disabled={markName === ""} className="btn my-2" onClick={() => {
          const canSave = onCheckSave(markName)
          if ( canSave ) {
            (document.getElementById('modal_on_save') as HTMLDialogElement).showModal();
          } else {
            onSave();
          }
        }}>
          Save as
        </button>  

        <label className="label">
          <input type="checkbox" className="checkbox" disabled={markName === ""} defaultChecked={isAutosave} onClick={(e) => onAutoSave(e)} />
          Autosave
        </label>
      
        <p>{saveOutput}</p>
      </fieldset>

      <fieldset className="fieldset bg-base-100 border-base-300 rounded-box w-64 border p-4">
        <legend className="fieldset-legend">Rubric Load options</legend>
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

      <h3 className="my-4">Rubric</h3>  

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
        ref={markRef}
        licenseKey={process.env.NEXT_PUBLIC_HANDSONTABLE_LICENSE_KEY}
      />

      {/* Load dialogue */}
      <dialog id="modal_on_load" className="modal">
        <div className="modal-box bg-white text-black">
          <p>{`Loading ${newRubricData.rubricName} will overwrite any Marks you have given. Are you sure you want to continue?`}</p>
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
          <p>{`Saving ${markName} will overwrite a saved Mark. Are you sure you want to continue?`}</p>
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

export default CreateMark;