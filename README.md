# Feedbacker

[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

AI-assisted feedback that enables educators to feedback smarter, faster, better.

## Table of Contents

- [Feedbacker](#feedbacker)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Built Using](#built-using)
  - [Install](#install)
  - [Run](#run)
  - [Maintainer](#maintainer)
  - [Contributing](#contributing)
  - [License](#license)

## Overview

Below is an overview of the capabilities of Feedbacker.

### Feedback Smarter

- Blends academic expertise with automation and AI
- Keeps feedback human-focused, not machine-generated
- Reduces repetitive work so the educators attention stays on pedagogy
- Helps deliver feedback students can genuinely act on

### Feedback Faster

- Automates the slow, repetitive parts of marking
- Helps produce personalised feedback in less time
- Shortens turnaround without sacrificing quality
- Frees up time for teaching, discussion, and student connection

### Feedback Better

- Makes it clear how students are performing
- Highlights where improvement is needed
- Points students towards actionable next steps
- Combines insight with smart automation for feedback that is more impactful

## Built Using

- [node](https://nodejs.org/en/)
- [Next.js](https://nextjs.org/)
- [OpenRouter](https://openrouter.ai/)

## Install

This project uses [node](http://nodejs.org/) and [pnpm](https://pnpm.io). If you've not done so, please install those first. Then clone this repository, switch to its root directory, and type `pnpm install`.

## Run

You will need to create a `.env` file in the root directory, with the following four variables:

1. NEXT_PUBLIC_OPENROUTER_URL
2. NEXT_PUBLIC_OPENROUTER_KEY
3. NEXT_PUBLIC_OPENROUTER_MODEL
4. NEXT_PUBLIC_TITLE
5. NEXT_PUBLIC_HOMEPAGE

Where NEXT_PUBLIC_OPENROUTER_URL is the URL of the [OpenRouter](https://openrouter.ai/) completions API, NEXT_PUBLIC_OPENROUTER_KEY is the API key and NEXT_PUBLIC_OPENROUTER_MODEL is the AI model to use. NEXT_PUBLIC_TITLE and NEXT_PUBLIC_HOMEPAGE are not important, but define the apps title and public URL.

Once you've defined those variables, you can run a local development server via `pnpm dev`.

## Maintainer

[Steve Huckle](https://huckle.studio/).

## Contributing

Contributions welcome - please email the maintainer.

## License

Creative Commons [Attribution 4.0 International Deed (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)

![CC BY 4.0](https://licensebuttons.net/l/by/4.0/80x15.png)
