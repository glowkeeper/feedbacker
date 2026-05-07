"use client";

import { useContext, useState, useEffect } from "react";

import { routes, rubricStoreName, defaultRubric } from "@/app/config/config";
import { privacyTextShort } from "@/app/config/text";

import { StoreContext, StoreAction } from "@/app/store/store";
import { Feedback } from '../Feedback';

import { getRubricPrompt } from "@/app/utils/getPrompts";
import type { Base64File, Rubric, RubricStore } from "@/app/store/types";

const RubricAndSubmission = () => {

  const store = useContext(StoreContext);

  const [rubricFile, setRubricFile] = useState<File | null>(null);
  const [rubricBase64, setRubricBase64] = useState<Base64File | null>(null);
  const [rubric, setRubric] = useState<Rubric>(defaultRubric);
  const [studentFiles, setStudentFiles] = useState<File[]>([]);
  const [studentBase64s, setStudentBase64s] = useState<Base64File[]>([]);
  const [getFeedback, setGetFeedback] = useState<boolean>(false);
  const [savedRubrics, setSavedRubrics] = useState<RubricStore>({});

  const thisTitle = routes.feedback.route.title

  useEffect(() => {
    if (store?.state.title != thisTitle) {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      });
    }
  }, [store])

  // Load saved rubrics from localStorage
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(rubricStoreName) as string)
    if (saved) {
      setSavedRubrics(saved)
    }
  }, [])

  const onRubricChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if ( event.target.files &&
         event.target.files[0].type === "application/pdf" ) {
		  setRubricFile(event.target.files[0]);
    }
	};

  const onRubricUpload = () => {
    if (rubricFile) {

      const reader = new FileReader();

      reader.onload = () => {
        const result = reader.result as string;
        // result looks like: "data:application/pdf;base64,JVBERi0xLjcKJ..."
        //const base64String = result.split(",")[1];
        const base64: Base64File = {
          file: rubricFile,
          base64: result
        }

        //console.log('rubric ', base64)

        setRubricBase64(base64);
      };

      reader.onerror = () => {
        console.error("Error reading rubric");
      };

      reader.readAsDataURL(rubricFile);
    }

  }

  const onStudentChange = (event: React.ChangeEvent<HTMLInputElement>) => {

    const files: File[] = []

    if ( event.target.files ) {
      for (const file of event.target.files) {
        if ( file.type === "application/pdf" ) files.push(file)
      }
      setStudentFiles(files);
    }
	};

  const onStudentUpload = () => {

    if (studentFiles.length) {

      const files = [...studentFiles]
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
            setStudentBase64s(base64s)
            //console.log('my base64s', base64s)
          }
        };

        reader.onerror = () => {
          console.error("Error reading student submission");
        };

        reader.readAsDataURL(file);
      }      
    }
  }
  
  return (
    <div className="pl-8 pr-8">
      <div>
        <p><b>{privacyTextShort}</b></p>
        <h3>Select a Rubric (or upload one)</h3>
        <p className="text-sm mb-2">For best results with the AI backend, select a rubric you created in the Rubric Editor.</p>
        <select 
          className="select mb-4"
          onChange={(e) => {
            if (e.target.value && savedRubrics[e.target.value]) {
              setRubric(savedRubrics[e.target.value])
            }
          }}
          defaultValue=""
        >
          <option value="">Choose a saved rubric...</option>
          {Object.keys(savedRubrics).map((rubricName) => (
            <option key={rubricName} value={rubricName}>{rubricName}</option>
          ))}
        </select>
      </div>
      <div>
        <h3>Upload Your Rubric PDF</h3>
        <input className="file-input my-4" type="file" accept="application/pdf" onChange={onRubricChange} />
        <button
          className="btn"
          disabled={rubricFile === null} 
          onClick={onRubricUpload}
        >
          Upload
        </button>
        { rubricBase64?.base64 && <p>Successfully uploaded {rubricBase64?.file.name}</p>}
      </div>
      <div>
        <h3>Upload Student Submission PDFs</h3>
        <input multiple className="file-input my-4" type="file" accept="application/pdf" onChange={onStudentChange} />
        <button 
          className="btn"
          disabled={!studentFiles.length} 
          onClick={onStudentUpload}
        >
          Upload
        </button>
        { studentBase64s.length === studentFiles.length && studentBase64s.map(studentBase64 => {
          return (
            <p
              key={studentBase64.file.name}
            >
              Successfully uploaded {studentBase64.file.name}
            </p>
          )
        })}
         
      </div>
      <div>
        <button 
          className="btn"
          disabled={(rubricBase64?.base64 === "" || studentBase64s.length !== studentFiles.length) || getFeedback } 
          onClick={() => {
            setGetFeedback(true)
          }}
        >
          Get Feedback
        </button>
        { getFeedback && studentBase64s.map(studentBase64 => {
          //console.log('here', rubricBase64, studentBase64s)
          const prompt = getRubricPrompt(rubricBase64?.file.name as string, studentBase64.file.name)
          return (
            <div
              key={studentBase64.file.name}
            >
              <hr className="my-4"/>
              <Feedback 
                prompt={prompt} 
                rubric={rubric}
                rubricBase64={rubricBase64 as Base64File} 
                studentBase64={studentBase64} 
              />  
            </div>         
        )})}
      </div>
    </div>
  );
};

export default RubricAndSubmission;
