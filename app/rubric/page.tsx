"use client";

import { useContext, useState, useEffect } from "react";

import { StoreContext, StoreAction } from "@/app/store/store";
import { Feedback } from './Feedback';

const RubricPage = () => {

  const store = useContext(StoreContext);

  const [rubricFile, setRubricFile] = useState<File | null>(null);
  const [rubricBase64, setRubricBase64] = useState<string>("");
  const [studentFile, setStudentFile] = useState<File | null>(null);
  const [studentBase64, setStudentBase64] = useState<string>("");
  const [getFeedback, setGetFeedback] = useState<boolean>(false);

  const thisTitle = "mark";

  useEffect(() => {
    if (store?.state.title != thisTitle) {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      });
    }
  }, [store])

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

        setRubricBase64(result);
      };

      // reader.onerror = () => {
      //   console.error("Error reading file");
      // };

      reader.readAsDataURL(rubricFile);
    }

  }

  const onStudentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if ( event.target.files &&
         event.target.files[0].type === "application/pdf" ) {
		  setStudentFile(event.target.files[0]);
    }
	};

  const onStudentUpload = () => {

    if (studentFile) {

      const reader = new FileReader();

      reader.onload = () => {
        const result = reader.result as string;

        // result looks like: "data:application/pdf;base64,JVBERi0xLjcKJ..."
        //const base64String = result.split(",")[1];

        setStudentBase64(result);
      };

      // reader.onerror = () => {
      //   console.error("Error reading file");
      // };

      reader.readAsDataURL(studentFile);
    }

  }
  
  return (
    <div className="pl-8 pr-8">
      <div>
        <h3>Upload Your Rubric</h3>
        <input className="file-input my-4" type="file" onChange={onRubricChange} />
        <button
          className="btn"
          disabled={rubricFile === null} 
          onClick={onRubricUpload}
        >
          Upload
        </button>
        { rubricBase64 !== "" && <p>Successfully uploaded {rubricFile?.name}</p>}
      </div>
      <div>
        <h3>Upload Student Submission</h3>
        <input className="file-input my-4" type="file" onChange={onStudentChange} />
        <button 
          className="btn"
          disabled={studentFile === null} 
          onClick={onStudentUpload}
        >
          Upload
        </button>
        { studentBase64 !== "" && <p>Successfully uploaded {studentFile?.name}</p>}
      </div>
      <div>
        <button 
          className="btn"
          disabled={(rubricBase64 === "" || studentBase64 === "") || getFeedback } 
          onClick={() => {
            setGetFeedback(true)

          }}
        >
          Get Feedback
        </button>
        <Feedback getFeedback={getFeedback} rubricBase64={rubricBase64} studentBase64={studentBase64} />          
      </div>
    </div>
  );
};

export default RubricPage;
