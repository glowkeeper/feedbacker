import Image from "next/image";

import { siteTitle } from "@/app/config"

const Home = () => {
  return (
    <>
      <div className="max-sm:hidden">
        <div className="grid grid-cols-3 gap-16">
          
          <div className="home-container">
            <Image
              className='home'
              fill
              src="/images/feedbackSmarter.svg"
              alt="feedback smarter"
              priority={true}
            />
          </div>
          <div className='text-center col-span-2'>  
            <h2>Feedback Smarter</h2>
            <p><i>{siteTitle}</i> changes the way you give feedback. It&apos;s a human-focused tool that blends your expertise with the power of automation and AI.</p>
            <p>By taking care of the repetitive work, <i>{siteTitle}</i> helps you focus on what matters most — giving feedback your students can really use.</p>
          </div>

          <div className='text-center col-span-2'>  
            <h2>Feedback Faster</h2>
            <p><i>{siteTitle}</i> handles the slow parts of marking so you can get to the teaching sooner.</p>
            <p>It helps you create personalised, meaningful feedback in less time — giving you more space for genuine student connection and classroom impact.</p>
          </div>
          <div className="home-container">
            <Image
              className='home'
              fill
              src="/images/feedbackFaster.svg"
              alt="feedback faster"
              priority={true}
            />
          </div>

          <div className="home-container">
            <Image
              className='home'
              fill
              src="/images/feedbackBetter.svg"
              alt="feedback better"
              priority={true}
            />
          </div>
          <div className='text-center col-span-2'>  
            <h2>Feedback Better</h2>
            <p><i>{siteTitle}</i> helps students see how they&apos;re doing, where they can improve, and what comes next.</p>
            <p>By combining your insight with smart automation, <i>{siteTitle}</i> helps you deliver feedback that&apos;s clearer, more actionable, and simply <b>better</b>.</p>
          </div>
        </div>

      </div>
      <div className="md:hidden">
        <h2>Feedback Smarter</h2>
        <p className="text-justify"><i>{siteTitle}</i> changes the way you give feedback. It&apos;s a human-focused tool that blends your expertise with the power of automation and AI.</p>
        <p className="text-justify">By taking care of the repetitive work, <i>{siteTitle}</i> helps you focus on what matters most — giving feedback your students can really use.</p>

        <h2>Feedback Faster</h2>
        <p className="text-justify"><i>{siteTitle}</i> handles the slow parts of marking so you can get to the teaching sooner.</p>
        <p className="text-justify">It helps you create personalised, meaningful feedback in less time — giving you more space for genuine student connection and classroom impact.</p>
        
        <h2>Feedback Better</h2>
        <p className="text-justify"><i>{siteTitle}</i> helps students see how they&apos;re doing, where they can improve, and what comes next.</p>
        <p className="text-justify">By combining your insight with smart automation, <i>{siteTitle}</i> helps you deliver feedback that&apos;s clearer, more actionable, and simply <b>better</b>.</p>
      </div>
    </>
  )
}


export default Home
