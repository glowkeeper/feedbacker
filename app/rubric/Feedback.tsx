"use client";

import { useState, useEffect, ReactNode } from "react";
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { rubricFilename, studentWorkFilename, rubricPrompt } from "@/app/config";

//import { StoreContext, StoreAction } from "@/app/store/store";

import { fetchData } from "@/app/utils/fetchData";

import Image, { StaticImageData } from 'next/image'
import share from "@/app/assets/images/share.png"

type FeedbackType = ({ getFeedback, rubricBase64, studentBase64 }: FeedbackProps) => ReactNode

interface FeedbackProps {
  getFeedback: boolean
  rubricBase64: string
  studentBase64: string
}

export const Feedback: FeedbackType = ( {getFeedback, rubricBase64, studentBase64} ) => {

  // const store = useContext(StoreContext);

  const [feedback, setFeedback] = useState<string | null>(null)
  const [edit, setEdit] = useState<boolean>(false)
  const [iterate, setIterate] = useState<boolean>(false)
  const [reprompt, setReprompt] = useState<string>("")
  const [doReprompt, setDoReprompt] = useState<boolean>(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // const textAreaRef = useRef<any>(null)

  // useEffect(() => {
  
  //     if (textAreaRef && 
  //         textAreaRef.current && 
  //         feedback) {
  //         // To get the correct height, set it to zero, then find the scrollHeight
  //         textAreaRef.current.style.height = "0px"
  //         const scrollHeight = textAreaRef.current.scrollHeight
  //         //then set the height directly, using the found scrollHeight 
  //         textAreaRef.current.style.height = scrollHeight + "px"
  //     }

  // }, [feedback, textAreaRef])  

  useEffect(() => {

    const fetchFeedback = async () => {

        const fetchOptions: object = {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENROUTER_KEY}`,
            'HTTP-Referer': process.env.NEXT_PUBLIC_HOMEPAGE,
            'X-Title': process.env.NEXT_PUBLIC_TITLE,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'openrouter/auto',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: rubricPrompt,
                  },
                  {
                    type: 'file',
                    file: {
                      filename: rubricFilename,
                      file_data: rubricBase64,
                    },
                  },
                  {
                    type: 'file',
                    file: {
                      filename: studentWorkFilename,
                      file_data: studentBase64,
                    },
                  },
                  
                ],
              },
            ],
            reasoning: {
              effort: 'high',
              exclude: true, // Use reasoning but don't include it in the response
            },
            plugins: [
              {
                id: 'file-parser',
                pdf: {
                  engine: 'pdf-text',
                },
              },
            ],
            stream: false,
          }),
        }

        const fetchParams = {
          url: process.env.NEXT_PUBLIC_OPENROUTER_URL as string,
          fetchOptions: fetchOptions,
        }

        console.log('options', fetchParams)

        const fetchedChoices = await fetchData(fetchParams)
        // console.log('feedback', fetchedChoices[0]?.message.content)
        setFeedback(fetchedChoices[0]?.message.content)
      }    
      
      if ( getFeedback &&
          rubricBase64 !== "" && 
          studentBase64 !== "" 
       ) {
        fetchFeedback()
      }
    
  }, [getFeedback, rubricBase64, studentBase64])

  useEffect(() => {

    const fetchFeedback = async () => {

        const oldFeedback = feedback
        setFeedback("")
        setDoReprompt(false)

        const fetchOptions: object = {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENROUTER_KEY}`,
            'HTTP-Referer': process.env.NEXT_PUBLIC_HOMEPAGE,
            'X-Title': process.env.NEXT_PUBLIC_TITLE,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'openrouter/auto',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'Using the original feedback below ' + reprompt,
                  },
                  {
                    type: 'text',
                    text: oldFeedback
                  }                  
                ],
              },
            ],
            reasoning: {
              effort: 'high',
              exclude: true, // Use reasoning but don't include it in the response
            },
            stream: false,
          }),
        }

        const fetchParams = {
          url: process.env.NEXT_PUBLIC_OPENROUTER_URL as string,
          fetchOptions: fetchOptions,
        }

        //console.log('options', fetchParams)

        const fetchedChoices = await fetchData(fetchParams)
        // console.log('feedback', fetchedChoices[0]?.message.content)
        setFeedback(fetchedChoices[0]?.message.content)
      }    
      
      if ( doReprompt ) {
        console.log('in reprompt', reprompt)
        fetchFeedback()
      }
    
  }, [doReprompt, feedback, reprompt])

  const onSetEdit = (newFeedback: string) => {

    //console.log('my', newFeedback)
    setFeedback(newFeedback)

  }

  const onSetReprompt = (reprompt: string) => {
    setReprompt(reprompt)
  }

  return (
    
    <div className="my-4">

      { (feedback && !edit && !iterate) ? (

        <>

          <hr className="my-4"/>
          <button
            className="btn bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl my-4"
            onClick={() => {
              ;(document.getElementById('modal_share_results') as HTMLDialogElement).showModal()
            }}
          >
            Share <Image className="share" src={share as StaticImageData} alt="Share" />
          </button>

          <button
            className="btn bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl my-4 mx-4"
            onClick={() => setEdit(true)}
          >
            Edit <Image className="share" src={share as StaticImageData} alt="Edit" />
          </button>

          <button
            className="btn bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl my-4 mx-4"
            onClick={() => setIterate(true)}
          >
            Iterate <Image className="share" src={share as StaticImageData} alt="Iterate" />
          </button>

          <Markdown remarkPlugins={[remarkGfm]}>{feedback}</Markdown>

          <button
            className="btn bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl my-4"
            onClick={() => {
              ;(document.getElementById('modal_share_results') as HTMLDialogElement).showModal()
            }}
          >
            Share <Image className="share" src={share as StaticImageData} alt="Share" />
          </button>

          <button
            className="btn bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl my-4 mx-4"
            onClick={() => setEdit(true)}
          >
            Edit <Image className="share" src={share as StaticImageData} alt="Edit" />
          </button>

          <button
            className="btn bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl my-4 mx-4"
            onClick={() => setIterate(true)}
          >
            Iterate <Image className="share" src={share as StaticImageData} alt="Iterate" />
          </button>

        </>

      ) : (

        <>
          { (getFeedback && !edit && !iterate) && (
            <p className="blink">Please wait - fetching feedback...</p>
          ) }
        </>
      )}   

      <dialog id="modal_share_results" className="modal">
        <div className="modal-box bg-white text-black">
          <Markdown remarkPlugins={[remarkGfm]}>{feedback}</Markdown>
          <div className="grid grid-cols-2 place-items-center gap-2">
            <form method="dialog">
              <button
                className="btn bg-gray-300 text-black"
                onClick={() => {
                  navigator.clipboard.writeText(feedback as string)
                }}
              >
                <p>Copy ⎗</p>
              </button>
            </form>
            <form method="dialog">
              {/* if there is a button in form, it will close the modal */}
              <button className="btn bg-gray-300 text-black">
                <p>Close</p>
              </button>
            </form>
          </div>
        </div>
      </dialog>

      {edit && (

        <>
          <textarea
            className="textarea p-4 w-full"
            defaultValue={feedback as string}
            onChange={(e) => {
                onSetEdit(e.target.value)
            }} 
          />
          <button className="btn my-4" onClick={() => setEdit(false)}>
            <p>Save</p>
          </button>
        </>
      )}

      {iterate && (

        <>
          <h3>Re-prompt</h3>
          <textarea
            className="textarea p-4 w-full"
            onChange={(e) => {
                onSetReprompt(e.target.value)
            }} 
          />
          <button className="btn my-4" onClick={() => {
            setDoReprompt(true)
            setIterate(false)
          }}>
            <p>Save</p>
          </button>
        </>
      )}

    </div>
  );
};
