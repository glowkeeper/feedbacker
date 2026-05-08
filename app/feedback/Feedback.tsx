"use client";

import { useState, useEffect, ReactNode } from "react";
import Link from 'next/link'

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { siteTitle } from "@/app/config/text"

import type { Base64File, Rubric } from "@/app/store/types";

//import { StoreContext, StoreAction } from "@/app/store/store";

import { callWorkerFeedback, callOpenRouterDirectly } from "@/app/utils/workerAPI";
import { extractTextFromPDF, getBase64FromFile } from "@/app/utils/pdfExtract";

// import Image, { StaticImageData } from 'next/image'
// import share from "@/app/assets/images/share.png"
// import editIcon from "@/app/assets/images/page-edit.svg"
// import iterateIcon from "@/app/assets/images/iterate.png"

type FeedbackType = ({ prompt, rubric, rubricBase64, studentBase64 }: FeedbackProps) => ReactNode

interface FeedbackProps {
  prompt: string
  rubric: Rubric  // The rubric structure (2D array)
  rubricBase64: Base64File
  studentBase64: Base64File | null
}

export const Feedback: FeedbackType = ( {prompt, rubric, rubricBase64, studentBase64} ) => {

  const [isFetching, setIsFetching] = useState<boolean>(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [edit, setEdit] = useState<boolean>(false)
  const [iterate, setIterate] = useState<boolean>(false)
  const [reprompt, setReprompt] = useState<string>("")
  const [doReprompt, setDoReprompt] = useState<boolean>(false)
  const [sessionId] = useState<string>(() => `session_${Date.now()}_${Math.random().toString(36).substring(7)}`)
  const [useWorker] = useState<boolean>(!!process.env.NEXT_PUBLIC_WORKER_URL)
  const useDirectPdfAssessment = Boolean(studentBase64?.base64 && rubricBase64?.base64)
  const RUBRIC_PROMPT_CHAR_LIMIT = 30000  // Increased from 12000 to preserve full rubric even for large documents
  const SUBMISSION_PROMPT_CHAR_LIMIT = 100000  // Increased from 16000 to preserve full student submission

  useEffect(() => {

    const fetchFeedback = async () => {
      
      setIsFetching(true)
      setStatusMessage('Preparing request...')
      
      try {
        // Submission-based flow: always assess from attached rubric + submission PDFs.
        if (useDirectPdfAssessment) {
          setStatusMessage('Extracting rubric PDF for guaranteed rubric-source marking...')

          let rubricTextFromPdf = ''
          try {
            rubricTextFromPdf = await extractTextFromPDF(rubricBase64.file)
          } catch (error) {
            if (process.env.NODE_ENV !== 'production') {
              console.warn('[WARN] Local rubric PDF extraction failed; will attempt direct file parse fallback', error)
            }
          }

          const hasRubricText = rubricTextFromPdf.trim().length > 0

          setStatusMessage('Extracting student submission PDF text...')
          let submissionTextFromPdf = ''
          try {
            submissionTextFromPdf = await extractTextFromPDF(studentBase64.file)
          } catch (error) {
            if (process.env.NODE_ENV !== 'production') {
              console.warn('[WARN] Local submission PDF extraction failed; will attempt direct file parse fallback', error)
            }
          }
          const hasSubmissionText = submissionTextFromPdf.trim().length > 0

          const directPrompt = hasRubricText && hasSubmissionText
            ? `${prompt}\n\n` +
              `[System instruction: The rubric and submission texts below were extracted from the uploaded PDFs and are the source of truth.]\n\n` +
              `RUBRIC TEXT (from uploaded rubric PDF):\n${rubricTextFromPdf.substring(0, RUBRIC_PROMPT_CHAR_LIMIT)}\n\n` +
              `SUBMISSION TEXT (from uploaded student PDF):\n${submissionTextFromPdf.substring(0, SUBMISSION_PROMPT_CHAR_LIMIT)}\n\n` +
              `[System instruction: Assess using only the extracted rubric and submission content above. ` +
              `Do not ask for additional inputs.]`
            : hasRubricText
            ? `${prompt}\n\n` +
              `[System instruction: The rubric text below was extracted from the uploaded rubric PDF and is the source of truth for criteria, descriptors, and weighting.]\n\n` +
              `RUBRIC TEXT (from uploaded rubric PDF):\n${rubricTextFromPdf.substring(0, RUBRIC_PROMPT_CHAR_LIMIT)}\n\n` +
              `[System instruction: Use the attached student submission PDF for evidence.]`
            : `${prompt}\n\n` +
              `[System instruction: Use the attached rubric PDF as the source of truth for criteria, descriptors, and weighting. ` +
              `Use the attached student submission PDF for evidence.]`

          setStatusMessage(
            hasRubricText && hasSubmissionText
              ? 'Rubric and submission extracted; assessing from extracted PDF text...'
              : hasRubricText
              ? 'Rubric PDF extracted; assessing using rubric text + student PDF...'
              : 'Rubric extraction unavailable locally; assessing from attached PDFs...'
          )

          try {
            // Prefer Worker path for text-only extracted content to leverage existing timeouts and avoid
            // provider-side file parser bottlenecks.
            if (hasRubricText && hasSubmissionText && useWorker && process.env.NEXT_PUBLIC_WORKER_URL) {
              setStatusMessage('Calling backend worker with extracted rubric/submission text...')

              const actualSubmissionSent = submissionTextFromPdf.substring(0, SUBMISSION_PROMPT_CHAR_LIMIT).length
              const submissionWasTruncated = submissionTextFromPdf.length > SUBMISSION_PROMPT_CHAR_LIMIT
              const actualRubricSent = rubricTextFromPdf.substring(0, RUBRIC_PROMPT_CHAR_LIMIT).length
              const rubricWasTruncated = rubricTextFromPdf.length > RUBRIC_PROMPT_CHAR_LIMIT

              console.log(`[DEBUG FRONTEND] ════════════════════════════════════════════════════════════════`)
              console.log(`[DEBUG FRONTEND] Worker request starting at ${new Date().toISOString()}`)
              console.log(`[DEBUG FRONTEND] Rubric structure: ${rubric.length} rows x ${rubric[0]?.length || 0} columns`)
              console.log(`[DEBUG FRONTEND] Rubric text extracted: ${rubricTextFromPdf.length} chars${rubricWasTruncated ? ` (truncated to ${actualRubricSent})` : ''}`)
              console.log(`[DEBUG FRONTEND] Submission text extracted: ${submissionTextFromPdf.length} chars${submissionWasTruncated ? ` (truncated to ${actualSubmissionSent})` : ''}`)
              console.log(`[DEBUG FRONTEND] Constructed prompt length: ${directPrompt.length} chars`)
              console.log(`[DEBUG FRONTEND] Prompt preview (first 400 chars):`)
              console.log(`[DEBUG FRONTEND]   ${directPrompt.substring(0, 400).replace(/\n/g, '\n  ')}${directPrompt.length > 400 ? '...' : ''}`)
              console.log(`[DEBUG FRONTEND] Sending to worker at: ${process.env.NEXT_PUBLIC_WORKER_URL}/api/feedback`)
              console.log(`[DEBUG FRONTEND] ────────────────────────────────────────────────────────────────`)

              const workerResponse = await callWorkerFeedback({
                rubric: rubric,
                assessmentText: submissionTextFromPdf.substring(0, SUBMISSION_PROMPT_CHAR_LIMIT),
                sessionId: sessionId,
                prompt: directPrompt,
              })

              console.log(`[DEBUG FRONTEND] ✓ Worker response received at ${new Date().toISOString()}`)
              console.log(`[DEBUG FRONTEND] Response length: ${workerResponse.feedback.length} chars`)
              console.log(`[DEBUG FRONTEND] ════════════════════════════════════════════════════════════════`)

              setFeedback(workerResponse.feedback)
              setStatusMessage('Feedback received from extracted-text worker assessment')
              return
            }

            const directFeedback = await callOpenRouterDirectly({
              prompt: directPrompt,
              // If text extraction succeeded, avoid sending PDFs to bypass provider parser failures.
              rubricBase64: hasRubricText ? undefined : rubricBase64?.base64,
              studentBase64: hasSubmissionText ? undefined : studentBase64?.base64,
            })

            setFeedback(directFeedback)
            setStatusMessage('Feedback received from PDF-based assessment')
            return
          } catch (directError) {
            const directMessage = directError instanceof Error ? directError.message : String(directError)
            if (directMessage.includes('Failed to parse rubric.pdf')) {
              throw new Error(
                'OpenRouter could not parse the uploaded rubric PDF. ' +
                  'Please re-export the rubric as a text-based PDF (not scanned/image-only) and try again.'
              )
            }
            if (directMessage.includes('Failed to parse submission.pdf')) {
              throw new Error(
                'OpenRouter could not parse the uploaded submission PDF. ' +
                  'Please re-export the submission as a text-based PDF (not scanned/image-only) and try again.'
              )
            }
            throw directError
          }
        }

        if (useWorker && process.env.NEXT_PUBLIC_WORKER_URL) {
          // Use Worker backend
          // Extract text from student submission PDF
          let assessmentText = ""
          let extractionWarning = ""
          if (studentBase64?.file) {
            setStatusMessage(`Extracting PDF text from ${studentBase64.file.name}...`)
            if (process.env.NODE_ENV !== 'production') {
              console.log('[DEBUG] Extracting student PDF text:', studentBase64.file.name)
            }
            try {
              const extractStart = Date.now()
              assessmentText = await extractTextFromPDF(studentBase64.file)
              if (process.env.NODE_ENV !== 'production') {
                console.log('[DEBUG] PDF extraction complete', {
                  file: studentBase64.file.name,
                  ms: Date.now() - extractStart,
                  chars: assessmentText.length,
                })
              }

              if (!assessmentText.trim()) {
                throw new Error(
                  `No readable text was extracted from ${studentBase64.file.name}. ` +
                    'This PDF may be image-based/scanned; OCR would be required.'
                )
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown extraction error'
              extractionWarning = `PDF extraction failed for ${studentBase64.file.name}: ${message}`
              assessmentText = `Extraction unavailable for ${studentBase64.file.name}.`
              setStatusMessage('PDF extraction failed; continuing with fallback context...')
              console.warn('[WARN] PDF extraction fallback triggered:', extractionWarning)
            }
          } else {
            // Live-assessment mode has no student file; use prompt context so backend validation passes.
            assessmentText = prompt.substring(0, 4000)
            if (process.env.NODE_ENV !== 'production') {
              console.log('[DEBUG] Live-assessment mode: using prompt context as assessmentText')
            }
          }

          if (process.env.NODE_ENV !== 'production') {
            console.log('[DEBUG] Sending worker request', {
              assessmentLength: assessmentText.length,
              hasPrompt: !!prompt,
              hasStudentFile: !!studentBase64?.file,
              workerUrl: process.env.NEXT_PUBLIC_WORKER_URL,
            })
          }

          if (extractionWarning && studentBase64?.base64 && rubricBase64?.base64) {
            setStatusMessage('Local PDF extraction failed; falling back to direct PDF parser...')

            const directPrompt = `${prompt}\n\n[System note: ${extractionWarning}]\n\n` +
              `[System instruction: The rubric and submission PDFs are attached in this request. ` +
              `Extract both documents directly from the attached files, then complete the full rubric-aligned assessment. ` +
              `Do not ask the user to paste the submission or rubric text.]`
            const directFeedback = await callOpenRouterDirectly({
              prompt: directPrompt,
              rubricBase64: rubricBase64.base64,
              studentBase64: studentBase64.base64,
            })

            setFeedback(directFeedback)
            setStatusMessage('Feedback received via direct PDF parser fallback')
            return
          }

          setStatusMessage('Calling backend worker for feedback...')

          const promptForRequest = extractionWarning
            ? `${prompt}\n\n[System note: ${extractionWarning}]`
            : prompt

          const response = await callWorkerFeedback({
            rubric: rubric,
            assessmentText: assessmentText,
            sessionId: sessionId,
            prompt: promptForRequest,
          })

          setFeedback(response.feedback)
          setStatusMessage('Feedback received')
        } else {
          // Fallback: call OpenRouter directly (for development)
          setStatusMessage('Calling OpenRouter directly...')
          const feedback = await callOpenRouterDirectly({
            prompt: prompt,
            rubricBase64: rubricBase64?.base64,
            studentBase64: studentBase64?.base64 || undefined,
          })
          setFeedback(feedback)
          setStatusMessage('Feedback received')
        }
      } catch (error) {
        console.error('Error fetching feedback:', error)
        setFeedback(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
        setStatusMessage('Request failed')
      } finally {
        setIsFetching(false)
      }
    }    
    
    if ( !isFetching && !feedback) {
      //console.log('feedback', studentBase64?.file.name)   
      fetchFeedback()
    }
    
  }, [prompt, rubric, rubricBase64, studentBase64, isFetching, feedback, sessionId, useWorker, useDirectPdfAssessment])

  useEffect(() => {

    const fetchFeedback = async () => {

      const oldFeedback = feedback
      setFeedback("")
      setDoReprompt(false)
      setStatusMessage('Preparing iteration request...')

      try {
        if (useDirectPdfAssessment) {
          const repromptMessage = `Using the original feedback below, ${reprompt}\n\n${oldFeedback}`

          let rubricTextFromPdf = ''
          try {
            rubricTextFromPdf = await extractTextFromPDF(rubricBase64.file)
          } catch {
            // Leave empty and fallback to attached rubric file parsing.
          }

          let submissionTextFromPdf = ''
          try {
            submissionTextFromPdf = await extractTextFromPDF(studentBase64.file)
          } catch {
            // Leave empty and fallback to attached submission file parsing.
          }

          const hasRubricText = rubricTextFromPdf.trim().length > 0
          const hasSubmissionText = submissionTextFromPdf.trim().length > 0
          const directPrompt = hasRubricText && hasSubmissionText
            ? `${repromptMessage}\n\n` +
              `[System instruction: Re-assess using rubric and submission text extracted from uploaded PDFs below.]\n\n` +
              `RUBRIC TEXT (from uploaded rubric PDF):\n${rubricTextFromPdf.substring(0, RUBRIC_PROMPT_CHAR_LIMIT)}\n\n` +
              `SUBMISSION TEXT (from uploaded student PDF):\n${submissionTextFromPdf.substring(0, SUBMISSION_PROMPT_CHAR_LIMIT)}\n\n` +
              `[System instruction: Produce the full revised assessment now and do not request additional inputs.]`
            : hasRubricText
            ? `${repromptMessage}\n\n` +
              `[System instruction: Re-assess using rubric text extracted from the uploaded rubric PDF below as source of truth.]\n\n` +
              `RUBRIC TEXT (from uploaded rubric PDF):\n${rubricTextFromPdf.substring(0, RUBRIC_PROMPT_CHAR_LIMIT)}\n\n` +
              `[System instruction: Use the attached student submission PDF for evidence.]`
            : `${repromptMessage}\n\n` +
              `[System instruction: Re-assess using the attached rubric PDF as source of truth and the attached student submission PDF as evidence.]`

          setStatusMessage('Iterating directly from uploaded PDF sources...')

          if (hasRubricText && hasSubmissionText && useWorker && process.env.NEXT_PUBLIC_WORKER_URL) {
            setStatusMessage('Calling backend worker for extracted-text iteration...')

            const workerResponse = await callWorkerFeedback({
              rubric: rubric,
              assessmentText: submissionTextFromPdf.substring(0, SUBMISSION_PROMPT_CHAR_LIMIT),
              sessionId: sessionId,
              prompt: directPrompt,
            })

            setFeedback(workerResponse.feedback)
            setStatusMessage('Iteration feedback received from extracted-text worker assessment')
            return
          }

          const directFeedback = await callOpenRouterDirectly({
            prompt: directPrompt,
            rubricBase64: hasRubricText ? undefined : rubricBase64?.base64,
            studentBase64: hasSubmissionText ? undefined : studentBase64?.base64,
          })

          setFeedback(directFeedback)
          setStatusMessage('Iteration feedback received from PDF-based assessment')
          return
        }

        if (useWorker && process.env.NEXT_PUBLIC_WORKER_URL) {
          // Extract text from student submission PDF
          let assessmentText = ""
          let extractionWarning = ""
          if (studentBase64?.file) {
            setStatusMessage(`Re-extracting PDF text from ${studentBase64.file.name}...`)
            try {
              assessmentText = await extractTextFromPDF(studentBase64.file)
              if (!assessmentText.trim()) {
                throw new Error(
                  `No readable text was extracted from ${studentBase64.file.name}. ` +
                    'This PDF may be image-based/scanned; OCR would be required.'
                )
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown extraction error'
              extractionWarning = `PDF extraction failed for ${studentBase64.file.name}: ${message}`
              assessmentText = `Extraction unavailable for ${studentBase64.file.name}.`
              setStatusMessage('PDF extraction failed during iteration; using fallback context...')
              console.warn('[WARN] PDF extraction fallback triggered during iteration:', extractionWarning)
            }
          } else {
            assessmentText = prompt.substring(0, 4000)
          }

          if (extractionWarning && studentBase64?.base64 && rubricBase64?.base64) {
            const repromptMessage = `Using the original feedback below, ${reprompt}`
            const directPrompt = `${repromptMessage}\n\n${oldFeedback}\n\n[System note: ${extractionWarning}]\n\n` +
              `[System instruction: The rubric and submission PDFs are attached in this request. ` +
              `Extract both documents directly from the attached files and provide updated feedback. ` +
              `Do not ask the user to paste rubric/submission text.]`

            setStatusMessage('Local PDF extraction failed; using direct PDF parser for iteration...')
            const directFeedback = await callOpenRouterDirectly({
              prompt: directPrompt,
              rubricBase64: rubricBase64.base64,
              studentBase64: studentBase64.base64,
            })

            setFeedback(directFeedback)
            setStatusMessage('Iteration feedback received via direct PDF parser fallback')
            return
          }

          const repromptMessage = `Using the original feedback below, ${reprompt}`
          const promptForRequest = extractionWarning
            ? `${repromptMessage}\n\n${oldFeedback}\n\n[System note: ${extractionWarning}]`
            : repromptMessage + '\n\n' + oldFeedback

          setStatusMessage('Calling backend worker for iteration...')

          const response = await callWorkerFeedback({
            rubric: rubric,
            assessmentText: assessmentText,
            sessionId: sessionId,
            prompt: promptForRequest,
          })

          setFeedback(response.feedback)
          setStatusMessage('Iteration feedback received')
        } else {
          // Fallback: call OpenRouter directly
          const repromptMessage = `Using the original feedback below, ${reprompt}\n\n${oldFeedback}`

          setStatusMessage('Calling OpenRouter for iteration...')

          const feedback = await callOpenRouterDirectly({
            prompt: repromptMessage,
          })
          setFeedback(feedback)
          setStatusMessage('Iteration feedback received')
        }
      } catch (error) {
        console.error('Error fetching reprompt:', error)
        setFeedback(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
        setStatusMessage('Iteration failed')
      }
    }    
    
    if ( doReprompt ) {
      // console.log('in reprompt', reprompt)
      fetchFeedback()
    }
    
  }, [doReprompt, feedback, reprompt, rubric, rubricBase64, studentBase64, sessionId, useWorker, useDirectPdfAssessment])

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
            <>
              <p className="blink">Please wait - fetching feedback {studentBase64 && `for ${studentBase64.file.name} `} {rubricBase64 && `using ${rubricBase64.file.name}`}</p>
              {statusMessage && <p>{statusMessage}</p>}
            </>
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
