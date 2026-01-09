"use client";

import { useContext, useState, useEffect } from "react";
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { rubricPrompt } from "@/app/config";

import { StoreContext, StoreAction } from "@/app/store/store";

import { fetchData } from "@/app/utils/fetchData";

const RubricPage = () => {

  const store = useContext(StoreContext);

  const [rubricFile, setRubricFile] = useState<File | null>(null);
  const [rubricBase64, setRubricBase64] = useState<string>("");
  const [studentFile, setStudentFile] = useState<File | null>(null);
  const [studentBase64, setStudentBase64] = useState<string>("");

  const [feedback, setFeedback] = useState<string>("")

  const thisTitle = "rubric";

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

  const getFeedback = async () => {

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
                  filename: 'rubric.pdf',
                  file_data: rubricBase64,
                },
              },
              {
                type: 'file',
                file: {
                  filename: 'student.pdf',
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

    const fetchedChoices = await fetchData(fetchParams)
    console.log('goit response', fetchedChoices)
    setFeedback(fetchedChoices[0]?.message.content)
  }

  return (
    <div className="pl-8 pr-8">
      <div>
        <h3>Upload Your Rubric</h3>
        <input type="file" onChange={onRubricChange} />
        <button onClick={onRubricUpload}>Upload!</button>
        <p>{rubricBase64}</p>
      </div>
      <div>
        <h3>Upload Student Submission</h3>
        <input type="file" onChange={onStudentChange} />
        <button onClick={onStudentUpload}>Upload!</button>
        <p>{studentBase64}</p>
      </div>
      <div>
        <button onClick={getFeedback}>Get Feedback!</button>
        <Markdown remarkPlugins={[remarkGfm]}>{feedback}</Markdown>
      </div>
    </div>
  );
};

export default RubricPage;
