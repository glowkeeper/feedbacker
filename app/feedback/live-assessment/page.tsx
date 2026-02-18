"use client";

import { useContext, useState, useEffect } from "react";

import { routes } from "@/app/config/config";
import { privacyTextShort } from "@/app/config/text";

import { StoreContext, StoreAction } from "@/app/store/store";
import type { Base64File } from "@/app/store/types";
import { getCommentedRubricPrompt } from "@/app/utils/getPrompts";
import { Feedback } from '../Feedback';

const CommentedRubric = () => {

  const store = useContext(StoreContext);

  const [rubricFiles, setRubricFiles] = useState<File[]>([]);
  const [rubricBase64s, setRubricBase64s] = useState<Base64File[]>([]);
  const [getFeedback, setGetFeedback] = useState<boolean>(false);

  const thisTitle = routes.feedback.route.title
  
  useEffect(() => {
    if (store?.state.title != thisTitle) {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      });
    }
  }, [store, thisTitle])

  const onRubricChange = (event: React.ChangeEvent<HTMLInputElement>) => {

    const files: File[] = []

    if ( event.target.files ) {
      for (const file of event.target.files) {
        if ( file.type === "application/pdf" ) files.push(file)
      }
      setRubricFiles(files);
    }
	};

  const onRubricUpload = () => {

    if (rubricFiles.length) {

      const files = [...rubricFiles]
      const base64s: Base64File[] = []

      for (const file of files) {

        const reader = new FileReader();

        reader.onload = () => {
          const result = reader.result as string;  
          const base64: Base64File = {
            file: file,
            base64: result
          }

          base64s.push(base64)
          if(base64s.length === files.length) {
            setRubricBase64s(base64s)
            //console.log('my base64s', base64s)
          }
        };

        reader.onerror = () => {
          console.error("Error reading rubric");
        };

        reader.readAsDataURL(file);
      }      
    }
  }

  return (
    <div className="pl-8 pr-8">
      <div>
        <p><b>{privacyTextShort}</b></p>
        <h3>Upload Your Live Assessment(s)</h3>
        <input multiple className="file-input my-4" type="file" onChange={onRubricChange} />
        <button
          className="btn"
          disabled={!rubricFiles.length} 
          onClick={onRubricUpload}
        >
          Upload
        </button>
        { rubricBase64s.length === rubricFiles.length && rubricBase64s.map(rubricBase64 => {
          return (
            <p
              key={rubricBase64.file.name}
            >
              Successfully uploaded {rubricBase64.file.name}
            </p>
          )
        })}
      </div>
      <div>
        <button 
          className="btn"
          disabled={rubricBase64s.length !== rubricFiles.length || getFeedback } 
          onClick={() => {
            setGetFeedback(true)

          }}
        >
          Get Feedback
        </button>

        { getFeedback && rubricBase64s.map(rubricBase64 => {
          //console.log('here', rubricBase64, studentBase64s)
          const prompt = getCommentedRubricPrompt(rubricBase64.file.name)
          return (
            <div
              key={rubricBase64.file.name}
            >
              <hr className="my-4"/>
              <Feedback prompt={prompt} rubricBase64={rubricBase64 as Base64File} studentBase64={null} />  
            </div>         
        )})}      
      </div>
    </div>
  );
};

export default CommentedRubric;
