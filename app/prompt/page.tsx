"use client";

import { useState, useContext, useEffect } from "react";
import { IDBPDatabase } from "idb";

import { useForm } from "react-hook-form";

import { addData, deleteData, getAllData } from "@/app/utils/dbase";
import type { Prompt } from "@/app/store/types";
import { defaultPrompt, routes, dBase } from "@/app/config";

import { StoreContext, StoreAction } from "@/app/store/store";

type AddType = {
  [key: string]: string
}

const PromptPage = () => {
  const store = useContext(StoreContext);

  const text = "prompt"

  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      [text]: "",
    },
  });

  const thisTitle = routes.prompt.route.title;

  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [editId, setEditId] = useState<number>(-1);
  const [tableToggle, setTableToggle] = useState<boolean>(!store?.state.tableToggle as boolean)

  useEffect(() => {
    const getPrompts = async () => {
      const db = store?.state.db as IDBPDatabase;

      if (db && tableToggle != store?.state.tableToggle) {
        const storedPrompts = await getAllData(db, dBase.prompts.name)

        //console.log('in here prompts', storedPrompts)
        const thisPrompts = [];

        if (storedPrompts.length) {
          storedPrompts.forEach((prompt) => {
            if (prompt.isDefault) {
              thisPrompts.unshift(prompt)
            } else {
              thisPrompts.push(prompt)
            }
          });
        } else {
          const promptsData: Prompt = {
            id: 1,
            isDefault: true,
            prompt: defaultPrompt,
            created: Date.now().toString(),
          };
          await addData(db, dBase.prompts.name, promptsData)
          thisPrompts.push(promptsData);
        }

        setPrompts(thisPrompts)
        setTableToggle(store?.state.tableToggle as boolean)
      }
    };

    getPrompts();
  }, [store?.state.db, store?.state.tableToggle, tableToggle]);

  useEffect(() => {
    if (store?.state.title != thisTitle) {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      });
    }
  }, [store, thisTitle]);

  const onAdd = async (data: AddType) => {

    console.log("add", data, prompts)
    // const currentPrompts = prompts
    const thisPrompt: Prompt = {
      id: prompts[prompts.length - 1].id + 1,
      isDefault: false,
      prompt: data[text],
      // eslint-disable-next-line react-hooks/purity
      created: Date.now().toString(),
    }

    // currentPrompts.push(thisPrompt)
    const db = store?.state.db as IDBPDatabase;
    if (db) {

      // setPrompts(currentPrompts)
      //console.log('adding data', DBStores.prompts.name, newPrompts)
      await addData(db, dBase.prompts.name, thisPrompt)
      store?.dispatch({
        type: StoreAction.TableUpdate,
        payload: true,
      })
      reset()
    }
    
  }

  const onSetEdit = (id: number) => {
    console.log("set edit", id)
    reset()
    setEditId(id)
  }

  const onDoEdit = (data: object) => {
    console.log("edit", data)
    setEditId(-1)
  }

  const onDelete = async (id: number) => {
    console.log("delete", id)
    const db = store?.state.db as IDBPDatabase;
    if (db) {
      //console.log('adding data', DBStores.prompts.name, newPrompts)
      await deleteData(db, dBase.prompts.name, id)
      store?.dispatch({
        type: StoreAction.TableUpdate,
        payload: true,
      })
    }
  }

  return (
    <>
      {prompts.map((prompt, index) => {
        if (prompt.isDefault) {
          return (
            <div key={prompt.id}>
              <div className="pl-8 pr-8">
                <h3>Active Prompt</h3>
                {prompt.prompt}


                { editId === prompt.id ? (

                  <div className="bg-surface p-8">
                
                    <form
                      onSubmit={handleSubmit(onDoEdit)}
                    >
                      <fieldset className="fieldset">
                        <textarea
                          className="textarea h-12 w-full"
                          placeholder={prompt.prompt}
                          {...register(text)}
                        ></textarea>
                      </fieldset>
                      <input
                        className="btn btn-wide bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl my-8"
                        value="Save"
                        type="submit"
                      />
                    </form>
                  </div>

                ) : (

                  <div className="my-6">
                    <button
                      className="btn btn-wide bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl"
                      onClick={() => onSetEdit(prompt.id)}
                    >
                      Edit
                    </button>
                  </div>

                )}
                
              </div>

              <div className="bg-surface p-8">
                
                <form
                  onSubmit={handleSubmit(onAdd)}
                >
                  <fieldset className="fieldset">
                    <h3>Create a New Prompt</h3>
                    <textarea
                      className="textarea h-12 w-full mb-4"
                      placeholder="As a marker..."
                      {...register(text)}
                    ></textarea>
                  </fieldset>
                  <input
                    className="btn btn-wide bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl"
                    value="Add"
                    type="submit"
                  />
                </form>
              </div>
            </div>
          );
        } else {
          return (
            <div className={index ? "p-8" : "bg-surface p-8"} key={prompt.id}>
              {prompt.prompt}
              { editId === prompt.id ? (

                  <div className="bg-surface p-8">
                
                    <form
                      onSubmit={handleSubmit(onDoEdit)}
                    >
                      <fieldset className="fieldset">
                        <textarea
                          className="textarea h-12 w-full"
                          placeholder={prompt.prompt}
                          {...register(text)}
                        ></textarea>
                      </fieldset>
                      <input
                        className="btn btn-wide bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl"
                        value="Save"
                        type="submit"
                      />
                    </form>
                  </div>

                ) : (

                  <div className="my-6">
                    <button
                      className="btn btn-wide bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl"
                      onClick={() => onSetEdit(prompt.id)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-wide bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl ml-8"
                      onClick={() => onDelete(prompt.id)}
                    >
                      Delete
                    </button>
                  </div>

                )}
            </div>
          );
        }
      })}
    </>
  );
};

export default PromptPage;
