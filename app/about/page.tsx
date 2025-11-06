'use client'

import { useContext, useEffect} from "react"

import { siteTitle } from "@/app/config"

import {
  StoreContext,
  StoreAction
} from '@/app/store/store'

const AboutPage = () => {

  const store = useContext(StoreContext)

  const thisTitle = 'about'

  useEffect(() => {
  
    if(store?.state.title != thisTitle) 
    {
      store?.dispatch({
        type: StoreAction.TitleSet,
        payload: thisTitle,
      }) 
    }

  }, [store])

  return (

    <>   
      
      <p>{siteTitle} takes a human-centric approach to marking while using automation and AI to streamline the process.</p>

      <p>The <a href="https://www.gov.uk/government/organisations/ofqual" target="_blank" rel="noreferrer">Office of Qualifications and Examinations Regulation (Ofqual)</a> recognises that <a href="https://www.gov.uk/government/publications/ofquals-approach-to-regulating-the-use-of-artificial-intelligence-in-the-qualifications-sector" target="_blank" rel="noreferrer">AI can enhance assessment quality</a>. However, they also warn that AI can introduce bias, inaccuracies, and a lack of transparency—risks that must be carefully managed when assessment outcomes shape futures.</p>

      <p>Accordingly, Ofqual advises a precautionary approach: AI can assist, but human judgement must remain central to marking design, development, and delivery.</p>

      <p><a href="https://huckle.studio">Dr Steve Huckle</a>—formerly a Lecturer at the <a href="https://www.sussex.ac.uk/" target="_blank" rel="noreferrer">University of Sussex</a> and now a Visiting Tutor at the <a href="https://www.roehampton.ac.uk/" target="_blank" rel="noreferrer">University of Roehampton</a>—demonstrates that principle in practice. As Module Convenor for <a href="https://www.sussex.ac.uk/ei/internal/coursesandmodules/informatics/modules/2023/85872" target="_blank" rel="noreferrer">Programming for 3D</a> at Sussex, he provided rich, constructive feedback that went far beyond simple grading. To make this process more efficient, he built the first prototype of {siteTitle}, combining automation and AI while maintaining full human control of assessment criteria and judgements.</p>

      <p>Since that early version, {siteTitle} has been <b>completely rebuilt from the ground up</b>. It has been <b>rewritten in a new programming language</b> with <b>more powerful rubrics</b> and a <b>robust, re-engineered feedback machanism</b>. The result is a thoroughly modern tool that helps educators mark smarter, faster, and better—producing feedback that genuinely improves learning outcomes by helping students understand their performance and development needs.</p>

      <p>This build of {siteTitle} uses a free, rate-limited large language model (LLM) via <a href="https://openrouter.ai/" target="_blank" rel="noreferrer">OpenRouter</a>, so feedback generation may take some time. If you would like {siteTitle} to use a paid LLM and can provide funding, please contact <a href="https://huckle.studio/" target="_blank" rel="noreferrer">Dr Huckle</a>.</p>

      <p>Alternatively, you can clone the source code via the GitHub link in the footer and deploy your own build with a paid LLM. The {siteTitle} source is released under a <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0 license</a>, allowing you to remix, adapt, and use it—even commercially—so long as you credit <a href="https://huckle.studio/" target="_blank" rel="noreferrer">Dr Steve Huckle</a>. Dr Huckle is also available to assist with new builds if required.</p>

      <p>Navigating AI-enhanced marking means balancing technology with human insight—{siteTitle} achieves that balance, helping you assess <b>smarter</b>, <b>faster</b>, and <b>better</b> than ever before.</p>

      <p>To learn more about {siteTitle}, please contact <a href="https://huckle.studio" target="_blank" rel="noreferrer">Dr Steve Huckle</a>.</p>

    </>
  )
}

export default AboutPage
