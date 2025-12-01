"use client";

import { useState, useContext, useEffect } from "react";
import { IDBPDatabase } from "idb";

import { useForm } from "react-hook-form";

import { addData, deleteData, updateData, getAllData } from "@/app/utils/dbase";
import type { Prompt } from "@/app/store/types";
import { defaultPrompt, routes, dBase } from "@/app/config";

import { StoreContext, StoreAction } from "@/app/store/store";

type AddType = {
  [key: string]: string;
};

const PromptPage = () => {
  const store = useContext(StoreContext);

  const text = "prompt";

  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      [text]: "",
    },
  });

  const thisTitle = routes.prompt.route.title;

  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [activePrompt, setActivePrompt] = useState<Prompt>();
  const [editId, setEditId] = useState<number>(-1);
  const [tableToggle, setTableToggle] = useState<boolean>(
    !store?.state.tableToggle as boolean
  );

  useEffect(() => {
    const getPrompts = async () => {
      const db = store?.state.db as IDBPDatabase;

      if (db && tableToggle != store?.state.tableToggle) {
        const storedPrompts = await getAllData(db, dBase.prompts.name);

        //console.log("in here prompts", storedPrompts);
        const thisPrompts: Prompt[] = [];

        if (storedPrompts.length) {
          storedPrompts.forEach((prompt) => {
            if (prompt.isDefault) {
              setActivePrompt(prompt);
            } else {
              //have them back to front so latest first...
              thisPrompts.unshift(prompt);
            }
          });
        } else {
          const promptsData: Prompt = {
            id: 1,
            isDefault: true,
            prompt: defaultPrompt,
            created: Date.now().toString(),
          };
          await addData(db, dBase.prompts.name, promptsData);
          setActivePrompt(promptsData);
        }

        setPrompts(thisPrompts);
        setTableToggle(store?.state.tableToggle as boolean);
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
    console.log("add", data, prompts, activePrompt)
    // const currentPrompts = prompts

    const db = store?.state.db as IDBPDatabase;
    if (db) {
      let newId = (activePrompt as Prompt).id + 1
      if ( prompts.length && prompts[0].id > (activePrompt as Prompt).id ) {
        newId = prompts[0].id + 1
      }
    
      const thisPrompt: Prompt = {
        id: newId,
        isDefault: false,
        prompt: data[text],
        // eslint-disable-next-line react-hooks/purity
        created: Date.now().toString(),
      };
      await addData(db, dBase.prompts.name, thisPrompt);
      store?.dispatch({
        type: StoreAction.TableUpdate,
        payload: true,
      });
      reset();
    }
  };

  const onSetEdit = (id: number) => {
    //console.log("set edit", id)
    reset();
    setEditId(id);
  };

  const onCancelEdit = () => {
    reset();
    setEditId(-1);
  };

  const onDoEdit = async (data: AddType) => {
    //console.log("edit", data)
    const db = store?.state.db as IDBPDatabase;
    if (db) {
      reset();
      const prompt: Prompt = (
        activePrompt?.id === editId
          ? activePrompt
          : prompts.find((prompt) => prompt.id === editId)
      ) as Prompt;
      const thisPrompt = {
        id: editId,
        isDefault: prompt.isDefault,
        prompt: data[text],
        created: prompt.created,
      };
      //console.log('adding data', DBStores.prompts.name, newPrompts)
      await updateData(db, dBase.prompts.name, thisPrompt);
      store?.dispatch({
        type: StoreAction.TableUpdate,
        payload: true,
      });
    }
    setEditId(-1);
  };

  const onDelete = async (id: number) => {
    //console.log("delete", id);
    const db = store?.state.db as IDBPDatabase;
    if (db) {
      await deleteData(db, dBase.prompts.name, id);
      store?.dispatch({
        type: StoreAction.TableUpdate,
        payload: true,
      });
    }
  };

  const onSetActive = async (id: number) => {
    //console.log("delete", id);
    const db = store?.state.db as IDBPDatabase;
    if (db) {

      const prompt: Prompt = (prompts.find((prompt) => prompt.id === id)) as Prompt
      const thisPrompt = {
        id: id,
        isDefault: true,
        prompt: prompt.prompt,
        created: prompt.created,
      };

      const oldActive = {...activePrompt as Prompt}
      oldActive.isDefault = false

      await updateData(db, dBase.prompts.name, oldActive);
      await updateData(db, dBase.prompts.name, thisPrompt);
      store?.dispatch({
        type: StoreAction.TableUpdate,
        payload: true,
      });
    }
  };

  return (
    <>
      {activePrompt?.hasOwnProperty("prompt") && (
        <>
          <div className="pl-8 pr-8 pb-8">
            <h3>Active Prompt</h3>

            {(activePrompt as Prompt).prompt}

            {editId === (activePrompt as Prompt).id ? (
              <form onSubmit={handleSubmit(onDoEdit)}>
                <fieldset className="fieldset my-8">
                  <textarea
                    className="textarea h-12 w-full"
                    placeholder={(activePrompt as Prompt).prompt}
                    {...register(text)}
                  ></textarea>
                </fieldset>
                <input
                  className="btn btn-wide bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl"
                  value="Save"
                  type="submit"
                />
                <button
                  className="btn btn-wide bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl ml-8"
                  onClick={() => onCancelEdit()}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="pt-6">
                <button
                  className="btn btn-wide bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl"
                  onClick={() => onSetEdit((activePrompt as Prompt).id)}
                >
                  Edit
                </button>
              </div>
            )}
          </div>

          <div className="bg-surface">
            <form className="p-8" onSubmit={handleSubmit(onAdd)}>
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

          {prompts.map((prompt, index) => {
            return (
              <div
                key={prompt.id}
                className={index % 2 ? "bg-surface pt-8" : "pt-8"}
              >
                <div className="pl-8 pr-8 pb-8">
                  {prompt.prompt}
                  {editId === prompt.id ? (
                    <div className="py-8">
                      <form onSubmit={handleSubmit(onDoEdit)}>
                        <fieldset className="fieldset">
                          <textarea
                            className="textarea h-12 w-full"
                            placeholder={prompt.prompt}
                            {...register(text)}
                          ></textarea>
                        </fieldset>
                        <input
                          className="btn btn-wide bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-x my-8"
                          value="Save"
                          type="submit"
                        />
                        <button
                          className="btn btn-wide bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl ml-8"
                          onClick={() => onCancelEdit()}
                        >
                          Cancel
                        </button>
                      </form>
                    </div>
                  ) : (
                    <div className="pt-6">
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
                      <button
                        className="btn btn-wide bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl ml-8"
                        onClick={() => onSetActive(prompt.id)}
                      >
                        Set Active
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
};

export default PromptPage;
