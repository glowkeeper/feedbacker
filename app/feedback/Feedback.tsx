"use client";

import { useState, useEffect, ReactNode } from "react";
import Link from 'next/link'

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { siteTitle } from "@/app/config/text"

import type { Base64File } from "@/app/store/types";

//import { StoreContext, StoreAction } from "@/app/store/store";

import { fetchData } from "@/app/utils/fetchData";

// import Image, { StaticImageData } from 'next/image'
// import share from "@/app/assets/images/share.png"
// import editIcon from "@/app/assets/images/page-edit.svg"
// import iterateIcon from "@/app/assets/images/iterate.png"

type FeedbackType = ({ prompt, rubricBase64, studentBase64 }: FeedbackProps) => ReactNode

interface FeedbackProps {
  prompt: string
  rubricBase64: Base64File
  studentBase64: Base64File | null
}

export const Feedback: FeedbackType = ( {prompt, rubricBase64, studentBase64} ) => {

  const [isFetching, setIsFetching] = useState<boolean>(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [edit, setEdit] = useState<boolean>(false)
  const [iterate, setIterate] = useState<boolean>(false)
  const [reprompt, setReprompt] = useState<string>("")
  const [doReprompt, setDoReprompt] = useState<boolean>(false)

  useEffect(() => {

    const fetchFeedback = async () => {
      
      setIsFetching(true)     
      const content = [
        {
          type: 'text',
          text: prompt,
        },
        {
          type: 'file',
          file: {
            filename: rubricBase64?.file.name as string,
            file_data: rubricBase64?.base64 as string,
          },
        }          
      ]

      if ( studentBase64?.base64 !== "" ) {
        content.push(
          {
            type: 'file',
            file: {
              filename: studentBase64?.file.name as string,
              file_data: studentBase64?.base64 as string,
            },
          }
        )
      }

      //console.log('content', content)

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
              content: content
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

      //console.log('options', fetchParams)

      const fetchedChoices = await fetchData(fetchParams)
      // console.log('feedback', fetchedChoices[0]?.message.content)
      setFeedback(fetchedChoices[0]?.message.content)
      setIsFetching(false)
    }    
    
    if ( !isFetching && !feedback) {
      //console.log('feedback', studentBase64?.file.name)   
      fetchFeedback()
    }
    
  }, [prompt, rubricBase64, studentBase64, isFetching, feedback])

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
      // console.log('in reprompt', reprompt)
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
          <p>Please consider supporting <a href="https://huckle.studio" target="_blank" rel="noreferrer">Dr Steve Huckle</a>&apos;s open source work on {siteTitle}.</p> 

          <Link
            className="btn bg-accent text-surface p-4"
            target="_blank"
            href='https://www.paypal.com/ncp/payment/R5Y64CQKMWWUW'
          >                                        
            Sponsor Dr Steve Huckle via PayPal
          </Link>    

          <br />  

          <Link
            className="btn bg-accent text-surface p-4 my-2"
            target="_blank"
            href='https://github.com/sponsors/glowkeeper'
          >                                        
            Sponsor Dr Steve Huckle on GitHub Sponsors (requires a GitHub account)
          </Link>

          <hr className="my-4"/> 

          <button
            className="btn bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl"
            onClick={() => {
              ;(document.getElementById('modal_share_results') as HTMLDialogElement).showModal()
            }}
          >
            Share
            {/* Share <Image className="share" src={share as StaticImageData} alt="Share" /> */}
          </button>

          <button
            className="btn bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl mx-4"
            onClick={() => setEdit(true)}
          >
            Edit
            {/* Edit <Image className="share" src={editIcon as StaticImageData} alt="Edit" /> */}
          </button>

          <button
            className="btn bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl mx-4"
            onClick={() => setIterate(true)}
          >
            Iterate
            {/* Iterate <Image className="share" src={iterateIcon as StaticImageData} alt="Iterate" /> */}
          </button>          

          {/* The feedback */}
          <p>Rubric {rubricBase64 && rubricBase64.file.name}</p>
          {studentBase64 && <p>Student submission {studentBase64.file.name}</p>}
          <Markdown remarkPlugins={[remarkGfm]}>{feedback}</Markdown>

          <button
            className="btn bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl"
            onClick={() => {
              ;(document.getElementById('modal_share_results') as HTMLDialogElement).showModal()
            }}
          >
            Share
            {/* Share <Image className="share" src={share as StaticImageData} alt="Share" /> */}
          </button>

          <button
            className="btn bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl mx-4"
            onClick={() => setEdit(true)}
          >
            Edit
            {/* Edit <Image className="share" src={editIcon as StaticImageData} alt="Edit" /> */}
          </button>

          <button
            className="btn bg-button text-button-foreground border-button-border cursor-pointer hover:bg-button-hover active:shadow-xl mx-4"
            onClick={() => setIterate(true)}
          >
            Iterate
            {/* Iterate <Image className="share" src={iterateIcon as StaticImageData} alt="Iterate" /> */}
          </button>

        </>

      ) : (

        <>
          { (isFetching && !edit && !iterate) && (
            <p className="blink">Please wait - fetching feedback {studentBase64 && `for ${studentBase64.file.name} `} {rubricBase64 && `using ${rubricBase64.file.name}`}</p>
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
            autoFocus={true}
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
            autoFocus={true}
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
