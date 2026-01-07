"use client";

import { useContext, useEffect } from "react";

import { useForm } from "react-hook-form";

import { StoreContext, StoreAction } from "@/app/store/store";

const addCriteria = 'criteria'
const addMarks = 'marks'

type AddCriteriaType = {
  [addCriteria]: string;
  [addMarks]: string
};

const SimpleRubricPage = () => {
  const store = useContext(StoreContext);

  const thisTitle = "simple rubric";


  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      [addCriteria]: '',
      [addMarks]: ''
    }
  });

  useEffect(() => {
    if (store?.state.title != thisTitle) {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      });
    }
  }, [store])

  const onAddCriteria = async (data: AddCriteriaType) => {
      console.log("add", data)
      // const currentPrompts = prompts
  
      // const db = store?.state.db as IDBPDatabase;
      // if (db) {
      //   let newId = (activePrompt as Prompt).id + 1
      //   if ( prompts.length && prompts[0].id > (activePrompt as Prompt).id ) {
      //     newId = prompts[0].id + 1
      //   }
      
      //   const thisPrompt: Prompt = {
      //     id: newId,
      //     isDefault: false,
      //     prompt: data[text],
      //     // eslint-disable-next-line react-hooks/purity
      //     created: Date.now().toString(),
      //   };
      //   await addData(db, dBase.prompts.name, thisPrompt);
      //   store?.dispatch({
      //     type: StoreAction.TableUpdate,
      //     payload: true,
      //   });
      //   reset();
      // }
    };

  return (
    <div className="bg-surface pl-8 pr-8">
      <form onSubmit={handleSubmit(onAddCriteria)}>
        <fieldset className="fieldset">
          <h3>Add Criteria</h3>
          <label className="input m-0" id="criteria">
            Criteria
            <input 
              id="criteria" 
              className="input-ghost" 
              {...register(addCriteria, { required: true })}
            />
          </label> 
          <label className="input" id="mark">
            Marks Available
            <input
              type="number"
              id="mark"
              className="input-ghost"
              placeholder="0 - 100%"
              min="0"
              max="100"
              {...register(addMarks, { required: true, valueAsNumber: true })}
            />
          </label>
          <h4>Comments for Criteria</h4>
          
        </fieldset>
        <input
          className="btn btn-wide bg-accent text-button-foreground border-button-border cursor-pointer hover:bg-accent-hover active:shadow-xl"
          value="Save"
          type="submit"
        />
        <button
          className="btn btn-wide bg-accent text-button-foreground border-button-border cursor-pointer hover:bg-accent-hover active:shadow-xl ml-8"
          onClick={() => reset()}
        >
          Cancel
        </button>
      </form>
    </div>
  );
};

export default SimpleRubricPage;
