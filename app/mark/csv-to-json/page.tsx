"use client"

import React, { useState } from "react"

function parseCSV(csv: string, options: { hasHeader: boolean; firstColumnIsLabel: boolean }) {
  const { hasHeader, firstColumnIsLabel } = options
  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return []

  const parseLine = (line: string) => {
    const res: string[] = []
    let cur = ""
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        inQuotes = !inQuotes
        continue
      }
      if (ch === "," && !inQuotes) {
        res.push(cur.trim())
        cur = ""
        continue
      }
      cur += ch
    }
    res.push(cur.trim())
    return res
  }

  const rows = lines.map(parseLine)

  let header: string[] | null = null
  if (hasHeader) {
    header = rows.shift() || null
  }

  // Determine percent keys (column headers)
  let percentKeys: string[] = []
  if (header) {
    percentKeys = firstColumnIsLabel ? header.slice(1) : header.slice(0)
  } else {
    // If no header, use first data row to infer keys (or numeric indices)
    const sample = rows[0] || []
    percentKeys = firstColumnIsLabel ? sample.slice(1).map((_, i) => String(i)) : sample.map((_, i) => String(i))
  }

  const data = rows.map(r => {
    const name = firstColumnIsLabel ? (r[0] || "") : ""
    const cells = firstColumnIsLabel ? r.slice(1) : r.slice(0)
    const marks: Record<string, string> = {}
    for (let i = 0; i < percentKeys.length; i++) {
      const key = percentKeys[i] ?? String(i)
      marks[key] = cells[i] ?? ""
    }
    return { criteria: name, marks }
  })

  return data
}

export default function Page() {
  const [csvText, setCsvText] = useState("")
  const [hasHeader, setHasHeader] = useState(true)
  const [firstColumnIsLabel, setFirstColumnIsLabel] = useState(true)
  const [jsonOutput, setJsonOutput] = useState("")

  const handleFile = (f?: File) => {
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? "")
      setCsvText(text)
    }
    reader.readAsText(f)
  }

  const convert = () => {
    try {
      const parsed = parseCSV(csvText, { hasHeader, firstColumnIsLabel })
      setJsonOutput(JSON.stringify(parsed, null, 2))
    } catch (err) {
      setJsonOutput(JSON.stringify({ error: String(err) }, null, 2))
    }
  }

  const download = () => {
    const blob = new Blob([jsonOutput], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "rubric.json"
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <main style={{ padding: 20 }}>
      <h1>CSV → JSON (Rubric)</h1>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 6 }}>Upload CSV file</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={e => handleFile(e.target.files?.[0])}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 6 }}>Or paste CSV content</label>
        <textarea
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
          rows={8}
          style={{ width: "100%" }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ marginRight: 12 }}>
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={e => setHasHeader(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          First row is header (percent columns)
        </label>
        <label>
          <input
            type="checkbox"
            checked={firstColumnIsLabel}
            onChange={e => setFirstColumnIsLabel(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          First column contains criteria labels
        </label>
      </div>

      <div style={{ marginBottom: 12 }}>
        <button onClick={convert} style={{ marginRight: 8 }}>Convert</button>
        <button onClick={() => { setCsvText(""); setJsonOutput("") }}>Clear</button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", marginBottom: 6 }}>JSON output</label>
        <textarea readOnly value={jsonOutput} rows={12} style={{ width: "100%" }} />
      </div>

      <div>
        <button onClick={download} disabled={!jsonOutput}>Download JSON</button>
      </div>
    </main>
  )
}
