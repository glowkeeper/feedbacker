"use client";

import { useContext, useState, useEffect } from "react";

import { routes } from "@/app/config/config";
import { privacyTextShort } from "@/app/config/text";

import { StoreContext, StoreAction } from "@/app/store/store";
import type { Base64File } from "@/app/store/types";
import { getCommentedRubricPrompt } from "@/app/utils/getPrompts";
import { parseRubricPDFFile, logParsingResults, type ParsedRubric } from "@/app/utils/parseRubricPDF";
import { Feedback } from '../Feedback';

interface RubricData {
  file: File;
  base64: string;
  parsed?: ParsedRubric;
  parseError?: string;
}

const CommentedRubric = () => {

  const store = useContext(StoreContext);

  const [rubricFiles, setRubricFiles] = useState<File[]>([]);
  const [rubricData, setRubricData] = useState<RubricData[]>([]);
  const [getFeedback, setGetFeedback] = useState<boolean>(false);
  const [parsing, setParsing] = useState<boolean>(false);

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

  const onRubricUpload = async () => {

    if (rubricFiles.length) {
      setParsing(true)
      const files = [...rubricFiles]
      const data: RubricData[] = []

      for (const file of files) {

        const reader = new FileReader();

        reader.onload = async () => {
          const result = reader.result as string;  
          
          // Parse the rubric PDF
          let parsed: ParsedRubric | undefined;
          let parseError: string | undefined;
          
          try {
            parsed = await parseRubricPDFFile(file);
            logParsingResults(parsed);
            console.log(`✓ Successfully parsed rubric: ${file.name}`);
          } catch (error) {
            parseError = error instanceof Error ? error.message : 'Unknown parsing error';
            console.error(`✗ Failed to parse rubric ${file.name}:`, error);
          }

          const rubricItem: RubricData = {
            file: file,
            base64: result,
            parsed,
            parseError,
          }

          data.push(rubricItem)
          if(data.length === files.length) {
            setRubricData(data)
            setParsing(false)
          }
        };

        reader.onerror = () => {
          console.error("Error reading rubric");
          setParsing(false)
        };

        reader.readAsDataURL(file);
      }      
    }
  }

  return (
    <div className="pl-8 pr-8">
      <div>
        <p><b>{privacyTextShort}</b></p>
        <h3>Upload Your Live Assessment PDFs</h3>
        <input multiple className="file-input my-4" type="file" accept="application/pdf" onChange={onRubricChange} />
        <button
          className="btn"
          disabled={!rubricFiles.length || parsing} 
          onClick={onRubricUpload}
        >
          {parsing ? 'Parsing...' : 'Upload'}
        </button>
        { rubricData.map(data => {
          return (
            <div key={data.file.name} className="my-4">
              <p>
                {data.parseError ? (
                  <span className="text-error">✗ {data.file.name} - Parse error: {data.parseError}</span>
                ) : data.parsed ? (
                  <span className="text-success">✓ {data.file.name} - Found {data.parsed.criteria.length} criteria</span>
                ) : (
                  <span>Processing {data.file.name}...</span>
                )}
              </p>
            </div>
          )
        })}
      </div>
      <div>
        <button 
          className="btn"
          disabled={rubricData.length === 0 || rubricData.some(d => !d.parsed) || getFeedback} 
          onClick={() => {
            setGetFeedback(true)
          }}
        >
          Get Feedback
        </button>

        { getFeedback && rubricData.map(data => {
          if (!data.parsed) return null;

          const prompt = getCommentedRubricPrompt(data.parsed);
          const rubricBase64: Base64File = {
            file: data.file,
            base64: data.base64,
          };

          return (
            <div
              key={data.file.name}
            >
              <hr className="my-4"/>
              <Feedback 
                prompt={prompt} 
                rubric={data.parsed} 
                rubricBase64={rubricBase64} 
                studentBase64={null} 
              />  
            </div>         
        )})}      
      </div>
    </div>
  );
};

export default CommentedRubric;
