"use client";

import { RJSFSchema, UiSchema } from "@rjsf/utils";
import Form from "@rjsf/daisyui";
import validator from "@rjsf/validator-ajv8";

import { IChangeEvent } from "@rjsf/core";

const ACSTemplatePage = () => {

  const schema: RJSFSchema = {
    type: "object",
    properties: {
      firstName: { type: "string", title: "First Name" },
      lastName: { type: "string", title: "Last Name" },
      email: { type: "string", format: "email", title: "Email" },
      phone: { type: "string", title: "Phone" },
    },
  };

  // Use grid layout for the form
  const uiSchema: UiSchema = {
    "ui:field": "LayoutGridField",
    "ui:layoutGrid": {
      "ui:row": {
        children: [
          {
            "ui:row": {
              children: [
                {
                  "ui:col": {
                    children: ["firstName"],
                  },
                },
                {
                  "ui:col": {
                    children: ["lastName"],
                  },
                },
                {
                  "ui:col": {
                    children: ["email"],
                  },
                },
                {
                  "ui:col": {
                    children: ["phone"],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  };

  const onSubmit = (data: IChangeEvent) => {
    console.log('submit', data.formData)
  }

  const onCancel = () => {
    console.log("cancelled")
  }

  return (
    <div className="bg-surface pl-8 pr-8">
      <p>Rubric coming soon...</p>
      <Form schema={schema} uiSchema={uiSchema} validator={validator} onSubmit={onSubmit}>
        <input
          className="btn btn-wide bg-accent text-button-foreground border-button-border cursor-pointer hover:bg-accent-hover active:shadow-xl"
          value="Submit"
          type="submit"
        />
        <button
          className="btn btn-wide bg-accent text-button-foreground border-button-border cursor-pointer hover:bg-accent-hover active:shadow-xl ml-8"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </Form>
    </div>
  );
};

export default ACSTemplatePage;
